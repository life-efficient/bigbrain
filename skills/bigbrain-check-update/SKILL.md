---
name: bigbrain-check-update
description: |
  Check whether the BigBrain code repo has an upstream update, pull the latest
  version when one is available, install newly bundled skills and automations,
  and verify the CLI, skill templates, automation templates, and runtime still
  work. Use when the user asks to update BigBrain, check for BigBrain updates,
  keep BigBrain current, or run the packaged update automation.
---

# BigBrain: Check Update

Use this skill to keep the BigBrain code checkout current without clobbering
local work. The expected target is the BigBrain source repo, not the user's
markdown brain home. The job is not complete when updates are merely found or
listed; apply/install all safe updates and prove the active installation works.

## Contract

This skill guarantees:
- Check the tracked upstream before deciding there is an update
- Pull only when the current branch is behind its upstream
- Preserve local edits and untracked work
- Reinstall dependencies only when package metadata changed or install appears
  broken
- Re-link the global `bigbrain` binary when needed
- Detect new bundled skills and automations after an update
- Install or refresh bundled skills and automations in the active agent runtime
- Read `CHANGELOG.md` after pulling and apply the matching `Agent update
  actions`
- Apply filing-rule updates from the new release to the selected brain, while
  preserving user customizations
- Verify the updated checkout and active runtime before reporting success
- Separately verify the always-on local MCP service and Codex MCP registration
  when a local service is configured, so "server alive" is not confused with
  "registered with Codex"
- Report unapplied updates only when applying them is blocked or unsafe

## Workflow

1. Resolve the BigBrain source repo:
   - use the current working directory if it is the BigBrain repo
   - otherwise walk upward from the current directory looking for the BigBrain
     repo
   - otherwise use `BIGBRAIN_REPO` when it points to the BigBrain repo
   - otherwise search common workspace roots exposed by the environment
   - otherwise ask the user for the repo path
2. Record the current state:
   - `git status --short --branch`
   - `git rev-parse --abbrev-ref --symbolic-full-name @{u}`
   - `git rev-parse HEAD`
3. Fetch upstream:
   - `git fetch --prune`
4. Compare local and upstream:
   - `git rev-list --left-right --count HEAD...@{u}`
   - if ahead count is `0` and behind count is `0`, report no update found and
     do not pull
   - if ahead count is greater than `0`, report that local commits exist before
     pulling
5. If behind, pull safely:
   - use `git pull --rebase --autostash`
   - stop and report the exact blocker if rebase conflicts or auth failures
     occur
6. Read release notes:
   - compare the previous HEAD and final HEAD against `CHANGELOG.md`
   - identify every release entry that may have landed
   - read each relevant `Agent update actions` section before continuing
   - if no release entry covers the changed range, report that the changelog is
     missing and continue with the generic verification steps below
7. If `package.json` or lockfiles changed, or `node_modules` is missing, run:
   - `npm install`
8. Ensure the global CLI points at the checkout:
   - `npm link`
   - `command -v bigbrain`
   - `bigbrain --help`
9. Check for new or changed bundled skills:
   - list repo skills with `find "$repo_root/skills" -mindepth 2 -maxdepth 2 -name SKILL.md -print`
   - determine the active skills root using the same rule as
     `INSTALL_FOR_AGENTS.md`: prefer the active harness directory, commonly
     `~/.agents/skills` or `~/.codex/skills`
   - symlink any missing repo skill directories into the active skills root
   - refresh existing symlinks that point to this repo
   - do not overwrite copied active skills that contain local edits; report
     them as manual follow-up instead
   - do not stop at listing found skills; install or refresh every safe skill
     before proceeding
10. Check for new or changed bundled automations:
   - list repo automation templates under `automations/*/automation.toml`
   - determine the active automation root, normally
     `${CODEX_HOME:-$HOME/.codex}/automations`
   - install any missing repo automation directories into the active automation
     root
   - replace `<brain-home>` with the selected brain home and `<bigbrain-repo>`
     with the BigBrain source repo path in the active installed copy only
   - refresh existing active automation installs when they were installed from
     this repo and do not contain local-only custom changes beyond ignored
     fields such as `cwds`, `created_at`, and `updated_at`
   - do not overwrite custom local automation definitions; report them as
     manual follow-up instead
   - do not stop at listing found automations; install or refresh every safe
     automation before proceeding
11. Apply release-specific actions:
   - execute every relevant `Agent update actions` item from `CHANGELOG.md`
     that applies to the local setup
   - for schema or filing-rules changes, apply the filing-rule update policy
     below before running verification
   - after applying filing-rule changes, run `bigbrain schema` and MCP
     `filing_rules` when an MCP-backed brain is configured
   - for new skills or automations, confirm active installs were refreshed
   - for removed skills or automations, remove stale BigBrain-owned active
     installs when safe, or report the manual cleanup needed
12. Verify the updated checkout and active install:
   - `npm test`
   - `bigbrain health --json` against the default brain when configured
   - if health fails with an `ENOENT` path under a deleted temp brain, repair
     `~/.config/bigbrain/default-brain-home` to the selected brain home before
     continuing
   - review `skill_template_status` and `automation_template_status` in the
     health output for missing or mismatched active installs
   - if health reports missing or mismatched BigBrain-owned skills or
     automations, fix the active install and run health again before reporting
     success
13. If a local always-on MCP service is configured, verify it as a separate
    runtime surface:
   - inspect the selected brain's launchd plist when present, currently often
     `~/Library/LaunchAgents/local.bigbrain.personal-brain.plist`; older
     installs may still use `~/Library/LaunchAgents/local.bigbrain.mcp.plist`
   - confirm its `--brain-home` argument points at the selected brain home, not
     a stale temp fixture
   - check `curl http://127.0.0.1:3333/health`
   - check the matching launchd label, for example
     `launchctl print "gui/$(id -u)/local.bigbrain.personal-brain"` on macOS;
     fall back to `local.bigbrain.mcp` only for legacy installs
   - run a direct MCP `initialize` plus `tools/list` smoke test against
     `http://127.0.0.1:3333/mcp`
   - run `codex mcp list` and report whether the current BigBrain MCP entry is
     registered with Codex; on this machine the active entry is `personal_brain`
     at `http://127.0.0.1:3333/mcp`, not the older `bigbrain` name
   - do not treat absence of the old `bigbrain` registration as proof the
     service is down when the direct endpoint checks pass
   - if Codex registration is expected but missing, report the exact MCP URL
     (`http://127.0.0.1:3333/mcp`) and config follow-up separately from service
     health

## Filing-Rule Update Policy

When release notes mention schema or filing-rule changes, update the selected
brain's `FILING.md` and relevant collection `FILING.md` files, especially
`tasks/FILING.md`, instead of only reporting that the compiled `filing_rules`
output changed.

- If a filing-rule file still matches the default wording from the previous
  BigBrain version, replace it with the new default wording for that file.
- If a filing-rule file has user customizations or has diverged from the old
  default, merge the new release's filing-rule changes into the existing file
  while keeping the user's wording and local rules present.
- For custom files, prefer additive edits: insert missing new bullets,
  sections, enum values, examples, or timeline notes near the corresponding
  existing rule.
- If a new default rule conflicts with an existing user rule, keep the user's
  rule and do not block the update; record the unresolved difference in the
  update report only if it matters operationally.
- It is acceptable to make straightforward judgment calls rather than asking
  the user to approve every filing-rule merge. Avoid destructive rewrites, but
  do not be overly cautious when the intended merge is clear.
- Do not overwrite unrelated collection guidance just because it differs from
  the generated defaults.

## Guardrails

- Do not use `git reset --hard`, `git checkout --`, or destructive cleanup.
- Do not discard unrelated local edits.
- Do not erase customized filing rules while applying release filing-rule
  changes; merge new defaults into them and keep user rules on conflict.
- Do not claim an update was installed unless the local HEAD changed or the
  upstream comparison proved it was already current.
- If the repo has local commits and upstream updates, still use rebase with
  autostash; report clearly that local commits were preserved.
- If tests fail after a pull, report the failure and leave the repo in the
  post-pull state for inspection.
- Do not overwrite active copied skills or automations with local edits.
- Do not present installable skills or automations as merely "available"; apply
  them unless a guardrail blocks the change.
- Do not skip `CHANGELOG.md`; release entries are the source of truth for
  friend/local-install update actions.
- Do not write secrets into the repo while verifying.

## Output

Use a concise, plain-language status report. This automation is an update check,
not a general brain-maintenance report, so do not include command logs, commit
hashes, template counts, or implementation details in a successful final answer.
Lead with the user-facing outcome, not the mechanism. Do not open with phrases
such as "no upstream update was found", "no pull/rebase was needed", "previous
HEAD", or "final HEAD" unless a failure or blocker makes those details
actionable.

For a clean no-update run, use this shape:

> BigBrain is already up to date.
>
> Applied runtime fixes:
> - Refreshed active BigBrain automations so they match the bundled templates.
> - Confirmed bundled BigBrain skills are installed and available.
>
> Verification passed:
> - BigBrain opens and runs from the normal command line.
> - The automated test suite passed.
> - The selected brain is healthy and has current filing rules.
> - The local BigBrain service is running and registered with Codex.
>
> No action is needed.

Omit an `Applied runtime fixes` section when nothing changed outside ordinary
verification. When there were no fixes, say one short sentence instead, for
example:

> The active skills, automations, filing rules, and local service are healthy.

For successful reports, describe verification by outcome rather than by command:
- "BigBrain opens and runs from the normal command line", not "`npm link` and
  CLI smoke passed"
- "The automated test suite passed", not "`npm test` passed"
- "The selected brain is healthy", not "`bigbrain health --json` returned zero
  findings"
- "The local BigBrain service is running and registered with Codex", not a port,
  launchd label, tool count, or MCP URL
- "The active skills and automations match the bundled versions", not template
  counts, symlink counts, or mismatch counters

For a successful applied update, include a short `What changed` bullet list
derived from the relevant `CHANGELOG.md` release entries, then close with the
health/no-action status. Example:

> BigBrain was updated successfully.
>
> What changed:
> - Added the `bigbrain-whats-next` skill for clearer task snapshots.
> - Improved `bigbrain-maintain` so it can safely fix some routine health
>   issues.
> - Updated nightly maintenance to rerun health after repairs and include task
>   refresh results.
>
> The local setup is healthy, and no action is needed.

If something did not work, include enough detail to act on it:
- what failed
- what was already attempted
- whether local work was preserved
- the exact remaining blocker or decision needed
- for local MCP issues, state separately whether the always-on service is
  healthy and whether Codex has a matching MCP registration

Only mention technical details such as command names, paths, commit hashes,
ports, launchd labels, MCP URLs, template mismatch counts, or health fields when
they explain a failure, blocker, or user-actionable follow-up.
