import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import express from "express";
import { and, eq, inArray } from "drizzle-orm";
import {
  db, user, calendarMembers, createCalendar, createEvent, events, externalEvents,
  eventOutbox, eventVisibility, getEvent, getUsersEvents, getEventVisibilityDocument,
  getRemindersDocument, setEventReminder, replaceMemberToken,
} from "@musubi/db";
import { CLIENT_VERSION_HEADER, PRODUCT_VERSION, EventVisibilityDocumentSchema, isEventHidden } from "@musubi/types";
import { issueMemberToken } from "../federation_tokens";
import { requireAuth } from "../middleware/require_auth";
import { middlewareErrorHandler } from "../middleware/error_handler";
import { handlerGetEventVisibility, handlerPutEventVisibility } from "./event_visibility";

// Authenticated HTTP and a disposable PostgreSQL database. No provider HTTP.
async function main() {
  assert.equal(process.env.ENVIRONMENT, "test");
  const people = await Promise.all(["owner", "viewer", "stranger"].map(async name => {
    const id = `visibility-${name}-${randomUUID()}`, token = issueMemberToken();
    await db.insert(user).values({ id, name, email: `${id}@example.test`, isExternal: true });
    await replaceMemberToken(id, token.tokenHash);
    return { id, token: token.raw };
  }));
  const [owner, viewer, stranger] = people;
  function serve() {
    const app = express();
    app.use(express.json());
    app.get("/api/v1/event-visibility", requireAuth, handlerGetEventVisibility);
    app.put("/api/v1/event-visibility", requireAuth, handlerPutEventVisibility);
    app.use(middlewareErrorHandler);
    return app.listen(0, "127.0.0.1");
  }
  let server = serve();
  await new Promise<void>(resolve => server.once("listening", resolve));
  const call = async (person: typeof owner | null, body?: unknown) => {
    const res = await fetch(`http://127.0.0.1:${(server.address() as { port: number }).port}/api/v1/event-visibility`, {
      method: body === undefined ? "GET" : "PUT",
      headers: { ...(person ? { authorization: `Bearer ${person.token}` } : {}),
        [CLIENT_VERSION_HEADER]: PRODUCT_VERSION, "content-type": "application/json" },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    return { status: res.status, cache: res.headers.get("cache-control"), body: res.status === 204 ? undefined : await res.json() };
  };
  try {
    const shared = await createCalendar({ creatorID: owner.id, name: "Shared", color: "#112233" });
    const privateCopy = await createCalendar({ creatorID: owner.id, name: "Private copy", color: "#112233" });
    await db.insert(calendarMembers).values({ calendarID: shared.id, userID: viewer.id, role: "viewer" });
    const values = { creatorID: owner.id, title: "Far future linked appointment", color: "#112233", organizer: owner.id,
      start: new Date("2035-01-02T09:00:00Z"), end: new Date("2035-01-02T10:00:00Z") };
    const event = await createEvent({ id: randomUUID(), ...values }, [shared.id, privateCopy.id]);
    await db.insert(externalEvents).values({ provider: "google", eventID: event.id, calendarID: privateCopy.id,
      externalCalendarID: "test-calendar", externalEventID: "remote-preserved", etag: '"before"' });
    await setEventReminder(viewer.id, event.id, { minutesBefore: 10, allDay: null });
    const reminders = await getRemindersDocument(viewer.id);
    const mapping = await db.select().from(externalEvents).where(eq(externalEvents.eventID, event.id));
    assert.equal((await call(null)).status, 401);
    assert.equal((await call(null, { eventId: event.id, hidden: true })).status, 401);
    assert.equal((await call(stranger, { eventId: event.id, hidden: true })).status, 404);
    assert.equal((await call(viewer, { eventId: randomUUID(), hidden: true })).status, 404);
    assert.equal((await call(viewer, { eventId: event.id, hidden: true, userID: owner.id })).status, 400);

    const hidden = { eventId: event.id, hidden: true };
    for (const result of await Promise.all([call(viewer, hidden), call(viewer, hidden)])) assert.equal(result.status, 204);
    const read = await call(viewer);
    assert.equal(read.cache, "private, no-store");
    const document = EventVisibilityDocumentSchema.parse(read.body);
    assert.equal(document.hidden.length, 1, "concurrent retries create one preference");
    assert.deepEqual(document.hidden[0].event.calendars, [shared.id], "private linked calendars are not disclosed");
    assert.equal(document.hidden[0].event.start.getUTCFullYear(), 2035, "recovery is independent of visible dates");
    assert.deepEqual((await call(owner)).body, { hidden: [] }, "preferences belong only to the actor");
    assert.deepEqual((await call(stranger)).body, { hidden: [] });
    assert.deepEqual(await getEvent(event.id), event, "presentation must not change content, revision or timestamps");
    assert.deepEqual(await db.select().from(externalEvents).where(eq(externalEvents.eventID, event.id)), mapping);
    assert.equal((await db.select().from(eventOutbox).where(eq(eventOutbox.eventID, event.id))).length, 0);
    assert.deepEqual(await getRemindersDocument(viewer.id), reminders);
    assert.ok((await getUsersEvents(viewer.id)).some(row => row.event.id === event.id), "raw events remain available for reminders and availability");

    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    server = serve();
    await new Promise<void>(resolve => server.once("listening", resolve));
    assert.deepEqual((await call(viewer)).body, read.body, "fresh API instance reads persisted preference");
    await db.delete(calendarMembers).where(and(eq(calendarMembers.userID, viewer.id), eq(calendarMembers.calendarID, shared.id)));
    assert.deepEqual((await call(viewer)).body, { hidden: [] }, "revoked membership removes recovery content");
    assert.equal((await call(viewer, { ...hidden, hidden: false })).status, 404);
    await db.insert(calendarMembers).values({ calendarID: shared.id, userID: viewer.id, role: "viewer" });
    assert.equal((await call(viewer, { ...hidden, hidden: false })).status, 204);
    assert.equal((await call(viewer, { ...hidden, hidden: false })).status, 204);
    assert.deepEqual((await call(viewer)).body, { hidden: [] });

    const series = await createEvent({ ...values, id: randomUUID(), title: "DST series",
      start: new Date("2026-03-07T14:00:00Z"), end: new Date("2026-03-07T15:00:00Z"), recurrence: "FREQ=DAILY;COUNT=3",
      timeModel: { kind: "zoned", timeZone: "America/New_York", startLocal: "2026-03-07T09:00:00.000", endLocal: "2026-03-07T10:00:00.000" },
    }, [shared.id]);
    const originalStart = { kind: "instant" as const, value: "2026-03-08T13:00:00.000Z" };
    assert.equal((await call(viewer, { eventId: series.id, originalStart, hidden: true })).status, 204, "DST identity uses the original instant");
    assert.equal((await call(viewer, { eventId: series.id, originalStart: { ...originalStart, value: "2026-03-08T14:00:00Z" }, hidden: true })).status, 400);
    assert.equal((await call(viewer, { eventId: series.id, originalStart: { kind: "date", value: "2026-03-08" }, hidden: true })).status, 400);
    const moved = await createEvent({ ...values, id: randomUUID(), seriesID: series.id, originalStart,
      start: new Date("2026-03-09T18:00:00Z"), end: new Date("2026-03-09T19:00:00Z"),
      timeModel: { kind: "zoned", timeZone: "America/New_York", startLocal: "2026-03-09T14:00:00.000", endLocal: "2026-03-09T15:00:00.000" },
    }, [shared.id]);
    assert.ok(isEventHidden(moved, (await getEventVisibilityDocument(viewer.id)).hidden), "a moved exception stays hidden by its original slot");
    assert.equal((await call(viewer, { eventId: series.id, hidden: true })).status, 204);
    assert.equal((await call(viewer, { eventId: series.id, hidden: false })).status, 204);
    assert.equal((await getEventVisibilityDocument(viewer.id)).hidden.length, 1, "restoring a series preserves its separately hidden occurrence");
    await db.update(events).set({ recurrence: null }).where(eq(events.id, series.id));
    assert.equal((await call(viewer, { eventId: series.id, originalStart, hidden: false })).status, 204, "obsolete occurrence preferences remain recoverable");

    for (const kind of ["all-day", "floating"] as const) {
      const master = await createEvent({ ...values, id: randomUUID(), isAllDay: kind === "all-day",
        start: new Date("2026-07-01T00:00:00Z"), end: new Date("2026-07-01T01:00:00Z"), recurrence: "FREQ=DAILY;COUNT=3",
        ...(kind === "all-day" ? { end: new Date("2026-07-01T00:00:00Z"), timeModel: { kind } }
          : { timeModel: { kind, startLocal: "2026-07-01T00:00:00.000", endLocal: "2026-07-01T01:00:00.000" } }),
      }, [shared.id]);
      const original = kind === "all-day" ? { kind: "date", value: "2026-07-02" } : { kind: "floating", value: "2026-07-02T00:00:00.000" };
      assert.equal((await call(viewer, { eventId: master.id, originalStart: original, hidden: true })).status, 204, `${kind} occurrences have portable identities`);
    }
    const legacy = await createEvent({ ...values, id: randomUUID(), recurrence: "FREQ=DAILY;COUNT=3" }, [shared.id]);
    assert.equal((await call(viewer, { eventId: legacy.id, originalStart, hidden: true })).status, 400);
    assert.equal((await call(viewer, { eventId: legacy.id, hidden: true })).status, 204);
    await db.update(events).set({ deletedAt: new Date() }).where(eq(events.id, legacy.id));
    assert.ok(!(await getEventVisibilityDocument(viewer.id)).hidden.some(entry => entry.eventId === legacy.id));
    assert.equal((await call(viewer, { eventId: legacy.id, hidden: false })).status, 404);
    await db.update(events).set({ deletedAt: null }).where(eq(events.id, legacy.id));
    assert.ok((await getEventVisibilityDocument(viewer.id)).hidden.some(entry => entry.eventId === legacy.id), "provider revival retains the preference");
    assert.equal((await db.select().from(eventVisibility).where(eq(eventVisibility.userID, owner.id))).length, 0);
    console.log("event visibility authenticated HTTP/DB tests: OK");
  } finally {
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    await db.delete(user).where(inArray(user.id, people.map(person => person.id)));
    await db.$client.end();
  }
}
void main();
