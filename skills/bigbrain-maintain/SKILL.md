---
name: "BigBrain: Maintain"
version: 1.0.0
description: |
  Check a BigBrain for problems, fix the obvious ones that BigBrain already
  knows how to fix, and clearly report anything that still needs manual follow-up.
triggers:
  - "run BigBrain maintenance"
  - "maintain BigBrain"
  - "check BigBrain health and fix what you can"
  - "run the health check and address issues"
tools:
  - shell
mutating: true
---

# BigBrain: Maintain

Use this skill when you want a quick BigBrain checkup. It runs the health
check, fixes straightforward issues when there is a safe built-in path, and
then tells you what still needs attention.

## Contract

This skill guarantees:
- Start with the live `bigbrain health --json` report
- Fix straightforward problems when the current runtime already has a safe way
  to do that
- Re-run health after any remediation attempt
- Exit cleanly when no findings remain
- Stop clearly when the remaining issues need manual page edits or a product
  change

## What it can fix

Use only these built-in repair paths unless the user asks for deeper edits:

1. Freshness or index drift:
   - Run `node ./bin/bigbrain.js sync --json`
   - Re-run `node ./bin/bigbrain.js health --json`

2. Task freshness only:
   - Run `node ./bin/bigbrain.js recent --json`
   - If recent note movement suggests `ops/tasks.md` is stale, run
     `node ./bin/bigbrain.js refresh-tasks --json`

3. Obvious page-shape fixes:
   - If a finding points to a single page and the correction is obvious from the
     page shape rules, apply the smallest safe edit, then re-run health
   - Safe examples: restoring missing required meeting headings, adding missing
     frontmatter delimiters, or fixing an obviously broken relative markdown
     link target

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
   - likely stale task view -> inspect `recent`, then `refresh-tasks` if needed
   - deterministic page-shape problem -> patch the affected page, then re-run
     health
3. Stop after one bounded remediation loop unless the next action is still
   deterministic and lower risk than leaving the issue open
4. Report:
   - initial findings
   - remediation attempted
   - final findings
   - whether the pass exited cleanly or stopped with explicit follow-up needed

## Guardrails

- Prefer the runtime commands over ad hoc filesystem walks when they answer the
  question directly
- Do not claim to fix citations, embeddings, backups, or automation drift
  unless BigBrain has a real command path for that in this repo
- Do not mass-rewrite pages during a maintenance pass
- If a manual page edit is required, keep it narrow and local to the reported
  finding
