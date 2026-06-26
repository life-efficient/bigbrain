---
name: "BigBrain: Fanout Tasks"
version: 1.0.0
description: |
  Fan out concise chat prompts from in-progress and open BigBrain task pages
  exposed through the BigBrain MCP task tools. Use when the user wants daily
  kickoff prompts, one prompt per brain task, prompts for their assigned
  BigBrain tasks, or prompts filtered by task assignee, status, or priority.
triggers:
  - "fan out brain tasks"
  - "bigbrain task prompts"
  - "daily kickoff from BigBrain"
  - "one prompt per brain task"
  - "tasks assigned to me"
tools:
  - mcp
mutating: false
---

# BigBrain: Fanout Tasks

Use this skill when the user wants handoff-ready chat prompts generated from
BigBrain task pages. BigBrain tasks are page-backed records under `tasks/*.md`;
do not read or reconstruct old `ops/tasks.md` task lists.

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
   create one prompt per task. Use the slug only for the final full-spec
   reference inside each prompt.
5. Treat `readiness` as authoritative. Generate handoff prompts only for
   `readiness: "ready"` tasks. Keep `readiness: "underspecified"` tasks out of
   prompt blocks and list them separately as needing input.

Respond in chat with the generated prompts. Do not write the result to a file,
do not return only a file link, and do not make the user open an artifact to see
the prompts.

## Output Requirements

Default output is capped at 10 ready items. Keep each ready item short and
copyable:

- Show ready `in_progress` tasks first, followed by ready `open` tasks.
- Include only tasks whose MCP record has `readiness: "ready"`.
- Each ready task should be one concise copyable prompt block that leads with
  the actual task content, using plain language drawn from the task page rather
  than a slug-heavy reference style.
- Do not use task slugs as prompt headings or lead text.
- The first paragraph must be only the task-specific brief: what to do, what to
  focus on, and the concrete output expected for this task. Do not mix generic
  workflow instructions into this paragraph.
- Put the reusable worker instructions in a separate paragraph after the
  task-specific brief.
- Each prompt should stand on its own by pulling in the key task details, so a
  reader can tell what they are doing without needing to parse internal file
  references first.
- The reusable-instructions paragraph should be concise and use this wording:
  `Show me the result for approval once you finish the task. Once approved, update the brain, marking the task as done or in_progress, enriching related pages and their timelines, and noting the successor task if needed.`
- The only task slug that should appear inside a ready prompt is the final
  full-spec reference. Each prompt must end with:
  `Do not start working until you have read the full task spec in the BigBrain tasks/<slug>.`
- Do not format ready tasks as a numbered list.
- Do not include boilerplate about reading files, preserving changes,
  verification, or commits beyond the required completion handoff.
- Show a `Needs input before fanout` section after ready tasks for
  `readiness: "underspecified"` tasks.
- Keep the input-needed list succinct; name each task by human-readable title
  or action, not slug, and include the blocking question(s), preferring the task
  page's `## Open Questions` section when present.

If no actionable BigBrain task pages match the requested filters, say that
directly and do not invent prompts.

## Quality Rules

- Treat MCP task data as authoritative for task status and assignees.
- Do not use local `TODO.md` discovery for this skill.
- Do not mutate tasks while fanning them out.
- Do not create prompts for tasks with `status: "done"` or
  `status: "archived"` unless the user explicitly asks for those statuses.
- Do not create prompts for tasks with `readiness: "underspecified"`.
- Keep each prompt scoped to one task; split multi-task records into
  input-needed items rather than guessing hidden subtasks.
