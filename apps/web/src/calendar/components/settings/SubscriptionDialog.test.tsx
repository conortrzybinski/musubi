import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { TooltipProvider } from "~/components/ui/tooltip";
import { SubscriptionDialog } from "./SubscriptionDialog";

it("requires both fields and keeps a rejected feed available for correction", async () => {
  const subscribe = vi.fn().mockRejectedValueOnce(new Error("Feed unavailable")).mockResolvedValue(undefined);
  const close = vi.fn();
  render(<TooltipProvider><SubscriptionDialog onSubscribe={subscribe} onOpenChange={close} /></TooltipProvider>);
  fireEvent.click(screen.getByRole("button", { name: "Subscribe" }));
  expect(subscribe).not.toHaveBeenCalled();
  fireEvent.change(screen.getByLabelText("Calendar name"), { target: { value: " VSO " } });
  const link = screen.getByLabelText("Subscription link");
  expect(link.getAttribute("type")).toBe("password");
  fireEvent.change(link, { target: { value: " https://example.test/private.ics " } });
  fireEvent.click(screen.getByRole("button", { name: "Subscribe" }));
  expect((await screen.findByRole("alert")).textContent).toContain("Feed unavailable");
  expect(close).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Subscribe" }));
  await waitFor(() => expect(close).toHaveBeenCalledWith(false));
  expect(subscribe).toHaveBeenLastCalledWith({ name: "VSO", url: "https://example.test/private.ics" });
  expect((link as HTMLInputElement).value).toBe("");
});
