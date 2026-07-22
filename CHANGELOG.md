# Changelog

BigBrain uses semantic versioning. Each release includes an `Agent update
actions` section for agents maintaining device and server installations.

## Unreleased

## [0.15.0] - 2026-07-22

### Added

- Added versioned, authenticated `BRAIN.md` purpose profiles; a private
  machine brain catalog for verified local and remote brains; deterministic
  metadata-only routing; and an idempotent routing ledger with review, approve,
  reject, retry, lease, and read-back verification states.
- Added a single paused, machine-wide `bigbrain-route-granola` automation plus
  a retired-ID manifest and health checks for duplicate writers, active retired
  automations, duplicate IDs, and active backup directories.
- Added desktop support for connecting to an existing BigBrain service and for
  running multiple isolated local brains with collision-safe service ports.
- Added secure API-key discovery during desktop onboarding. BigBrain can offer
  masked choices from `OPENAI_API_KEY`, `~/.config/bigbrain/.env`, and known
  BigBrain-owned macOS Keychain entries while keeping direct entry available.

### Changed

- Reframed packaging and onboarding around two action-led paths: run BigBrain
  on this device or connect to an existing BigBrain service. Hosting ownership,
  Docker packaging, storage, client type, and private/shared access are now
  documented as separate deployment or configuration choices rather than
  competing product modes.
- Changed the default MCP service port from `3333` to `55560` for new local and
  bundled Docker installs. Existing launch agents with an explicit port remain
  supported, and update verification now discovers that configured port before
  testing the endpoint.
- Aligned desktop onboarding with the dark dashboard shell and added standard
  macOS editing shortcuts to the application menu.
- Declared the existing Node.js runtime requirement explicitly as Node
  `>=22.5.0`.

### Fixed

- Refused local service startup when the requested port is already occupied
  instead of silently colliding with another BigBrain instance.
- Avoided false Granola-writer conflict findings from non-writer automations
  that merely mention routing, and kept backup/retired automation conflicts
  explicit.
- Restored normal paste behavior in desktop onboarding.
- Made API-key validation use the desktop controller's injected network client,
  passed the selected credential correctly to initial sync, rejected forged or
  stale saved-key identifiers, and cleared manually entered credentials after
  successful setup.
- Preserved an existing ordinary root `BRAIN.md` as a searchable and visible
  knowledge page while keeping routing fail-closed; only profile-shaped
  `BRAIN.md` files are hidden from the knowledge index and explorer.
- Made legacy desktop registry import recover canonical `brn_...` identities
  from each local brain config while preserving backups and active selection.
- Aligned the packaged brain-profile JSON schema, runtime validation, and MCP
  `about/update` schema, and made routing-ledger initialization reject future or
  malformed database schemas without relabeling or partially modifying them.

### Agent update actions

- Pull the release, run `npm install`, and run `npm link` so the CLI, desktop
  runtime, schema dependency, and bundled skills resolve to `v0.15.0`.
- Verify `node --version` is `22.5.0` or newer before installing.
- Refresh the bundled BigBrain skills, especially `bigbrain-setup`,
  `bigbrain-onboarding`, and `bigbrain-check-update`.
- Restart every running dashboard or MCP service, including Docker or other
  server deployments, so the new authenticated `about` and admin-scoped
  `about/update` tools are available. Existing tokens do not gain scopes
  automatically; profile updates through MCP require an owner identity plus
  `brain:admin` within the server scope ceiling and issued token.
- For a local service, read the configured `--port` from its launch agent before
  testing it: new installs default to `55560`, while an existing explicit
  `3333` service remains valid. Update the Codex MCP registration only if the
  service endpoint actually changes.
- Before rebuilding a bundled Docker Compose deployment, inspect its `.env`.
  To preserve the old endpoint, set `BIGBRAIN_SERVICE_PORT=3333` and
  `BIGBRAIN_MCP_PUBLIC_URL` to the matching public `3333` URL. To adopt the new
  `55560` default, update the public URL, reverse proxy, firewall, health checks,
  and Codex MCP registrations together. Then rebuild/restart and verify
  `/health` plus a direct MCP `initialize` and `tools/list` check.
- Install `bigbrain-route-granola` in its bundled paused state. Do not activate
  it until all destination profiles are approved and existing `granola_id`
  provenance is reconciled.
- In one cutover, pause or remove every ID in `automations/retired.json`, move
  rollback copies outside the live automation root, then activate only
  `bigbrain-route-granola`.
- Run `bigbrain health --json` and require exactly one active Granola writer and
  zero automation conflicts after cutover.
- Existing brain pages, task fields, filing rules, SQLite/Postgres data, and
  existing Keychain records need no migration. Existing brains without a
  `BRAIN.md` remain usable but are held out of automatic routing.
- An existing ordinary knowledge page named `BRAIN.md` remains visible and
  indexed. If the owner later opts into routing profiles, rename that knowledge
  page first; `bigbrain about init` will refuse to overwrite it.
- To opt an existing local brain into routing, run `bigbrain about init`,
  review the generated `BRAIN.md` with the owner, approve it with
  `bigbrain about set --from /path/to/brain/BRAIN.md --approve`, register or
  verify it with `bigbrain brains add-local /path/to/brain`, and confirm
  `bigbrain about show --json` reports an approved profile.
- For a remote brain, approve its profile on that service, then register it:

  ```bash
  bigbrain brains add-remote --brain-id ID --name NAME --handle HANDLE \
    --endpoint MCP_URL --authenticated --writable
  ```

  Verify the profile and catalog entry before enabling the router.
- Run `bigbrain sync --json`, `bigbrain health --json`, and `npm test`.

### Verification

- `npm test`
- `node --test test/bigbrain/desktop-controller.test.mjs`
- `node --test test/bigbrain/brain-profile.test.mjs test/bigbrain/routing-ledger.test.mjs`
- `npm_config_cache=/private/tmp/bigbrain-npm-cache npm pack --dry-run`
- Local-data compatibility audit against `v0.14.3`

## [0.14.3] - 2026-07-20

### Fixed

- Disabled electron-builder's implicit tag-triggered publishing so the macOS
  release workflow can finish packaging before its explicit, authenticated
  GitHub Release upload step.

### Agent update actions

- Pull the release and run `npm install` plus `npm link`.
- Follow the hosted MCP scope and restart actions in `v0.14.1` when upgrading
  from `v0.14.0` or earlier; no additional runtime, brain-data, database, task,
  skill, or automation migration is required for this packaging follow-up.
- Run `npm test`.

### Verification

- `npm test`
- `npm_config_cache=/private/tmp/bigbrain-npm-cache npm pack --dry-run`
- GitHub Actions macOS release packaging and asset upload

## [0.14.2] - 2026-07-20

### Fixed

- Made the dashboard CLI smoke test suppress Node's expected experimental
  SQLite warning so the macOS release runner can verify and package the desktop
  app consistently.

### Agent update actions

- Pull the release and run `npm install` plus `npm link`.
- Follow the hosted MCP scope and restart actions in `v0.14.1` when upgrading
  from `v0.14.0` or earlier; no additional runtime, brain-data, database, task,
  skill, or automation migration is required for this CI-only follow-up.
- Run `npm test`.

### Verification

- `npm test`
- `npm_config_cache=/private/tmp/bigbrain-npm-cache npm pack --dry-run`
- GitHub Actions macOS release packaging

## [0.14.1] - 2026-07-20

### Fixed

- Hardened hosted MCP authorization so every advertised tool must have an
  explicit fail-closed policy, new OAuth grants cannot exceed the configured
  server scope ceiling, public group writes require `brain:publish`, and legacy
  `brain:write` remains limited to non-destructive create/update operations.

### Agent update actions

- Pull the release and run `npm install` plus `npm link` so the active
  `bigbrain` command uses the hardened hosted MCP policy.
- Restart each hosted MCP service after updating.
- New OAuth clients now default to `brain:read brain:create`. Before restarting
  a deployment where allowlisted users must request publishing, destructive
  raw-file, Git-backup, maintenance, or admin access, set
  `BIGBRAIN_MCP_OAUTH_ALLOWED_SCOPES` to the exact space- or comma-separated
  scope ceiling that deployment intends to permit.
- Existing issued tokens keep their recorded scopes. Scope-less legacy MCP
  token records continue to mean `brain:read brain:write`; no token-store,
  database, brain-page, task-field, filing-rule, skill, or automation migration
  is required.
- Run `bigbrain health --json` and verify each hosted client sees only the tools
  allowed by its OAuth scopes.
- Run `npm test`.

### Verification

- `npm test`
- `npm_config_cache=/private/tmp/bigbrain-npm-cache npm pack --dry-run`

## [0.14.0] - 2026-07-18

### Added

- Added a first-class `bigbrain connect codex` workflow for remote brains.
  Hosted connections use Codex-managed OAuth by default; trusted
  single-operator deployments can explicitly install an isolated, persistent
  bearer-token connection without putting the token in Codex configuration or
  command history.
- Added bounded MCP audit logging with retention controls, migration support,
  and dashboard visibility for recent MCP activity.
- Added public-safe shared group dashboard rendering so public group views expose
  only approved page and raw-file content.

### Changed

- Updated the hosted `/connect` guidance and BigBrain Setup skill so Codex
  client provisioning is owned by BigBrain rather than individual workbench
  repositories.
- Simplified `bigbrain-granola-ingest` output guidance for more readable
  automation reports.
- Scoped `bigbrain-whats-next` to the current user by default.
- Tightened `bigbrain-media-ingest` transcript handling guidance.
- Clarified the `bigbrain-check-update` skill's final report guidance so routine
  update checks lead with a plain-language status, keep applied runtime fixes
  readable, and reserve hashes, ports, command names, and MCP implementation
  details for failures or actionable follow-up.
- Moved missing MCP tool discovery out of BigBrain's bundled skills and into
  the shared skills surface.

### Fixed

- Fixed structured MCP collection responses.
- Avoided false fatal hosted rebase log messages.
- Removed a redundant shared group type pill from dashboard cards.

### Agent update actions

- Pull the release and run `npm install` plus `npm link` so the active
  `bigbrain` command, new `bigbrain connect codex` workflow, and bundled skills
  resolve to the updated checkout.
- Refresh the bundled BigBrain skills in the active agent runtime, especially
  `bigbrain-check-update`, `bigbrain-granola-ingest`,
  `bigbrain-media-ingest`, `bigbrain-setup`, and `bigbrain-whats-next`.
- Remove any stale BigBrain-owned active install of
  `bigbrain-find-missing-tools`; use the shared `find-missing-tools` skill
  instead.
- Restart each dashboard or local MCP service so MCP audit logging, public group
  rendering, and hosted connection changes take effect.
- No brain-page, task-field, filing-rule, folder, or manual database migration
  is required. Existing SQLite and Postgres MCP audit tables are migrated by the
  runtime.
- Run `bigbrain health --json` and verify the bundled skill templates are
  healthy.
- For a local MCP service, verify the service starts and recent MCP activity can
  be recorded without exposing secrets.
- Run `npm test`.

### Verification

- `npm test`
- Installed Codex skill symlink resolves to
  `/Users/hq/projects/bigbrain/skills/bigbrain-check-update/SKILL.md`

## [0.13.0] - 2026-07-11

### Changed

- Reworked the relationship, spacious, and Jarvis Bloom graph layouts so
  connected pages form clearer communities, dense graphs use their available
  space more naturally, and the camera fits rendered content more reliably.
- Persisted dashboard graph visualizer and style preferences in local browser
  storage.
- Clarified Git durability health without adding a separate dashboard or API:
  brains without Git backup receive a low-severity recommendation, while
  configured backups report factual warnings such as the number of local
  changes or commits not yet backed up to the tracked upstream.

### Fixed

- Brains without a Git repository or tracked upstream are no longer classified
  as needing attention merely because optional Git backup is not configured.
- Git durability warnings now distinguish uncommitted changes, unpushed
  commits, behind or diverged checkouts, and verification failures.

### Agent update actions

- Pull the release, run `npm install`, and restart each dashboard or local MCP
  service so the graph and health-message changes take effect.
- No brain-page, task-field, filing-rule, database, MCP-tool, skill, automation,
  or folder migration is required.
- Run `bigbrain health --json`. For a brain without Git backup, verify
  `git_status.health_status` is `ok` and the Git finding is low severity. For a
  configured, synchronized brain, verify there is no Git finding.
- Run `npm test`.

### Verification

- `npm test`
- `node --test test/bigbrain/runtime.test.mjs`
- `npm pack --dry-run`

## [0.12.2] - 2026-07-11

### Added

- Added three Jarvis-style graph visualizers and promoted Jarvis Bloom as an
  available dashboard graph renderer.
- Added the spacious constellation graph renderer and shared graph visualizer
  utilities for calmer large-graph layouts.
- Added app-convention reference notes for dashboard surfaces, navigation,
  state, auth, registration, local development, email delivery, schema, and
  visual design.

### Changed

- Optimized Jarvis Bloom graph rendering for denser graph views.

### Fixed

- The development desktop app can now be launched from Finder more reliably.
- Existing brain services are migrated more safely, with rollback behavior that
  restores the app service if migration cannot complete.
- The dashboard hides the brain selector until the dashboard is ready, avoiding
  premature selector interactions during startup.
- Health now validates `*/.raw/*.md` attachment sidecars with a sidecar-specific
  profile instead of inheriting canonical meeting-page heading requirements from
  `meetings/`.
- Attachment-sidecar health now reports missing or mismatched same-basename raw
  artifact bindings when a neighboring raw artifact exists or a sidecar declares
  `raw_file`.
- Healthy Git status is no longer counted as a health finding. Git state remains
  available as `git_status` report metadata, and only states that need attention
  create `git_status` findings.
- Git health ignores BigBrain runtime state files under `.bigbrain-state/`, so
  SQLite write-ahead files cannot create false dirty-repository findings.

### Agent update actions

- Pull the release, run `npm install`, and restart each dashboard or local MCP
  service so the health and graph-renderer changes take effect.
- No brain-page, task-field, filing-rule, database, MCP-tool, skill, automation,
  or folder migration is required.
- Run `bigbrain sync --json` and `bigbrain health --json`; for a clean,
  in-sync brain, verify `finding_count` is `0` while `git_status.health_status`
  is `ok`.
- For brains with attachment sidecars, verify `*/.raw/*.md` pages pass health
  without canonical meeting-heading requirements and that same-basename raw
  artifact bindings are reported only when deterministic.
- Run `npm test`.

### Verification

- `npm test`
- `node --test test/bigbrain/runtime.test.mjs`
- Personal Brain health with the updated runtime: `finding_count: 0`,
  `git_status.health_status: ok`, and `git_status.needs_attention: false`

## [0.12.1] - 2026-07-11

### Fixed

- Restored a continuous graph activity timeline from the brain's first Git
  commit through today, including explicit zero-activity days.
- Replaced current-filesystem-mtime-only activity counts with Git-backed daily
  change counts for current graph pages, while retaining a bounded modification
  time fallback for non-Git brains.
- Historical graph rewind now uses each page's first-seen Git date, so nodes that
  already existed remain visible before their latest modification date.

### Agent update actions

- Pull the release, run `npm install`, and restart each dashboard or local MCP
  service so the rebuilt dashboard and Git-backed graph history take effect.
- No brain-page, task-field, filing-rule, database, or folder migration is
  required.
- Verify `/api/graph` includes a continuous `activity` array and node
  `created_at` values, then scrub the graph back to the brain's first commit and
  confirm historical nodes remain visible.
- Run `npm test` and `bigbrain health --json`.

### Verification

- `npm test`
- Personal Brain graph history: 77 continuous days from 2026-04-26 through
  2026-07-11, including 16 zero-activity days
- Historical node counts: 20 on 2026-04-26, 68 on 2026-05-01, 265 on
  2026-06-10, and 289 on 2026-06-15
- App-managed LaunchAgent health, MCP initialize, and app-closed persistence
  checks on the Personal Brain

## [0.12.0] - 2026-07-11

### Added

- Added a lecture-ready macOS desktop onboarding flow for owner identity, brain
  selection, local mode, Keychain-backed OpenAI access, and copyable generic,
  Codex, and Claude MCP connection instructions.
- Added a desktop brain registry with isolated service labels and stable ports,
  multi-brain switching, resumable setup, and in-place registration of existing
  initialized brains without moving or reinitializing their markdown.
- Added a custom themed brain selector integrated with the dashboard navigation,
  including a separated new-brain action and a dedicated macOS drag strip.
- Added provider-neutral AI access, authentication, entitlement, usage-metering,
  and managed-inference boundaries. Managed plans remain disabled; local
  bring-your-own-key OpenAI access is the only enabled desktop provider.
- Added an unsigned universal macOS DMG/ZIP release workflow with SHA-256
  checksums and GitHub Release uploads.
- Added a shared hosted runtime adapter and authenticated dashboard protections
  for hosted and on-prem brain deployments.

### Changed

- Local MCP services can retrieve a brain-specific OpenAI key from macOS
  Keychain without writing the secret into brain files, service definitions,
  logs, onboarding state, or connection instructions.
- MCP health responses now include the immutable `brain_id` and editable
  `brain_name`, allowing desktop clients to prove that an endpoint serves the
  selected brain.
- The desktop development app can adopt an already-running local brain service,
  preserving its endpoint so existing agent connections continue working.
- Desktop distribution now builds a single universal Intel/Apple Silicon app
  with versioned artifact names.

### Fixed

- Selecting the already-active brain no longer rebuilds the dashboard iframe or
  reloads the application.
- Universal packaging now handles architecture-specific esbuild binaries during
  the Electron merge.

### Agent update actions

- Before upgrading, commit or back up each local brain, then pull the release,
  run `npm install`, and run `npm link`.
- Restart each local or hosted BigBrain MCP/dashboard service so health identity,
  hosted runtime, and dashboard authentication changes take effect.
- Existing CLI and MCP installations remain compatible and require no brain-page,
  task-field, filing-rule, database, or folder migration.
- To use the desktop app, run `npm run desktop:dev` from a source checkout or
  install the unsigned DMG. Existing brains can be registered in place by
  choosing the folder that contains `.bigbrain-state/config.json`.
- When adopting an existing brain, preserve its current port and service instead
  of running two sync/backup services against the same brain home.
- Run `bigbrain sync --json`, `bigbrain health --json`, verify the MCP `/health`
  response reports the intended brain identity, and run `npm test`.

### Verification

- `npm test`
- `node ./bin/bigbrain.js schema`
- `npm run desktop:dist`
- Universal DMG and ZIP SHA-256 generation
- Live MCP `/health`, `initialize`, and `tools/list` verification against an
  existing local brain
- Desktop development launch against an adopted real brain

## [0.11.0] - 2026-07-10

### Added

- Added first-class indexed attachment sidecars at
  `<collection>/.raw/<basename>.md`. Sidecars can contain comprehensive
  extraction, synthesis, links, timelines, visibility, and group metadata while
  the neighboring raw binary remains outside the index.
- Added deterministic sidecar creation and raw-file rename behavior. The
  `create_raw_file_with_page` tool now derives the sidecar path from `raw_path`
  and rejects conflicting placement; raw-file renames move and rewrite the
  same-basename sidecar.
- Added security coverage proving public attachment pages expose only their
  exact same-basename safe artifact and never leak private sidecar Markdown,
  sibling files, traversal targets, or unsupported raw types.
- Added first-class brain identity with an immutable generated `brain_id`, an
  editable `brain_name`, named initialization, and `bigbrain identity` commands.
- Formalized one BigBrain runtime instance per brain. Multiple local or hosted
  brains use isolated services, databases, users, authentication boundaries,
  secrets, backups, ports, and MCP registrations while sharing the same
  BigBrain software.

### Changed

- Attachment sidecars are now searchable through the normal lexical and
  semantic index even when existing brain configs still exclude `.raw/**`.
- Public attachment-sidecar routes render the declared raw artifact. Ordinary
  public pages continue to render Markdown and retain their existing explicit
  `public_raw_files` compatibility behavior.
- Legacy configs remain readable without modification, including read-only
  hosted config mounts. They receive a stable compatibility identity in memory
  until an explicit initialization or identity update persists the new fields.
- Additional local MCP services can use distinct labels, ports, plist files,
  and now distinct log filenames. Existing `local.bigbrain.mcp` defaults remain
  unchanged.

### Deprecated

- Deprecated the conceptual model of multiple brains inside one running
  BigBrain service. Brain-selection flags and the default-brain pointer remain
  supported for choosing among isolated instances.

- Added first-class shared groups stored in the runtime database. Groups have
  simple `/shared/<slug>` URLs, ordered member pages, optional redirects, MCP
  read/write tools, and a dedicated public group UI.
- Added shared raw-file serving for group member pages. Public groups expose
  only safe raw attachment types selected from member page `raw_file` or
  `public_raw_files` frontmatter.

### Fixed

- Public page renames now preserve old public slugs through `redirect_from`
  metadata. `rename_page` records the previous slug, public page/raw lookups
  resolve those redirects, and direct `/public/<old-slug>` browser requests
  redirect to the canonical slug.

### Agent update actions

- Before upgrading, back up or commit each brain. After upgrading, run
  `npm install`, `npm link`, restart every local or hosted MCP/dashboard
  instance, and run `bigbrain sync --json` so `.raw/*.md` sidecars enter the
  lexical and semantic index.
- Migrate attachment metadata or document-summary pages into deterministic
  pairs: `<collection>/.raw/<basename>.<ext>` and
  `<collection>/.raw/<basename>.md`. Preserve comprehensive extracted content
  in the sidecar and update subject-page links. Existing ordinary pages remain
  readable, but new `create_raw_file_with_page` calls reject non-sidecar paths.
- Refresh bundled skills, especially `bigbrain-understand`, `bigbrain-enrich`,
  `bigbrain-document-ingest`, `bigbrain-meeting-ingest`, and
  `bigbrain-maintain`, so agents stop creating attachment pages outside `.raw/`.
- Review public attachments after migration. A public sidecar must declare one
  existing, safe, same-basename `raw_file`; its `/public/<sidecar-slug>` route
  serves that artifact and does not publish the sidecar Markdown.
- Run `bigbrain health --json`, verify attachment links and visibility, then
  run `npm test`.
- Treat this as a `0.11.0` minor release rather than a `0.10.x` patch: it adds
  indexed attachment-page behavior plus public configuration and CLI behavior.
- Existing MCP registrations such as `[mcp_servers.bigbrain]` remain valid and
  must not be renamed automatically.

- Pull the latest BigBrain checkout and restart hosted or local MCP/dashboard
  services that serve public pages before renaming already-shared public pages.
- For public collections of pages, create a shared group with `groups_upsert`
  and use `/shared/<slug>` instead of publishing a markdown page as a group.
- After a public page rename, verify both `/public/<new-slug>` and the prior
  `/public/<old-slug>` URL.

### Verification

- `npm test`
- `node ./bin/bigbrain.js schema`
- Attachment-sidecar sync/search test with an existing config that retains
  `.raw/**` in `exclude_globs`
- Public attachment security tests for exact binding, private Markdown
  non-disclosure, traversal rejection, sibling rejection, unsafe MIME rejection,
  and symlink rejection

## [0.10.0] - 2026-07-08

### Added

- Added MCP/page-operation support for renaming canonical pages and raw files
  while rewriting markdown links, `raw_file` frontmatter, and
  `public_raw_files` references that pointed at the old path.

### Changed

- Updated the default BigBrain folder pack to
  `people/`, `organizations/`, `deals/`, `projects/`, `ideas/`, `meetings/`,
  `tasks/`, `concepts/`, `writing/`, `protocol/`, and `archive/`.
- Updated schema output, filing recommendations, config examples, bundled
  skills, docs, retrieval fixtures, and dashboard graph ordering for the new
  default pack while preserving legacy/domain folders such as `companies/`,
  `sources/`, `ops/`, `inbox/`, `personal-protocol/`, and `health/` for
  existing brains.
- Raw-file guidance now prefers the owning collection `.raw/` folder and treats
  `sources/` as a legacy or domain-specific overlay instead of a generic
  default.

### Agent update actions

- Pull the new release with `git pull --rebase --autostash`.
- Run `npm install`, then `npm link`.
- Restart local or hosted MCP services that run from this checkout so updated
  schema defaults, filing recommendations, MCP tool descriptions, and rename
  tools are active.
- Refresh bundled BigBrain skills from `skills/`, especially
  `bigbrain-understand`, `bigbrain-conversation-ingest`,
  `bigbrain-document-ingest`, `bigbrain-onboarding`, and `bigbrain-query`.
- For every existing brain, read the active filing rules before moving content:
  `bigbrain filing-rules` for local brains or the hosted MCP `filing_rules`
  tool for remote brains.
- Back up or commit the brain before migrating page paths.
- Migrate generic brain contents toward the v2 default pack:
  - move ordinary company/institution pages from `companies/` to
    `organizations/`;
  - move repeatable preferences, health/personal protocols, process notes,
    MCP/server operating guidance, and how-things-work notes from
    `personal-protocol/`, `health/`, or generic `ops/` into `protocol/`;
  - move actionable next actions from `ops/` or `inbox/` into one page per
    task under `tasks/`;
  - move standalone prose drafts from `inbox/` or generic notes into
    `writing/`;
  - move unbuilt possibilities into `ideas/`;
  - move raw/rendered attachments from generic `sources/.raw/` into the
    owning collection `.raw/` folder when ownership is clear, such as
    `deals/.raw/`, `meetings/.raw/`, `projects/.raw/`, `writing/.raw/`, or
    `protocol/.raw/`;
  - archive obsolete `dreams/`, `dream-cycle-summaries/`, and dead folder
    stubs instead of keeping them active.
- Preserve domain overlays when the active brain's filing rules define them.
  For example, ICAIRE may keep `sources/`, `initiatives/`, `deliverables/`,
  and `reports/`; Dealmaking may keep `companies/` for operating companies
  that are deal subjects while also using `organizations/` for firms,
  investors, advisors, buyers, vendors, and institutions.
- After migrating a brain, run `bigbrain sync --json`, then
  `bigbrain health --json`, and fix or record any unresolved links created by
  moved pages. Hosted brains should use their normal MCP sync/health path if
  direct CLI access is not available.
- Run `npm test`.

### Verification

- `npm test`
- `node ./bin/bigbrain.js schema`
- Live `filing_rules` checks against Harry's personal BigBrain, ICAIRE, and
  Dealmaking brains.
- Local-data compatibility audit: this release changes default schema dirs,
  filing recommendations, config examples, bundled skills, docs, graph display
  ordering, and retrieval fixtures. It does not remove indexing or read support
  for existing legacy/domain folders, and it does not rename, remove, or narrow
  persisted task enum values or task fields such as `status`, `readiness`,
  `priority`, `assignees`, `source`, or `execution_mode`. Existing brains can
  migrate content gradually by following the folder migration actions above.

## [0.9.0] - 2026-07-08

### Added

- Added `BigBrain: Find Missing Tools`, a bundled skill for resolving missing
  or partially visible MCP tools before falling back to local files or weaker
  workflows.
- Added `scripts/discover-codex-mcp-tools.mjs`, a deterministic Codex MCP
  discovery helper that reads Codex MCP config, probes a named HTTP or stdio
  MCP server with `initialize` and `tools/list`, and reports expected-tool
  matches, disabled servers, missing config, auth blockers, and tool errors.

### Changed

- Raw-file hosting docs, health checks, dashboard public-page behavior, and
  bundled skill guidance now distinguish canonical markdown pages from
  metadata-only `.raw` sidecar pages.
- Public raw-file views now focus on the shared raw artifact instead of
  presenting raw sidecar markdown as the public item.
- BigBrain skills that create or enrich pages now steer raw-file sidecar
  metadata under the owning `.raw/` folder and keep canonical summaries under
  normal collection paths.

### Removed

- Removed the dashboard `/api/inbox` compatibility endpoint, inbox payload
  builder, inbox dashboard styling, and inbox assignment tests. Existing
  historical `inbox/` pages can still be migrated and indexed, but active
  intake is task-only.

### Agent update actions

- Pull the new release with `git pull --rebase --autostash`.
- Run `npm install`, then `npm link`.
- Refresh bundled BigBrain skills from `skills/`, especially
  `bigbrain-find-missing-tools`, `bigbrain-maintain`,
  `bigbrain-understand`, `bigbrain-conversation-ingest`, and
  `bigbrain-onboarding`.
- Restart local or hosted MCP services that run from this checkout so updated
  raw-file/public-page behavior and docs are active.
- When a known MCP tool appears missing in Codex, use:
  `node scripts/discover-codex-mcp-tools.mjs --name <mcp-server-name> --tool <expected-tool> --names-only`
  before falling back to lazy tool discovery or local files.
- Run `bigbrain health --json` and review any raw sidecar findings. Canonical
  markdown pages should stay under normal collection paths; metadata-only raw
  sidecars belong under the matching `.raw/` folder.
- Run `npm test`.

### Verification

- `npm test`
- `node --test test/bigbrain/codex-mcp-discovery-script.test.mjs`
- `node scripts/discover-codex-mcp-tools.mjs --name bigbrain --tool tasks/list --names-only --no-keychain`
- Local-data compatibility audit: this release adds a bundled skill and a
  deterministic MCP discovery helper, removes the legacy dashboard inbox API,
  and tightens health/dashboard behavior around metadata-only raw sidecars. It
  does not rename, remove, or narrow persisted task enum values or task page
  fields such as `status`, `readiness`, `priority`, `assignees`, `source`, or
  `execution_mode`. Historical `inbox/` pages remain indexable/migratable even
  though active intake is task-only. Existing canonical pages with raw links
  remain valid; metadata-only raw sidecar pages outside `.raw/` are now reported
  for cleanup rather than silently treated as canonical pages.

## [0.8.5] - 2026-07-07

### Fixed

- `bigbrain-fanout-tasks` agent metadata now describes the current
  thread-first behavior: launch separate Codex threads with self-contained
  worker prompts when `codex_app.create_thread` is available, and return
  copyable prompts only when explicitly requested or when live thread creation
  is unavailable after targeted discovery.
- MCP token authentication now preserves the configured member/user precedence
  so bearer-token callers resolve the intended active member identity.

### Changed

- Agent-facing handoff wording now describes task readiness and execution
  metadata as handoff hints rather than hard execution permission.

### Agent update actions

- Pull the new release with `git pull --rebase --autostash`.
- Run `npm install`, then `npm link`.
- Restart local or hosted MCP services that run from this checkout so updated
  task-tool auth behavior and bundled skill metadata are active.
- Refresh bundled BigBrain skills from `skills/`, especially
  `bigbrain-fanout-tasks`, so the exposed agent description is thread-first.
- Verify `bigbrain-fanout-tasks` discovers `codex_app.create_thread` before
  falling back to copyable prompts.
- Run `npm test`.

### Verification

- `npm test`
- Local-data compatibility audit: this release changes bundled skill metadata,
  README wording, and MCP/member authentication resolution. It does not rename,
  remove, or narrow persisted task enum values or task page fields such as
  `status`, `readiness`, `priority`, `assignees`, `source`, or
  `execution_mode`. Existing task pages and member records remain compatible.

## [0.8.4] - 2026-07-06

### Changed

- `bigbrain-whats-next` now makes the follow-up contract explicit: when the
  user answers input-needed questions or adds context after a snapshot, that
  input is for clarifying or enriching the task record, not permission to start
  executing the task in the same thread.

### Agent update actions

- Refresh bundled BigBrain skills from `skills/`, especially
  `bigbrain-whats-next`.
- Keep execution in separate fanout threads or explicit execution requests;
  do not work on tasks in the same thread just because the user answered
  `What's Next` clarification questions.
- Run `npm test`.

### Verification

- `npm test`

## [0.8.3] - 2026-07-05

### Changed

- `bigbrain-fanout-tasks` now scopes fanout to the current conversation by
  default: tasks just named, just created or discussed, selected task numbers,
  or explicit assignee/status/priority filters.
- Broad active-queue fanout now requires an explicit broad request such as
  "all ready" or "daily kickoff", or the accepted follow-up after a
  `BigBrain: What's Next` snapshot offers fanout.
- Task identity is now documented as path-derived for `tasks/<slug>.md`.
  Legacy `type: task` frontmatter remains tolerated and may still be written
  for compatibility, but it is optional and not used to decide whether a page
  is a task.
- Generic page creation no longer forces `type: note` frontmatter, reducing
  contradictory metadata on non-task pages.

### Agent update actions

- Pull the new release with `git pull --rebase --autostash`.
- Run `npm install`, then `npm link`.
- Restart local or hosted MCP services that run from this checkout so updated
  task docs, schema output, and bundled skill prompts are active.
- Refresh bundled BigBrain skills from `skills/`, especially
  `bigbrain-fanout-tasks`.
- When using `bigbrain-fanout-tasks`, do not fan out the whole task queue
  unless the user explicitly asks for all ready/open/in-progress tasks, daily
  kickoff threads, or accepts a fanout offer from a preceding
  `BigBrain: What's Next` snapshot.
- Stop treating `type: task` as required metadata for task behavior. Existing
  pages with `type: task`, `type: note`, missing `type`, or other legacy values
  remain readable; task identity should come from the `tasks/` path and task
  fields such as `status`, `readiness`, and `execution_mode`.
- Run `npm test`.

### Verification

- `npm test`
- `npm_config_cache=/private/tmp/bigbrain-npm-cache npm pack --dry-run`
- Local-data compatibility audit: this release changes bundled skill behavior,
  schema documentation, filing-rule output, and page creation defaults. It does
  not rename or narrow persisted task enum values, remove support for existing
  `type` frontmatter, remove `type: task` from new task creation, or change
  task path semantics. Existing task pages remain discoverable by path under
  `tasks/`, while older `type` values are tolerated as inert legacy metadata.

## [0.8.2] - 2026-07-04

### Changed

- Task readiness is now treated as an agent-authored handoff hint instead of a
  write-time schema gate. `tasks/create` and `tasks/update` no longer reject
  `readiness: ready` solely because a body has open questions, no source link,
  or no completion-criteria heading; presentation skills decide how to surface
  input-needed work.
- `bigbrain-whats-next` and `bigbrain-fanout-tasks` now inspect task bodies for
  substantive `## Open Questions` and keep those tasks in input-needed sections
  unless they are clearly interactive guided sessions.
- Fanout prompts are now self-contained and no longer tell worker threads to
  read the task page before starting; task slugs are retained only as compact
  source/update references.
- `bigbrain-granola-ingest` now requires an explicit identity and affiliation
  pass, preserving self-stated participant names, roles, employers,
  mandate/source authority, relationship context, and unresolved identity fields
  instead of smoothing malformed transcript details into generic summaries.
- Filing guidance now treats `sources/` as a last-resort home for legacy or
  evidence-first imports without a clearer owning collection, instead of a
  default bucket for PDFs, decks, snapshots, or source-like material.
- Raw-file examples now lead with owner-based paths such as `deals/.raw/` and
  `meetings/.raw/`, with `sources/.raw/` shown only for unassigned evidence.
- Folder recommendation now routes generic raw/PDF/screenshot language to
  `sources/`; when no owning collection is obvious, it avoids `inbox/` unless
  a legacy last-resort holding area is explicitly needed.

### Agent update actions

- Pull the new release with `git pull --rebase --autostash`.
- Run `npm install`, then `npm link`.
- Restart local or hosted MCP services that run from this checkout so the new
  task-tool descriptions, filing-rule examples, and bundled skills are active.
- Refresh bundled BigBrain skills from `skills/`, especially
  `bigbrain-whats-next`, `bigbrain-fanout-tasks`,
  `bigbrain-refresh-tasks`, `bigbrain-clarify-tasks`, and
  `bigbrain-granola-ingest`.
- Verify the live MCP `tasks/create` and `tasks/update` schemas describe
  readiness as an agent-authored handoff hint rather than a strict write-time
  validation rule.
- Review any local automations or prompts that still assume `readiness: ready`
  means no open questions; they should read the task body and route substantive
  `## Open Questions` to input-needed presentation.
- For recent Granola ingests, check whether participant employer, role,
  mandate/source authority, or contact/channel fields were flattened or left
  ambiguous; update affected meeting/entity pages when a transcript supports
  clearer identity facts.
- Review each brain's `sources/` folder. Move files and pages there to the
  appropriate owning collection wherever possible:
  - deal-owned teasers, models, brochures, decks, diligence packs, and review
    PDFs belong under `deals/` with raw files under `deals/.raw/`;
  - meeting transcripts and meeting source material belong under `meetings/`
    with raw files under `meetings/.raw/`;
  - project/workstream maps and planning artifacts belong under `projects/`;
  - operating queues, filing notes, MCP notes, and migration guidance belong
    under `ops/`;
  - only leave material under `sources/` when it is genuinely unassigned
    evidence without a clearer canonical owner.
- For hosted brains, check the active `filing_rules` output after migration and
  update collection `FILING.md` files to make any local removal or deprecation
  of `sources/` explicit.
- Run `npm test`.

### Verification

- `npm test`
- Local-data compatibility audit: this release narrows filing guidance and
  examples, relaxes task write-time readiness validation, and updates bundled
  skill guidance. It does not rename or remove persisted task enum values,
  remove the `sources` folder from BigBrain's core schema, or remove raw-file
  tooling support for existing `sources/` pages. Existing task pages and
  `sources/` pages remain readable while agents migrate filing locations and
  rely on presentation tools to route open questions.

## [0.8.1] - 2026-06-30

### Changed

- `bigbrain-fanout-tasks` now launches separate Codex threads with
  self-contained task handoff prompts by default when `codex_app.create_thread`
  is available, instead of only returning copyable prompt blocks.
- `bigbrain-fanout-tasks` keeps the previous worker prompt structure as the
  prompt passed into each new thread, and prepends interactive tasks with:
  `I need to get this done, and I want you to walk me through it step by step.`
- `bigbrain-whats-next` now offers to launch Codex threads with handoff prompts
  when the user wants to fan out ready `agent` or `interactive` tasks.

### Agent update actions

- Pull the new release with `git pull --rebase --autostash`.
- Run `npm install`, then `npm link`.
- Refresh bundled BigBrain skills from `skills/`, especially
  `bigbrain-whats-next` and `bigbrain-fanout-tasks`.
- Verify `bigbrain-fanout-tasks` discovers `codex_app.create_thread` before
  falling back to copyable prompts.
- Run `npm test`.

### Verification

- `npm test`
- `npm_config_cache=/private/tmp/bigbrain-npm-cache npm pack --dry-run`

## [0.8.0] - 2026-07-01

### Added

- Task pages now support `execution_mode: agent|user|interactive` frontmatter
  across task ops, MCP schemas, dashboard payloads, filing rules, schema docs,
  and task skills. Fanout creates autonomous prompts for `agent` tasks and
  guided step-by-step prompts for `interactive` tasks, while `user` tasks stay
  surfaced as user action.
- What's Next now treats ready `interactive` tasks as actionable next work,
  while ready `user` tasks get a separate "There are a few things I can't
  physically help with:" section and underspecified tasks remain under the
  input-needed section.

### Changed

- MCP task writes now treat `readiness` and `execution_mode` as agent-authored
  handoff hints instead of rejecting legal enum combinations based on task body
  semantics. What's-next and fanout presentation should use the task body,
  especially `## Open Questions`, to decide whether a task belongs in the main
  actionable list or the input-needed section.

### Agent update actions

- Read this section before pulling or deploying unreleased changes.
- Pull the new release with `git pull --rebase --autostash`.
- Run `npm install`, then `npm link`.
- Restart the local BigBrain MCP service if installed:
  `launchctl kickstart -k gui/$(id -u)/local.bigbrain.mcp`.
- Verify the live MCP `tasks/create`, `tasks/update`, and `tasks/list` schemas
  include `execution_mode` with enum values `agent`, `user`, and
  `interactive`.
- Run `bigbrain schema` and confirm the task page shape documents
  `execution_mode`.
- Refresh bundled BigBrain skills from `skills/`, especially
  `bigbrain-whats-next`, `bigbrain-fanout-tasks`, `bigbrain-refresh-tasks`,
  `bigbrain-clarify-tasks`, and `bigbrain-roadmap-tasks`.
- For hosted brains that run BigBrain from this repo, redeploy or restart the
  hosted wrapper after pulling so the MCP schema and bundled task skills are
  active.
- Existing task pages without `execution_mode` remain backward-compatible and
  default to `agent` when listed, but agents should classify
  `execution_mode` case by case on new or materially updated tasks:
  - `agent`: Codex can complete the task autonomously with current context,
    tools, and files.
  - `interactive`: Codex can advance the task but needs the user's judgement,
    review, preferences, or decisions.
  - `user`: the task requires a real-world action Codex cannot meaningfully
    perform.
- Run `npm test`.

### Verification

- `npm test`
- `npm_config_cache=/private/tmp/bigbrain-npm-cache npm pack --dry-run`
- Local-data compatibility audit: `execution_mode` is a backward-compatible
  frontmatter addition; missing persisted values default to `agent` in task
  list/dashboard readers, and existing `status`, `readiness`, `priority`,
  `assignees`, `source`, and task path values are not renamed or narrowed.

## [0.7.0] - 2026-07-01

### Changed

- `bigbrain dashboard` is now the default lightweight dashboard launcher for
  agents. It starts the local browser dashboard, opens the local URL by default,
  supports `--no-open` for headless verification, and reports the actual served
  port when `--port 0` is used.
- `BigBrain: Dashboard` now uses the browser dashboard workflow by default
  instead of requiring the Electron desktop development dependencies. The
  desktop app remains available only when explicitly requested.
- BigBrain dashboard and update-check skills no longer assume a machine-specific
  `~/projects/bigbrain` source path when resolving repo context.

### Fixed

- The dashboard frontend now shows the controlled dashboard error fallback for
  uncaught browser errors and unhandled promise rejections, not only React render
  boundary failures.
- The Electron desktop wrapper now handles renderer exits, unresponsive
  renderers, and dashboard load failures with bounded reload attempts and an
  in-window recovery screen instead of leaving a crashed or blank window.

### Agent update actions

- Read this section before pulling or deploying unreleased changes.
- Do not claim an update is complete unless the relevant release actions below
  have been applied or explicitly marked not applicable.
- Pull the new release with `git pull --rebase --autostash`.
- Run `npm install`, then `npm link`.
- Verify `bigbrain dashboard --no-open --port 0` prints a local dashboard URL
  and that the printed URL returns HTTP 200.
- Refresh bundled BigBrain skills from `skills/`, especially
  `bigbrain-dashboard` and `bigbrain-check-update`.
- Restart any active `bigbrain dashboard` or Electron desktop dashboard sessions
  after updating so the new crash recovery and browser-first launcher behavior
  are active.
- Restart the local BigBrain MCP service after pulling if it is running from
  this checkout.
- Run `npm test`.

### Verification

- `node --check electron/main.cjs`
- `npm run build:dashboard`
- `npm test`
- `npm_config_cache=/private/tmp/bigbrain-npm-cache npm pack --dry-run`
- Local-data compatibility audit: dashboard CLI, bundled skill instructions,
  frontend error handling, and Electron renderer recovery do not rename or
  narrow persisted task fields, filing rules, MCP schemas, runtime state, or
  database migrations.

## [0.6.1] - 2026-06-30

### Changed

- BigBrain agent install instructions now require verifying `bigbrain` from a
  fresh Codex-style shell outside the repo and repairing the shell `PATH` with
  npm's global binary directory before setup can be considered complete.
- Dashboard graph pages now show recent update cards alongside graph activity
  so agents and humans can inspect fresh brain changes without switching views.
- `BigBrain: Granola Ingest` and its automation now require relevant entity
  page updates from meeting evidence, not just task updates.

### Fixed

- Dashboard markdown rendering now tolerates page visibility updates that
  temporarily omit markdown content, preventing preview crashes.

### Agent update actions

- Read this section before pulling or deploying unreleased changes.
- Do not claim an update is complete unless the relevant release actions below
  have been applied or explicitly marked not applicable.
- Pull the new release with `git pull --rebase --autostash`.
- Run `npm install`, then `npm link`.
- Verify the active shell can resolve BigBrain with `command -v bigbrain` and
  `bigbrain --help`.
- Verify a fresh Codex-style shell can resolve BigBrain from outside the repo:
  `cd /tmp && zsh -lc 'command -v bigbrain && bigbrain --help'`.
- If either PATH check fails, add `$(npm prefix -g)/bin` to the shell startup
  file used by Codex, open a fresh shell, and rerun the verification.
- Refresh bundled BigBrain skills from `skills/`, especially
  `bigbrain-granola-ingest`.
- Refresh bundled BigBrain automations from `automations/`, especially
  `bigbrain-ingest-granola`.
- Restart the local BigBrain MCP service after pulling, then verify Codex can
  run `bigbrain sync --json` from a normal project directory.
- Run `npm test`.

### Verification

- `npm test`
- `npm_config_cache=/private/tmp/bigbrain-npm-cache npm pack --dry-run`
- Local-data compatibility audit: install-only PATH guidance, dashboard
  rendering, and Granola ingest instruction changes do not rename or narrow
  persisted task fields, filing rules, MCP schemas, runtime state, or database
  migrations.

## [0.6.0] - 2026-06-29

### Changed

- `BigBrain: Granola Ingest` and its bundled automation now require
  meeting-derived task updates as part of ingestion: check existing active task
  pages first, update matches when meeting evidence changes status or next
  action, and create new task pages only for concrete assignable follow-ups.
- `BigBrain: Granola Ingest` now also requires relevant entity page updates
  from meeting evidence, including people, company or organization, deal,
  concept, and project pages, with timeline entries as the minimum durable
  write-back.
- BigBrain MCP task tools now expose only the canonical slash names
  `tasks/list`, `tasks/create`, and `tasks/update`; the old underscore task
  aliases have been removed to match Codex-native tool discovery.

### Agent update actions

- Read this section before pulling or deploying unreleased changes.
- Do not claim an update is complete unless the relevant release actions below
  have been applied or explicitly marked not applicable.
- Pull the new release with `git pull --rebase --autostash`.
- Run `npm install`, then `npm link`, and verify `bigbrain --help`.
- Refresh bundled BigBrain skills from `skills/`, especially
  `bigbrain-granola-ingest`, `bigbrain-whats-next`,
  `bigbrain-fanout-tasks`, `bigbrain-refresh-tasks`, and
  `bigbrain-roadmap-tasks`.
- Refresh bundled BigBrain automations from `automations/`, especially
  `bigbrain-ingest-granola`.
- Update any custom agents or scripts that call `tasks_list`, `tasks_create`,
  or `tasks_update` to use `tasks/list`, `tasks/create`, and `tasks/update`.
- Restart the local BigBrain MCP service after pulling, then verify
  `tasks/list` appears in Codex tool discovery before falling back to local
  runtime inspection.
- Run `npm test`.

### Verification

- `npm test`
- `npm_config_cache=/private/tmp/bigbrain-npm-cache npm pack --dry-run`
- Local MCP `tools/list` verification showed only `tasks/list`,
  `tasks/create`, and `tasks/update` for task tools.

## [0.5.0] - 2026-06-29

### Added

- Added public body-only page publishing and explicit page visibility controls
  for sharing approved brain pages without exposing private metadata.
- Added a bundled `BigBrain: Granola Ingest` skill and
  `bigbrain-ingest-granola` automation template for scheduled Granola meeting
  capture into the selected brain.

### Changed

- `bigbrain health --json` now checks every normal brain folder for a
  `FILING.md` file and reports `missing_filing_rules` findings for gaps.
- `BigBrain: What's Next` now formats ready task snapshots as a numbered list
  instead of bullets.

### Agent update actions

- Read this section before pulling or deploying unreleased changes.
- Do not claim an update is complete unless the relevant release actions below
  have been applied or explicitly marked not applicable.
- Pull the new release with `git pull --rebase --autostash`.
- Run `npm install`, then `npm link`, and verify `bigbrain --help`.
- Refresh bundled BigBrain skills from `skills/`, especially
  `bigbrain-granola-ingest` and `bigbrain-whats-next`.
- Refresh bundled BigBrain automations from `automations/`, including the new
  `bigbrain-ingest-granola` template.
- Run `bigbrain health --json` for the selected brain and add `FILING.md` files
  to any normal folders reported as `missing_filing_rules`.
- Review any intentionally shared public pages and their visibility settings
  before distributing links.
- Run `npm test`.

### Verification

- `npm test`
- `npm_config_cache=/private/tmp/bigbrain-npm-cache npm pack --dry-run`

## [0.4.3] - 2026-06-28

### Changed

- `bigbrain-nightly-maintenance` now treats task refresh as advisory work after
  sync and health checks, so task interpretation does not block the core
  maintenance result.
- `bigbrain-refresh-tasks` guidance now better separates evidence-backed task
  updates from speculative task reshaping.

### Fixed

- Local identity tests now isolate their default brain pointer and runtime state
  under temporary fixture paths, and fixture cleanup refuses to remove paths
  outside the OS temp directory. This prevents test runs from rewriting a real
  default brain pointer to a temporary brain.

### Agent update actions

- Pull the new release with `git pull --rebase --autostash`.
- Run `npm link`, then verify `bigbrain --help`.
- Refresh bundled BigBrain skills from `skills/`, especially
  `bigbrain-refresh-tasks`.
- Refresh the bundled `bigbrain-nightly-maintenance` automation template from
  `automations/`.
- Run `npm test`.
- Confirm the default brain pointer still points at the intended production
  brain after tests or automation verification.

### Verification

- `npm test`
- `npm_config_cache=/private/tmp/bigbrain-npm-cache npm pack --dry-run`

## [0.4.2] - 2026-06-27

### Changed

- Replaced the MCP-level `tasks/enrich` helper with the bundled
  `bigbrain-clarify-tasks` skill. Task clarification now uses the core
  `tasks/list` readiness filter plus `read`, `search`, and `query` from the
  skill workflow, while `readiness` remains first-class in task MCP operations.
- Generated task filing guidance and schema docs now clarify that task slugs are
  concise, stable, human-readable identifiers and do not need to match or mirror
  the full task title.
- `bigbrain-check-update` now applies release filing-rule changes to selected
  brains. Default old filing rules should be replaced with the new defaults,
  while customized user filing rules should receive the new changes additively
  and keep user wording on conflicts.
- The bundled `bigbrain-check-update` automation prompt now asks agents to
  report applied filing-rule updates, not just skill and automation refreshes.

### Removed

- Removed the `tasks/enrich` and `tasks_enrich` MCP tools. Use
  `BigBrain: Clarify Tasks` for task-specification review instead.

### Agent update actions

- Read this section before pulling or deploying unreleased changes.
- Do not claim an update is complete unless the relevant release actions below
  have been applied or explicitly marked not applicable.
- Refresh bundled BigBrain skills from `skills/`, especially
  `bigbrain-clarify-tasks`.
- Remove any old BigBrain-owned installed `bigbrain-enrich-tasks` skill symlink
  or copy after confirming it points at this checkout and has no local edits.
- Refresh the bundled `bigbrain-check-update` automation template from
  `automations/`.
- For each selected brain, update `FILING.md` and relevant collection filing
  rules, especially `tasks/FILING.md`: if the file still matches the default
  wording from a previous BigBrain version, replace it with the new default; if
  it has user customizations, merge in the new filing-rule changes and keep the
  user's rule on conflict.
- Confirm the compiled `filing_rules` output includes the task slug guidance:
  task slugs are stable human-readable identifiers and do not need to match full
  task titles.
- Restart or redeploy MCP servers after pulling so `tools/list` no longer
  advertises `tasks/enrich` or `tasks_enrich`.

### Verification

- `npm test`
- `npm_config_cache=/private/tmp/bigbrain-npm-cache npm pack --dry-run`

## [0.4.1] - 2026-06-26

### Added

- Task pages now support `readiness: underspecified|ready` as a first-class
  frontmatter key across task ops, MCP schemas, dashboard payloads, filing
  rules, generated schema output, docs, and task-facing skills.
- Task status now includes `in_progress` for active work currently underway.

### Changed

- Valid task statuses are now `open`, `in_progress`, `waiting`, `done`, and
  `archived`; `waiting` represents work paused on an external dependency,
  reply, approval, access, or date.
- Generated filing rules and schema docs now define each task status and clarify
  that status is independent from readiness.
- `bigbrain-whats-next` and `bigbrain-fanout-tasks` now check `in_progress`
  tasks before `open` tasks by default and keep `waiting` work separate unless
  requested.
- `bigbrain-refresh-tasks`, `bigbrain-roadmap-tasks`, and
  `bigbrain-enrich-tasks` now treat readiness as the authority for fanout
  readiness instead of mixing handoff readiness into task status.
- `bigbrain-fanout-tasks` now uses cleaner task-specific prompt structure and
  less slug-heavy wording.
- `bigbrain-check-update` now explicitly separates local MCP service health from
  Codex MCP registration, including stale default brain pointer repair guidance
  and direct MCP `tools/list` verification for local installs.

### Removed

- `blocked` is no longer a valid task status. Existing `blocked` task pages
  should be migrated to `waiting` when deploying this release.

### Agent update actions

- Pull the new release with `git pull --rebase --autostash`.
- Run `npm install` because `package.json` and `package-lock.json` version
  metadata changed.
- Run `npm link`, then verify `bigbrain --help`.
- Refresh bundled BigBrain skills from `skills/`, especially:
  - `bigbrain-whats-next`
  - `bigbrain-fanout-tasks`
  - `bigbrain-refresh-tasks`
  - `bigbrain-roadmap-tasks`
  - `bigbrain-enrich-tasks`
  - `bigbrain-check-update`
- Refresh the bundled `bigbrain-check-update` automation template from
  `automations/`.
- For each selected brain, update local filing rules or collection filing rules
  that still describe task statuses so they use `open`, `in_progress`,
  `waiting`, `done`, and `archived`, and explain `readiness:
  underspecified|ready`.
- Migrate any existing task page with `status: blocked` to `status: waiting`
  and add a timeline note explaining that `blocked` was retired.
- Use `status: in_progress` for active work already underway; do not enforce a
  singleton active task unless the brain's local rules explicitly require it.
- Run `bigbrain schema` and verify the task status list includes `in_progress`
  and does not include `blocked`.
- Run `bigbrain sync --json` and `bigbrain health --json` for the selected
  brain.
- For hosted MCP deployments, restart or redeploy the server after pulling so
  MCP `tasks/list`, `tasks/create`, `tasks/update`, and `tasks/enrich` expose
  the new task status enum.
- Confirm `tasks/list status:"in_progress"` works through the MCP connector for
  at least one hosted or local brain where in-progress work exists.

### Verification

- `npm test`
- `npm_config_cache=/private/tmp/bigbrain-npm-cache npm pack --dry-run`

## [0.4.0] - 2026-06-25

### Changed

- Dashboard graph activity sparklines now stay visually bounded and reveal
  activity details on hover.
- `bigbrain-nightly-maintenance` now uses `BigBrain: Refresh Tasks` behavior for
  page-backed `tasks/*.md` instead of calling the removed legacy
  `bigbrain refresh-tasks` command.
- `bigbrain-maintain` now treats concrete `missing_separator`,
  `missing_timeline`, non-critical extra meeting-prep headings, and obvious
  unresolved-link findings as deterministic bounded remediation when health
  reports specific pages.
- `bigbrain-check-update` reporting now more clearly separates current status,
  checks performed, and remaining follow-up.

### Agent update actions

- Pull the new release with `git pull --rebase --autostash`.
- Run `npm install` because `package.json` and `package-lock.json` version
  metadata changed.
- Run `npm link`, then verify `bigbrain --help`.
- Refresh bundled BigBrain skills from `skills/`, especially:
  - `bigbrain-maintain`
  - `bigbrain-check-update`
- Refresh the bundled `bigbrain-nightly-maintenance` automation template from
  `automations/` so it invokes `BigBrain: Refresh Tasks` behavior instead of
  the removed legacy `refresh-tasks` CLI command.
- Run `bigbrain sync --json` and `bigbrain health --json` for the selected
  brain; maintenance agents should now attempt the deterministic health
  remediations listed above before reporting unresolved items.
- If `bigbrain health --json` fails with a missing temp-brain config path, reset
  the default brain pointer to the real brain home, for example:

  ```bash
  printf '%s\n' "$brain_home" > "$HOME/.config/bigbrain/default-brain-home"
  ```

### Verification

- `npm test`
- `npm_config_cache=/private/tmp/bigbrain-npm-cache npm pack --dry-run`

## [0.3.2] - 2026-06-25

### Changed

- Upgraded the desktop runtime from Electron `37.10.3` to `42.5.0` to clear
  the outstanding audited Electron security advisories while keeping the app's
  BrowserWindow shell and packaging flow intact.
- Added an `overrides.undici` pin so the `electron-builder` toolchain resolves a
  patched `undici` version during packaging.

### Agent update actions

- Pull the new release with `git pull --rebase --autostash`.
- Run `npm install` because `package.json` and `package-lock.json` changed.
- Run `npm link`, then verify `bigbrain --help`.
- If you package the desktop app, rebuild it with `npm run desktop:dir` or your
  usual release packaging command before trusting an older local bundle.
- If the desktop app is distributed outside your own machine, smoke test app
  launch, dashboard load, external-link opening, and packaging on the target
  platform after upgrading Electron.

### Verification

- `npm audit --json`
- `npm test`
- `npm run desktop:dir`

## [0.3.1] - 2026-06-24

### Added

- `bigbrain members ensure-local-owner <people/slug>` to bootstrap or repair the
  active owner row needed by local single-user MCP installs.
- Local MCP installer flags `--local-owner-name` and `--local-owner-email`; when
  used with `--local-person-slug`, the installer now creates or repairs the
  active local owner before starting the LaunchAgent.

### Fixed

- Local `BIGBRAIN_MCP_AUTH_MODE=none` installs with an empty `members` table can
  now be repaired during setup, so `assignee=me`, assigned-to-me task views, and
  MCP task creation do not depend on hosted OAuth member onboarding.

### Agent update actions

- Pull the new release with `git pull --rebase --autostash`.
- Run `npm install` because `package.json` and `package-lock.json` version
  metadata changed.
- Run `npm link`, then verify `bigbrain --help` includes
  `members ensure-local-owner`.
- For local single-user brains where `assignee=me` fails with
  `The authenticated user is not an active member`, choose the owner's canonical
  `people/<slug>` page and run:

  ```bash
  bigbrain --brain-home "$brain_home" members ensure-local-owner people/<slug> \
    --name "Owner Name" \
    --email owner@example.com
  ```

- Reinstall or refresh the local MCP service with the same identity so the
  LaunchAgent persists `BIGBRAIN_MCP_LOCAL_PERSON_SLUG`:

  ```bash
  node "$repo_root/scripts/install-local-mcp-service.mjs" \
    --repo-root "$repo_root" \
    --brain-home "$brain_home" \
    --local-person-slug people/<slug> \
    --local-owner-name "Owner Name" \
    --local-owner-email owner@example.com
  ```

- Confirm `members/list` shows the owner as `active` and `owner`, then confirm
  `tasks/list` with `assignee=me` works through the local MCP connector.
- Hosted OAuth brains do not need this repair unless they also run a separate
  local `BIGBRAIN_MCP_AUTH_MODE=none` service.

### Verification

- `node --test test/bigbrain/local-identity.test.mjs`
- `npm test`
- `npm_config_cache=/private/tmp/bigbrain-npm-cache npm pack --dry-run`

## [0.3.0] - 2026-06-23

### Added

- `bigbrain-whats-next` skill for concise BigBrain task snapshots before
  optionally fanning out handoff prompts.

### Changed

- `bigbrain-maintain` now attempts safe bounded remediation for deterministic
  health findings before reporting unresolved items.
- `bigbrain-nightly-maintenance` now uses the maintenance remediation behavior,
  re-runs health after remediation, runs task refresh, and reports the task
  refresh result.

### Agent update actions

- Read this section before pulling or deploying unreleased changes.
- Install or refresh the new bundled `bigbrain-whats-next` skill from
  `skills/`.
- Refresh the bundled `bigbrain-maintain` skill from `skills/`.
- Refresh the bundled `bigbrain-nightly-maintenance` automation template from
  `automations/`.
- Do not claim an update is complete unless the relevant release actions below
  have been applied or explicitly marked not applicable.

### Verification

- `npm test`
- `npm_config_cache=/private/tmp/bigbrain-npm-cache npm pack --dry-run`

## [0.2.0] - 2026-06-21

### Added

- Page-backed task workflows under `tasks/*.md`, with MCP task tools for
  listing, creating, and updating task pages.
- BigBrain task skills:
  - `bigbrain-fanout-tasks`
  - `bigbrain-roadmap-tasks`
  - `bigbrain-refresh-tasks`
- Setup guidance that asks whether to back up the brain to GitHub, strongly
  recommends a private GitHub backup, and uses GitHub MCP when accepted.
- Task schema documentation in `README.md`, `bigbrain schema`, and MCP
  `filing_rules` output.

### Changed

- `bigbrain init` now creates the `tasks/` directory and no longer creates
  `ops/tasks.md`.
- Dashboard and task APIs treat `tasks/*.md` as the canonical task source.
- BigBrain maintenance and install docs no longer install the old hourly task
  refresh automation.

### Removed

- The legacy `refresh-tasks` CLI/script/source/test path that rewrote
  `ops/tasks.md`.
- The old `task-refresh` skill and hourly task-refresh automation template.

### Agent update actions

- Pull the new release with `git pull --rebase --autostash`.
- Run `npm install` because `package.json` and `package-lock.json` version
  metadata changed.
- Run `npm link`, then verify `bigbrain --help`.
- Install or refresh bundled BigBrain skills from `skills/`, especially:
  - `bigbrain-fanout-tasks`
  - `bigbrain-roadmap-tasks`
  - `bigbrain-refresh-tasks`
  - refreshed `bigbrain-setup`
- Install or refresh bundled automation templates from `automations/`; do not
  reinstall any removed hourly task-refresh automation.
- Run `bigbrain schema` and confirm it includes `Task Page Shape`.
- Run the MCP `filing_rules` tool for the target brain and confirm it includes
  `Task Page Schema`.
- Run `bigbrain sync --json` and `bigbrain health --json` for the selected
  brain.
- If the brain still uses `ops/tasks.md`, stop using that file for new work and
  create or update individual `tasks/*.md` pages instead. Use active-member
  `assignees`, `status`, `priority`, `source`, and optional `due` frontmatter.
- If setup is local and the brain has no GitHub remote backup, ask the user
  whether to create a private GitHub backup. Warn that the brain could be lost
  if the folder is deleted or device access is lost.

### Verification

- `npm test`

[Unreleased]: https://github.com/life-efficient/bigbrain/compare/v0.6.1...HEAD
[0.6.1]: https://github.com/life-efficient/bigbrain/releases/tag/v0.6.1
[0.6.0]: https://github.com/life-efficient/bigbrain/releases/tag/v0.6.0
[0.5.0]: https://github.com/life-efficient/bigbrain/releases/tag/v0.5.0
[0.4.3]: https://github.com/life-efficient/bigbrain/releases/tag/v0.4.3
[0.4.2]: https://github.com/life-efficient/bigbrain/releases/tag/v0.4.2
[0.4.1]: https://github.com/life-efficient/bigbrain/releases/tag/v0.4.1
[0.4.0]: https://github.com/life-efficient/bigbrain/releases/tag/v0.4.0
[0.3.2]: https://github.com/life-efficient/bigbrain/releases/tag/v0.3.2
[0.3.1]: https://github.com/life-efficient/bigbrain/releases/tag/v0.3.1
[0.3.0]: https://github.com/life-efficient/bigbrain/releases/tag/v0.3.0
[0.2.0]: https://github.com/life-efficient/bigbrain/releases/tag/v0.2.0
