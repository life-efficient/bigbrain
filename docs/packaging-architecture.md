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
does not silently rename or disconnect clients. The single machine-level
catalog for those registrations is `~/.config/bigbrain/brains.json`, shared by
the CLI and desktop. Desktop operational metadata is nested in the matching
catalog entry; the old app-support `registry.json` is migration input only.

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

## Independent Desktop And MCP Releases

The desktop client and the MCP runtime are separate release boundaries, even
when they are built from the same source checkout:

- The desktop owns connection profiles, Brain creation UX, authentication
  setup, dashboard presentation, and local runtime controls.
- The MCP runtime owns one Brain instance, its storage, migrations, tools,
  events, sync, and dashboard/API backend.
- A local runner or deployment operator starts and updates the MCP runtime.
  The desktop may invoke that runner during local Brain creation, but it does
  not become the runtime.

Every MCP advertises its application version, MCP protocol, API contract, and
supported compatibility range through `/health` and `/ready`. The desktop
advertises the MCP API contract and protocol versions it supports, records the
last compatibility check for each connection, and keeps legacy connections
available when an older runtime does not yet publish this metadata.

This allows a Dev or release desktop client to connect to the same local MCP,
or to multiple local and hosted MCP instances. Dev hot reload applies only to
desktop dashboard assets. It does not require a second Dev MCP service.

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

Creating a Brain remains a desktop action. For a local Brain, the desktop
initializes the selected folder and calls the local runner to install or start
the independent MCP instance. For a hosted Brain, the same desktop flow will
eventually call the hosting provisioner and then save the returned connection.

### Service Ownership And Updates

Every local service has an explicit lifecycle owner. The supported ownership
states are `desktop-bundle`, `source-checkout`, `server-managed`, and `unknown`.
Loopback addresses, ports, and LaunchAgent labels are discovery hints, not proof
of ownership.

- A `desktop-bundle` service runs the CLI and runtime from the installed app
  bundle through the local runner. The desktop may ask that runner to reinstall,
  restart, and verify it when the service is older or unavailable.
- A `source-checkout` service runs from a Git checkout. Only the source updater
  or its operator may change it.
- A `server-managed` service is controlled by its deployment operator even when
  it runs on the same physical machine as the desktop client.
- An `unknown` service is advisory-only until ownership can be proven or the
  user explicitly transfers it.

The machine catalog, LaunchAgent, and runtime metadata must agree before the
desktop claims a service. A newer service is never replaced by an older desktop bundle.
The desktop reports the mismatch and asks the user to update the app. Remote,
source-managed, server-managed, and unknown services are never restarted by the
desktop updater.

After a signed desktop update downloads, the app records the expected release,
restarts through the platform installer, and verifies on launch that the app
reached that release. It then reconciles only `desktop-bundle` services from the
new app bundle and requires readiness, canonical brain identity, exact runtime
release, MCP initialization, and tool listing before clearing the pending
update.

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

The normal Electron app reads the canonical machine catalog for the brain
selector. It keeps
that desktop chrome visible while loading the selected local or hosted service
dashboard in an isolated content view. Each service dashboard remains
single-brain and does not discover or switch to other services.

Setting `BIGBRAIN_DASHBOARD_URL` or passing `--dashboard-url` is an explicit
fixed-dashboard mode for kiosk or thin-client deployments. It intentionally
bypasses the multi-brain desktop shell; service lifecycle remains managed by
the host.

The desktop may show a connected service's runtime release for diagnosis, but
the client update control always updates only the desktop application. It never
downloads, installs, or restarts code on the connected service.

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
