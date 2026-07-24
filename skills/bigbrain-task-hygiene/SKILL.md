---
name: bigbrain-task-hygiene
description: Audit BigBrain tasks for likely stale, overdue, unassigned, invalid-assignee, or backlogged work without mutating records.
---

# BigBrain Task Hygiene

Run a bounded read-only task hygiene audit and explain likely cleanup candidates.

## Contract Checklist

- Use the BigBrain MCP `tasks/hygiene` tool as the source of truth.
- Default personal requests to `assignee: "me"` and active statuses.
- Treat every finding as advisory; never archive, update, merge, or delete.
- Keep discovery compact and fetch full task detail only after the user selects
  a finding for deeper review.
- Report the threshold, scope, truncation, and freshness metadata used.

## Workflow

1. Resolve the audit scope.
   - Default to `statuses: ["in_progress", "open", "waiting"]`.
   - Use `assignee: "me"` for personal or generic requests.
   - Omit the assignee only for an explicit all-team audit.
   - Preserve user-provided status, assignee, stale-day, and limit filters.
   - Anti-patterns: unscoped all-team audit by default, including done work
     without request, inventing a stale threshold
2. Run the compact audit.
   - Call `tasks/hygiene` with a bounded limit and the resolved filters.
   - Follow `next_cursor` only when the user requests the full backlog or the
     first page is insufficient for the requested scope.
   - Do not call task mutation tools.
   - Anti-patterns: reading every task body, auto-paginating an unbounded queue,
     treating an offset cursor as a durable snapshot
3. Interpret findings conservatively.
   - Explain signals such as `overdue`, `stale_in_progress`,
     `backlogged_open`, `stale_waiting`, `underspecified_backlog`,
     `unassigned`, and `invalid_assignee`.
   - Prefer overdue and stale in-progress work before lower-confidence backlog
     signals.
   - State that filesystem update time is a heuristic, not proof that work is
     obsolete.
   - Anti-patterns: calling a task obsolete from age alone, hiding uncertainty,
     converting advisory findings into archive recommendations without review
4. Offer detailed review only for selected findings.
   - If the user selects a task, call `tasks/get` for that slug and preserve its
     full body, timeline, sources, assignees, readiness, execution mode, and
     exact open questions.
   - Reassess the finding from the full selected record.
   - Keep any mutation as a separate explicit follow-up requiring user approval.
   - Anti-patterns: fetching full content for every finding, changing a task
     during the audit, treating selection as approval to mutate

## Anti-Patterns

- Archiving or changing tasks during the audit.
- Presenting stale age as conclusive evidence that work should be deleted.
- Returning full bodies, timelines, sources, or open-question text for the
  entire backlog.
- Omitting unavailable-source, truncation, or freshness information.

## Output

Return a concise grouped audit:

- likely urgent cleanup candidates;
- older backlog candidates;
- assignment or metadata issues;
- threshold, scope, result count, truncation, and generated time;
- a reminder that findings are advisory and unchanged.

Ask whether the user wants a full-detail review of any selected task. Do not
offer or perform mutation unless the user explicitly asks in a later step.
