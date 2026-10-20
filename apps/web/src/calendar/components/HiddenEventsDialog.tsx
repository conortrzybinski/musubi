import type { EventVisibilityTarget, HiddenEvent } from "@musubi/types";
import { Eye } from "lucide-react";
import { useRef, useState } from "react";
import { Button } from "~/components/ui/button";
import { Dialog, DialogBody, DialogContent, DialogHeader, DialogTitle } from "~/components/ui/dialog";
import { Empty } from "~/components/ui/empty";
import { HelpTooltip } from "~/components/ui/help-tooltip";
import { InlineError } from "~/components/ui/inline-error";
import { ItemGroup } from "~/components/ui/item";
import { Row } from "~/components/ui/row";

function targetKey(target: EventVisibilityTarget) {
  return JSON.stringify([target.eventId, target.originalStart ?? null]);
}

function detail(item: HiddenEvent) {
  if (item.originalStart) {
    const date = item.originalStart.kind === "instant"
      ? new Date(item.originalStart.value).toLocaleString()
      : item.originalStart.value.replace("T", " ");
    return `Occurrence · ${date}`;
  }
  return item.event.recurrence ? "Entire series" : item.event.start.toLocaleDateString();
}

export function HiddenEventsDialog({ hidden, onRestore, onClose, returnFocus, offline = false }: {
  hidden: HiddenEvent[];
  onRestore: (target: EventVisibilityTarget) => Promise<void>;
  onClose: () => void;
  returnFocus?: HTMLElement | null;
  offline?: boolean;
}) {
  const [busy, setBusy] = useState<string>();
  const [error, setError] = useState("");
  const bodyRef = useRef<HTMLDivElement>(null);
  const busyRef = useRef(false);
  async function restore(item: HiddenEvent) {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(targetKey(item));
    setError("");
    try {
      await onRestore({ eventId: item.eventId, ...(item.originalStart ? { originalStart: item.originalStart } : {}) });
      // The restored row disappears. Keep the keyboard inside this dialog.
      requestAnimationFrame(() => bodyRef.current?.focus());
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not show this event. Try again.");
    } finally {
      busyRef.current = false;
      setBusy(undefined);
    }
  }
  return <Dialog open onOpenChange={open => { if (!open && !busyRef.current) onClose(); }}>
    <DialogContent size="form" tall aria-describedby={undefined} closeLabel="Close hidden events" returnFocus={returnFocus}>
      <DialogHeader>
        <div className="flex items-center gap-1">
          <DialogTitle>Hidden events</DialogTitle>
          <HelpTooltip label="About hidden events">Hidden across your web calendar views, including linked copies. Reminders and availability stay unchanged. Showing a series keeps any separately hidden occurrences hidden.</HelpTooltip>
        </div>
      </DialogHeader>
      <DialogBody ref={bodyRef} tabIndex={-1}>
        {error ? <InlineError>{error}</InlineError> : null}
        {offline ? <p className="text-13 text-foreground-secondary">Reconnect to show events.</p> : null}
        {hidden.length ? <ItemGroup>
          {hidden.map(item => <Row key={targetKey(item)} label={item.event.title} detail={detail(item)} trailing={
            <Button variant="secondary" size="compact" disabled={offline || Boolean(busy)} loading={busy === targetKey(item)} aria-label={`Show ${item.event.title}${item.originalStart ? " occurrence" : item.event.recurrence ? " series" : ""}`} onClick={() => void restore(item)}><Eye aria-hidden="true" />Show</Button>
          } />)}
        </ItemGroup> : <Empty title="No hidden events" />}
      </DialogBody>
    </DialogContent>
  </Dialog>;
}
