---
name: bigbrain-refresh-tasks
description: Audit existing BigBrain task pages against current Brain evidence and suggest grounded status, ownership, readiness, and context changes. Use for refresh tasks, reconcile stale tasks, or task-status reviews. Read-only by default; apply specific recommendations only when explicitly authorized after review. Do not use for new roadmap ideation.
---

# BigBrain: Refresh Tasks

Use this skill to audit existing BigBrain task pages against current brain
evidence and suggest grounded changes. BigBrain tasks are page-backed records
under `tasks/*.md`; do not read or reconstruct old `ops/tasks.md` task lists.

This skill is advisory by default. It should not create, update, close,
archive, reassign, or reprioritize task pages unless the user explicitly asks
for mutation in the current turn after seeing the recommendations.

## Contract Checklist

- Use BigBrain MCP for current context when an MCP-backed brain is available.
- Prefer suggestions for existing task pages over suggestions to create new
  tasks.
- Use `me`, `members/list`, `tasks/list`, `filing_rules`, `search`,
  and `read` when available. If `tasks/list` is not visible, use targeted
  Codex tool discovery before falling back to runtime or code inspection.
- Do not call `tasks/update` or `tasks/create` during refresh-task behavior
  unless the user explicitly asks you to apply a specific recommendation in the
  current turn.
- Before suggesting task-page changes, call `filing_rules` and follow the
  compiled `FILING.md` guidance it returns. If that tool is unavailable, list
  and read the relevant `FILING.md` files directly; do not expect a page named
  `filing_rules` to exist.
- Do not assign work to arbitrary `people/*` pages. Assignees must be active
  members.
- Every suggested status, assignee, priority, source, or body change must be
  grounded in retrieved BigBrain pages or explicit user instruction.
- Before marking a task `done` or `archived`, either create or link the
  successor task and use `Next task: tasks/<slug>` in the timeline entry, or
  state `No successor task needed: <reason>`.
- When suggesting that a task should be marked `done` or `archived`, include
  the exact completion handoff that would be required in the timeline: either
  `Next task: tasks/<slug>` or `No successor task needed: <reason>`.

## Workflow

1. Call `me` and `members/list` to identify the requester and active members.
   - Anti-patterns: assuming requester identity, assigning non-members.
2. Retrieve task context:
   - `filing_rules` for current task-page conventions
   - `tasks/list` for in_progress, open, waiting, and recently done tasks
   - `search` for recent meetings, project updates, blockers,
     decisions, legacy inbox notes, and roadmap pages related to those tasks
   - direct `read` on task pages and source pages that may change task state
   - For material deal-task progress, read the canonical deal and affected task and use [Deal and Task Consistency](../bigbrain-page/SKILL.md#deal-and-task-consistency) as a read-only comparison. Check completed actions, next actor, dependencies, unresolved terms, and scope against current bodies and source chronology; recent metadata edits do not establish substantive freshness.
   - Anti-patterns: task-only verification, reconstructing state from timestamps alone.
3. For each relevant task, decide whether to recommend that it should be:
   - left unchanged
   - marked `done` because source evidence shows completion
   - moved to `in_progress` because source evidence shows active work is
     underway
   - moved to `waiting` because ownership, access, dependency, reply, approval,
     or decision evidence is missing
   - reopened because the source evidence contradicts a completed state
   - reprioritized because the brain shows urgency or risk changed
   - marked `readiness: "underspecified"` when useful work cannot begin without
     more context
   - marked `readiness: "ready"` when the task appears specified enough to work,
     even if the work is an interactive review or decision session
   - marked `execution_mode: "agent"` only when Codex can complete the task
     autonomously with current context, tools, and files
   - marked `execution_mode: "interactive"` when Codex can advance the task but
     needs the user's judgement, preferences, review, or decisions
   - marked `execution_mode: "user"` only when the task requires a real-world
     action Codex cannot meaningfully perform, such as sending a personal
     WhatsApp, conducting a meeting, signing a physical document, or obtaining
     approval
   - when uncertain between `agent` and `interactive`, prefer `interactive`;
     when uncertain between `interactive` and `user`, use `interactive` if
     Codex can still structure or guide the work
   - reassigned only when the new assignee is an active member and the evidence
     supports the ownership change
   - updated with better source links or body context
   - Anti-patterns: closing tasks from silence, conflating delivered scenarios with supplier-confirmed terms.
4. For existing tasks whose metadata or body looks stale, report a suggested
   `tasks/update` payload or concise diff rather than applying it.
   - If the task records completed delivery while the deal still instructs preparation or delivery, recommend the corresponding canonical deal reconciliation with exact evidence and current next actor. Keep the review read-only.
   - Anti-patterns: repairing pages during an advisory review, reporting only task drift while omitting linked deal drift.
5. For close/archive recommendations, identify the next concrete task first
   unless no successor is needed, then include the required completion handoff
   text in the recommendation.
   - Anti-patterns: closure without a successor disposition, repeating completed delivery.
6. Suggest `tasks/create` only when current evidence shows a clear missing task
   that is concrete, useful, deduplicated, and assignable.
   - Anti-patterns: speculative tasks, duplicating existing follow-ups.
7. Leave ambiguous items as review questions rather than mutations.
   - Anti-patterns: resolving conflicting scope without evidence, silently guessing authority.
8. Verify the recommendation set with `tasks/list`, direct `read`, or retrieved
   source evidence; do not verify by writing changes.
   - If explicitly authorized to apply a recommendation later, use the owning page/task write workflow and read back the affected deal and task together; report partial reconciliation if either fails and never resend a deliverable to repair logging.
   - Anti-patterns: write-response-only success, hiding missing reads or partial reconciliation.

## Output

Return:

- `Suggested Updates`: task slugs, proposed changes, exact evidence, and
  suggested payload or timeline entry where useful
- `Suggested Creates`: proposed task titles/slugs, assignees, priority, source,
  and why they are deduplicated
- `Left Unchanged`: important task slugs checked with no change needed
- `Needs Review`: ambiguous tasks or missing ownership that blocked a clear
  recommendation
- `Verification`: checks performed

## Anti-Patterns

- Do not create speculative tasks that are not grounded in the brain.
- Do not create, update, close, archive, reassign, or reprioritize tasks during
  refresh-task behavior unless the user explicitly asks you to apply a specific
  recommendation in the current turn.
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
