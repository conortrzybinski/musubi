import type { Meta, StoryObj } from "@storybook/tanstack-react";
import { expect, fn, userEvent, within } from "storybook/test";
import { DESKTOP_MODES, MOBILE_MODES } from "../../../../.storybook/modes";
import { SubscriptionDialog } from "./SubscriptionDialog";

const meta = { title: "Calendar/Subscriptions", component: SubscriptionDialog,
  parameters: { layout: "fullscreen", chromatic: { modes: DESKTOP_MODES } },
  args: { onSubscribe: fn(async () => {}), onOpenChange: fn() },
} satisfies Meta<typeof SubscriptionDialog>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Form: Story = {};
export const Narrow: Story = { parameters: { viewport: { value: "mobile" }, chromatic: { modes: MOBILE_MODES } } };
export const Subscribe: Story = { play: async ({ canvasElement, args }) => {
  const screen = within(canvasElement.ownerDocument.body);
  await userEvent.type(screen.getByLabelText("Calendar name"), "VSO");
  await userEvent.type(screen.getByLabelText("Subscription link"), "https://example.test/calendar.ics");
  await userEvent.click(screen.getByRole("button", { name: "Subscribe" }));
  await expect(args.onSubscribe).toHaveBeenCalledWith({ name: "VSO", url: "https://example.test/calendar.ics" });
} };
