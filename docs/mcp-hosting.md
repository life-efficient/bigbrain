# Hosting BigBrain MCP for a Team

BigBrain can expose one configured brain over HTTP as an MCP server. The server
does not discover or publish every brain on the device. It serves the
`brain_dir` from the config used to start `bigbrain mcp`.

This is the server-managed relationship behind the user-facing action
**Connect to an existing BigBrain**. The same runtime contract covers two
deployment variants:

- hosted by us: operated on our infrastructure
- self-hosted/on-premises: deployed into an operator-controlled environment

Both variants should use BigBrain's server runtime adapter instead of
brain-specific wrapper code for route allowlists, dashboard protection, member
seeding, sync, git backup, public pages, shared groups, and raw-file exposure.
Docker is the canonical package for either variant. A Docker deployment remains
server-managed when it runs on the same physical machine as its client because
the client connects to an independently managed service.

Git backup is optional. This keeps device-local use, workshops, and initial
onboarding available without requiring every user to create a remote
repository. A tracked upstream is strongly recommended for server deployments
whose runtime filesystem can disappear. The ordinary health check reports a
low-severity recommendation when Git or a tracked upstream is not configured.
Once an upstream is configured, it warns when local changes or commits have not
been backed up, the runtime has diverged from the upstream, or the backup status
cannot be verified.

One process serves one brain. Do not multiplex several brains through one
runtime or database. Give every deployed brain its own deployment, database,
member directory, authentication configuration, secrets, and backup lifecycle.
Several deployments can run the same BigBrain release independently.

The server is still a knowledge service, not an agent runtime. Agents
visit it over MCP/API when they need memory, search, query, or controlled
writes. The agents themselves can live in Codex, Relay, Claude, local scripts,
or other tools.

## Public Boundary

The hosting wrapper or platform decides what is public by starting BigBrain with
a specific config:

```sh
bigbrain --config /path/to/config.json mcp --host 0.0.0.0 --port "$PORT"
```

Only the configured `brain_dir` is reachable through MCP tools. Page reads,
lists, creates, and updates are constrained to that brain root.

Use a separate deployment per shared brain. Do not point a server deployment at
a personal brain unless that is intentionally what you want to publish.

## Private Canonical Page Links

Every markdown page has a stable private dashboard route:

```text
/dashboard/page/<brain_id>/<canonical-slug>
```

The MCP `read` and `get_page_visibility` responses include a directly clickable,
stable loopback link:

```text
http://127.0.0.1:55559/page/brn_01234567-89ab-4cde-8fab-0123456789ab/organizations/acme-intralog
```

Use the returned `local_url`; do not guess a port or brain ID. The response also
includes `brain_id`, `page_url`, and `page_url_path`. The BigBrain desktop app
owns port `55559`, listens only on `127.0.0.1`, resolves the immutable brain ID
against its connected brains, and opens the matching private dashboard route.
The desktop app must be running and the brain must already be connected. The
resolver does not proxy page content or store remote credentials.

The brain ID in this route is an identity assertion against the one brain served
by that process. It never selects a different brain or filesystem root. Missing
pages, malformed slugs, traversal attempts, and mismatched brain IDs return
`404`.

On a server-managed deployment, the desktop resolver opens `page_url` at the
configured service origin. That route remains behind the existing dashboard
authentication. It is not a public-sharing link. An unauthenticated remote
request is denied or sent through the configured OAuth flow. Agents should
return:

- `local_url` when the user wants to open the private page in their connected
  local BigBrain desktop app
- `page_url` when the user is authorized to view the protected server dashboard
- `public_url` only after explicit publication and only when the user asked for
  a public sharing link

## Public Body-Only Pages

A server-managed BigBrain can publish individual approved pages at
`/public/<slug>`.
Public publishing is internal by default: a page is public only when its
visibility is explicitly set to:

```yaml
visibility: public
```

The public renderer exposes only the current page body above the timeline
separator. It does not expose frontmatter, timeline entries, task metadata, raw
files, graph data, search, dashboard state, or unapproved linked pages.

Public page URLs use the canonical brain slug:

```text
https://your-service.example.com/public/ops/example-onboarding
```

The visibility MCP tools return that full URL directly. When
`get_page_visibility` or `set_page_visibility` reports `visibility: public`,
the `public_url` field is an absolute, directly shareable URL such as
`https://your-service.example.com/public/ops/example-onboarding`. The response
also keeps `path`, `slug`, `visibility`, `public_raw_files`, and
`public_url_path` for callers that need the canonical brain slug or relative
route. The private `page_url` remains separate. Internal pages return
`public_url: null`.

The body-only JSON surface is:

```text
GET /api/public/page?slug=ops/example-onboarding
```

That API returns only `slug`, `title`, `summary`, `markdown`, and `updated_at`
for public pages. Missing pages, invalid paths, and pages without
`visibility: public` return `404`. Missing or invalid visibility values fall
back to `internal`.

Internal brain links are active only when the target page is also public. Links
to private pages or raw files are rendered as plain text. Linked pages are never
published automatically.

To revoke publication, set visibility back to `internal` from the dashboard page
sidecar or the `set_page_visibility` MCP tool, then sync or redeploy the server
as usual. Ordinary page create/update tools ignore visibility fields so
pages are not published by accident.

## Persistence Boundary

Server deployments should treat the app container filesystem as disposable. For
redeploy-heavy services, all mutable runtime state must be stored on persistent
storage:

- embeddings and embedding chunks
- compact brain Git durability state
- OAuth clients, grants, sessions, and issued MCP tokens
- bounded MCP audit logs and contribution attribution
- health findings

Markdown remains canonical and should continue to live in the selected brain
home or a git-backed content repo. Database state is a durable runtime
projection and operational ledger. It should be rebuildable from markdown where
possible, but redeploys should not force re-embedding, re-authentication, or
loss of activity history.

Preferred server storage variants:

- local development: SQLite or local Postgres
- bundled server: app service plus local Postgres/pgvector with a persistent
  volume or database service
- managed Postgres: the same Postgres schema pointed at a provider such as
  Supabase when needed

Use a generic `DATABASE_URL` Postgres contract for server deployments. Do not
make the core server model depend on Supabase-specific APIs; Supabase should be
one possible Postgres target rather than the product boundary.

## Raw File Uploads

Before writing a page or upload, an MCP harness should call `filing_rules`.
That tool reads the selected brain's top-level `FILING.md` file, actual
top-level folders, and collection `FILING.md` files, falling back to collection
`README.md` files for older brains. It returns combined Markdown as the primary
tool content, preserving free-form notes from those filing files. Structured
content also includes the source paths and best-effort extracted sections, but
the tool does not recommend a destination path.

The MCP server exposes raw-file CRUD tools for inputs such as PDFs,
screenshots, transcripts, slide decks, and spreadsheets:

- `filing_rules`
- `list_raw_files`
- `read_raw_file`
- `create_raw_file`
- `update_raw_file`
- `delete_raw_file`

Use `create_raw_file` to upload a remote file without a markdown page,
`create_raw_file_with_page` to upload a remote file and create a markdown
metadata page in the same call, `read_raw_file` to download the raw bytes as
base64, and `update_raw_file` to replace the bytes of an existing upload.

The tool `create_raw_file_with_page` writes a raw file and its indexed attachment
sidecar together. The sidecar path is deterministic: `<collection>/.raw/<basename>.md`.
It may contain comprehensive extraction and synthesis as well as metadata. Public
sidecar routes render the bound raw artifact, never the private sidecar Markdown.

Required fields:

- `path` or `raw_path`: destination under `<collection>/.raw/<filename>`, for
  example `deals/.raw/blind-teaser.pdf` for a deal-owned teaser,
  `meetings/.raw/call-transcript.txt` for a meeting transcript,
  `deliverables/.raw/partner-brief.pdf` for a deliverable-owned upload, or
  `writing/.raw/unassigned-evidence.pdf` when the upload has no clearer owning
  collection yet. Follow the selected brain's `filing_rules`; choose the
  collection by the artifact's role, not only its file type. Do not nest
  page-slug folders or any other folders inside `.raw`; use collision-safe
  filenames.
- `raw_content_base64` or `raw_content_text`: provide exactly one. Use base64
  for PDFs and other binary files.
- `title`, `body`, `timeline_entry`: the indexed attachment sidecar content.
  `page_path` is optional and, when supplied, must equal the deterministic
  same-basename `<collection>/.raw/<slug>.md` path derived from `raw_path`.

For local binary artifacts, the normal upload path is still MCP:

1. Read the local file on the client side.
2. Base64 encode the bytes.
3. Pass the encoded string as `raw_content_base64` to `create_raw_file` or
   `create_raw_file_with_page`.
4. Verify with `list_raw_files` and, when possible, `read_raw_file`; compare the
   decoded byte count or checksum with the local source file.

Do not add a server-side `local_filepath` field for remote MCP uploads. A path
such as `/Users/alice/report.pdf` exists on the client machine, not on the
hosted MCP server, and remote servers must not read arbitrary client paths. If a
client surface makes large base64 arguments awkward, use
`scripts/prepare-raw-upload.mjs` with `--call --mcp-name <name>` to read the
local file, encode it, submit it through the authenticated Codex MCP credential,
and verify the uploaded bytes with `list_raw_files` and `read_raw_file`.
Without `--call`, the helper prints the MCP tool name, arguments, source byte
count, and SHA-256 so another authenticated MCP client can submit the request.
Direct git pushes to the backing brain repo are not an ingestion substitute.

Example:

```sh
node scripts/prepare-raw-upload.mjs \
  --call \
  --mcp-name example-brain \
  --file ./evidence-deck.pptx \
  --raw-path deals/.raw/example-deal-deck.pptx
```

Raw reads return `content_base64` so binary files can round-trip safely. The
generated page from `create_raw_file_with_page` gets a `raw_file` frontmatter
field and a `## Source File` link back to the raw upload. Canonical markdown
pages remain the searchable surface. Raw sidecar markdown under `.raw/` is
metadata for the raw file and should not be shown as the public item when a
group shares that raw file; published group views should show the raw file
itself.

Raw uploads are limited to 25 MiB decoded bytes by default so git-backed brains
do not accept files likely to break backup or sync. The limit can be changed
with `raw_file_max_bytes` in the brain config or `BIGBRAIN_RAW_FILE_MAX_BYTES`
in the server environment. Compress oversized PDFs/images/decks before upload,
or store a summary and external link in the brain instead of committing the raw
file.

Hosted sync is embedding-incremental. It refreshes embeddings only for pages
whose embedding row is missing, whose embedding model changed, or whose content
hash changed. The sync report includes `embedding_selection` and
`embedding_guard` so operators can see why pages were selected. To prevent an
accidental full-brain embedding backfill, sync skips embedding calls when the
selected page count exceeds `max_embedding_pages_per_sync` (default 1000), or
the `BIGBRAIN_MAX_EMBEDDING_PAGES_PER_SYNC` environment override. Raise that
cap only for intentional backfills.

## Auth Modes

BigBrain MCP supports these auth modes:

- `none`: no auth. Use only for local development.
- `token`: one shared bearer token from `BIGBRAIN_MCP_TOKEN` or
  `MCP_AUTH_TOKEN`.
- `oauth_allowlist`: Google OAuth invite flow that issues per-user MCP tokens
  to allowlisted team members.

Shared or internet-reachable server deployments should use `oauth_allowlist`.

## Server Tool Policy

Server OAuth MCP tokens are scoped before tools are listed or called.
Device-local `none` auth and shared `token` auth remain unscoped for development
and trusted single-operator deployments. In `oauth_allowlist` mode, per-user
tokens use these scopes:

- `brain:read`: read-only tools, including `me`, members/tasks listing,
  `search`, `query`, `list`, `read`, `filing_rules`, `list_raw_files`, and
  `read_raw_file`.
- `brain:create`: append/create tools, including task writes, `create_page`,
  `update_page`, `create_raw_file`, and `create_raw_file_with_page`.
- `brain:publish`: page visibility publishing tools, including
  `set_page_visibility` and `groups_upsert`. Public group creation and updates
  stay in this layer because they can expose curated summaries and raw files.
- `brain:raw:destructive`: destructive raw-file replacement/deletion through
  `update_raw_file`, `rename_raw_file`, and `delete_raw_file`.
- `brain:git-backup`: explicit git publishing through `maintenance/git_backup`.
- `brain:maintenance`: explicit maintenance operations such as
  `maintenance/sync`.
- `brain:admin`: all MCP tools.

The older `brain:write` scope is still accepted for append/create tools so
existing tokens can continue contributing pages and tasks, but it does not grant
destructive raw-file, git-backup, or maintenance/admin capabilities.

New dynamic OAuth clients receive `brain:read brain:create` by default. The
server will issue only scopes listed in `BIGBRAIN_MCP_OAUTH_ALLOWED_SCOPES`
(space- or comma-separated); the default ceiling is also
`brain:read brain:create`. Add privileged scopes such as `brain:publish`,
`brain:raw:destructive`, `brain:git-backup`, `brain:maintenance`, or
`brain:admin` only on deployments where connected allowlisted users should be
able to request them. Unsupported or out-of-ceiling scope requests are rejected
instead of being upgraded to a default grant. Existing scope-less token records
retain the legacy `brain:read brain:write` interpretation.

The dashboard can use the same `oauth_allowlist` configuration. Device-local
dashboard use stays unauthenticated on `127.0.0.1` by default; shared server
deployments should bind explicitly and rely on the Google allowlist session:

```sh
bigbrain --config /path/to/config.json dashboard --host 0.0.0.0 --port "$PORT"
```

The current file-backed token store is acceptable for local development or
small persistent-volume deployments. The target server model should store token
hashes, OAuth grants, sessions, and client metadata in the persistent database
so redeploys do not invalidate connected agents.

## OAuth Allowlist Setup

Required environment:

```text
BIGBRAIN_MCP_AUTH_MODE=oauth_allowlist
BIGBRAIN_MCP_PUBLIC_URL=https://your-service.example.com
BIGBRAIN_MCP_SERVICE_NAME=Example Brain
DATABASE_URL=postgres://...
BIGBRAIN_MCP_ALLOWED_EMAILS=alice@example.com,bob@example.com
BIGBRAIN_MCP_ALLOWED_DOMAINS=example.com
BIGBRAIN_MCP_GOOGLE_CLIENT_ID=...
BIGBRAIN_MCP_GOOGLE_CLIENT_SECRET=...
```

Set `BIGBRAIN_MCP_TOKEN_STORE` only for file-backed SQLite or persistent-volume
deployments. When the BigBrain config uses `storage_backend: "postgres"`, OAuth
client, state, code, and token records are stored in Postgres instead. Health
checks also upsert one compact server git durability state row per brain,
including upstream head, runtime checkout head, dirty/ahead/behind status, last
checked time, latest error, and needs-attention status. MCP audit logs remain a
separate bounded stream for meaningful writes, destructive/admin operations,
maintenance actions, and auth/security failures without storing full payloads.

At least one of `BIGBRAIN_MCP_ALLOWED_EMAILS` or
`BIGBRAIN_MCP_ALLOWED_DOMAINS` must be set, unless active members have already
been created in the brain database. Members are the durable allowlist model for
shared server deployments:

```sh
bigbrain --config /path/to/config.json members add alice@example.com people/alice --name Alice
```

Each member links an authenticated email to a canonical `people/<slug>` page.
Only active members can be assigned tasks. Active intake is task-only.

Create a Google OAuth client with this redirect URI:

```text
https://your-service.example.com/auth/callback
```

Use the Google Auth Platform client UI for this credential. The `gcloud iam
oauth-clients` commands create IAM/IAP OAuth clients, which are not accepted by
the public `accounts.google.com` OAuth endpoint used by BigBrain's Google
allowlist flow.

Then send teammates to:

```text
https://your-service.example.com/connect
```

For dashboard deployments, send teammates to the service root. They sign in
with Google and receive a secure dashboard session cookie if their email is
allowlisted.

For MCP deployments, `/connect` shows the first-class Codex connection command:

```sh
bigbrain connect codex https://your-service.example.com/mcp \
  --name example-brain \
  --auth oauth
```

OAuth is the default when connecting to a shared or internet-reachable
BigBrain. The command registers the MCP endpoint and starts Codex's OAuth login.
Codex owns the per-user OAuth credential; BigBrain does not copy it into a
repository, shell profile, environment file, command line, or generated
configuration. Each connection has its own MCP name and credential, so one
Codex installation can connect to multiple BigBrain services without sharing or
overwriting authentication state.

The command is idempotent for the same name and endpoint and reports conflicts
instead of silently replacing another registration. After setup, open a fresh
Codex task and verify an authenticated tool listing plus the connected brain
identity. Merely finding a configuration entry or environment variable is not
end-to-end success; classify a failed live check as unreachable, not logged in,
or connected to the wrong brain.

Shared-token auth is a fallback only for trusted, single-operator deployments:

```sh
printf '%s' "$BIGBRAIN_CONNECTION_TOKEN" | \
  bigbrain connect codex https://your-service.example.com/mcp \
    --name example-brain \
    --auth token \
    --token-stdin
```

Pass the token only through standard input. Do not put it in an argument, source
file, repository, Codex configuration, shell history, plist, log, or diagnostic
output. BigBrain stores fallback credentials in a machine-local, owner-only,
per-connection credential file; names and storage identifiers must not reuse a
global `BIGBRAIN_MCP_TOKEN` across brains. The command keeps secrets out of
normal and JSON output. Restart Codex, then verify the authenticated tool
listing and connected brain identity in a fresh task.

OAuth connections do not depend on a GUI application's inherited shell
environment. The token fallback does require a full Codex restart: a running
macOS application cannot acquire an environment variable that was published
after it started. Its BigBrain-owned, per-connection loader replaces
project-specific token loaders.

OAuth access and dashboard session tokens are stored as hashes in
`BIGBRAIN_MCP_TOKEN_STORE` or, for server deployments, the database-backed token
store.

## Contribution Attribution

Writes made with OAuth-issued tokens are attributed in timeline entries:

```text
- **2026-06-17** | Updated partner context. (via alice@example.com)
```

Git backup commits also include the contributor email in the commit message when
the write came from an OAuth user.

## Operational Notes

- `/health` returns only `{ "ok": true }`.
- `/mcp` requires auth unless `BIGBRAIN_MCP_AUTH_MODE=none`.
- Shared server `dashboard` requires `BIGBRAIN_MCP_AUTH_MODE=oauth_allowlist`;
  device-local dashboard remains unauthenticated unless OAuth is configured.
- In device-local `none` auth mode, `assignee=me` resolves to
  `BIGBRAIN_MCP_LOCAL_PERSON_SLUG`, the single active owner, or the single active
  member. Single-user device-managed installs should create that owner with
  `bigbrain members ensure-local-owner people/<slug> --name ... --email ...`
  and install the LaunchAgent with `--local-person-slug people/<slug>`.
  Multiple possible local identities produce a setup error.
- `/connect`, `/auth/start`, and `/auth/callback` are enabled only in
  `oauth_allowlist` mode.
- Keep token/session state on persistent storage. Prefer the database-backed
  store for server deployments.
- Rotate any shared bootstrap token after migration to per-user tokens.
- Prefer explicit email allowlists for external collaborators and domain
  allowlists only for domains you fully control.
- Expose only connected-client-safe tools by default. Search, query, read, list, and
  append-style contributions are safer than destructive raw-file writes,
  reindexing, or git operations. Grant maintenance and publishing scopes only
  to trusted operators.
