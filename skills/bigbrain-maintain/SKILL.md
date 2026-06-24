---
name: "BigBrain: Maintain"
version: 1.0.0
description: |
  Check a BigBrain for problems, fix the obvious ones that BigBrain already
  knows how to fix, and clearly report anything that still needs manual follow-up.
triggers:
  - "run BigBrain maintenance"
  - "run BigBrain nightly maintenance"
  - "maintain BigBrain"
  - "check BigBrain health and fix what you can"
  - "run the health check and address issues"
  - "address BigBrain unresolved items"
tools:
  - shell
mutating: true
---

# BigBrain: Maintain

Use this skill when you want a quick BigBrain checkup. It runs the health
check, fixes straightforward issues when there is a safe built-in path, and
then tells you what still needs attention.

For recurring nightly maintenance, reporting unresolved items is not enough.
The agent must first attempt safe, bounded remediation for findings that have a
deterministic fix path, then report only what remains.

## Contract

This skill guarantees:
- Start with the live `bigbrain health --json` report
- Fix straightforward problems when the current runtime already has a safe way
  to do that
- Re-run health after any remediation attempt
- After content remediation, re-run sync so the database/index reflects the
  committed brain files
- Commit intentional remediation changes once verification passes, then push the
  branch when the repository is otherwise clean
- For nightly maintenance, attempt remediation before finalizing the
  "unresolved items" section
- Exit cleanly when no findings remain
- Stop clearly when the remaining issues need manual page edits or a product
  change

## What it can fix

Use only these built-in repair paths unless the user asks for deeper edits:

1. Freshness or index drift:
   - Run `node ./bin/bigbrain.js sync --json`
   - Re-run `node ./bin/bigbrain.js health --json`

2. Template/install drift:
   - For `skill_template_mismatch`, inspect `skill_template_status.checks`
   - If the intended active install is missing and the template path exists,
     create or correct the active symlink with `ln -sfn`, then re-run health
   - For `automation_template_mismatch`, compare the template and active
     `automation.toml`; if the active install should track the template, copy
     the template to the active path while preserving machine-local `cwds` when
     present, then re-run health
   - Do not delete, pause, activate, or reschedule automations unless the user
     explicitly asked for that operational change

3. Obvious page-shape fixes:
   - If a finding points to a single page and the correction is obvious from the
     page shape rules, apply the smallest safe edit, then re-run health
   - Safe examples: restoring missing required meeting headings, adding missing
     frontmatter delimiters, or fixing an obviously broken relative markdown
     link target
   - Do not batch-fix broad `missing_separator` or `missing_timeline` findings
     unless the exact page convention is already clear and the user asked for a
     cleanup pass

4. Post-remediation persistence:
   - After any content or brain-file edit, run `node ./bin/bigbrain.js sync
     --json` so embeddings/index state catches up with the files
   - Run `git status --short --branch` and inspect the changed files before
     staging anything
   - Commit only the intentional remediation changes with a concise message
   - Re-run `node ./bin/bigbrain.js health --json` after the commit
   - If the repository is clean and the only remaining git status issue is being
     ahead of the remote, run `git push`

## When to stop

Do not keep digging once one of these is true:
- `health` is clean
- Remaining findings need judgment-heavy content edits
- Multiple candidate fixes exist and the right one is unclear
- BigBrain does not have a safe built-in fix path for the issue
- The issue points to unrelated repo work or new feature work rather than a
  maintenance fix

## Steps

1. Run the health check:
   - `node ./bin/bigbrain.js health --json`
2. Classify findings:
   - no findings -> exit cleanly
   - likely index freshness problem -> `sync`, then re-run health
   - missing active skill install -> repair the symlink, then re-run health
   - automation template mismatch -> reconcile the active file with the
     template when the intended state is clear, then re-run health
   - deterministic page-shape problem -> patch the affected page, then re-run
     health
3. After a successful remediation:
   - run `node ./bin/bigbrain.js sync --json`
   - commit the intentional fix
   - re-run `node ./bin/bigbrain.js health --json`
   - push if the repository is clean and the branch has commits ahead of the
     remote
4. Stop after one bounded remediation loop unless the next action is still
   deterministic and lower risk than leaving the issue open
5. Report:
   - initial findings
   - remediation attempted
   - final findings
   - sync, commit, and push status for remediation changes
   - whether the pass exited cleanly or stopped with explicit follow-up needed

## Guardrails

- Prefer the runtime commands over ad hoc filesystem walks when they answer the
  question directly
- Do not claim to fix citations, embeddings, backups, or automation drift
  unless there is a real command path or deterministic file/symlink repair for
  that in this repo
- Do not mass-rewrite pages during a maintenance pass
- If a manual page edit is required, keep it narrow and local to the reported
  finding
- Do not stage or commit unrelated user changes; if unrelated dirty files are
  present, leave them untouched and report that push was skipped or limited by
  the dirty worktree
- Do not push before the post-remediation sync and health checks complete
- Never report unresolved items as the final outcome until each remaining
  finding has been classified as either attempted, not safely fixable, or
  intentionally deferred
