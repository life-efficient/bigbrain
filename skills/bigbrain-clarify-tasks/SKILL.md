---
name: "BigBrain: Clarify Tasks"
version: 1.0.0
description: |
  Find BigBrain task pages that need clarification, identify archive and merge
  candidates, ask focused questions, and update tasks only when the user
  explicitly asks. Use when the user asks to clarify tasks, clean up vague
  tasks, find tasks needing specification, enrich tasks, or make BigBrain tasks
  handoff-ready.
triggers:
  - "clarify tasks"
  - "which tasks need clarification"
  - "clean up vague tasks"
  - "tasks needing specification"
  - "underspecified BigBrain tasks"
  - "enrich tasks"
  - "make tasks handoff-ready"
tools:
  - mcp
mutating: true
---

# BigBrain: Clarify Tasks

Use this skill to review BigBrain task pages and separate useful tasks that
need clearer specifications from stale, duplicate, or fragmentary task records.
BigBrain tasks are page-backed records under `tasks/*.md`; do not read or
reconstruct old `ops/tasks.md` task lists.

## Contract

- Use BigBrain MCP for current task context when an MCP-backed brain is
  available.
- Use `tasks/list` as the task source of truth. Pass `readiness:
  "underspecified"` by default when the user asks what needs clarification.
- Use `me`, `members/list`, `tasks/list`, `read`, `search`, `query`,
  `filing_rules`, and `tasks/update` as needed.
- Do not call `tasks/enrich`; task clarification is owned by this skill, not a
  separate MCP enrichment endpoint.
- Do not mutate tasks unless the user explicitly asks to archive, merge, or
  update them.
- Before any task update, call `filing_rules` and follow the compiled
  `FILING.md` guidance it returns. If that tool is unavailable, list and read
  the relevant `FILING.md` files directly.
- Do not invent missing ownership, acceptance criteria, deadlines, or source
  links. Ask focused questions when the brain does not answer them.
- Assignees must be active members. Use `me` only through MCP task tools.

## Workflow

1. Identify the requester and valid assignees with `me` and `members/list` when
   ownership or assignment may be updated.
2. List candidate tasks with `tasks/list`:
   - use `readiness: "underspecified"` by default for clarification reviews
   - use `assignee: "me"` for "my tasks"
   - pass `status`, `priority`, `readiness`, or `assignee` when the user scopes
     the pass
   - when no status is named, review `in_progress`, `open`, and `waiting`
     tasks; do not include `done` or `archived` unless explicitly requested
3. Read task bodies when summaries are not enough. Use `search` or `query` for
   missing project, meeting, person, company, or decision context before asking
   the user.
4. Classify each relevant task:
   - `Clarify` for useful work missing owner, source, next action, completion
     criteria, unblock path, or enough body context for handoff
   - `Archive Candidates` for fragments, stale priority notes, duplicate
     placeholders, broad umbrella tasks, or items already covered by sharper
     tasks
   - `Merge Candidates` for overlapping tasks that should become one clearer
     task before fanout
5. Ask the user only the remaining questions needed to make a task ready or to
   confirm archive/merge decisions. Keep questions short and grouped by
   human-readable task title.
6. If the user explicitly asks for updates, use `tasks/update`:
   - enrich the body with clarified context and completion criteria
   - structure substantial rewrites as Summary, What Counts as Completed, Body
     Context, Open Questions, and Anti-Patterns
   - set `readiness: "ready"` only when there are no blocking open questions
   - keep or set `readiness: "underspecified"` when the task still needs user
     input before fanout
   - set `execution_mode: "agent"` for autonomous agent-executable work,
     `execution_mode: "user"` for work the user must personally do, or
     `execution_mode: "interactive"` when the agent should walk the user
     through input, review, or decisions
   - add or correct assignees only when they are active members
   - add source links only when grounded in retrieved brain pages or the user's
     answer
   - when archiving, include `No successor task needed: <reason>` unless a
     successor is explicitly identified
7. Verify updates with `tasks/list` or direct `read`.

## Output

For review-only runs, return:

- `Clarify`: useful task titles, why they need clarification, and focused
  questions
- `Archive Candidates`: task titles and the reason each looks stale,
  fragmentary, duplicate, or too broad
- `Merge Candidates`: task titles that overlap and the suggested merged shape
- `Resolved From Brain`: important details found without needing the user

After applying explicit updates, return:

- `Updated Tasks`: task slugs and fields changed
- `Still Needs Clarification`: remaining gaps
- `Verification`: checks performed

## Guardrails

- Do not create new task pages; use `BigBrain: Roadmap Tasks` when the user
  wants new tasks generated.
- Do not treat a vague task as ready just because it has a title.
- Do not set `readiness: "ready"` while the task still has blocking items under
  `## Open Questions`.
- Do not update tasks from weak inference when a short user question would
  avoid corrupting the brain.
- Do not assign work to arbitrary `people/*` pages. Assignees must be active
  members.
- Do not bypass the MCP `filing_rules` tool before writes.
- Do not use old `ops/tasks.md` workflows; BigBrain tasks are page-backed.
