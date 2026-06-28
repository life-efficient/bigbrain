---
name: "BigBrain: Refresh Tasks"
version: 1.0.0
description: |
  Refresh BigBrain task pages from current brain evidence. Use when the user
  asks to refresh tasks, reconcile stale task pages, suggest task-status changes
  from recent progress, or audit in_progress/waiting/open task metadata.
triggers:
  - "refresh tasks"
  - "reconcile tasks"
  - "update stale tasks"
  - "refresh BigBrain tasks"
  - "clean up task statuses"
tools:
  - mcp
mutating: false
---

# BigBrain: Refresh Tasks

Use this skill to audit existing BigBrain task pages against current brain
evidence and suggest grounded changes. BigBrain tasks are page-backed records
under `tasks/*.md`; do not read or reconstruct old `ops/tasks.md` task lists.

This skill is advisory by default. It should not create, update, close,
archive, reassign, or reprioritize task pages unless the user explicitly asks
for mutation in the current turn after seeing the recommendations.

## Contract

- Use BigBrain MCP for current context when an MCP-backed brain is available.
- Prefer suggestions for existing task pages over suggestions to create new
  tasks.
- Use `me`, `members/list`, `tasks/list`, `filing_rules`, `query`, `search`,
  and `read` when available; use underscore aliases only if slash tool names
  fail.
- Do not call `tasks/update` or `tasks/create` during refresh-task behavior
  unless the user explicitly asks you to apply a specific recommendation in the
  current turn.
- Before suggesting task-page changes, call `filing_rules` and follow the
  compiled `FILING.md` guidance it returns. If that tool is unavailable, list
  and read the relevant `FILING.md` files directly; do not expect a page named
  `filing_rules` to exist.
- Do not assign work to arbitrary `people/*` pages. Assignees must be active
  members.
- Every suggested status, assignee, priority, source, or body change must be
  grounded in retrieved BigBrain pages or explicit user instruction.
- Before marking a task `done` or `archived`, either create or link the
  successor task and use `Next task: tasks/<slug>` in the timeline entry, or
  state `No successor task needed: <reason>`.
- When suggesting that a task should be marked `done` or `archived`, include
  the exact completion handoff that would be required in the timeline: either
  `Next task: tasks/<slug>` or `No successor task needed: <reason>`.

## Workflow

1. Call `me` and `members/list` to identify the requester and active members.
2. Retrieve task context:
   - `filing_rules` for current task-page conventions
   - `tasks/list` for in_progress, open, waiting, and recently done tasks
   - `query` or `search` for recent meetings, project updates, blockers,
     decisions, inbox notes, and roadmap pages related to those tasks
   - direct `read` on task pages and source pages that may change task state
3. For each relevant task, decide whether to recommend that it should be:
   - left unchanged
   - marked `done` because source evidence shows completion
   - moved to `in_progress` because source evidence shows active work is
     underway
   - moved to `waiting` because ownership, access, dependency, reply, approval,
     or decision evidence is missing
   - reopened because the source evidence contradicts a completed state
   - reprioritized because the brain shows urgency or risk changed
   - marked `readiness: "underspecified"` when open questions remain or the
     body lacks context, ownership, next action, or a clear completion
     definition
   - marked `readiness: "ready"` only when the task has enough context,
     completion criteria, and no blocking open questions
   - reassigned only when the new assignee is an active member and the evidence
     supports the ownership change
   - updated with better source links or body context
4. For existing tasks whose metadata or body looks stale, report a suggested
   `tasks/update` payload or concise diff rather than applying it.
5. For close/archive recommendations, identify the next concrete task first
   unless no successor is needed, then include the required completion handoff
   text in the recommendation.
6. Suggest `tasks/create` only when current evidence shows a clear missing task
   that is concrete, useful, deduplicated, and assignable.
7. Leave ambiguous items as review questions rather than mutations.
8. Verify the recommendation set with `tasks/list`, direct `read`, or retrieved
   source evidence; do not verify by writing changes.

## Output

Return:

- `Suggested Updates`: task slugs, proposed changes, exact evidence, and
  suggested payload or timeline entry where useful
- `Suggested Creates`: proposed task titles/slugs, assignees, priority, source,
  and why they are deduplicated
- `Left Unchanged`: important task slugs checked with no change needed
- `Needs Review`: ambiguous tasks or missing ownership that blocked a clear
  recommendation
- `Verification`: checks performed

## Guardrails

- Do not create speculative tasks that are not grounded in the brain.
- Do not create, update, close, archive, reassign, or reprioritize tasks during
  refresh-task behavior unless the user explicitly asks you to apply a specific
  recommendation in the current turn.
- Do not mass-close tasks just because no recent update mentions them.
- Do not mark tasks `readiness: "ready"` just because they are high priority.
  Readiness means they can be fanned out without another clarification round.
- Do not rewrite roadmap, project, initiative, or meeting pages unless the user
  explicitly asks.
- Do not hide missing ownership; report it.
- Do not assign everything to `me` unless the brain or user context supports it.
- Do not bypass the MCP `filing_rules` tool by guessing from stale local
  conventions or by reading a nonexistent `filing_rules` page.
- Do not use old `ops/tasks.md` workflows; BigBrain tasks are page-backed.
