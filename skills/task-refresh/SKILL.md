---
name: task-refresh
version: 1.0.0
description: |
  Reconcile the canonical ops/tasks.md file for a BigBrain-style markdown directory
  by inspecting recently changed notes and applying conservative task updates.
triggers:
  - "refresh tasks from recent notes"
  - "update ops tasks from recent pages"
  - "reconcile tasks from recent meetings"
tools:
  - shell
mutating: true
---

# BigBrain: Task Refresh

Use this skill when the task list needs to be kept current based on recently changed
pages, not when the user wants the tasks themselves executed.

## Contract

This skill guarantees:
- The target notes directory is read from `bigbrain.config.json`
- Recent changes are discovered via the standalone `bigbrain recent --json` CLI
- The canonical task file is updated conservatively from explicit recent signals
- The task file itself is excluded from recency detection to avoid self-trigger loops
- `bigbrain.state.json` advances `last_checked_at` only after a successful refresh

## Steps

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
