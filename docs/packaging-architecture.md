# BigBrain Packaging Architecture

BigBrain should ship as one runtime with two supported product modes:

- `local brain`: a markdown brain on the user's machine, local runtime state,
  localhost MCP, and localhost dashboard.
- `remote brain`: a markdown brain served by a hosted BigBrain endpoint, with
  durable server state in Postgres and OAuth allowlist access.

Other deployment shapes are implementation details or roadmap variants. They
should wrap these two modes rather than define separate products.

## Identity And Isolation

BigBrain is the software. Each brain has an immutable `brain_id` and editable
`brain_name`, and each running instance serves exactly one brain. Multiple
brains on one machine are multiple isolated service instances, not tenants
inside one runtime. Selection mechanisms such as `--brain-home`,
`BIGBRAIN_HOME`, and the default-brain pointer choose an instance; they do not
weaken the one-instance-one-brain boundary.

MCP registrations, service labels, deployment names, and ports are installation
aliases rather than canonical brain identity. Installers may normalize an alias
from `brain_name`, but must persist it independently so a display-name change
does not silently rename or disconnect clients.

## Layering

```text
BigBrain core
  config, storage adapters, sync, search, query, health, page ops, task ops

BigBrain HTTP runtime
  /mcp
  /dashboard
  /api/*
  /public/*
  /health

Wrappers
  CLI
  Electron desktop shell
  macOS LaunchAgent service
  Docker or hosted service process
  external agents and browsers
```

The dashboard should stay endpoint-relative. It should talk to the same
BigBrain HTTP API whether it is loaded from a local service or from a hosted
service.

## Local Brain

The local mode is the default personal setup:

- brain home resolves from `--brain-home`, `BIGBRAIN_HOME`, or
  `~/.config/bigbrain/default-brain-home`
- runtime/index state lives under the selected brain's `.bigbrain-state/`
- SQLite is the default storage backend
- the local MCP service runs on `127.0.0.1`
- the desktop app can manage or open the local dashboard

The local desktop app should become a controller for the local service:

- select or verify the default brain home
- install, start, stop, and restart the LaunchAgent
- show `/health` and MCP `tools/list` status
- open the local dashboard
- show the local MCP URL for agent setup
- configure the local owner identity used for `assignee=me`

## Remote Brain

The remote mode is the supported shared or hosted setup:

- one hosted BigBrain service serves one configured brain
- markdown/git remains canonical
- Postgres stores runtime/index and operational state
- OAuth allowlist protects MCP and dashboard access
- the hosted service exposes `/mcp`, `/dashboard`, `/connect`, `/public/*`, and
  `/health`

The same Electron shell may point at a remote dashboard by setting
`BIGBRAIN_DASHBOARD_URL` or passing `--dashboard-url`. In that mode the desktop
app is a dashboard wrapper only; service lifecycle is managed by the host.

## Roadmap Variants

These variants should stay subordinate to local brain and remote brain:

- Docker Compose: a runnable remote-brain hosting shape for development or a
  small server.
- Bundled Postgres: the default remote-brain persistence option when the host
  provides a persistent database or volume.
- Supabase: a managed Postgres target selected by changing `DATABASE_URL`.
- Thin client: any Codex, Relay, browser, or desktop shell that points at a
  remote BigBrain endpoint.

Do not split the dashboard into a separate app until the endpoint contract is
stable and there is a concrete reason to release it independently.
