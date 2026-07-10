# Changelog

BigBrain uses semantic versioning. Each release includes an `Agent update
actions` section for agents maintaining local installs and hosted brains.

## Unreleased

### Added

- Added first-class brain identity with an immutable generated `brain_id`, an
  editable `brain_name`, named initialization, and `bigbrain identity` commands.
- Formalized one BigBrain runtime instance per brain. Multiple local or hosted
  brains use isolated services, databases, users, authentication boundaries,
  secrets, backups, ports, and MCP registrations while sharing the same
  BigBrain software.

### Changed

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

- Treat this feature set as the upcoming `0.11.0` minor release rather than a
  `0.10.x` patch: it adds public configuration and CLI behavior without removing
  existing behavior.
- Existing MCP registrations such as `[mcp_servers.bigbrain]` remain valid and
  must not be renamed automatically.

- Pull the latest BigBrain checkout and restart hosted or local MCP/dashboard
  services that serve public pages before renaming already-shared public pages.
- For public collections of pages, create a shared group with `groups_upsert`
  and use `/shared/<slug>` instead of publishing a markdown page as a group.
- After a public page rename, verify both `/public/<new-slug>` and the prior
  `/public/<old-slug>` URL.

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
