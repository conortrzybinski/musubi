# Personal fork: baseline and operations

Assessment dated 20 October 2026. This is deployment preparation, not a record
of a server deployment or live provider acceptance. Fork:
[conortrzybinski/musubi](https://github.com/conortrzybinski/musubi).

## Reproducible source baseline

- The implementation starts at upstream
  `f82cba9cf9e6f7b858c52e3c2361b185b27b520d`, exactly the brief's reviewed SHA.
- GitHub's latest published upstream release was verified as
  [v0.2.11](https://github.com/f-tuma/musubi/releases/tag/v0.2.11), published
  `2026-10-16T16:12:41Z`. The local tag resolves to
  `b85a57500ad81b47603a705290e215270a642a95`.
- `git diff --stat v0.2.11..f82cba9` contains only `apps/web/src/brand.ts`,
  `docs/brand-asset-spec.md`, and `docs/brand-assets.md`. The additional source
  commit changes the favicon source; it does not change the database or sync
  implementation. This comparison establishes source differences, not a
  running container's identity.
- Both baselines have root version `0.2.11` and migration journal index 85,
  `0085_graph_read_coverage` (86 entries). The personal-fork migration is
  additional; use the final reviewed checkout's journal at deployment.
- The README and public-doc source still describe `0.2.2`; the checked-in
  `0.2.3` runbook contains historical publication holds. Use their operational
  invariants, but do not mistake those dated records for today's release state.
- The lockfile selects `pnpm@11.8.0`. Both Dockerfiles pin the same Node 22
  Alpine base digest. Use the existing Dockerfiles and frozen lockfile, and
  record the full final fork commit and resulting image IDs. Package version
  alone cannot distinguish this fork from upstream.

Use Node **22.23.1** for local checks, recorded in `.node-version` and verified
inside the pinned image. The host's older 22.22.1 failed existing clean-process
ESM import assertions in the config and calendar tests; 22.23.1 supplies the
expected named exports. Do not disable those assertions. The host's Corepack
0.24 also cannot launch pnpm 11.8.0; a current Corepack or direct execution of
that exact downloaded pnpm version avoids changing the repository lockfile.

## Account and editing evidence

Multiple-account support exists in source: authenticated `linkSocial` permits
different email addresses; OAuth credentials and imported calendars retain the
provider/account identity; discovery enumerates all eligible accounts. Relevant
sources are [auth configuration](../../packages/auth/src/lib/auth.ts),
[OAuth queries](../../packages/db/src/queries/oauth.ts), and
[web connections](../../apps/web/src/calendar/connections.ts). This assessment
has not connected the user's accounts or verified their tenant's policies.

Use Settings → Connections after signing in; sign-in alone is an identity flow.
Web connections currently request Tasks alongside Calendar permissions:

| Provider | Required setup for the existing web flow |
| --- | --- |
| Google | Enable Calendar and Tasks APIs. Supply `GOOGLE_WEB_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`; register the Web redirect `{BETTER_AUTH_URL}/api/auth/callback/google`. The flow requests Calendar events, calendar list, calendars and Tasks scopes, offline access and consent. Free/busy adds a separate scope only when enabled. |
| Microsoft | Supply `MICROSOFT_CLIENT_ID` and `MICROSOFT_CLIENT_SECRET`; register a **Web** redirect `{BETTER_AUTH_URL}/api/auth/callback/microsoft`. Existing provider documentation specifies `openid User.Read Calendars.ReadWrite Tasks.ReadWrite offline_access`. `MICROSOFT_TENANT_ID` defaults to `common`; restricting it requires the actual intended tenant ID. Tenant consent and access must be established with the user's organization. |

The requested work-calendar workflow needs particular care: source support does
not mean arbitrary Microsoft 365 meetings are editable. The bounded specialized
Microsoft content/time paths require the connected owner's verified default
calendar and exclude shared/delegated copies, online meetings and attachments.
Recurrence has explicit finite-family, exception and zone restrictions. Google
read-only calendars remain read-only; Google organizer/occurrence actions also
have source identity and scope restrictions. Linking cannot grant provider
permission. See the source
[Microsoft guide](../../packages/docs/src/content/docs/providers/microsoft.mdx),
[Google guide](../../packages/docs/src/content/docs/providers/google.mdx), and
[dated capability matrix](../../packages/docs/src/content/docs/operations/capabilities.mdx).

Core flags are off in `.env.example`. In particular, time edits,
organizer edits, RSVP, provider reminders and Google availability have separate
gates. A gate enables admission to the supported contract, not every edit shape.
Choose the required flags only after testing the intended operation in dedicated
calendars. The fork does not change these defaults or remove provider guards.

## Ubuntu staging configuration and first deployment

### Host conventions

This is an independent CLI-managed Compose project, following the host's
standalone Health Journal convention. CasaOS is not its lifecycle manager;
do not use CasaOS Apply/Uninstall on it. Keep CasaOS port 80 reserved, bind every
new published port explicitly to IPv4, preserve the intentional absence of
router port forwarding, and do not change Docker group membership or sudo
policy. The `127.0.0.1:7532` listener satisfies those constraints. Sources in the
registered personal wiki: `wiki/systems/host-homelabtower.md`,
`wiki/patterns/ipv4-bind-suppresses-ipv6.md`,
`wiki/patterns/never-assume-standing-sudo.md`, `wiki/meta/ownership.md`, and
`wiki/components/health-journal.md` (read 20 October 2026).

### Staging configuration

The user confirmed that the current host is `homelabtower`; staging is local
on that Ubuntu server. Use the distinct Compose project `musubi-personal` and
bind only `127.0.0.1:7532`. This creates separate named volumes and avoids the
existing host services and public ports. Domain/DNS and provider integration
are deferred by the user. No live account connection is needed for this stage.
The future external rollout still needs the public origin, provider app
registrations/consent and exact test-calendar IDs.

The supported full stack needs Docker Engine with Compose, a single public
origin, persistent PostgreSQL/media/Caddy volumes and one API replica. The API
acquires its singleton lock before applying migrations. The gateway must keep
`/api/stream` unbuffered. PostgreSQL and API/web ports stay internal; expose only
the gateway. The personal override replaces inherited ports 80/443 with the
loopback port and forces `PUBLIC_HOST=:80`. For this staging instance set
`BETTER_AUTH_URL=http://127.0.0.1:7532`, with no `/api` suffix. A future public
deployment needs an explicitly configured HTTPS origin and proxy/TLS routing.
The current web product targets desktop and tablet; phone browsers retain upstream's native-app gate.

Copy `.env.example` to a private environment file outside the repository and
restrict permissions to the operator. Set `MUSUBI_PERSONAL_ENV_FILE` to its
absolute path. Before first boot, complete this checklist:

- Set `POSTGRES_USER`, `POSTGRES_DB`, a strong `POSTGRES_PASSWORD`,
  `ENVIRONMENT=prod`, `BETTER_AUTH_URL`, and `PUBLIC_HOST`. Compose builds a
  database URL using these credentials; avoid unescaped URL-reserved characters
  in the password when using that template.
- Generate `BETTER_AUTH_SECRET` with `openssl rand -base64 32`; preserve it in
  the secrets backup. Replacing it invalidates sessions and prevents decrypting
  existing OAuth tokens. Never put the value in this document or Git.
- Leave OAuth values empty for local staging; configure them later using the
  provider setup above. Set all SMTP settings to actual values, or clear the
  sample SMTP host/user/password: the template has nonempty placeholders and the
  API checks SMTP before listening. Email verification requires working SMTP.
- Preserve the default five-minute polling and independent delivery recovery
  unless a tested operational requirement changes them. Polling zero and
  disabled background recovery are **not** write kill switches: request wakeups
  can still dispatch accepted work.
- Leave optional S3, VAPID and CalDAV settings empty unless used. Local media
  goes into the persistent `media` volume. Back up `CALDAV_ENC_KEY` if configured.

The base Compose file pulls upstream images. Always layer the committed
[personal override](../../docker-compose.personal.yml) over it to build this
fork's API and web together. It requires Compose support for `!override`; this
configuration was verified with the host's Compose 5.6.0. From a clean, reviewed fork checkout on the target, with
`MUSUBI_PERSONAL_ENV_FILE` already set to the private environment file:

```sh
git status --short
export MUSUBI_FORK_REV=$(git rev-parse HEAD)
export COMPOSE_FILE=docker-compose.yml:docker-compose.personal.yml
export COMPOSE_PROJECT_NAME=musubi-personal
docker compose --env-file "$MUSUBI_PERSONAL_ENV_FILE" config --quiet
docker compose --env-file "$MUSUBI_PERSONAL_ENV_FILE" build api web
docker image inspect "musubi-personal-api:$MUSUBI_FORK_REV" \
  "musubi-personal-web:$MUSUBI_FORK_REV" \
  --format '{{.Id}} {{index .Config.Labels "org.opencontainers.image.revision"}}'
docker compose --env-file "$MUSUBI_PERSONAL_ENV_FILE" up -d
docker compose --env-file "$MUSUBI_PERSONAL_ENV_FILE" ps
docker compose --env-file "$MUSUBI_PERSONAL_ENV_FILE" logs --tail 100 api
```

Resolve a dirty `git status` before assigning the revision label. The override's
`pull_policy: never` applies to API/web and prevents replacement by registry
images. PostgreSQL/Caddy keep the base stack's upstream images. Build labels
record the declared revision; retain the clean-checkout record and actual image
IDs as well. For stronger infrastructure reproducibility, capture the resolved
PostgreSQL/Caddy image digests before rollout; their base Compose tags float.

Record the actual migration journal (`drizzle.__drizzle_migrations`), image IDs,
running container creation/start times and API startup result. Check local
`/api/v1/server/ok`, `/api/v1/server`, login, authenticated reads and the browser
stream. Health proves startup only. Verify the personal feature explicitly in
the browser; the API's version string remains upstream's release version.

## Acceptance before real calendar use

Using only agreed test calendars, connect two Google accounts and the work
Microsoft account. Confirm account/calendar ownership and access, reconnect and
token refresh, read-only refusal, then create/edit an ordinary one-off event in
each writable provider and read it back independently in Google/Outlook.
Include timed, all-day and a relevant DST/recurring example within the provider
contract. Record native IDs and delivery state privately; do not use matching
title/time as proof of identity. Check application restart and provider polling
without duplicate creation.

Test hiding separately from provider mutation: hide, refresh/restart/sync,
inspect hidden items, unhide and independently confirm unchanged remote events.
Linked-copy association, propagation, conflicts and partial-failure acceptance
must be recorded separately when that increment is implemented. Existing
membership links do not prove merging independently imported events works.
Keep synthetic test results, historical upstream live evidence, this fork's
live round trips and deployment evidence distinct.

## Backup, update and recovery

Before an update, record the current configuration/gates, image IDs, migration
journal and outstanding/uncertain delivery state. Keep the existing Compose
project name/directory so its persistent volumes are reused. Build the new
reviewed images before maintenance, then block public writes and stop the API
and any custom consumers; do not overlap old and new API processes.

With the original database still running and the Compose variables above still
exported, create a private custom-format dump through the complete stack:

```sh
set -eu
umask 077
mkdir -p backups
musubi_backup_file="backups/musubi-$(date -u +%Y%m%dT%H%M%SZ).dump"
docker compose --env-file "$MUSUBI_PERSONAL_ENV_FILE" exec -T db sh -ceu \
  'pg_dump -Fc --no-owner --no-acl -U "$POSTGRES_USER" -d "$POSTGRES_DB"' \
  > "$musubi_backup_file.partial"
docker compose --env-file "$MUSUBI_PERSONAL_ENV_FILE" exec -T db pg_restore --list \
  < "$musubi_backup_file.partial" > /dev/null
mv -- "$musubi_backup_file.partial" "$musubi_backup_file"
./ops/verify-postgres-backup.sh "$musubi_backup_file"
```

This follows `ops/backup-postgres.sh`'s archive checks but uses both Compose files
and the private env-file location. The original helper defaults to the base
Compose file, whose API expects a repository `.env`; do not use that default
unchanged for this staging layout. Failed dumps remain `.partial` and are not
recovery artifacts. Schedule verified backups and retention once the target
operational policy is selected; copy them off the host.

The verification helper starts isolated PostgreSQL 17 and restores a custom
archive; despite its historical usage text, plain SQL is not accepted. A
successful restore plus nonempty tables is a useful check; additionally compare
the restored journal and selected counts to the source.

Back up local media (or the selected S3 backend), the private environment file,
encryption keys and deployment configuration separately; the database helper does not include them.
Start one new API, verify migration/read behavior and matching web image, then
reopen access after scoped smoke checks.

Migrations are forward-only. An image downgrade alone is not a safe rollback.
For restore recovery, stop all writes/consumers, retain an incident dump and
provider-effect evidence, restore the verified pre-upgrade dump into a clean
database and use the exact previous API/web images, secrets and consistent
media. A restore does not undo Google/Outlook changes: reconcile delivered or
uncertain writes before reopening and never blindly repeat a CREATE. Preserve
accepted outbox envelopes and receipts; older workers may not understand them.
The [0.2.3 recovery discussion](../releases/0.2.3-deployment.md) documents these
decoder/Graph-read boundaries; its historical publication workflow is not the
personal fork's deployment mechanism.

No production server or live provider account was changed by this preparation.
