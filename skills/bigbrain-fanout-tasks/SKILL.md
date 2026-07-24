---
name: "BigBrain: Fanout Tasks"
version: 1.0.0
description: |
  Fan out currently discussed BigBrain task pages into separate Codex threads
  using handoff prompts built from the BigBrain MCP task tools. Use when the
  user wants the tasks just mentioned, selected from a recent what's-next
  snapshot, or explicitly filtered by assignee, status, or priority turned into
  handoff-ready worker threads.
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

Use this skill when the user wants the currently discussed BigBrain task pages
fanned out into handoff-ready Codex threads. BigBrain tasks are page-backed
records under `tasks/*.md`; do not read or reconstruct old `ops/tasks.md` task
lists.

By default, this skill should create one new Codex thread per ready task in the
current conversation scope when the Codex app thread tools are available. The
current conversation scope is narrower than the whole task queue: it means
tasks the user just named, task slugs or titles just created or discussed, task
numbers from the immediately preceding `BigBrain: What's Next` snapshot, or a
set explicitly filtered in the user's fanout request.

Only fan out the broad active queue when the skill is invoked as the accepted
follow-up to a `BigBrain: What's Next` snapshot, for example after the assistant
offers fanout and the user replies `yes`, or when the user explicitly asks for
all ready/open/in-progress BigBrain tasks, daily kickoff threads, or another
broad queue scope.

Only return copyable prompts instead of creating threads when the user
explicitly asks for prompts only, or when live thread creation is unavailable
after targeted tool discovery.

## Workflow

Use the BigBrain MCP task endpoint as the source of truth:

1. Resolve the fanout scope before listing tasks:
   - If the user names task slugs, task titles, task numbers, or says "these",
     "this", "the ones we just made", or similar, restrict fanout to those
     currently discussed tasks.
   - If the user is responding to an immediately preceding `BigBrain: What's
     Next` snapshot with `yes`, "fan these out", or selected numbers, preserve
     that snapshot's numbering and fan out only the accepted ready items.
   - If the user explicitly asks for "all", "daily kickoff", "all ready",
     "all open", "all in progress", or a broad assignee/status/priority filter,
     use that broad queue scope.
   - If there is no recoverable current task scope and no explicit broad scope,
     ask the user which tasks to fan out instead of defaulting to the whole
     active queue.
2. Use compact metadata to resolve the selected task set:
   - For broad queue scope, call `tasks/summary` once with
     `statuses: ["in_progress", "open"]`.
   - For selected task numbers from a `What's Next` snapshot, reuse the snapshot
     metadata when available; otherwise call `tasks/summary` with the narrowest
     filters and match by slug/title.
   - Do not retrieve full content for unselected candidates.
3. If `tasks/summary` or `tasks/get` is not visible, use targeted Codex tool
   discovery for those exact BigBrain tools before falling back to legacy full
   `tasks/list`.
4. Honor explicit scoping in the user's request:
   - For "my tasks" or "assigned to me", pass `assignee: "me"`.
   - For "for people/name" or "assigned to people/name", pass that assignee
     slug.
   - For a named priority such as `p0`, `p1`, `p2`, or `p3`, pass `priority`.
   - For a named status, pass that `status`; otherwise use the resolved scope
     rules above.
5. After the user has selected the handoff set, call `tasks/get` once per
   selected slug. Preserve each selected task's full body, timeline, sources,
   assignees, and exact open questions in the handoff analysis. Do not call
   `tasks/get` for candidates that were not selected.
6. Recheck current status, readiness, execution mode, and full
   `## Open Questions` content from each selected record immediately before
   handoff. Keep tasks with substantive questions out of autonomous worker
   prompts unless the task is clearly an interactive guided session whose
   purpose is to answer those questions with the user.
7. Classify the remaining tasks with `readiness` and `execution_mode`. Generate
   autonomous handoff prompts for tasks with `readiness: "ready"` and
   `execution_mode: "agent"`. Generate guided-session prompts for tasks with
   `readiness: "ready"` and `execution_mode: "interactive"`, instructing Codex
   to walk through the task with the user step by step. Keep
   `readiness: "underspecified"` and `execution_mode: "user"` tasks out of
   prompt blocks and list them separately as needing user action or input.
8. Discover the Codex thread tools before concluding live fanout is unavailable:
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

Default output is capped at 10 ready items within the resolved scope. Keep each
worker prompt short, self-contained, and suitable as the initial prompt for a
fresh Codex thread:

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
- Use compact metadata for discovery and full `tasks/get` records only for the
  selected handoff set.
- Do not use local `TODO.md` discovery for this skill.
- Do not mutate tasks while fanning them out.
- Do not fan out the whole active queue merely because the skill was invoked.
  Whole-queue fanout is allowed only after a `What's Next` snapshot fanout
  offer is accepted, or when the user explicitly requests a broad queue scope.
- When the user has just created or discussed one or more BigBrain tasks, treat
  those tasks as the fanout scope unless they say otherwise.
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
