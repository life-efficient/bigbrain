---
name: "BigBrain: Task Refresh"
version: 1.0.0
description: |
  Review recent changes in a BigBrain and update `ops/tasks.md` so the task list
  reflects what changed in the notes.
triggers:
  - "refresh tasks from recent notes"
  - "update ops tasks from recent pages"
  - "reconcile tasks from recent meetings"
tools:
  - shell
mutating: true
---

# BigBrain: Task Refresh

Use this skill when the task list looks stale and should be brought back in
line with recent note changes. It updates the task list; it does not do the
tasks themselves.

## Contract

This skill guarantees:
- The target notes directory is read from `bigbrain.config.json`
- Recent changes are discovered via the standalone `bigbrain recent --json` CLI
- The canonical task file is updated only when the recent notes clearly support
  a task change
- The task file itself is excluded from recency detection to avoid self-trigger loops
- `bigbrain.state.json` advances `last_checked_at` only after a successful refresh

## What it does

1. Inspect recent note changes:
   - `node ./bin/bigbrain.js recent --json`
2. Reconcile the task file from those recent changes:
   - `node ./scripts/refresh-tasks.mjs --json`
3. Report:
   - which files were considered
   - whether `ops/tasks.md` changed
   - how many tasks were updated or added

## Guardrails

- Do not execute the tasks in `ops/tasks.md`
- Prefer rewriting an existing matching task over adding a new one
- Do not invent a new task unless the recent page has a clear `## Open Threads` signal
- Do not use task-file self-changes as evidence
