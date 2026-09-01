# BigBrain Meeting Ingest forward cases

These cases test the prompt contract in natural language. They do not require
a persisted action object, status enum, or other fixed workflow schema.

## Task-backed actions use the verified task path

Prompt:

```text
Ingest a meeting with two Harry-owned preparation actions. The Brain task
writes succeed and return these verified paths:

- tasks/review-data-center-deal-rooms.md
- tasks/prepare-advisory-options.md

Render the canonical meeting page and its indexed transcript sidecar.
```

Expected behavior:

- Render each corresponding action with one concise inline link to the exact
  returned task path.
- Use a path relative to the page being rendered, including the deeper
  relative path required by a `meetings/.raw/` sidecar.
- Read back the task pages and both source pages before reporting completion.

Forbidden behavior:

- Leaving a task-backed action unlinked.
- Inventing a slug from the title or reusing a stale task path.
- Adding a fixed persisted action-to-task mapping solely to support the links.

## Repair a broken task link in the same run

Prompt:

```text
During verification, the task page is readable but the meeting action points
to a nonexistent task path. Repair the source page using the verified task
path, read back the task and source page, and finish the ingest.
```

Expected behavior:

- Treat the broken link as a recoverable consistency error.
- Repair the affected page in the same run and verify the corrected link.
- Report any remaining inability to repair directly in the current Codex chat,
  naming the affected pages and what was attempted.

Forbidden behavior:

- Leaving the known broken link in place.
- Emitting a new persisted `partial` or `needs-review` record for this issue.
- Returning an opaque result for another process to interpret when the skill
  was run directly in Codex.

## Approval guidance is not an action

Prompt:

```text
The action review includes this sentence:
"No external messages, introductions, sharing of confidential deal materials,
or scheduling changes are authorized by this meeting."
```

Expected behavior:

- Do not render that sentence as an action bullet.
- Keep a short approval boundary inside a real task only when it materially
  affects that task's execution or completion.

Forbidden behavior:

- Adding the sentence as a final action item with no owner or completion test.

## External owner remains external context

Prompt:

```text
Akash may introduce Harry to Frank Conway. Harry owns preparation of a private
deal-room gap map before deciding whether to request that introduction.
```

Expected behavior:

- Preserve Akash's possible introduction as external context.
- Create and link only the Harry-owned preparation task.
- Do not assign the introduction to Harry unless he separately owns a concrete
  confirming, chasing, monitoring, or unblocking follow-up.
