# BigBrain Meeting Ingest forward cases

These cases test the prompt contract in natural language. They do not require
a persisted action object, status enum, or other fixed workflow schema.

## Generic page body and writer-owned timeline

Prompt:

```text
Ingest this meeting into its canonical meeting page and transcript sidecar.
Use the generic page writer. Include the current meeting facts, chronology,
decisions, discussion context, and owner-labelled next steps.
```

Expected behavior:

- The current body follows the generic page-writing schema.
- The page writer receives only current content and adds the single timeline.
- The meeting skill does not require a fixed list of section headings.
- Provenance and raw-file association remain in metadata or concise inline links.

Forbidden behavior:

- Supplying `## Timeline` or another writer-owned boundary in the body.
- Adding a verbose `Source File` or provenance section solely because the page
  has an attached raw artifact.

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
# Deal placement: actual deal versus prep and VDR evidence

Evidence:

- A meeting identifies a distinct, named acquisition process and records current participants, stage, and a possible role for Harry.
- The same meeting includes `## Prep` questions prepared before the call and references a protected VDR folder with a file inventory.

Expected:

- Search aliases and create or update one canonical `deals/<deal-slug>.md` page for the actual transaction, with evidence-backed `deal_involvement` when the schema supports it.
- Keep the questions under `## Prep` on the canonical meeting page and preserve them when the page is updated after the call.
- Preserve the VDR inventory as a `deals/.raw/` indexed sidecar linked from the canonical deal, not as another top-level page under `deals/`.


## Unrecorded dinner supplied as a recap

Prompt:

```text
Save these notes from last night's dinner. It was not recorded. The attached
file is named dinner-transcript.txt, but its contents are my post-meeting recap.
```

Expected behavior:

- Classify the source as user notes regardless of the filename.
- Save the canonical meeting and indexed summary sidecar with note provenance.
- Create no raw transcript and do not report a missing transcript as a gap.

Forbidden behavior:

- Copying or renaming the recap into a raw transcript artifact.
- Describing the recap as a verbatim transcript or recorded meeting.

## Correct a recap previously filed as a transcript

Prompt:

```text
This meeting was added from a note and was not recorded. Remove its mislabeled
raw transcript while keeping the summary sidecar and meeting knowledge.
```

Expected behavior:

- Preserve the supplied note evidence in the summary sidecar.
- Remove the misleading raw artifact through owning Brain tools.
- Repair transcript links and provenance, then read back all changed records.

Forbidden behavior:

- Deleting the summary sidecar or losing the source note evidence.
- Leaving a dangling raw-transcript link or treating removal as incomplete ingest.

## Actual transcript remains raw evidence

Prompt:

```text
Ingest this recorded call with the full fetched speaker-attributed transcript
and a generated summary.
```

Expected behavior:

- Preserve the actual fetched transcript and its indexed sidecar.
- Prefer actual transcript evidence when summary attribution conflicts.

Forbidden behavior:

- Applying the note-only branch to discard the actual transcript.

## Trigger boundaries

- Positive: "Save my unrecorded dinner notes" selects meeting ingestion.
- Negative: "Find new Granola recordings" starts with Granola ingestion.
- Adjacent: "Save this podcast transcript" selects media ingestion.
