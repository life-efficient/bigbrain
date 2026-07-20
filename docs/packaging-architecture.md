# BigBrain Packaging Architecture

BigBrain should present two action-led setup choices:

- **Run BigBrain on this device:** create or select a markdown brain on the
  device, keep runtime state there, and use its localhost MCP and dashboard.
- **Connect to an existing BigBrain:** point the client at an already-running
  BigBrain service endpoint without managing that service's lifecycle.

Architecture may call these relationships **device-managed** and
**server-managed**. They are the only product modes. Hosting ownership,
physical location, storage, and access are separate dimensions beneath them:

- a server-managed BigBrain may be hosted by us or self-hosted/on-premises
- Docker is the canonical package for a server-managed deployment, including
  one running on the same physical machine as its client
- SQLite, bundled Postgres, and managed Postgres such as Supabase are storage
  choices, not product modes
- either relationship may be private or shared with approved users

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
  Docker server process
  external agents and browsers
```

The dashboard should stay endpoint-relative. It should talk to the same
BigBrain HTTP API whether it is loaded from a device-managed service or an
existing server-managed service.

## Run BigBrain On This Device

The device-managed relationship is the default personal setup:

- brain home resolves from `--brain-home`, `BIGBRAIN_HOME`, or
  `~/.config/bigbrain/default-brain-home`
- runtime/index state lives under the selected brain's `.bigbrain-state/`
- SQLite is the default storage backend
- the MCP service runs on `127.0.0.1`
- the desktop app can manage or open the device dashboard

The desktop app should become a controller for the device-managed service:

- select or verify the default brain home
- install, start, stop, and restart the LaunchAgent
- show `/health` and MCP `tools/list` status
- open the dashboard
- show the MCP URL for agent setup
- configure the owner identity used for `assignee=me`

## Connect To An Existing BigBrain

An existing BigBrain uses the same secured server contract whether it is
hosted by us, self-hosted, or deployed on-premises:

- one BigBrain service serves one configured brain
- markdown/git remains canonical
- Postgres stores runtime/index and operational state
- OAuth allowlist protects MCP and dashboard access
- the service exposes `/mcp`, `/dashboard`, `/connect`, `/public/*`,
  `/shared/*`, and `/health`

Hosting ownership and location are deployment variants. Hosted-by-us services
run on our infrastructure; self-hosted or on-premises services run in an
operator-controlled environment. Docker is the canonical server package for
both. A Docker service on the client's physical machine is still
server-managed because the client connects to an independently managed service.

The same Electron shell may point at an existing service dashboard by setting
`BIGBRAIN_DASHBOARD_URL` or passing `--dashboard-url`. In this relationship the
desktop app is a dashboard wrapper only; service lifecycle is managed by the
host.

## Deployment, Storage, And Access Variants

These variants remain subordinate to the two product relationships:

- Docker Compose: the canonical runnable server package for development,
  same-machine use, on-premises deployment, or a small server.
- Bundled Postgres: the default server persistence option when the host
  provides a persistent database or volume.
- Supabase: a managed Postgres target selected by changing `DATABASE_URL`.
- Thin client: any Codex, Relay, browser, or desktop shell that points at a
  BigBrain service endpoint.
- Access: keep a brain private or share it with approved users independently
  of who hosts it or where it runs.

Do not split the dashboard into a separate app until the endpoint contract is
stable and there is a concrete reason to release it independently.
