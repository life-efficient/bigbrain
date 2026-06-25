---
name: "BigBrain: Refresh Tasks"
version: 1.0.0
description: |
  Refresh BigBrain task pages from current brain evidence. Use when the user
  asks to refresh tasks, reconcile stale task pages, update task statuses from
  recent progress, or clean up blocked/waiting/open task metadata.
triggers:
  - "refresh tasks"
  - "reconcile tasks"
  - "update stale tasks"
  - "refresh BigBrain tasks"
  - "clean up task statuses"
tools:
  - mcp
mutating: true
---

# BigBrain: Refresh Tasks

Use this skill to reconcile existing BigBrain task pages with current brain
evidence. BigBrain tasks are page-backed records under `tasks/*.md`; do not read
or reconstruct old `ops/tasks.md` task lists.

## Contract

- Use BigBrain MCP for current context when an MCP-backed brain is available.
- Prefer updating existing task pages over creating new ones.
- Use `me`, `members/list`, `tasks/list`, `tasks/update`, and `tasks/create`
  when available; use underscore aliases only if slash tool names fail.
- Before creating or updating task pages, call `filing_rules` and follow the
  compiled `FILING.md` guidance it returns. If that tool is unavailable, list
  and read the relevant `FILING.md` files directly; do not expect a page named
  `filing_rules` to exist.
- Do not assign work to arbitrary `people/*` pages. Assignees must be active
  members.
- Every status, assignee, priority, source, or body change must be grounded in
  retrieved BigBrain pages or explicit user instruction.
- Before marking a task `done` or `archived`, either create or link the
  successor task and use `Next task: tasks/<slug>` in the timeline entry, or
  state `No successor task needed: <reason>`.

## Workflow

1. Call `me` and `members/list` to identify the requester and active members.
2. Retrieve task context:
   - `filing_rules` for current task-page conventions
   - `tasks/list` for open, waiting, blocked, and recently done tasks
   - `query` or `search` for recent meetings, project updates, blockers,
     decisions, inbox notes, and roadmap pages related to those tasks
   - direct `read` on task pages and source pages that may change task state
3. For each relevant task, decide whether it should be:
   - left unchanged
   - marked `done` because source evidence shows completion
   - moved to `blocked` or `waiting` because ownership, access, dependency, or
     decision evidence is missing
   - reopened because the source evidence contradicts a completed state
   - reprioritized because the brain shows urgency or risk changed
   - marked `readiness: "underspecified"` when blocking questions remain or the
     body lacks a clear completion definition
   - marked `readiness: "ready"` only when the task has enough context,
     completion criteria, and no blocking open questions
   - reassigned only when the new assignee is an active member and the evidence
     supports the ownership change
   - updated with better source links or body context
4. Use `tasks/update` for existing tasks whose metadata or body is stale.
5. When closing a task, create or identify the next concrete task first unless
   no successor is needed, then include the completion handoff in
   `tasks/update`.
6. Use `tasks/create` only when current evidence shows a clear missing task that
   is concrete, useful, deduplicated, and assignable.
7. Leave ambiguous items as recommendations rather than mutating them.
8. Verify updates with `tasks/list` or direct `read`.

## Output

Return:

- `Updated Tasks`: task slugs and what changed
- `Created Tasks`: task slugs, assignees, priority, and source
- `Left Unchanged`: important task slugs checked with no change needed
- `Needs Review`: ambiguous tasks or missing ownership that blocked mutation
- `Verification`: checks performed

## Guardrails

- Do not create speculative tasks that are not grounded in the brain.
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
