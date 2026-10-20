import assert from "node:assert/strict";
import { EventVisibilityRequestSchema, eventVisibilityTarget, isEventHidden } from "./event-visibility";

const id = "11111111-1111-4111-8111-111111111111";
const childId = "22222222-2222-4222-8222-222222222222";
const originalStart = { kind: "instant" as const, value: "2026-03-08T13:00:00.000Z" };
const occurrence = { id: `${id}_1772974800000`, recurrence: "FREQ=DAILY", occurrenceIdentity: { seriesId: id, originalStart } };
const target = { eventId: id, originalStart };
assert.deepEqual(eventVisibilityTarget(occurrence), target);
assert.deepEqual(eventVisibilityTarget(occurrence, "series"), { eventId: id });
assert.ok(isEventHidden(occurrence, [target]));
assert.ok(isEventHidden({ id: childId, seriesID: id, originalStart }, [target]), "moved exceptions use the original identity");
assert.ok(isEventHidden(occurrence, [{ eventId: id }]), "whole series applies to generated occurrences");
assert.ok(!isEventHidden({ ...occurrence, occurrenceIdentity: { seriesId: id, originalStart: { ...originalStart, value: "2026-03-09T13:00:00.000Z" } } }, [target]));
assert.deepEqual(eventVisibilityTarget({ id: `${id}_1772974800000`, recurrence: "FREQ=DAILY" }), { eventId: id }, "legacy expansion supports whole-series identity only");
assert.deepEqual(eventVisibilityTarget({ id: `${id}_-86400000`, recurrence: "FREQ=DAILY" }), { eventId: id }, "legacy dates before the Unix epoch still address the series");
assert.ok(!isEventHidden({ id: "task:projection" }, [target]));
assert.ok(!isEventHidden({ id: "fixture" }, []));
for (const kind of ["date", "floating"] as const) {
  const original = { kind, value: kind === "date" ? "2026-03-08" : "2026-03-08T09:00:00" };
  const event = { id: childId, seriesID: id, originalStart: original };
  assert.ok(isEventHidden(event, [{ eventId: id, originalStart: original }]));
  assert.deepEqual(eventVisibilityTarget(event, "series"), { eventId: id });
}
assert.equal(EventVisibilityRequestSchema.parse({ eventId: id.toUpperCase(), hidden: true, originalStart: { kind: "instant", value: "2026-03-08T13:00:00Z" } }).originalStart?.value, originalStart.value);
for (const body of [{ eventId: id }, { eventId: id, hidden: "true" }, { eventId: id, hidden: true, userID: "another-person" }, { eventId: id, hidden: true, originalStart: { kind: "instant", value: "invalid" } }])
  assert.ok(!EventVisibilityRequestSchema.safeParse(body).success);
console.log("event visibility identity tests: OK");
