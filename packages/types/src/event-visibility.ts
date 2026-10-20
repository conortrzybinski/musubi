import { z } from "zod";
import { EventSchema, type Event } from "./event";
import { OccurrenceStartSchema, occurrenceKey, type OccurrenceIdentity } from "./event_time";

export const EventVisibilityTargetSchema = z.object({
  eventId: z.string().uuid().transform(value => value.toLowerCase()),
  originalStart: OccurrenceStartSchema.optional(),
}).strict();
export type EventVisibilityTarget = z.infer<typeof EventVisibilityTargetSchema>;
export const EventVisibilityRequestSchema = EventVisibilityTargetSchema.extend({ hidden: z.boolean() }).strict();
export type EventVisibilityRequest = z.infer<typeof EventVisibilityRequestSchema>;
export const HiddenEventSchema = EventVisibilityTargetSchema.extend({ event: EventSchema });
export type HiddenEvent = z.infer<typeof HiddenEventSchema>;
export const EventVisibilityDocumentSchema = z.object({ hidden: z.array(HiddenEventSchema) });
export type EventVisibilityDocument = z.infer<typeof EventVisibilityDocumentSchema>;

type VisibilityEvent = Pick<Event, "id" | "recurrence" | "seriesID" | "originalStart"> & {
  occurrenceIdentity?: OccurrenceIdentity;
};

/** Preferences address original slots, never an exception's moved start time.
 * Legacy generated IDs have no portable occurrence identity: hide the series.
 */
export function eventVisibilityTarget(event: VisibilityEvent, scope: "event" | "series" = "event"): EventVisibilityTarget {
  const identity = event.occurrenceIdentity ?? (event.seriesID && event.originalStart
    ? { seriesId: event.seriesID, originalStart: event.originalStart } : undefined);
  if (identity) return EventVisibilityTargetSchema.parse({ eventId: identity.seriesId,
    ...(scope === "event" ? { originalStart: identity.originalStart } : {}) });
  const legacyMaster = event.recurrence ? /^([\da-f-]{36})_-?\d+$/i.exec(event.id)?.[1] : undefined;
  return EventVisibilityTargetSchema.parse({ eventId: event.seriesID ?? legacyMaster ?? event.id });
}

export function eventVisibilityKey(target: EventVisibilityTarget): string {
  return target.originalStart
    ? occurrenceKey({ seriesId: target.eventId, originalStart: target.originalStart })
    : target.eventId.toLowerCase();
}

/** Rendering only. Call after recurrence expansion; keep the raw definitions
 * for reminders, busy-time calculations and provider synchronization.
 */
export function isEventHidden(event: VisibilityEvent, hidden: readonly EventVisibilityTarget[]): boolean {
  if (!hidden.length) return false;
  let target: EventVisibilityTarget;
  try { target = eventVisibilityTarget(event); }
  catch { return false; } // Synthetic task projections are not hideable events.
  return hidden.some(entry => entry.eventId.toLowerCase() === target.eventId &&
    (!entry.originalStart || eventVisibilityKey(entry) === eventVisibilityKey(target)));
}
