# Personal calendar fork

## Working plan

1. Pin and validate the upstream baseline; create the personal fork.
2. Deliver persistent personal hiding through the database, authenticated API,
   web calendar, search, and an all-date restoration view.
3. Design and implement explicit association of independently imported events,
   then safe detachment, preferred-source conflict visibility, and recovery.
4. Validate with dedicated Google and Microsoft calendars after OAuth setup.
5. Build and deploy the reviewed fork on homelabtower; verify the revision,
   persistent storage, backup, update, and rollback procedures.

The first implementation increment is step 2. Existing upstream linked-copy
creation remains available; merging imported events is a separate future change.
Implementation, GitHub publication, local deployment, and live-provider evidence
must be reported separately.

## Baseline

- Upstream: `https://github.com/f-tuma/musubi`.
- Reviewed and cloned source: `f82cba9cf9e6f7b858c52e3c2361b185b27b520d`.
- Fork: `https://github.com/conortrzybinski/musubi`.
- Implementation branch: `codex/personal-calendar`.
- Runtime used locally: Node 22.22.1 and repository-pinned pnpm 11.8.0.
- Installation uses the unchanged `pnpm-lock.yaml`.
- Deployment host: homelabtower, confirmed by the user. Initial listener is
  loopback-only; public domain and OAuth registration remain pending.

## Hiding policy

Hiding is a private presentation preference for the signed-in user. It never
changes a provider event, calendar membership, shared event revision, attendance,
or outgoing synchronization operation. A viewer can hide a read-only appointment.

The preference belongs to the canonical Musubi event, so all already-linked
copies hide together. Matching titles or times do not link independent events.
For explicit recurrence identities, a user can hide a whole series or one
original occurrence. A moved exception keeps its original identity. Legacy
recurrence without a reliable occurrence identity supports whole-series hiding
only. Restoring a series preference does not erase separately hidden occurrences.

The web calendar and account search apply the preference to presentation. A
dedicated Hidden events view lists accessible saved preferences across dates and
selected calendars and restores each independently. Provider resynchronization
and server restarts do not erase preferences. Removing access prevents the list
from revealing the former event's content.

Reminders, provider notifications, free/busy availability, public/shared views,
and other people's views remain unchanged. The first increment targets the web
client; native mobile clients do not apply these presentation preferences yet.
This limitation must be explicit before relying on hiding across devices.

## Linking findings and next increment

Current source separates canonical events, calendar memberships, provider
mappings, and durable outgoing operations. Its link endpoint adds another
calendar to one canonical event and creates a provider copy. Its list response
collapses copies only when they already share that canonical identity.

Current authority is the origin calendar. Inbound origin changes become
canonical and fan out through persisted operations. Secondary content changes
are rejected during import and logged; immediate divergence visibility needs
improvement. Conditional delivery and recovery already exist and should be
extended rather than replaced.

The existing unlink operation deletes the remote copy. A new detach operation
must preserve the remote appointment and give it an independent local identity.
Do not label the existing operation as a harmless unlink.

For explicit association of imported events, start with nonrecurring personal
appointments and require a selected preferred source plus fresh revisions of
both events. Verify writable destinations, disjoint calendar memberships,
account ownership, supported conditional writes, and absence of pending or
uncertain deliveries. Lock both event records and relevant lifecycle state in a
deterministic order. Transfer mappings without recreating remote events and
retain provider IDs, accepted validators, and immutable delivery history. Retire
the losing local identity through the existing tombstone mechanism.

Before enabling that operation, define migration of personal visibility,
reminders, attendance, provider observations, and recovery references. Never
silently combine events by title/time or discard a pending operation. Meetings,
recurrence families, overlapping calendars, and ambiguous mappings should give
an explicit unsupported result until their semantics are implemented and tested.

## Acceptance evidence

Record actual executed checks in the pull request and operations notes. Local
database and mocked-provider tests are not live Google/Microsoft round trips.
Live writes will use only dedicated calendars agreed with the user. OAuth
registration, tenant permissions, provider accounts, and test calendar IDs are
not configured as part of the hiding increment.

See [personal-fork-operations.md](personal-fork-operations.md) for deployment and
recovery instructions.
