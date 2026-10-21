import { type FormEvent, useId, useRef, useState } from "react";
import { Button } from "~/components/ui/button";
import { Dialog, DialogBody, DialogClose, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "~/components/ui/dialog";
import { Field, FieldGroup } from "~/components/ui/field";
import { InlineError } from "~/components/ui/inline-error";
import { Input } from "~/components/ui/input";

export function SubscriptionDialog({ onSubscribe, onOpenChange, returnFocus }: {
  onSubscribe: (input: { name: string; url: string }) => Promise<void>;
  onOpenChange: (open: boolean) => void;
  returnFocus?: HTMLElement | null;
}) {
  const formId = useId();
  const nameRef = useRef<HTMLInputElement>(null);
  const [name, setName] = useState("");
  const [url, setURL] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!name.trim() || !url.trim()) { setError("Enter a name and calendar subscription link."); return; }
    setBusy(true); setError("");
    try {
      await onSubscribe({ name: name.trim(), url: url.trim() });
      setURL(""); onOpenChange(false);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Could not subscribe to this calendar.");
    } finally { setBusy(false); }
  }
  return <Dialog open onOpenChange={next => { if (!busy) onOpenChange(next); }}>
    <DialogContent aria-describedby={undefined} closeLabel="Close subscription form" initialFocus={nameRef} returnFocus={returnFocus} size="compact">
      <DialogHeader><DialogTitle>Subscribe to calendar</DialogTitle></DialogHeader>
      <DialogBody>
        <form id={formId} noValidate onSubmit={event => void submit(event)}>
          <FieldGroup>
            <Field label="Calendar name"><Input ref={nameRef} disabled={busy} maxLength={100} placeholder="Work" value={name} onChange={event => setName(event.target.value)} /></Field>
            <Field label="Subscription link" help="Paste the ICS link from Outlook’s Publish a calendar settings. Anyone with this link can read the published details. Musubi refreshes it every five minutes while scheduled sync is enabled; Outlook may publish changes later.">
              <Input autoComplete="off" disabled={busy} maxLength={8192} placeholder="https://…/calendar.ics" spellCheck={false} type="password" value={url} onChange={event => setURL(event.target.value)} />
            </Field>
            {error ? <InlineError>{error}</InlineError> : null}
          </FieldGroup>
        </form>
      </DialogBody>
      <DialogFooter><DialogClose asChild><Button disabled={busy} variant="secondary">Cancel</Button></DialogClose><Button form={formId} loading={busy} type="submit">Subscribe</Button></DialogFooter>
    </DialogContent>
  </Dialog>;
}
