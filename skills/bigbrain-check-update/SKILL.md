---
name: bigbrain-check-update
description: |
  Check whether the BigBrain code repo has an upstream update, pull the latest
  version when one is available, and verify the CLI, skill templates, and runtime
  still work. Use when the user asks to update BigBrain, check for BigBrain
  updates, keep BigBrain current, or run the packaged update automation.
---

# BigBrain: Check Update

Use this skill to keep the BigBrain code checkout current without clobbering
local work. The expected target is the BigBrain source repo, not the user's
markdown brain home.

## Contract

This skill guarantees:
- Check the tracked upstream before deciding there is an update
- Pull only when the current branch is behind its upstream
- Preserve local edits and untracked work
- Reinstall dependencies only when package metadata changed or install appears
  broken
- Re-link the global `bigbrain` binary when needed
- Verify the updated checkout before reporting success

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
8. Verify the updated checkout:
   - `npm test`
   - `bigbrain health --json` against the default brain when configured

## Guardrails

- Do not use `git reset --hard`, `git checkout --`, or destructive cleanup.
- Do not discard unrelated local edits.
- Do not claim an update was installed unless the local HEAD changed or the
  upstream comparison proved it was already current.
- If the repo has local commits and upstream updates, still use rebase with
  autostash; report clearly that local commits were preserved.
- If tests fail after a pull, report the failure and leave the repo in the
  post-pull state for inspection.
- Do not write secrets into the repo while verifying.

## Output

Report:
- repo path
- starting branch and upstream
- whether an update was found
- previous HEAD and final HEAD
- whether dependencies or `npm link` were run
- verification commands and pass/fail status
- any unresolved blockers
