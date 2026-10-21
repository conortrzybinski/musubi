# Read-only calendar subscriptions

In the web app, open **Connections → Calendar subscriptions → Subscribe to
calendar**. Enter a name and an HTTPS ICS link (a `webcal:` link is upgraded to
HTTPS). For Outlook on the web, obtain the ICS link from **Settings → Calendar →
Shared calendars → Publish a calendar**. The published permissions determine
which details Musubi receives. Keep the link private: it is a bearer credential.

Subscriptions need no Microsoft application registration or OAuth credentials.
The initial fetch must finish successfully before the calendar is created.
Events appear alongside selected Google, Microsoft and local calendars. The
mirror is read-only, including for its creator. Personal hiding remains available.
This feature does not collapse independently imported copies of a meeting;
personal duplicate grouping is a separate planned feature. The existing linked
copy command is not a display grouping command.

## Refresh and removal

The external-account scheduler checks subscriptions at most once every five
minutes. `EXTERNAL_SYNC_INTERVAL_MIN` controls the scheduler itself; a longer
interval delays checks and `0` disables them. **Refresh** in Connections can
refresh a subscription immediately. Outlook controls publication latency and
the date range included in its feed, so a refresh is not a promise of immediate
publication or access to the mailbox's complete history.

The status row shows the last successful refresh and any refresh failure.
ETag/Last-Modified conditional requests avoid reimporting unchanged feeds.
The whole feed is parsed before any import. Accepted snapshots, local removals
and validators commit in one transaction. A failed, truncated or unsupported
feed keeps the previous successful snapshot. A complete empty feed clears its
local mirrored events. Absent items are local feed removals, not proof of an
Outlook deletion. No subscription operation writes back to the publisher.

**Unsubscribe** removes the local calendar, its mirrored events and saved link.
It does not unpublish or modify the Outlook calendar. An in-flight refresh cannot
recreate a removed subscription. To replace a revoked link, unsubscribe and add
the new link; this creates new local event identities and personal hiding choices
must be reapplied.

## Implementation and operational constraints

- Migration `0087_calendar_subscriptions` adds per-user subscriptions, encrypted
  URLs, URL hashes, refresh generations and checkpoint/status fields.
- Links use Better Auth's existing encryption key, outside the database. Preserve
  `BETTER_AUTH_SECRET` along with database backups. Listing endpoints return
  neither the URL, ciphertext, hash nor response validators.
- Fetches use public HTTPS only, validate and pin DNS addresses, validate redirect
  destinations, send no account credentials, time out after 30 seconds, and cap
  decoded bodies at 8 MB and feeds at 10,000 event components. Failure messages
  omit the private link and underlying network exception.
- Recurrence UIDs and original occurrence slots retain local identity across
  refreshes. All-day exclusive end dates, exceptions, cancellations and IANA
  zones are normalized through the existing calendar model. Recognized Outlook
  Windows TZIDs use the CLDR representative IANA zone. Unknown custom zones,
  unsupported recurrence forms reject the snapshot. When a feed omits a series
  master, its explicit occurrences import as standalone events without invented
  recurrence. UID/original-slot keys preserve identity when that master leaves
  or returns; occurrence hiding follows the displayed form, while whole-series
  hiding remains saved for the returning series.
- Subscription reads use complete snapshots and private lifecycle fences;
  outgoing provider adapters are not registered for this provider.

## Validation

`pnpm --filter @musubi/api exec tsx src/sync/ics_feed.test.ts` covers parsing,
stable identities, DST/recurrence, cancellation, response validators, malformed
feeds, size bounds, sanitized errors and private-address redirect rejection.

With a disposable PostgreSQL database and `ENVIRONMENT=test`, run
`pnpm test:db:subscriptions`. It covers encrypted storage, access isolation,
read-only mutation guards, calendar overlay, personal hiding, conditional reads,
snapshot rejection, generation races, series changes and unsubscribe fencing.
Web tests and the Calendar/Subscriptions stories cover form validation, errors,
successful submission and narrow layouts. Live provider acceptance is recorded
separately after the user enters their published link.
