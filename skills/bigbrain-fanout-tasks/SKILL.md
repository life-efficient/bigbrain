---
name: "BigBrain: Fanout Tasks"
version: 1.0.0
description: |
  Fan out in-progress and open BigBrain task pages into separate Codex threads
  using handoff prompts built from the BigBrain MCP task tools. Use when the
  user wants daily kickoff threads, one thread per brain task, prompts for
  their assigned BigBrain tasks, or prompts filtered by task assignee, status,
  or priority.
triggers:
  - "fan out brain tasks"
  - "bigbrain task prompts"
  - "daily kickoff from BigBrain"
  - "one prompt per brain task"
  - "tasks assigned to me"
tools:
  - mcp
  - codex_app
mutating: true
---

# BigBrain: Fanout Tasks

Use this skill when the user wants BigBrain task pages fanned out into
handoff-ready Codex threads. BigBrain tasks are page-backed records under
`tasks/*.md`; do not read or reconstruct old `ops/tasks.md` task lists.

By default, this skill should create one new Codex thread per ready task when
the Codex app thread tools are available. The generated worker prompt remains
the same kind of self-contained prompt this skill previously returned in chat;
the difference is that the prompt is passed directly to `codex_app.create_thread`.
Only return copyable prompts instead of creating threads when the user
explicitly asks for prompts only, or when live thread creation is unavailable
after targeted tool discovery.

## Workflow

Use the BigBrain MCP task endpoint as the source of truth:

1. Call `tasks/list` twice by default: first with `status: "in_progress"`,
   then with `status: "open"`.
2. If `tasks/list` is not visible, use targeted Codex tool discovery for the
   BigBrain `tasks/list` tool before falling back to runtime or code inspection.
3. Honor scoping in the user's request:
   - For "my tasks" or "assigned to me", pass `assignee: "me"`.
   - For "for people/name" or "assigned to people/name", pass that assignee
     slug.
   - For a named priority such as `p0`, `p1`, `p2`, or `p3`, pass `priority`.
   - For a named status, pass that `status`; otherwise use both default calls.
4. Use the returned task title, body, priority, assignees, source, and slug to
   create one prompt per task. The prompt itself must contain the task context
   needed to begin; do not make the worker fetch or read the task page before
   starting.
5. Treat `readiness` and `execution_mode` as useful hints, then read the task
   body. If `## Open Questions` contains substantive questions, keep the task
   out of worker prompt blocks and list it as needing input, unless the task is
   clearly an interactive guided session whose purpose is to answer those
   questions with the user.
6. Classify the remaining tasks with `readiness` and `execution_mode`. Generate
   autonomous handoff prompts for tasks with `readiness: "ready"` and
   `execution_mode: "agent"`. Generate guided-session prompts for tasks with
   `readiness: "ready"` and `execution_mode: "interactive"`, instructing Codex
   to walk through the task with the user step by step. Keep
   `readiness: "underspecified"` and `execution_mode: "user"` tasks out of
   prompt blocks and list them separately as needing user action or input.
7. Discover the Codex thread tools before concluding live fanout is unavailable:
   - Call `tool_search` for `create_thread`.
   - Use `codex_app.list_projects` when available to choose an appropriate
     target for each worker thread.
   - Use `codex_app.create_thread` for each ready task, passing the generated
     handoff prompt as the new thread's initial prompt.
   - Use a repo project target with a local or worktree environment when the
     task clearly belongs to a known local project.
   - Use `target: { "type": "projectless" }` for general BigBrain work or
     tasks that do not clearly belong to one code repository.
   - Preserve returned thread IDs or links so they can be reported.

Respond in chat with the launched thread list and any blocked/non-fanned-out
tasks. Do not write the result to a file, do not return only a file link, and
do not make the user open an artifact to see what was launched.

## Output Requirements

Default output is capped at 10 ready items. Keep each worker prompt short,
self-contained, and suitable as the initial prompt for a fresh Codex thread:

- Show ready `in_progress` tasks first, followed by ready `open` tasks.
- Include only tasks whose MCP record has `readiness: "ready"` and
  `execution_mode: "agent"` or `execution_mode: "interactive"` after the
  open-questions override above.
- Each ready task should be one concise copyable prompt block that leads with
  the actual task content, using plain language drawn from the task page rather
  than a slug-heavy reference style.
- Do not use task slugs as prompt headings or lead text.
- The first paragraph must be only the task-specific brief: what to do, what to
  focus on, and the concrete output expected for this task. Do not mix generic
  workflow instructions into this paragraph.
- Put the reusable worker instructions in a separate paragraph after the
  task-specific brief.
- For `execution_mode: "interactive"` tasks, the prompt must tell Codex to take
  the user through the task step by step, ask for input at each decision point,
  and not proceed past a decision without the user's answer.
- For `execution_mode: "interactive"` tasks, prepend this sentence before the
  task-specific brief:
  `I need to get this done, and I want you to walk me through it step by step.`
  This keeps the worker's posture clear without overfitting to any one task.
- After that prepend, keep the same task-specific brief format as autonomous
  prompts: what to do, what to focus on, and the concrete output expected for
  this task.
- Each prompt should stand on its own by pulling in the key task details, so a
  reader can tell what they are doing without needing to parse internal file
  references first or find the task in the brain before beginning.
- The reusable-instructions paragraph should be concise and use this wording:
  `Show me the result for approval once you finish the task. Once approved, update the brain, marking the task as done or in_progress, enriching related pages and their timelines, and noting the successor task if needed.`
- Include the source task slug only as a compact completion/update reference,
  for example `Source task: tasks/<slug>`. Do not instruct the worker to read,
  open, find, or fetch the task from the brain before starting.
- Do not format ready tasks as a numbered list.
- Do not include boilerplate about reading files, preserving changes,
  verification, or commits beyond the required completion handoff.
- When live thread creation succeeds, do not print the full worker prompts by
  default. Instead, show a concise launched-thread list with each task title,
  execution mode, and returned thread ID or link.
- When the user explicitly asks for copyable prompts only, or live thread
  creation is unavailable, print the prompt blocks instead of thread IDs.
- Show a `Needs user action before fanout` section after ready prompts for
  input-needed tasks and `execution_mode: "user"` tasks.
- Keep the input-needed list succinct; name each task by human-readable title
  or action, not slug, and include the blocking question(s), preferring the task
  page's `## Open Questions` section when present.

If no actionable BigBrain task pages match the requested filters, say that
directly and do not invent prompts.

If live thread creation is unavailable after targeted `create_thread`
discovery, output exactly:

`Parallel execution unavailable here.`

Then provide the shortest useful set of copyable worker prompts.

## Quality Rules

- Treat MCP task data as authoritative for task status and assignees.
- Do not use local `TODO.md` discovery for this skill.
- Do not mutate tasks while fanning them out.
- Creating Codex threads is allowed by this skill; mutating BigBrain task pages
  is not.
- Do not create prompts for tasks with `status: "done"` or
  `status: "archived"` unless the user explicitly asks for those statuses.
- Do not create prompts for input-needed tasks or `execution_mode: "user"`
  tasks.
- Keep each prompt scoped to one task; split multi-task records into
  input-needed items rather than guessing hidden subtasks.
- Do not claim fanout ran unless `codex_app.create_thread` succeeded for the
  relevant workers.
