import assert from "node:assert/strict";
import { expandRecurringEvents } from "@musubi/calendar";
import { fetchFeed, normalizeFeedURL, parseFeed, FEED_LIMIT_BYTES } from "./ics_feed";
import { calendarFeed, feedEvent, feedSeries, feedException } from "./ics_feed.fixture";
import { createGuardedCaldavFetch } from "./caldav_client";

async function main() {
  assert.equal(normalizeFeedURL(" webcal://outlook.office365.com/private/calendar.ics "), "https://outlook.office365.com/private/calendar.ics");
  for (const bad of ["file:///etc/passwd", "http://example.test/x", "https://user:pass@example.test/", "https://example.test:8443/x", "https://example.test/x#secret"])
    assert.throws(() => normalizeFeedURL(bad));
  const first = parseFeed(calendarFeed(feedEvent()))[0]!;
  const updated = parseFeed(calendarFeed(feedEvent("one", "Changed")))[0]!;
  assert.equal(first.externalId, updated.externalId);
  assert.notEqual(first.etag, updated.etag);
  assert.equal(first.icalUid, "one");
  assert.equal(first.start.toISOString(), "2026-10-20T14:00:00.000Z");
  assert.equal(first.providerState, undefined);
  const series = parseFeed(calendarFeed(feedException, feedSeries));
  assert.equal(series[0]!.start.toISOString(), "2026-10-26T13:00:00.000Z");
  assert.equal(series[1]!.start.toISOString(), "2026-11-02T16:00:00.000Z");
  assert.deepEqual(series[1]!.originalStart, { kind: "instant", value: "2026-11-02T14:00:00.000Z" });
  const masterID = "11111111-1111-4111-8111-111111111111";
  const expanded = expandRecurringEvents(series.map((event, index) => ({ ...event, id: index ? "22222222-2222-4222-8222-222222222222" : masterID, creatorID: "test", calendars: ["one"], color: "red", hasAttendees: false, seriesID: index ? masterID : null })), new Date("2026-10-25"), new Date("2026-11-12"), { consumerTimeZone: "America/New_York" });
  assert.deepEqual(expanded.map(event => event.start.toISOString()).sort(), ["2026-10-26T13:00:00.000Z", "2026-11-02T16:00:00.000Z", "2026-11-09T14:00:00.000Z"]);
  const allDay = parseFeed(calendarFeed(feedEvent().replace("DTSTART:20261020T140000Z", "DTSTART;VALUE=DATE:20261020").replace("DTEND:20261020T150000Z", "DTEND;VALUE=DATE:20261022")))[0]!;
  assert.equal(allDay.end.toISOString(), "2026-10-21T00:00:00.000Z");
  assert.deepEqual(parseFeed(calendarFeed()), []);
  assert.deepEqual(parseFeed(calendarFeed(feedSeries.replace("SUMMARY:Weekly meeting", "STATUS:CANCELLED\r\nSUMMARY:Weekly meeting"), feedException)), []);
  assert.deepEqual(parseFeed(calendarFeed("BEGIN:VEVENT\r\nUID:cancelled\r\nSTATUS:CANCELLED\r\nEND:VEVENT")), []);
  for (const invalid of ["<html>Sign in</html>", calendarFeed(feedEvent()).replace("END:VCALENDAR", ""), calendarFeed(feedEvent(), feedEvent()), calendarFeed(feedException), calendarFeed(feedSeries.replace(/Eastern Standard Time/g, "Unknown Custom Zone")), calendarFeed(feedEvent().replace("DTSTART:20261020T140000Z", "DTSTART:invalid"))])
    assert.throws(() => parseFeed(invalid), /incomplete|unsupported/);
  const requests: RequestInit[] = [];
  const result = await fetchFeed("https://example.test/private", undefined, async (_url, options) => { requests.push(options!); return new Response(calendarFeed(feedEvent()), { headers: { etag: '"v1"' } }); });
  assert.equal(result.events?.length, 1);
  assert.equal(requests[0]!.method, "GET");
  assert.equal(new Headers(requests[0]!.headers).has("authorization"), false);
  const unchanged = await fetchFeed("https://example.test/private", result, async (_url, options) => {
    assert.equal(new Headers(options!.headers).get("if-none-match"), '"v1"');
    return new Response(null, { status: 304 });
  });
  assert.equal(unchanged.events, null);
  await assert.rejects(fetchFeed("https://example.test/private", undefined, async () => new Response(null, { status: 304 })));
  await assert.rejects(fetchFeed("https://example.test/private", undefined, async () => new Response("x".repeat(FEED_LIMIT_BYTES + 1))), /8 MB/);
  await assert.rejects(fetchFeed("https://example.test/private-secret", undefined, async () => { throw new Error("request failed private-secret"); }), error => error instanceof Error && !error.message.includes("private-secret") && !("cause" in error));
  let dispatched = 0;
  const guarded = createGuardedCaldavFetch({ allowPrivate: false, lookupImpl: async hostname => [{ address: hostname === "public.test" ? "93.184.216.34" : "127.0.0.1", family: 4 }], fetchPinnedImpl: async () => {
    dispatched++;
    return new Response(null, { status: 302, headers: { location: "https://internal.test/private" } });
  } });
  await assert.rejects(fetchFeed("https://internal.test/private", undefined, guarded));
  assert.equal(dispatched, 0);
  await assert.rejects(fetchFeed("https://public.test/private", undefined, guarded));
  assert.equal(dispatched, 1, "redirect to private DNS is rejected before dispatch");
  console.log("ICS feeds: identity, recurrence/DST, complete parsing, validators, size limits, redaction and SSRF passed");
}
void main();
