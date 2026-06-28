---
name: "BigBrain: What's Next"
version: 1.0.0
description: |
  Provide a concise snapshot of what should be done next from in-progress and
  open BigBrain task pages exposed through the BigBrain MCP task tools. Use when the user
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

Use this skill when the user wants a short, decision-ready snapshot of active
and ready BigBrain task pages. BigBrain tasks are page-backed records under
`tasks/*.md`; do not read or reconstruct old `ops/tasks.md` task lists.

This skill is related to `bigbrain-fanout-tasks`, but it does not produce
copyable handoff prompts by default. It summarizes the next work first, then
offers to fan out prompts if the user wants to start the work.

## Workflow

Use the BigBrain MCP task endpoint as the source of truth:

1. Call `tasks/list` twice by default: first with `status: "in_progress"`,
   then with `status: "open"`.
2. If the MCP client does not support slash tool names, call the alias
   `tasks_list` with the same arguments.
3. Honor scoping in the user's request:
   - For "my tasks" or "assigned to me", pass `assignee: "me"`.
   - For "for people/name" or "assigned to people/name", pass that assignee
     slug.
   - For a named priority such as `p0`, `p1`, `p2`, or `p3`, pass `priority`.
   - For a named status, pass that `status`; otherwise use both default calls.
4. Use the returned task title, body, priority, assignees, source, and slug to
   identify the most useful next work. Use slugs internally for lookup and
   continuity, but do not normally show them in the snapshot output.
5. Prefer `in_progress` tasks first, then high-priority `open` tasks that are
   clearly scoped and assigned to the requester when the request implies
   personal focus. Keep `waiting` tasks separate unless the user asks for them.
6. Treat `readiness` as authoritative:
   - `readiness: "ready"` means the task can appear in the normal next-work
     numbered list.
   - `readiness: "underspecified"` means the task needs user input before it
     should be fanned out or treated as an executable handoff.

Respond in chat with the snapshot. Do not write the result to a file, do not
return only a file link, and do not make the user open an artifact to see what
is next.

## Output Requirements

Default output is capped at 8 numbered items. Keep the snapshot short:

- Show a `What's Next` section first.
- This section should contain only `readiness: "ready"` tasks.
- Format ready tasks as a numbered list, not bullets.
- Each numbered item should lead with a human-readable task title or action, not the
  task slug. Include priority only when it helps ranking or urgency.
- Do not include task slugs in the `What's Next` numbered list unless the user
  explicitly asks for paths/slugs or two tasks would otherwise be ambiguous.
- Do not format the numbered list as copyable prompt blocks.
- Do not include boilerplate about reading files, preserving changes,
  verification, or commits.
- After the existing bullet output, append exactly:
  `I also need your input on a few tasks:`
- Under that line, show a numbered list of `readiness: "underspecified"` tasks.
  For each task, include indented bullet questions.
- Name underspecified tasks by human-readable title or action, not slug, unless
  the user explicitly asks for paths/slugs.
- Prefer questions from the task page's `## Open Questions` section. If that
  section is absent or incomplete, add a small number of inferred blocking
  questions on the spot.
- Do not include underspecified tasks in the main `What's Next` numbered list.
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
- Do not promote an underspecified task to the ready list just because it sounds
  important.
- Keep each numbered item scoped to one task; put multi-task or ambiguous records in
  the input-needed list rather than guessing hidden subtasks.
