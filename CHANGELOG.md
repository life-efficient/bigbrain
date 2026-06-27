# Changelog

BigBrain uses semantic versioning. Each release includes an `Agent update
actions` section for agents maintaining local installs and hosted brains.

## [Unreleased]

### Agent update actions

- Read this section before pulling or deploying unreleased changes.
- Do not claim an update is complete unless the relevant release actions below
  have been applied or explicitly marked not applicable.

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

[Unreleased]: https://github.com/life-efficient/bigbrain/compare/v0.4.2...HEAD
[0.4.2]: https://github.com/life-efficient/bigbrain/releases/tag/v0.4.2
[0.4.1]: https://github.com/life-efficient/bigbrain/releases/tag/v0.4.1
[0.4.0]: https://github.com/life-efficient/bigbrain/releases/tag/v0.4.0
[0.3.2]: https://github.com/life-efficient/bigbrain/releases/tag/v0.3.2
[0.3.1]: https://github.com/life-efficient/bigbrain/releases/tag/v0.3.1
[0.3.0]: https://github.com/life-efficient/bigbrain/releases/tag/v0.3.0
[0.2.0]: https://github.com/life-efficient/bigbrain/releases/tag/v0.2.0
