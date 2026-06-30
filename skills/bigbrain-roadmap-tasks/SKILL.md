---
name: "BigBrain: Roadmap Tasks"
version: 1.0.0
description: |
  Suggest and create roadmap tasks from BigBrain progress, open questions,
  blockers, and member responsibilities. Use when the user asks what tasks
  should be added next, wants a roadmap-to-task pass, or wants next actions
  generated from a BigBrain-backed project or brain.
triggers:
  - "roadmap tasks"
  - "what tasks should be added"
  - "create next tasks from the brain"
  - "turn roadmap into tasks"
  - "next actions from BigBrain"
tools:
  - mcp
mutating: true
---

# BigBrain: Roadmap Tasks

Use the selected BigBrain brain to turn current progress and gaps into
assignable task pages under `tasks/*.md`.

## Contract

- Use BigBrain MCP for current context when an MCP-backed brain is available.
- Prefer direct task creation when a recommendation is concrete, useful,
  grounded in the brain, and assignable to an active member.
- Use `me`, `members/list`, `tasks/list`, `tasks/create`, and `tasks/update`
  when available. If any task tool is not visible, use targeted Codex tool
  discovery before falling back to runtime or code inspection.
- Before creating or updating task pages, call `filing_rules` and follow the
  compiled `FILING.md` guidance it returns. If that tool is unavailable, list
  and read the relevant `FILING.md` files directly; do not expect a page named
  `filing_rules` to exist.
- Do not assign work to arbitrary `people/*` pages. Assignees must be active
  members.
- Keep roadmap reasoning grounded in retrieved BigBrain pages.
- Before marking a task `done` or `archived`, either create or link the
  successor task and use `Next task: tasks/<slug>` in the timeline entry, or
  state `No successor task needed: <reason>`.

## Workflow

1. Call `me` and `members/list` to identify the requester and active members.
2. Retrieve current context:
   - `filing_rules` for current task-page and routing conventions
   - `tasks/list` for existing in_progress, open, and waiting tasks
   - `query` or `search` for projects, initiatives, roadmaps, blockers, recent
     meetings, inbox questions, and relevant operating notes
   - direct `read` on the most relevant pages
3. Identify task candidates:
   - overdue, waiting, or stalled follow-ups
   - unowned open questions that should become work
   - project or initiative next steps that are concrete enough to assign
   - dependencies or risks that need active resolution
   - documentation, migration, or cleanup work that is clearly supported by
     current brain evidence
4. Deduplicate against existing task pages.
5. Create task pages with `tasks/create` when each task has:
   - a clear title
   - status, priority, and source links
   - execution_mode set to `agent`, `user`, or `interactive`
   - one or more active member assignees
   - a body that explains why the task exists and what good completion means
6. Use `tasks/update` instead of creating a new task when an existing page
   already captures the work but needs status, priority, execution_mode,
   source, body, or assignee updates.
7. When a roadmap pass closes a task, create or identify the next concrete task
   first unless no successor is needed, then include the completion handoff in
   `tasks/update`.
8. Leave non-actionable, ungrounded, or unassignable ideas as recommendations
   only.
9. Verify created or updated tasks with `tasks/list` or direct `read`.

## Output

Return:

- `Created Tasks`: task slugs, assignees, priority, and source
- `Updated Tasks`: task slugs and what changed
- `Suggested But Not Created`: reason each item was not created
- `Existing Tasks Considered`: relevant duplicates or blockers
- `Verification`: checks performed

## Guardrails

- Do not create speculative tasks that are not grounded in the brain.
- Do not rewrite roadmap, project, initiative, or meeting pages unless the user
  explicitly asks.
- Do not hide missing ownership; report it.
- Do not assign everything to `me` unless the brain or user context supports it.
- Do not bypass the MCP `filing_rules` tool by guessing from stale local
  conventions or by reading a nonexistent `filing_rules` page.
- Do not use old `ops/tasks.md` workflows; BigBrain tasks are page-backed.
