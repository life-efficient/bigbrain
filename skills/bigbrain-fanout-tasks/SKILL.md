---
name: "BigBrain: Fanout Tasks"
version: 1.0.0
description: |
  Fan out concise chat prompts from open BigBrain task pages exposed through
  the BigBrain MCP task tools. Use when the user wants daily kickoff prompts,
  one prompt per brain task, prompts for their assigned BigBrain tasks, or
  prompts filtered by task assignee, status, or priority.
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
   create one prompt per task.
5. Treat `readiness` as authoritative. Generate handoff prompts only for
   `readiness: "ready"` tasks. Keep `readiness: "underspecified"` tasks out of
   prompt blocks and list them separately as needing input.

Respond in chat with the generated prompts. Do not write the result to a file,
do not return only a file link, and do not make the user open an artifact to see
the prompts.

## Output Requirements

Default output is capped at 10 ready items. Keep each ready item short and
copyable:

- Show a `Ready tasks` section first.
- Include only tasks whose MCP record has `readiness: "ready"`.
- Each ready task should be one concise copyable prompt block that leads with
  the actual task content, using plain language drawn from the task page rather
  than a slug-heavy reference style.
- Each prompt should stand on its own by pulling in the key task details, so a
  reader can tell what they are doing without needing to parse internal file
  references first.
- Each prompt must tell the worker to show the proposed work to the user for
  approval before taking the final action, while still updating the brain with
  what happened (for example, timeline updates or page-body changes).
- Each prompt must instruct the worker to finish by asking:
  `Anything you want changed, or should I update this in the brain?`
- Each prompt must end with:
  `Before you start working, check the full task spec in the BigBrain tasks/<slug>.`
- Each prompt must tell the worker that before marking the task `done` or
  `archived`, they must either create/link the successor as
  `Next task: tasks/<slug>` or state
  `No successor task needed: <reason>` in the completion timeline.
- Do not format ready tasks as a numbered list.
- Do not include boilerplate about reading files, preserving changes,
  verification, or commits beyond the required completion handoff.
- Show a `Needs input before fanout` section after ready tasks for
  `readiness: "underspecified"` tasks.
- Keep the input-needed list succinct; name the task slug and include the
  blocking question(s), preferring the task page's `## Open Questions` section
  when present.

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
