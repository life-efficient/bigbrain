---
name: "BigBrain: What's Next"
version: 1.0.0
description: |
  Provide a concise snapshot of what should be done next from open BigBrain
  task pages exposed through the BigBrain MCP task tools. Use when the user
  asks what's next, wants a short task snapshot, or wants to decide what to
  work on before optionally fanning out full handoff prompts.
triggers:
  - "what's next"
  - "what is next"
  - "what should I do next"
  - "next BigBrain tasks"
  - "snapshot of what needs to be done"
  - "what needs to be done next"
tools:
  - mcp
mutating: false
---

# BigBrain: What's Next

Use this skill when the user wants a short, decision-ready snapshot of open
BigBrain task pages. BigBrain tasks are page-backed records under `tasks/*.md`;
do not read or reconstruct old `ops/tasks.md` task lists.

This skill is related to `bigbrain-fanout-tasks`, but it does not produce
copyable handoff prompts by default. It summarizes the next work first, then
offers to fan out prompts if the user wants to start the work.

## Workflow

Use the BigBrain MCP task endpoint as the source of truth:

1. Call `tasks/list` with `status: "open"` by default.
2. If the MCP client does not support slash tool names, call the alias
   `tasks_list` with the same arguments.
3. Honor scoping in the user's request:
   - For "my tasks" or "assigned to me", pass `assignee: "me"`.
   - For "for people/name" or "assigned to people/name", pass that assignee
     slug.
   - For a named priority such as `p0`, `p1`, `p2`, or `p3`, pass `priority`.
   - For a named status, pass `status`; otherwise keep `status: "open"`.
4. Use the returned task title, body, priority, assignees, source, and slug to
   identify the most useful next work.
5. Prefer tasks that are high priority, unblocked, clearly scoped, and assigned
   to the requester when the request implies personal focus.

Respond in chat with the snapshot. Do not write the result to a file, do not
return only a file link, and do not make the user open an artifact to see what
is next.

## Output Requirements

Default output is capped at 8 bullets. Keep the snapshot short:

- Show a `What's Next` section first.
- Each bullet should include the task slug, priority when present, and a
  one-sentence description of the concrete next action.
- Do not format bullets as copyable prompt blocks.
- Do not include boilerplate about reading files, preserving changes,
  verification, or commits.
- Show a `Needs Clarification` section only when matching tasks are too vague,
  blocked, unassigned, or too broad to treat as immediate next work.
- Keep clarification bullets succinct; name the task slug and the missing
  decision or context.
- End by asking whether the user wants handoff prompts generated for the
  ready tasks.

If the user agrees to receive prompts, immediately use the BigBrain: Fanout
Tasks workflow on the same task scope and filters. Do not ask the user to repeat
the scope.

If no actionable BigBrain task pages match the requested filters, say that
directly and offer to run BigBrain: Roadmap Tasks only if the user wants new
tasks proposed from current brain evidence.

## Quality Rules

- Treat MCP task data as authoritative for task status and assignees.
- Do not use local `TODO.md` discovery for this skill.
- Do not mutate tasks while producing the snapshot.
- Do not create summaries for tasks with `status: "done"` or
  `status: "archived"` unless the user explicitly asks for those statuses.
- Keep each bullet scoped to one task; put multi-task or ambiguous records in
  `Needs Clarification` rather than guessing hidden subtasks.
