import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import type { Calendar, Event, OccurrenceIdentity } from "@musubi/types";
import { EventDetailsPopover } from "./EventDetailsPopover";
import { HiddenEventsDialog } from "./HiddenEventsDialog";

vi.mock("./ProviderEventDetails", () => ({ ProviderEventDetails: () => null }));
vi.mock("./EventDeliveryDialog", () => ({ EventDeliveryDialog: () => null }));
afterEach(cleanup);

const id = "11111111-1111-4111-8111-111111111111";
const calendar: Calendar = { id: "calendar", creatorID: "owner", color: "#112233", name: "Work", role: "viewer", members: [] };
const event: Event = { id, creatorID: "owner", originCalendarID: "calendar", calendars: ["calendar"], revision: 4, title: "Work appointment", organizer: "owner", color: "#112233", start: new Date("2026-07-08T09:00:00Z"), end: new Date("2026-07-08T10:00:00Z"), isAllDay: false, isCanceled: false, hasAttendees: false };

function inspector(current = event, master = current, set = vi.fn().mockResolvedValue(undefined), notice = vi.fn()) {
  return <EventDetailsPopover calendar={calendar} calendars={[calendar]} event={current} getEventMaster={() => master} user={{ id: "owner", name: "Owner" }} onNotice={notice} onForkEvent={vi.fn()} onLinkEvent={vi.fn()} onUpdateEvent={vi.fn()} onRemoveEvent={vi.fn()} onSetAttendance={vi.fn()} onSetEventVisibility={set} timeFormat="24h" weekStartsOn="monday"><button>Open event</button></EventDetailsPopover>;
}

async function openMenu() {
  const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: "Open event" }));
  await user.click(screen.getByRole("button", { name: "More event actions" }));
  return user;
}

it("hides a read-only event with a personal preference and offers Undo", async () => {
  const set = vi.fn().mockResolvedValue(undefined);
  const notice = vi.fn();
  render(inspector(event, event, set, notice));
  const user = await openMenu();
  expect(screen.queryByRole("menuitem", { name: "Delete" })).toBeNull();
  await user.click(screen.getByRole("menuitem", { name: "Hide event" }));
  expect(set).toHaveBeenCalledWith({ eventId: id, hidden: true });
  expect(notice).toHaveBeenCalledWith("Event hidden.", { undo: expect.any(Function) });
  await notice.mock.calls[0]![1].undo();
  expect(set).toHaveBeenLastCalledWith({ eventId: id, hidden: false });
});

it("uses the original occurrence identity for a moved exception", async () => {
  const originalStart = { kind: "instant" as const, value: "2026-07-08T09:00:00.000Z" };
  const master = { ...event, recurrence: "FREQ=WEEKLY" };
  const moved: Event & { occurrenceIdentity: OccurrenceIdentity } = { ...event, id: `${id}_1783501200000`, start: new Date("2026-07-09T12:00:00Z"), occurrenceIdentity: { seriesId: id, originalStart } };
  const set = vi.fn().mockResolvedValue(undefined);
  render(inspector(moved, master, set));
  const user = await openMenu();
  expect(screen.getByRole("menuitem", { name: "Hide entire series" })).toBeTruthy();
  await user.click(screen.getByRole("menuitem", { name: "Hide this occurrence" }));
  expect(set).toHaveBeenCalledWith({ eventId: id, originalStart, hidden: true });
});

it("only offers series hiding for legacy recurrence", async () => {
  const master = { ...event, recurrence: "FREQ=WEEKLY" };
  const set = vi.fn().mockResolvedValue(undefined);
  render(inspector({ ...master, id: `${id}_${event.start.getTime()}` }, master, set));
  const user = await openMenu();
  expect(screen.queryByRole("menuitem", { name: "Hide this occurrence" })).toBeNull();
  await user.click(screen.getByRole("menuitem", { name: "Hide entire series" }));
  expect(set).toHaveBeenCalledWith({ eventId: id, hidden: true });
});

it("retains a failed hide for retry without announcing success", async () => {
  const set = vi.fn().mockRejectedValueOnce(new Error("Preference could not be saved.")).mockResolvedValue(undefined);
  const notice = vi.fn();
  render(inspector(event, event, set, notice));
  const user = await openMenu();
  await user.click(screen.getByRole("menuitem", { name: "Hide event" }));
  expect((await screen.findByRole("alert")).textContent).toContain("Preference could not be saved.");
  expect(notice).not.toHaveBeenCalled();
  await user.click(screen.getByRole("button", { name: "More event actions" }));
  await user.click(screen.getByRole("menuitem", { name: "Hide event" }));
  expect(set).toHaveBeenCalledTimes(2);
});

it("recovers hidden items across dates and keeps a failed restore retryable", async () => {
  const originalStart = { kind: "date" as const, value: "2030-12-24" };
  const onRestore = vi.fn().mockRejectedValueOnce(new Error("Try again.")).mockResolvedValue(undefined);
  const user = userEvent.setup();
  render(<HiddenEventsDialog hidden={[{ eventId: id, event }, { eventId: id, originalStart, event: { ...event, title: "Future occurrence" } }]} onClose={vi.fn()} onRestore={onRestore} />);
  const dialog = within(screen.getByRole("dialog", { name: "Hidden events" }));
  expect(dialog.getByText("Occurrence · 2030-12-24")).toBeTruthy();
  await user.click(dialog.getByRole("button", { name: "Show Future occurrence occurrence" }));
  expect(onRestore).toHaveBeenCalledWith({ eventId: id, originalStart });
  expect((await dialog.findByRole("alert")).textContent).toContain("Try again.");
  await user.click(dialog.getByRole("button", { name: "Show Future occurrence occurrence" }));
  expect(onRestore).toHaveBeenCalledTimes(2);
  expect(dialog.queryByRole("alert")).toBeNull();
});
