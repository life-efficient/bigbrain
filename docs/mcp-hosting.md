# Hosting BigBrain MCP for a Team

BigBrain can expose one configured brain over HTTP as an MCP server. The server
does not discover or publish every local brain. It serves the `brain_dir` from
the config used to start `bigbrain mcp`.

The hosted server is still a knowledge service, not an agent runtime. Agents
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

Use a separate deployment per shared brain. Do not point a hosted deployment at
a personal brain unless that is intentionally what you want to publish.

## Persistence Boundary

Hosted BigBrain should treat the app container filesystem as disposable. For
redeploy-heavy services, all mutable runtime state must be stored on persistent
storage:

- embeddings and embedding chunks
- sync runs and sync cursors
- OAuth clients, grants, sessions, and issued MCP tokens
- MCP audit logs and contribution attribution
- health findings and operational history

Markdown remains canonical and should continue to live in the selected brain
home or a git-backed content repo. Database state is a durable runtime
projection and operational ledger. It should be rebuildable from markdown where
possible, but redeploys should not force re-embedding, re-authentication, or
loss of activity history.

Preferred hosted storage modes:

- local development: SQLite or local Postgres
- bundled server: app service plus local Postgres/pgvector with a persistent
  volume or database service
- managed remote: the same Postgres schema pointed at a remote provider such as
  Supabase when needed

Use a generic `DATABASE_URL` Postgres contract for server deployments. Do not
make the core hosted model depend on Supabase-specific APIs; Supabase should be
one possible Postgres target rather than the product boundary.

## Raw File Uploads

Before writing a page or upload, an MCP harness should call `filing_rules`.
That tool reads the selected brain's top-level `FILING.md` file, actual
top-level folders, and collection `README.md` files, then returns shared
filing principles, structured routing rules, page-shape guidance, raw-file
path rules, and an optional recommendation when given `input`, `file_name`, or
`mime_type`.

The MCP server exposes raw-file CRUD tools for inputs such as PDFs,
screenshots, transcripts, slide decks, and spreadsheets:

- `filing_rules`
- `list_raw_files`
- `read_raw_file`
- `create_raw_file`
- `update_raw_file`
- `delete_raw_file`

Use `create_raw_file` to upload a remote file without a markdown page,
`create_raw_file_with_page` to upload a remote file and create the searchable
brain page in the same call, `read_raw_file` to download the raw bytes as
base64, and `update_raw_file` to replace the bytes of an existing upload.

The tool `create_raw_file_with_page` writes a raw source file and its
corresponding markdown brain page together.

Required fields:

- `path` or `raw_path`: destination under `<collection>/.raw/<file>`, for example
  `sources/.raw/example-deck.pdf`.
- `raw_content_base64` or `raw_content_text`: provide exactly one. Use base64
  for PDFs and other binary files.
- `page_path`, `title`, `body`, `timeline_entry`: the markdown brain page to
  create at the same time when using `create_raw_file_with_page`.

Raw reads return `content_base64` so binary files can round-trip safely. The
generated page from `create_raw_file_with_page` gets a `raw_file` frontmatter
field and a `## Source File` link back to the raw upload. Raw files under
`.raw/` stay out of the indexed page graph; the associated markdown page is the
searchable surface.

## Auth Modes

BigBrain MCP supports these auth modes:

- `none`: no auth. Use only for local development.
- `token`: one shared bearer token from `BIGBRAIN_MCP_TOKEN` or
  `MCP_AUTH_TOKEN`.
- `oauth_allowlist`: Google OAuth invite flow that issues per-user MCP tokens
  to allowlisted team members.

Hosted deployments should use `oauth_allowlist`.

The current file-backed token store is acceptable for local development or
small persistent-volume deployments. The target hosted model should store token
hashes, OAuth grants, sessions, and client metadata in the persistent database
so redeploys do not invalidate connected agents.

## OAuth Allowlist Setup

Required environment:

```text
BIGBRAIN_MCP_AUTH_MODE=oauth_allowlist
BIGBRAIN_MCP_PUBLIC_URL=https://your-service.example.com
BIGBRAIN_MCP_SERVICE_NAME=Example Brain Cortex
DATABASE_URL=postgres://...
BIGBRAIN_MCP_ALLOWED_EMAILS=alice@example.com,bob@example.com
BIGBRAIN_MCP_ALLOWED_DOMAINS=example.com
BIGBRAIN_MCP_GOOGLE_CLIENT_ID=...
BIGBRAIN_MCP_GOOGLE_CLIENT_SECRET=...
```

Set `BIGBRAIN_MCP_TOKEN_STORE` only for file-backed SQLite or persistent-volume
deployments. When the BigBrain config uses `storage_backend: "postgres"`, OAuth
client, state, code, and token records are stored in Postgres instead.

At least one of `BIGBRAIN_MCP_ALLOWED_EMAILS` or
`BIGBRAIN_MCP_ALLOWED_DOMAINS` must be set.

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

They sign in with Google. If their email is allowlisted, BigBrain shows a
personal MCP token and a Codex config snippet:

```toml
[mcp_servers.example-brain-cortex]
url = "https://your-service.example.com/mcp"
headers = { Authorization = "Bearer bbmcp_..." }
```

The token is shown once. Store only the hashed token in
`BIGBRAIN_MCP_TOKEN_STORE` or, for hosted deployments, the database-backed token
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
- `/connect`, `/auth/start`, and `/auth/callback` are enabled only in
  `oauth_allowlist` mode.
- Keep token/session state on persistent storage. Prefer the database-backed
  store for hosted deployments.
- Rotate any shared bootstrap token after migration to per-user tokens.
- Prefer explicit email allowlists for external collaborators and domain
  allowlists only for domains you fully control.
- Expose only remote-safe tools by default. Search, query, read, list, and
  append-style contributions are safer than destructive writes, reindexing, or
  git operations. Gate maintenance and publishing commands behind admin scopes
  once scoped OAuth is available.
