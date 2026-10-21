export function calendarFeed(...events: string[]) {
  return ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Musubi Test//EN", ...events, "END:VCALENDAR"].join("\r\n");
}
export function feedEvent(uid = "one", title = "Meeting") {
  return ["BEGIN:VEVENT", `UID:${uid}`, "DTSTART:20261020T140000Z", "DTEND:20261020T150000Z", `SUMMARY:${title}`, "END:VEVENT"].join("\r\n");
}
export const feedSeries = ["BEGIN:VEVENT", "UID:series", "DTSTART;TZID=Eastern Standard Time:20261026T090000", "DTEND;TZID=Eastern Standard Time:20261026T100000", "RRULE:FREQ=WEEKLY;COUNT=3", "SUMMARY:Weekly meeting", "END:VEVENT"].join("\r\n");
export const feedException = ["BEGIN:VEVENT", "UID:series", "RECURRENCE-ID;TZID=Eastern Standard Time:20261102T090000", "DTSTART;TZID=Eastern Standard Time:20261102T110000", "DTEND;TZID=Eastern Standard Time:20261102T120000", "SUMMARY:Rescheduled meeting", "END:VEVENT"].join("\r\n");
