import { and, eq, isNull } from "drizzle-orm";
import { expandRecurringEvents } from "@musubi/calendar";
import {
  BadRequestError, EventSchema, EventVisibilityRequestSchema, NotFoundError,
  occurrenceKey, type EventVisibilityDocument, type EventVisibilityRequest,
} from "@musubi/types";
import { db } from "..";
import { calendarEvents, calendarMembers, events, eventVisibility } from "../schema";

/** One SQL snapshot joins preference ownership and current membership. Neither
 * revoked access nor a hidden event's private destinations leak into recovery.
 * Deliberately independent of the currently displayed date range.
 */
export async function getEventVisibilityDocument(userID: string): Promise<EventVisibilityDocument> {
  const rows = await db.select({ preference: eventVisibility, event: events, calendarID: calendarEvents.calendarID })
    .from(eventVisibility)
    .innerJoin(events, eq(events.id, eventVisibility.eventID))
    .innerJoin(calendarEvents, eq(calendarEvents.eventID, events.id))
    .innerJoin(calendarMembers, and(eq(calendarMembers.calendarID, calendarEvents.calendarID), eq(calendarMembers.userID, userID)))
    .where(and(eq(eventVisibility.userID, userID), isNull(events.deletedAt)))
    .orderBy(eventVisibility.createdAt, eventVisibility.eventID, eventVisibility.scopeKey, calendarEvents.calendarID);
  const hidden = new Map<string, EventVisibilityDocument["hidden"][number]>();
  for (const { preference, event, calendarID } of rows) {
    const key = `${preference.eventID}:${preference.scopeKey}`;
    const entry = hidden.get(key);
    if (entry) entry.event.calendars.push(calendarID);
    else hidden.set(key, {
      eventId: preference.eventID,
      ...(preference.originalStart ? { originalStart: preference.originalStart } : {}),
      event: EventSchema.parse({ ...event, calendars: [calendarID] }),
    });
  }
  return { hidden: [...hidden.values()] };
}

/** Desired state is safe to retry. This transaction never changes event
 * content, its revision, memberships, reminders, or provider delivery work.
 */
export async function setEventVisibility(userID: string, input: EventVisibilityRequest): Promise<void> {
  const request = EventVisibilityRequestSchema.parse(input);
  const scopeKey = request.originalStart ? `${request.originalStart.kind}:${request.originalStart.value}` : "";
  await db.transaction(async tx => {
    // Lock the actual event and membership used to authorize the preference,
    // keeping recurrence validation and admission in the same transaction.
    const [accessible] = await tx.select({ event: events })
      .from(events)
      .innerJoin(calendarEvents, eq(calendarEvents.eventID, events.id))
      .innerJoin(calendarMembers, and(eq(calendarMembers.calendarID, calendarEvents.calendarID), eq(calendarMembers.userID, userID)))
      .where(and(eq(events.id, request.eventId), isNull(events.deletedAt)))
      .for("share", { of: [events, calendarMembers] });
    if (!accessible) throw new NotFoundError("Event not found.");
    const event = accessible.event;
    if (event.seriesID) throw new BadRequestError("Use the recurring series and original occurrence identity.");

    if (!request.hidden) {
      // Restore remains available even after a series edit removes an old slot
      // or changes its time model. Only the exact personal preference is removed.
      await tx.delete(eventVisibility).where(and(eq(eventVisibility.userID, userID),
        eq(eventVisibility.eventID, request.eventId), eq(eventVisibility.scopeKey, scopeKey)));
      return;
    }
    if (request.originalStart) {
      const original = request.originalStart;
      if (!event.recurrence || !event.timeModel || event.timeModel.kind === "legacy-unknown" || event.isCanceled)
        throw new BadRequestError("This event supports hiding the whole series only.");
      const expectedKind = event.timeModel.kind === "all-day" ? "date" : event.timeModel.kind === "floating" ? "floating" : "instant";
      if (original.kind !== expectedKind) throw new BadRequestError("The occurrence identity does not match this series.");
      const [exception] = await tx.select({ id: events.id }).from(events)
        .where(and(eq(events.seriesID, event.id), eq(events.originalStart, original), isNull(events.deletedAt)));
      if (!exception) {
        const point = new Date(original.kind === "instant" ? original.value : original.kind === "date" ? `${original.value}T00:00:00Z` : `${original.value}Z`);
        let matches = false;
        try {
          const key = occurrenceKey({ seriesId: event.id, originalStart: original });
          matches = expandRecurringEvents([{ ...event, calendars: [] }], point, point, {
            consumerTimeZone: "UTC", maxCandidates: 50_000, maxOccurrences: 50_000, strict: true,
          }).some(candidate => {
            const identity = (candidate as typeof candidate & { occurrenceIdentity?: { seriesId: string; originalStart: typeof original } }).occurrenceIdentity;
            return identity && occurrenceKey(identity) === key;
          });
        } catch {
          throw new BadRequestError("This occurrence cannot be verified. Hide the whole series instead.");
        }
        if (!matches) throw new BadRequestError("The original occurrence is not part of this series.");
      }
    }
    await tx.insert(eventVisibility).values({ userID, eventID: event.id, scopeKey, originalStart: request.originalStart ?? null })
      .onConflictDoNothing();
  });
}
