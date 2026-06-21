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
- Verify the updated checkout and active runtime before reporting success
- Report unapplied updates only when applying them is blocked or unsafe

## Workflow

1. Resolve the BigBrain source repo:
   - use the current working directory if it is the BigBrain repo
   - otherwise use `~/projects/bigbrain` when it exists
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
6. If `package.json` or lockfiles changed, or `node_modules` is missing, run:
   - `npm install`
7. Ensure the global CLI points at the checkout:
   - `npm link`
   - `command -v bigbrain`
   - `bigbrain --help`
8. Check for new or changed bundled skills:
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
9. Check for new or changed bundled automations:
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
10. Verify the updated checkout and active install:
   - `npm test`
   - `bigbrain health --json` against the default brain when configured
   - review `skill_template_status` and `automation_template_status` in the
     health output for missing or mismatched active installs
   - if health reports missing or mismatched BigBrain-owned skills or
     automations, fix the active install and run health again before reporting
     success

## Guardrails

- Do not use `git reset --hard`, `git checkout --`, or destructive cleanup.
- Do not discard unrelated local edits.
- Do not claim an update was installed unless the local HEAD changed or the
  upstream comparison proved it was already current.
- If the repo has local commits and upstream updates, still use rebase with
  autostash; report clearly that local commits were preserved.
- If tests fail after a pull, report the failure and leave the repo in the
  post-pull state for inspection.
- Do not overwrite active copied skills or automations with local edits.
- Do not present installable skills or automations as merely "available"; apply
  them unless a guardrail blocks the change.
- Do not write secrets into the repo while verifying.

## Output

Report:
- repo path
- starting branch and upstream
- whether an update was found
- previous HEAD and final HEAD
- whether dependencies or `npm link` were run
- new or refreshed skills
- new or refreshed automations
- unapplied updates, only with the blocker that prevented installation
- verification commands and pass/fail status
- skill and automation template health status
- any unresolved blockers
