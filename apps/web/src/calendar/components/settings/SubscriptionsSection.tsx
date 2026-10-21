import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link2, RefreshCw, Unlink } from "lucide-react";
import { useState } from "react";
import { getSubscriptions, subscribeCalendar, syncProviderCalendars, unsubscribeCalendar } from "~/api/resources";
import { getServerOrigin, queryKeys } from "~/api/query-keys";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { InlineError } from "~/components/ui/inline-error";
import { Row } from "~/components/ui/row";
import { SettingsSection } from "~/components/ui/settings-section";
import { SubscriptionDialog } from "./SubscriptionDialog";

export function SubscriptionsSection({ userId, onNotice }: { userId: string; onNotice: (message: string) => void }) {
  const queryClient = useQueryClient();
  const origin = getServerOrigin();
  const key = ["subscriptions", origin, userId];
  const subscriptions = useQuery({ queryKey: key, queryFn: ({ signal }) => getSubscriptions(signal), refetchInterval: 30_000 });
  const [trigger, setTrigger] = useState<HTMLElement>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const refresh = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: key }),
      queryClient.invalidateQueries({ queryKey: queryKeys.calendars(origin, userId) }),
      queryClient.invalidateQueries({ queryKey: ["events", origin, userId] }),
    ]);
  };
  async function act(operation: () => Promise<unknown>, notice: string) {
    setBusy(true); setError("");
    try { await operation(); onNotice(notice); }
    catch (failure) { setError(failure instanceof Error ? failure.message : "The subscription could not be updated."); }
    finally { await refresh(); setBusy(false); }
  }
  return <>
    <SettingsSection title="Calendar subscriptions" variant="plain">
      {subscriptions.data?.subscriptions.map(subscription => <Row
        key={subscription.id} icon={<Link2 />} label={<><span className="truncate">{subscription.name}</span><Badge variant="muted">Read only</Badge></>}
        detail={subscription.error ?? (subscription.lastSuccessAt ? `Updated ${new Date(subscription.lastSuccessAt).toLocaleString()}` : "Waiting for refresh")}
        trailing={<>
          <Button aria-label={`Refresh ${subscription.name}`} disabled={busy} size="icon-compact" variant="ghost" onClick={() => void act(() => syncProviderCalendars({ provider: "ics", accountId: subscription.id }), "Subscription refreshed.")}><RefreshCw aria-hidden="true" /></Button>
          <Button aria-label={`Unsubscribe ${subscription.name}`} disabled={busy} size="icon-compact" variant="ghost" onClick={() => void act(() => unsubscribeCalendar(subscription.id), "Subscription removed.")}><Unlink aria-hidden="true" /></Button>
        </>}
      />)}
      {subscriptions.isError ? <InlineError>Subscriptions could not be loaded.</InlineError> : null}
      {error ? <InlineError>{error}</InlineError> : null}
      <div className="flex justify-end"><Button disabled={busy} variant="secondary" onClick={event => setTrigger(event.currentTarget)}><Link2 aria-hidden="true" />Subscribe to calendar</Button></div>
    </SettingsSection>
    {trigger ? <SubscriptionDialog returnFocus={trigger} onOpenChange={open => { if (!open) setTrigger(undefined); }} onSubscribe={async input => {
      await subscribeCalendar(input); await refresh(); onNotice("Calendar subscribed.");
    }} /> : null}
  </>;
}
