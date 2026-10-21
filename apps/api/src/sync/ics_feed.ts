import { createHash } from "node:crypto";
import ICAL from "ical.js";
import { canonicalTimeZone, outlookWindowsZone } from "@musubi/calendar";
import { caldavOccurrenceIdentity, normalizeCaldavResource } from "./adapters/caldav_time";
import { createGuardedCaldavFetch } from "./caldav_client";
import type { NormalizedEvent } from "./adapter";

export const FEED_LIMIT_BYTES = 8 * 1024 * 1024;
const MAX_COMPONENTS = 10_000;
export class FeedError extends Error {}
export function normalizeFeedURL(input: string): string {
  let url: URL;
  try { url = new URL(input.trim().replace(/^webcal:/i, "https:")); }
  catch { throw new FeedError("Enter an HTTPS or webcal calendar subscription link."); }
  if (url.protocol !== "https:" || url.username || url.password || url.hash || url.port)
    throw new FeedError("Use an HTTPS calendar link without a password, fragment or custom port.");
  return url.href;
}
export const feedHash = (value: string) => createHash("sha256").update(value).digest("hex");

/** Parse the entire snapshot before accepting any change. A bad component is
 * a failed refresh, never evidence that the other appointments disappeared. */
export function parseFeed(text: string): NormalizedEvent[] {
  try {
    if (Buffer.byteLength(text) > FEED_LIMIT_BYTES || !/^BEGIN:VCALENDAR\r?\n/i.test(text.trim()) || !/\r?\nEND:VCALENDAR$/i.test(text.trim())) throw new Error();
    const calendar = new ICAL.Component(ICAL.parse(text.trim()));
    if (calendar.name !== "vcalendar" || calendar.getFirstPropertyValue("version") !== "2.0") throw new Error();
    const components = calendar.getAllSubcomponents("vevent");
    if (components.length > MAX_COMPONENTS) throw new Error();
    const groups = new Map<string, ICAL.Component[]>();
    for (const component of components) {
      const uid = component.getFirstPropertyValue("uid");
      if (typeof uid !== "string" || !uid.trim() || uid.length > 2048) throw new Error();
      // Outlook publishes Windows TZIDs. Store the CLDR representative IANA
      // zone, preserving wall time and recurrence across daylight-saving time.
      for (const property of component.getAllProperties()) {
        const tzid = property.getParameter("tzid");
        if (tzid) {
          const zone = canonicalTimeZone(tzid) ?? outlookWindowsZone(tzid)?.default;
          if (!zone) throw new Error();
          property.setParameter("tzid", zone);
        }
      }
      groups.set(uid, [...(groups.get(uid) ?? []), component]);
    }
    return [...groups.entries()].flatMap(([uid, family]) => {
      const masters = family.filter(component => !component.hasProperty("recurrence-id"));
      if (!masters.length) {
        // Published feeds may omit the master outside their publication window.
        // Keep only the explicit occurrences, keyed by their original slot;
        // never infer the missing series or generate additional appointments.
        const seen = new Set<string>();
        return family.flatMap(component => {
          const recurrenceID = component.getFirstProperty("recurrence-id")!;
          if (recurrenceID.getParameter("range") || ["rrule", "rdate", "exdate"].some(name => component.hasProperty(name))) throw new Error();
          const original = caldavOccurrenceIdentity(recurrenceID);
          const externalId = `ics:${feedHash(uid)}#musubi-original=${encodeURIComponent(JSON.stringify(original))}`;
          if (seen.has(externalId)) throw new Error();
          seen.add(externalId);
          if (String(component.getFirstPropertyValue("status")).toUpperCase() === "CANCELLED") return [];
          const standalone = new ICAL.Component(structuredClone(component.toJSON()));
          standalone.removeProperty("recurrence-id");
          const resource = new ICAL.Component(["vcalendar", [], []]);
          resource.addPropertyWithValue("version", "2.0");
          resource.addSubcomponent(standalone);
          const data = resource.toString();
          return normalizeCaldavResource({ url: externalId, data, etag: feedHash(data) }).map(({ providerState: _state, ...event }) => event);
        });
      }
      if (masters.length !== 1) throw new Error();
      // Cancelling a series also retires any old overrides. A cancellation
      // tombstone need not repeat the master's original time fields.
      if (String(masters[0]!.getFirstPropertyValue("status")).toUpperCase() === "CANCELLED") return [];
      const resource = new ICAL.Component(["vcalendar", [], []]);
      resource.addPropertyWithValue("version", "2.0");
      for (const component of family) resource.addSubcomponent(component);
      const data = resource.toString();
      return normalizeCaldavResource({ url: `ics:${feedHash(uid)}`, data, etag: feedHash(data) }).map(({ providerState: _state, ...event }) => event);
    });
  } catch {
    throw new FeedError("The feed is incomplete or contains an unsupported event or time zone. No calendar data was changed.");
  }
}

export type FeedSnapshot = { events: NormalizedEvent[] | null; etag: string | null; lastModified: string | null };
const fetchPublic = createGuardedCaldavFetch({ allowPrivate: false });
export async function fetchFeed(input: string, previous?: { etag: string | null; lastModified: string | null }, fetchImpl = fetchPublic): Promise<FeedSnapshot> {
  const url = normalizeFeedURL(input);
  const headers = new Headers({ Accept: "text/calendar", "User-Agent": "Musubi-Calendar-Subscription/1" });
  if (previous?.etag) headers.set("If-None-Match", previous.etag);
  else if (previous?.lastModified) headers.set("If-Modified-Since", previous.lastModified);
  try {
    // Public HTTPS only, DNS pinning and redirect validation are supplied by
    // the existing guarded transport. No cookies or account tokens are sent.
    const response = await fetchImpl(url, { method: "GET", headers, signal: AbortSignal.timeout(30_000) });
    if (response.status === 304 && previous && (previous.etag || previous.lastModified)) {
      await response.body?.cancel();
      return { events: null, etag: previous.etag, lastModified: previous.lastModified };
    }
    if (response.status !== 200) {
      await response.body?.cancel();
      throw new FeedError(response.status === 401 || response.status === 403 || response.status === 404
        ? "The calendar link is unavailable. Check that it is still published."
        : "The calendar could not be refreshed. Please retry later.");
    }
    const reader = response.body?.getReader();
    if (!reader) throw new FeedError("The calendar feed is empty.");
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
      while (true) {
        const chunk = await reader.read();
        if (chunk.done) break;
        size += chunk.value.byteLength;
        if (size > FEED_LIMIT_BYTES) throw new FeedError("The calendar feed exceeds the 8 MB limit.");
        chunks.push(chunk.value);
      }
    } finally { await reader.cancel().catch(() => {}); }
    const validator = (name: string) => { const value = response.headers.get(name); return value && value.length <= 2048 ? value : null; };
    return { events: parseFeed(new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks))), etag: validator("etag"), lastModified: validator("last-modified") };
  } catch (error) {
    // Network/parser exceptions may contain the private feed URL. Never retain
    // their message or cause in API errors, logs or subscription status.
    if (error instanceof FeedError) throw error;
    throw new FeedError("The calendar could not be refreshed. Check the subscription link and try again.");
  }
}
