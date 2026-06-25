---
name: "BigBrain: Enrich Tasks"
version: 1.0.0
description: |
  Identify underspecified BigBrain task pages, gather related brain context,
  ask the user focused clarifying questions, and update the tasks once the
  missing details are known. Use when the user asks to enrich tasks, clarify
  vague tasks, make BigBrain tasks handoff-ready, or find tasks needing more
  specification.
triggers:
  - "enrich tasks"
  - "clarify tasks"
  - "make tasks handoff-ready"
  - "tasks needing specification"
  - "underspecified BigBrain tasks"
tools:
  - mcp
mutating: true
---

# BigBrain: Enrich Tasks

Use this skill to turn vague BigBrain task pages into task records that are
ready to hand off or execute. BigBrain tasks are page-backed records under
`tasks/*.md`; do not read or reconstruct old `ops/tasks.md` task lists.

## Contract

- Use BigBrain MCP for current context when an MCP-backed brain is available.
- Prefer `tasks/enrich` to identify underspecified tasks. Use the alias
  `tasks_enrich` only if slash tool names fail.
- Use `me`, `members/list`, `tasks/list`, `read`, `search`, `query`, and
  `tasks/update` as needed to validate context and apply confirmed answers.
- Before updating task pages, call `filing_rules` and follow the compiled
  `FILING.md` guidance it returns. If that tool is unavailable, list and read
  the relevant `FILING.md` files directly.
- Do not invent missing ownership, acceptance criteria, deadlines, or source
  links. Ask focused questions when the brain does not answer them.
- Assignees must be active members. Use `me` only through MCP task tools.

## Workflow

1. Identify the requester and valid assignees with `me` and `members/list`.
2. Call `tasks/enrich` with filters from the user's request:
   - use `assignee: "me"` for "my tasks"
   - pass an explicit `path` for one named task
   - pass `status`, `priority`, or `limit` when the user scopes the pass
3. Review each candidate:
   - read the task page when the MCP summary is not enough
   - inspect `related_context` from `tasks/enrich`
   - use `search` or `query` for missing project, meeting, person, or company
     context before asking the user
4. Resolve what can be resolved from the brain:
   - source links
   - known stakeholders or active members
   - project, meeting, or decision context
   - blockers already documented elsewhere
5. Ask the user only the remaining questions. Group by task slug and keep the
   question count small; prefer questions that unlock a concrete update.
6. After the user answers, update each task with `tasks/update`:
   - enrich the body with clarified context and completion criteria
   - structure the body as Summary, What Counts as Completed, Body Context,
     Open Questions, and Anti-Patterns when rewriting substantial task bodies
   - set `readiness: "ready"` only when there are no blocking open questions
     left
   - keep or set `readiness: "underspecified"` when the task still needs user
     input before fanout
   - add or correct assignees only when they are active members
   - add source links only when grounded in retrieved brain pages or the user's
     answer
   - include a timeline entry such as `Task enriched from clarification pass.`
7. Verify updates with `tasks/list` or direct `read`.

## Output

When asking questions, return:

- `Needs Clarification`: task slug, issue summary, related context used, and
  focused questions
- `Resolved From Brain`: details found without needing the user
- `Not Enriched`: tasks skipped and why

After applying answers, return:

- `Updated Tasks`: task slugs and fields changed
- `Still Needs Clarification`: remaining gaps
- `Verification`: checks performed

## Guardrails

- Do not use this skill to create new task pages; use `BigBrain: Roadmap Tasks`
  when the user wants new tasks generated.
- Do not treat a vague task as ready just because it has a title.
- Do not set `readiness: "ready"` while the task still has blocking items under
  `## Open Questions`.
- Do not update tasks from weak inference when a short user question would avoid
  corrupting the brain.
- Do not assign work to arbitrary `people/*` pages. Assignees must be active
  members.
- Do not bypass the MCP `filing_rules` tool before writes.
- Do not use old `ops/tasks.md` workflows; BigBrain tasks are page-backed.
