import type { Meta, StoryObj } from "@storybook/tanstack-react";
import { fn } from "storybook/test";
import { DESKTOP_MODES, MOBILE_MODES } from "../../../.storybook/modes";
import { fixtureEvents } from "../fixtures";
import { HiddenEventsDialog } from "./HiddenEventsDialog";

const eventId = "11111111-1111-4111-8111-111111111111";
const event = { ...fixtureEvents[0]!, id: eventId };
const meta = {
  title: "Calendar/Hidden events",
  component: HiddenEventsDialog,
  parameters: { layout: "fullscreen", chromatic: { modes: DESKTOP_MODES } },
  args: {
    hidden: [{ eventId, event }],
    onRestore: fn(),
    onClose: fn(),
  },
} satisfies Meta<typeof HiddenEventsDialog>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Events: Story = {};
export const SeriesAndOccurrence: Story = { args: { hidden: [
  { eventId, event: { ...event, recurrence: "FREQ=WEEKLY" } },
  { eventId, originalStart: { kind: "date", value: "2026-11-20" }, event },
] } };
export const Empty: Story = { args: { hidden: [] } };
export const Offline: Story = { args: { offline: true } };
export const Narrow: Story = { parameters: { viewport: { value: "mobile" }, chromatic: { modes: MOBILE_MODES } } };
