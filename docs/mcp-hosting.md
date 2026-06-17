# Hosting BigBrain MCP for a Team

BigBrain can expose one configured brain over HTTP as an MCP server. The server
does not discover or publish every local brain. It serves the `brain_dir` from
the config used to start `bigbrain mcp`.

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

## Auth Modes

BigBrain MCP supports these auth modes:

- `none`: no auth. Use only for local development.
- `token`: one shared bearer token from `BIGBRAIN_MCP_TOKEN` or
  `MCP_AUTH_TOKEN`.
- `oauth_allowlist`: Google OAuth invite flow that issues per-user MCP tokens
  to allowlisted team members.

Hosted deployments should use `oauth_allowlist`.

## OAuth Allowlist Setup

Required environment:

```text
BIGBRAIN_MCP_AUTH_MODE=oauth_allowlist
BIGBRAIN_MCP_PUBLIC_URL=https://your-service.example.com
BIGBRAIN_MCP_SERVICE_NAME=Example Brain Cortex
BIGBRAIN_MCP_TOKEN_STORE=/app/data/bigbrain-runtime/example-brain-cortex/mcp-tokens.json
BIGBRAIN_MCP_ALLOWED_EMAILS=alice@example.com,bob@example.com
BIGBRAIN_MCP_ALLOWED_DOMAINS=example.com
BIGBRAIN_MCP_GOOGLE_CLIENT_ID=...
BIGBRAIN_MCP_GOOGLE_CLIENT_SECRET=...
```

At least one of `BIGBRAIN_MCP_ALLOWED_EMAILS` or
`BIGBRAIN_MCP_ALLOWED_DOMAINS` must be set.

Create a Google OAuth client with this redirect URI:

```text
https://your-service.example.com/auth/callback
```

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
`BIGBRAIN_MCP_TOKEN_STORE`.

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
- Keep the token store on persistent storage.
- Rotate any shared bootstrap token after migration to per-user tokens.
- Prefer explicit email allowlists for external collaborators and domain
  allowlists only for domains you fully control.
