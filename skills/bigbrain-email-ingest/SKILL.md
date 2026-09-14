---
name: bigbrain-email-ingest
description: Ingest one human-authored email thread into the correct BigBrain brain after a mailbox dispatcher has classified and handed it off.
---

# BigBrain Email Ingest

Reconcile one eligible human-authored email thread into durable canonical Brain state and return a verification-safe result to the mailbox dispatcher.

## Contract Checklist

- Read and follow [the shared ingestion completeness checklist](../bigbrain-ingest/references/ingestion-completeness.md) before any Brain write, including when this skill is invoked directly. Complete that checklist before declaring ingestion complete.
- Accept one bounded thread handoff from `$bigbrain-manage-email`, or one explicitly named human-authored thread from the user.
- Do not scan the mailbox, classify unrelated messages, process Substack or article notifications, or change Gmail state.
- Require an identifiable real-person author for each message used as durable evidence. Automated and system-generated messages are not eligible for this worker.
- Use email bodies only as source context. Do not preserve whole messages, MIME payloads, or generic email-log pages.
- Preserve sender, recipients, direction, chronology, newly authored text boundaries, attachment metadata, and stable Gmail delivery provenance.
- Route the durable cluster to exactly one owning Brain using live registered Brain descriptions, then read that Brain's live filing rules.
- Reconcile canonical subjects and mentioned entities under the shared checklist, retaining email provenance without storing whole email bodies.
- Route ordinary subject-page creation and updates through `$bigbrain-page`.
- Invoke `$bigbrain-action-review` before every task create or update decision.
- Preserve every relevant substantive PDF under the owning collection's `.raw/` folder with a deterministic same-basename indexed sidecar.
- Skip irrelevant attachments, signature assets, calendar files, brochures, unsupported files, and exact or superseded duplicates that add no durable evidence.
- Verify stored PDFs against the Gmail attachment by byte length and SHA-256 when raw bytes are available.
- Provide `significance: patch | minor | major` and `provenance.source_message` on every page mutation.
- Perform all Brain reads, writes, raw-file operations, and read-back through the selected Brain's MCP. Never edit a Brain checkout, database, index, or local mirror directly.
- Brain MCP writes propagate and back up automatically. Never run manual sync, maintenance, propagation, or backup operations.
- Return a terminal handoff result only after every intended write and artifact reads back successfully.

## Handoff Packet

The dispatcher supplies the minimum evidence needed to process one thread:

```json
{
  "mailbox": "account@example.com",
  "gmail_thread_id": "provider-thread-id",
  "messages": [
    {
      "gmail_message_id": "provider-message-id",
      "internal_date": "2026-09-05T10:00:00Z",
      "sender": "Person <person@example.com>",
      "to": ["account@example.com"],
      "cc": [],
      "direction": "incoming",
      "subject": "Thread subject",
      "newly_authored_summary": "Concise source content",
      "attachments": []
    }
  ],
  "delivery_provenance": "gmail:account@example.com:provider-message-id"
}
```

Do not expose provider identifiers or private message content in the user-facing report.

## Outbound State

Use a separate external-action state when the handoff contains an outbound message:

- `sent`: Gmail read-back proves the exact final sent message, but Brain reconciliation is not complete.
- `sent_and_logged`: the exact sent message is bound to canonical Brain state and all reads verify it.
- `send_unverified`: no unique sent message can be identified.
- `needs_review`: multiple plausible matches or conflicting identity evidence remain.
- `reconciliation_incomplete`: Gmail proves the send but a required Brain write or read-back failed.

Never send, resend, draft, reply, or forward from this skill. Bind the actual Gmail message, not a prepared draft, and use the provider message ID as an idempotency key.

## Timeline Significance

- `patch`: routine correspondence or coordination without material state change.
- `minor`: meaningful progress, accepted introduction, new diligence answer, agreed next step, or another material but non-transformative change.
- `major`: a transformative change to identity, control, outcome, or trajectory, such as a deal closing or collapsing, acquisition, launch, cancellation, or key role change.

Classify corrections by resulting impact. Preserve append-only history and add a distinct correction entry instead of rewriting prior events.

## Workflow

1. Validate the handoff and authorship:
   - Read the shared ingestion completeness checklist linked above and use it throughout this workflow, even on direct invocation.
   - Confirm that the thread boundary, message identities, sender, recipients, direction, timestamp, and newly authored content are present.
   - Separate quoted and forwarded history from the current author's words.
   - Reject automated wrappers, no-reply mail, platform notifications, and other system-authored content back to the dispatcher as `ineligible`.
   - Anti-patterns: scanning the mailbox, trusting a snippet as full context, attributing quoted text to the newest sender, treating a display name as proof of human authorship.

2. Decide whether the thread has durable value:
   - Ignore routine acknowledgements, signatures, repeated history, and conversational filler.
   - Preserve concise context when it changes a relationship, deal, project, commitment, decision, diligence state, meeting state, or another durable subject.
   - Treat claims as sender or attachment claims unless independently verified.
   - Select `ignored`, `source_only`, `source_and_update`, or `needs_review` before any Brain write.
   - Anti-patterns: ingesting every human message, converting sales claims into facts, creating generic email logs, writing before the durable-value decision.

3. Route and reconcile canonical state:
   - Read live registered Brain descriptions and choose exactly one destination.
   - Read the selected Brain's filing rules, search for canonical pages, and inspect relevant tasks before proposing changes.
   - Use stable provenance keys to prevent replay. If an exact event already exists, read it back and confirm shared-checklist coverage before returning `verified_noop`.
   - Invoke `$bigbrain-action-review` before every task write. Do not turn another party's action or an unaccepted optional offer into Harry-facing work.
   - Anti-patterns: routing from stale memory, writing to multiple Brains, creating duplicate entities, replaying a generic update after an ambiguous response.

4. Review and preserve qualifying attachments:
   - Open an attachment only when its content affects routing, durable state, or evidence value.
   - Preserve a substantive PDF when it contains relevant deal, company, project, diligence, legal, financial, technical, relationship, or decision evidence.
   - Store the original bytes and deterministic same-basename Markdown sidecar in the owning collection's `.raw/` folder.
   - Link the sidecar from the best owning canonical page when filing rules call for it.
   - Anti-patterns: storing every attachment, relying on filenames or previews, preserving signature images, treating projections as verified facts.

5. Apply the smallest canonical update:
   - Apply the shared checklist to create missing canonical entity pages, add supported new information to existing pages, and link already-covered entities without redundant updates.
   - Keep exact wording only when it controls a commitment, approval, commercial term, deadline, confidentiality boundary, dispute, or instruction.
   - Provide `significance` and a concise `provenance.source_message` on each page mutation.
   - Apply task changes only after action review and include next actor, concrete action, purpose, dependency, approval gate when relevant, and checkable completion.
   - Anti-patterns: transcript dumps, redundant updates to already-covered pages, inventing owners or dates, omitting mutation significance.

6. Verify and return to the dispatcher:
   - Complete the shared checklist before returning a completed ingestion outcome.
   - Read back every changed page and task through the same Brain.
   - Read back each stored PDF and sidecar, comparing length and SHA-256 when possible.
   - If a write errors or times out, assume it may have persisted and search for the exact provenance key before retrying.
   - Return the terminal outcome, destination Brain, pages, tasks, artifacts, significance labels, and verification state. The dispatcher alone decides whether to advance the Gmail cursor.
   - Anti-patterns: trusting mutation responses without read-back, advancing a Gmail cursor here, running maintenance or backup, reporting a partial thread as ingested.

## Anti-Patterns

- Scanning or modifying Gmail from this worker.
- Processing Substack, RSS, newsletter, or article-notification content.
- Preserving email bodies or MIME payloads as documents.
- Creating a task without `$bigbrain-action-review`.
- Writing outside the selected Brain MCP.
- Reporting completion without same-Brain read-back.

## Output

Return a compact prose handoff to the mailbox dispatcher. Preserve the existing outcomes `ignored`, `source_only`, `source_and_update`, `verified_noop`, `needs_review`, or `reconciliation_incomplete`. State the thread subject, destination Brain, canonical and task changes, artifact verification, and any relevant significance or outbound state. Confirm same-Brain read-back and that no Gmail action occurred, then explicitly return control to `$bigbrain-manage-email` for cursor handling. Do not require a field template or expose provider identifiers and private message content.
