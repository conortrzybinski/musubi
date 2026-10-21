import { randomUUID } from "node:crypto";
import { expandRecurringEvents } from "@musubi/calendar";
import { and, eq, or, sql } from "drizzle-orm";
import { BadRequestError, NotFoundError, DEFAULT_CALENDAR_COLOR, type EventTimeModel, type OccurrenceStart } from "@musubi/types";
import { db, calendarSubscriptions, calendars, calendarMembers, externalCalendars, externalEvents, eventVisibility } from "..";
import { lockCalendarLifecycle, lockUserLifecycle } from "./calendar-lifecycle";
import { removeCalendarInTransaction, type DbTransaction } from "./calendars";
import { upsertExternalEventInTransaction, deleteExternalEventInTransaction } from "./external";

export type SubscriptionEvent = {
  externalId: string; status: "active" | "cancelled"; title: string; start: Date; end: Date;
  isAllDay: boolean; description: string | null; location: string | null; organizer: string | null;
  recurrence: string | null; url: string | null; etag?: string | null; icalUid?: string | null;
  timeModel?: EventTimeModel; externalSeriesID?: string | null; originalStart?: OccurrenceStart | null; isCanceled?: boolean;
};
export type SubscriptionSnapshot = { events: SubscriptionEvent[] | null; etag: string | null; lastModified: string | null };
type Subscription = typeof calendarSubscriptions.$inferSelect;

/** Validate complete incoming families independently of historical local
 * tombstones. An exception removed by this snapshot must not veto a master's
 * transition to a one-off or a different time kind. */
function validateSnapshot(events: SubscriptionEvent[]) {
  const active = events.filter(event => event.status === "active");
  const identities = new Map(active.map(event => [event.externalId, randomUUID()]));
  if (identities.size !== active.length) throw new Error("Duplicate subscription event identity.");
  const families = new Map<string, SubscriptionEvent[]>();
  for (const event of active) {
    if (!event.timeModel || !event.icalUid) throw new Error("Subscription event identity is missing.");
    const root = event.externalSeriesID ?? event.externalId;
    if (!identities.has(root)) throw new Error("Subscription occurrence has no master.");
    families.set(root, [...(families.get(root) ?? []), event]);
  }
  for (const [rootID, family] of families) {
    const master = family.find(event => event.externalId === rootID);
    if (!master || master.externalSeriesID || family.some(event => event.icalUid !== master.icalUid)) throw new Error("Invalid subscription family.");
    expandRecurringEvents(family.map(event => ({ ...event, id: identities.get(event.externalId)!,
      seriesID: event.externalSeriesID ? identities.get(event.externalSeriesID)! : null })),
      master.start, master.end, { consumerTimeZone: "UTC", strict: true, maxCandidates: 10_000 });
  }
}

export async function listSubscriptions(userID: string) {
  return db.select({ id: calendarSubscriptions.id, calendarId: calendarSubscriptions.calendarID, name: calendarSubscriptions.name,
    lastAttemptAt: calendarSubscriptions.lastAttemptAt, lastSuccessAt: calendarSubscriptions.lastSuccessAt, error: calendarSubscriptions.error })
    .from(calendarSubscriptions).where(eq(calendarSubscriptions.userID, userID));
}

async function applySnapshot(tx: DbTransaction, subscription: Subscription, snapshot: SubscriptionSnapshot) {
  const [source] = await tx.select().from(externalCalendars).where(and(eq(externalCalendars.calendarID, subscription.calendarID),
    eq(externalCalendars.provider, "ics"), eq(externalCalendars.userID, subscription.userID), eq(externalCalendars.accountID, subscription.id), eq(externalCalendars.disabled, false)));
  const [calendar] = await tx.select().from(calendars).where(eq(calendars.id, subscription.calendarID));
  if (!source || !calendar) throw new Error("Subscription source changed.");
  let changed = false;
  if (snapshot.events) {
    validateSnapshot(snapshot.events);
    const incoming = new Set(snapshot.events.filter(event => event.status === "active").map(event => event.externalId));
    const existing = await tx.select().from(externalEvents).where(and(eq(externalEvents.provider, "ics"), eq(externalEvents.calendarID, subscription.calendarID)));
    // Retire missing exceptions before replacing their master. Every accepted
    // snapshot and its validators commit as one unit, including an empty feed.
    for (const old of existing.sort((a, b) => Number(!!b.externalSeriesID) - Number(!!a.externalSeriesID))) {
      if (!incoming.has(old.externalEventID)) changed = (await deleteExternalEventInTransaction(tx, "ics", subscription.calendarID, old.externalEventID)).changed || changed;
    }
    for (const event of snapshot.events) {
      if (event.status === "cancelled") continue;
      if (!event.timeModel || !event.icalUid) throw new Error("Subscription event identity is missing.");
      // The complete new family was validated above. Historical retired
      // exceptions must not participate in this complete-snapshot replacement.
      const previous = existing.find(row => row.externalEventID === event.externalId);
      changed = await upsertExternalEventInTransaction(tx, true, "ics", subscription.userID, subscription.calendarID, subscription.id,
        event.externalId, { ...event, organizer: event.organizer ?? "", color: calendar.color }, event.etag ?? null, event.icalUid, undefined,
        { timeModel: event.timeModel, externalSeriesID: event.externalSeriesID, originalStart: event.originalStart, isCanceled: event.isCanceled }) || changed;
      // Hiding follows the explicitly published occurrence when its master
      // leaves/returns to the feed window. Move slot preferences, and retain
      // whole-series intent on the master for when that series reappears.
      if (previous?.externalSeriesID && previous.originalStart && !event.externalSeriesID) {
        const parent = existing.find(row => row.externalEventID === previous.externalSeriesID);
        if (!parent) throw new Error("Subscription occurrence lost its parent mapping.");
        const slot = `${previous.originalStart.kind}:${previous.originalStart.value}`;
        const preferences = await tx.select().from(eventVisibility).where(and(eq(eventVisibility.eventID, parent.eventID),
          or(eq(eventVisibility.scopeKey, ""), eq(eventVisibility.scopeKey, slot)))).for("update");
        for (const preference of preferences) await tx.insert(eventVisibility).values({ userID: preference.userID,
          eventID: previous.eventID, scopeKey: "", originalStart: null }).onConflictDoNothing();
        const wholeSeriesUsers = new Set(preferences.filter(preference => preference.scopeKey === "").map(preference => preference.userID));
        for (const preference of preferences) {
          // Preserve an independently saved slot alongside whole-series hiding.
          if (preference.scopeKey !== slot || wholeSeriesUsers.has(preference.userID)) continue;
          await tx.delete(eventVisibility).where(and(eq(eventVisibility.userID, preference.userID),
            eq(eventVisibility.eventID, parent.eventID), eq(eventVisibility.scopeKey, slot)));
        }
      } else if (previous && !previous.externalSeriesID && event.externalSeriesID && event.originalStart) {
        const [parent] = await tx.select().from(externalEvents).where(and(eq(externalEvents.provider, "ics"),
          eq(externalEvents.calendarID, subscription.calendarID), eq(externalEvents.externalEventID, event.externalSeriesID)));
        if (!parent) throw new Error("Subscription occurrence has no parent mapping.");
        const preferences = await tx.select().from(eventVisibility).where(eq(eventVisibility.eventID, previous.eventID)).for("update");
        const wholeSeries = await tx.select({ userID: eventVisibility.userID }).from(eventVisibility)
          .where(and(eq(eventVisibility.eventID, parent.eventID), eq(eventVisibility.scopeKey, ""))).for("update");
        const wholeSeriesUsers = new Set(wholeSeries.map(preference => preference.userID));
        for (const preference of preferences) {
          if (wholeSeriesUsers.has(preference.userID)) continue;
          await tx.insert(eventVisibility).values({ userID: preference.userID,
            eventID: parent.eventID, scopeKey: `${event.originalStart.kind}:${event.originalStart.value}`, originalStart: event.originalStart }).onConflictDoNothing();
        }
        await tx.delete(eventVisibility).where(eq(eventVisibility.eventID, previous.eventID));
      }
    }
  }
  await tx.update(calendarSubscriptions).set({ etag: snapshot.etag, lastModified: snapshot.lastModified, lastSuccessAt: new Date(), error: null })
    .where(eq(calendarSubscriptions.id, subscription.id));
  return changed;
}

export async function createSubscription(userID: string, input: { name: string; encryptedURL: string; urlHash: string }, snapshot: SubscriptionSnapshot) {
  if (!snapshot.events) throw new Error("Initial subscription requires a full snapshot.");
  return db.transaction(async tx => {
    await lockUserLifecycle(tx, [userID], "exclusive");
    const existing = await tx.select({ id: calendarSubscriptions.id, hash: calendarSubscriptions.urlHash }).from(calendarSubscriptions).where(eq(calendarSubscriptions.userID, userID));
    if (existing.some(row => row.hash === input.urlHash)) throw new BadRequestError("This calendar is already subscribed.");
    if (existing.length >= 20) throw new BadRequestError("The subscription limit is 20 calendars.");
    const id = randomUUID();
    const [calendar] = await tx.insert(calendars).values({ creatorID: userID, name: input.name, color: DEFAULT_CALENDAR_COLOR }).returning();
    await tx.insert(calendarMembers).values({ userID, calendarID: calendar.id, role: "viewer" });
    await tx.insert(externalCalendars).values({ provider: "ics", userID, accountID: id, accountLabel: input.name, calendarID: calendar.id,
      externalCalendarID: id, supportsEvents: true, supportsTasks: false });
    const [subscription] = await tx.insert(calendarSubscriptions).values({ id, userID, calendarID: calendar.id, ...input, lastAttemptAt: new Date() }).returning();
    await applySnapshot(tx, subscription, snapshot);
    return { id, calendarId: calendar.id };
  });
}

/** Incrementing generations fence concurrent refreshes and disconnected rows.
 * Network I/O runs outside the transaction; only the newest claim may commit. */
export async function claimSubscription(userID: string, id: string, force = false) {
  const [row] = await db.update(calendarSubscriptions).set({ generation: sql`${calendarSubscriptions.generation} + 1`, lastAttemptAt: new Date() })
    .where(and(eq(calendarSubscriptions.userID, userID), eq(calendarSubscriptions.id, id),
      force ? undefined : sql`(${calendarSubscriptions.lastAttemptAt} is null or ${calendarSubscriptions.lastAttemptAt} < now() - interval '5 minutes')`)).returning();
  return row;
}

export async function commitSubscription(snapshotOfSource: Subscription, snapshot: SubscriptionSnapshot) {
  return db.transaction(async tx => {
    await lockUserLifecycle(tx, [snapshotOfSource.userID], "shared");
    await lockCalendarLifecycle(tx, [snapshotOfSource.calendarID], "exclusive");
    const [current] = await tx.select().from(calendarSubscriptions).where(and(eq(calendarSubscriptions.id, snapshotOfSource.id),
      eq(calendarSubscriptions.userID, snapshotOfSource.userID), eq(calendarSubscriptions.generation, snapshotOfSource.generation))).for("update");
    if (!current) return false;
    return applySnapshot(tx, current, snapshot);
  });
}
export async function failSubscription(source: Subscription, message: string) {
  await db.update(calendarSubscriptions).set({ error: message }).where(and(eq(calendarSubscriptions.id, source.id),
    eq(calendarSubscriptions.userID, source.userID), eq(calendarSubscriptions.generation, source.generation)));
}
export async function removeSubscription(userID: string, id: string) {
  return db.transaction(async tx => {
    await lockUserLifecycle(tx, [userID], "exclusive");
    const [row] = await tx.select().from(calendarSubscriptions).where(and(eq(calendarSubscriptions.userID, userID), eq(calendarSubscriptions.id, id)));
    if (!row) throw new NotFoundError("Subscription not found.");
    await lockCalendarLifecycle(tx, [row.calendarID], "exclusive");
    await removeCalendarInTransaction(tx, row.calendarID);
    return row.calendarID;
  });
}
