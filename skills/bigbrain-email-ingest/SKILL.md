---
name: bigbrain-email-ingest
description: Scan recently unchecked email, apply narrowly authorized notification cleanup, preserve relevant PDF evidence, and ingest durable context into the correct BigBrain brain.
---

# BigBrain Email Ingest

Scan eligible recent email, reconcile durable context into canonical BigBrain pages, verify every write, and maintain a safe per-thread cursor.

Email bodies are operational evidence, not document artifacts. Do not preserve whole messages or MIME payloads in BigBrain. Preserve relevant substantive PDFs as source artifacts under the owning Brain collection, while skipping irrelevant, unsafe, unsupported, or duplicate attachments.

## Contract Checklist

- A bare invocation scans the recently unchecked queue. A named sender, thread, topic, mailbox query, or date range limits the scan to that scope.
- Gmail is read-only except for the standing Trash rules in `Authorized Gmail Cleanup`. Never send, draft, reply, forward, permanently delete, archive, mark read or unread, star, or label email unless the user separately requests that exact action.
- Treat `delete` under the standing rules as a recoverable move to Gmail Trash, never permanent deletion.
- Move clearly automated Preply session-scheduling and reminder messages to Trash immediately after verifying official Preply sending infrastructure and automated authorship. Preserve human tutor correspondence and unrelated Preply payment, account, or support mail.
- Move a calendar acceptance notification to Trash only after the correct Brain reflects the attendee's accepted status and the upcoming meeting, and the same Brain reads that state back successfully.
- Capture `run_started_at` before discovery and process no email newer than that boundary.
- Scheduled runs use `/Users/hq/.codex/automations/<automation-id>/memory.md`; interactive runs use the named automation memory when supplied, otherwise they deduplicate against Brain provenance and the bounded scan only.
- Keep a separate verified cursor for each Gmail thread, including the stable thread identifier, newest processed message identifier and timestamp, content fingerprint or equivalent deduplication evidence, selected destination Brain, affected pages, and verification state.
- If no reliable cursor exists, initialize from the prior 24 hours. Future runs use the cursor with a small overlap and deduplicate by stable IDs and Brain provenance.
- Advance a thread cursor only after every intended Brain write for that thread is read back successfully and every required artifact is verified.
- Route each durable cluster to exactly one owning Brain by live registered Brain descriptions. Prefer a clearly matching specialized Brain and use Personal Brain only for otherwise processable personal context.
- Perform every Brain mutation through the selected destination Brain's MCP tools, including page, task, raw-file, sidecar, and provenance changes. Never edit a Brain checkout, database, index, or local mirror directly.
- Brain MCP mutations are propagated and backed up automatically. Never invoke maintenance, propagation, or backup operations after an ingest write.
- Read the selected Brain's live filing rules and existing canonical pages before writing.
- Preserve every relevant substantive PDF in the owning collection's `.raw/` folder with its deterministic same-basename indexed sidecar, unless an exact or equivalent canonical artifact already exists.
- Skip irrelevant attachments, signatures, logos, calendar files, boilerplate brochures, unsupported files, and exact or superseded duplicates that add no durable evidence. Record the skip reason without storing them.
- Verify stored PDFs against the Gmail attachment using byte length and SHA-256 when raw read-back is available. A parsed preview or sidecar alone is not proof that the PDF was preserved.
- Update an existing canonical page when possible. Create a page only when the evidence supports a useful standalone record and no canonical page exists.
- Do not create a meeting page merely because an email thread was reviewed. A qualifying calendar acceptance notification may update, or when live filing rules support it create, the canonical upcoming-meeting record required by `Authorized Gmail Cleanup`.
- Store concise durable context and channel provenance, not a transcript. Preserve exact wording only when it controls a material commitment, approval, commercial term, deadline, confidentiality boundary, dispute, or instruction.
- Distinguish confirmed facts, sender claims, attached-document claims, proposals, estimates, and unknowns. Never upgrade email marketing or deal materials into verified facts.
- Resolve email-specific authorship before task judgment: preserve the sender, recipients, incoming or outgoing direction, chronology, quoted-history boundary, and automated-versus-human classification for every candidate action.
- Treat a candidate action as evidence, not as a task. Invoke `$bigbrain-action-review` after reading relevant Brain context and existing tasks, and before every task create or update decision.
- Keep email retrieval, source interpretation, Brain mutation authority, Gmail cleanup, verification, and cursor handling in this skill. `$bigbrain-action-review` returns a reconciliation plan and never broadens this skill's write authority.
- Explicit invocation or an authorized scheduled run permits in-scope Brain writes, same-Brain read-back, artifact verification, verified cursor advancement, and only the Gmail Trash actions listed in `Authorized Gmail Cleanup`. It does not authorize any other Gmail write or outbound action.
- Final output is count-first, grouped by destination Brain and email thread, with page-type categories and individual `Created:` or `Updated:` page bullets nested beneath each category.

## Workflow

1. Establish mode, scope, and boundary.
   - Record whether the run is interactive or scheduled, the requested mailbox/topic/date scope, `run_started_at`, and the automation memory path when available.
   - For a bare run, use the recently unchecked operational queue. For a first run, bound discovery to the prior 24 hours. For later runs, start before the oldest relevant cursor by a small overlap.
   - Exclude spam, Trash, bulk marketing, newsletters, automated receipts, social notifications, and clearly personal or unrelated mail from ingest unless the user explicitly includes them or they contain durable operational context. Still identify bounded candidates covered by `Authorized Gmail Cleanup`.
   - Anti-patterns: unbounded mailbox scans, treating unread state as the cursor, processing messages after `run_started_at`, opening clearly excluded personal mail merely to classify it.

2. Discover candidate messages.
   - Use Gmail search syntax to combine the time boundary with the user's scope and default exclusions.
   - Treat search results as message-level summaries. Shortlist likely durable messages first and paginate when the bounded result set continues.
   - Deduplicate candidates by stable message and thread identifiers before fetching content. Keep cleanup-only candidates distinct from ingest candidates.
   - Anti-patterns: searching every historical message, treating subject keywords as proof of relevance, assuming Gmail search results are thread summaries, ignoring pagination in the bounded window.

3. Read enough thread context.
   - Batch-read shortlisted threads when practical and inspect surrounding messages when direction, chronology, authority, or current state matters.
   - Record sender, recipients, timestamp, direction, subject, attachment metadata, and the smallest evidence summary needed for reconciliation.
   - Separate newly authored text from quoted or forwarded history before identifying candidate actions. Attribute each candidate to the message's actual sender, recipients, direction, and timestamp rather than to the thread as a whole.
   - Preserve chronology when a later message accepts, changes, completes, declines, or supersedes an earlier request or promise. The newest meaningful message does not inherit ownership from an older speaker.
   - Classify sender authorship before durable-state assessment. Automated notifications are ineligible for ingest even when they are actionable.
   - Keep requests to Harry, Harry's accepted commitments, external promises, optional offers, proposals, and discussion distinct as email evidence. Do not decide task ownership from action verbs alone.
   - Identify cleanup candidates using verified sender identity, official sending domain when available, subject, and notification type. A display name or loose keyword match alone is insufficient.
   - Treat verified automated Preply lesson-booking, upcoming-session, rescheduling, cancellation, and other session-scheduling reminders as cleanup-only candidates. Do not treat a human tutor's message as automated merely because Preply delivered it.
   - Do not ingest routine acknowledgements, signatures, repeated quoted history, delivery notices, or conversational filler.
   - Anti-patterns: ingesting from snippets alone, copying entire bodies, treating quoted history as a new event, confusing the newest message with the newest meaningful state change.

4. Classify and review attachments.
   - Open an attachment when its content materially affects routing, a durable page update, evidence classification, or artifact relevance.
   - Use the applicable PDF, document, image, spreadsheet, or presentation capability to review the actual content.
   - Treat a PDF as relevant when it contains substantive deal, company, project, diligence, proposal, legal, financial, technical, relationship, or decision evidence that belongs in the selected Brain.
   - Treat logos, signature images, calendar files, generic marketing collateral, irrelevant brochures, unsupported media, and attachments unrelated to the owning Brain as irrelevant by default.
   - Treat all claims in a deck, memo, model, or teaser according to their source authority and stated caveats.
   - Anti-patterns: ingesting every attachment, skipping a substantive PDF because the email body was enough, relying on filenames or previews as content, promoting projections to verified facts.

5. Route to the owning Brain.
   - List registered Brains and read each reachable candidate's live description, authentication state, and write capability.
   - Compare the durable message cluster to Brain descriptions only for routing. Select one clear specialized Brain, or Personal Brain for otherwise processable personal context.
   - Once selected, use that destination Brain's MCP for all reads, writes, raw-file operations, and read-back verification for the cluster.
   - Hold materially ambiguous confidentiality, identity, or ownership boundaries for review instead of guessing or writing to several Brains.
   - Use `$find-missing-tools` before concluding an expected Brain or Gmail tool is unavailable. Do not substitute a local mirror for a required hosted Brain.
   - Anti-patterns: routing from stale memory, keyword-only routing, fan-out across Brains, selecting a destination from private filing hints, silently switching to a fallback system, writing directly to Brain files or databases.

6. Reconcile canonical state and review candidate actions.
   - Call the destination's live filing-rules tool before choosing paths or page types.
   - Search and read the canonical deal, project, organization, person, concept, artifact, and task pages that could own the update.
   - Compare email timestamps and direction with existing source provenance. Use the newest verified evidence while retaining uncertainty and source attribution.
   - Prefer one concise timeline or state update on the best owning page. Update broader related pages only when their durable canonical state genuinely changed.
   - Build a concise action evidence packet from newly authored message content. Preserve source thread, sender, recipients, direction, timestamp, exact wording only when material, and email-specific interpretation such as request, accepted commitment, external promise, optional offer, proposal, or discussion.
   - Invoke `$bigbrain-action-review` with that evidence packet, the most relevant canonical Brain context, live open, in-progress, and waiting tasks, and this skill's approval boundaries. Do this before every task write.
   - Treat the review result as a task reconciliation plan. It may recommend updating an existing task, creating a concrete task, recording an external action only on its owning page, keeping a conditional follow-up, or holding ambiguity for review.
   - Do not turn another party's action into Harry-facing work unless Harry or another active member separately owns a concrete next step such as tracking, chasing, confirming, approving, or unblocking it. Do not turn an optional offer into a commitment unless the offer was invoked or explicitly accepted.
   - Use Brain context to sharpen an owned action into the most intuitive concrete next step, but never use context to override source ownership, manufacture acceptance, or convert a possibility into a commitment.
   - For every task the review plan supports, state the next actor, concrete action, purpose, dependency or lack of one, approval gate when relevant, and externally checkable completion in the task body. These are prose quality requirements, not new task-schema fields.
   - Apply page and supported task changes only through the selected destination Brain's MCP. This skill remains responsible for deduplication, mutation, read-back, and cursor gating.
   - Anti-patterns: bypassing `$bigbrain-action-review`, passing quoted history as a new action, assigning an external promise to Harry, treating an optional offer as accepted, creating a vague follow-up task, duplicate entities or deals, changing several pages with the same fact, overwriting stronger evidence, inventing owners or dates, creating a meeting page, converting a sales claim into compiled truth.

7. Preserve relevant PDF artifacts.
   - Check existing canonical pages, raw-file listings, attachment sidecars, source filenames, dates, sizes, hashes when available, and document content before creating anything.
   - If the relevant PDF is new or materially revised, use the destination Brain's MCP to store the original bytes under the owning collection's `.raw/` folder using a collision-safe descriptive filename.
   - Create the deterministic same-basename Markdown sidecar under that same `.raw/` folder. Include an executive summary, comprehensive extraction, provenance from the email, source-authority and claim-status boundaries, canonical-page links, and the raw-file link.
   - Link the artifact sidecar from the owning deal, project, company, organization, or other canonical page when the destination pattern expects it.
   - If an exact duplicate already exists, reuse the existing artifact and add only genuinely new provenance or context. If a newer PDF supersedes an older artifact, preserve both when filing rules require traceability and identify the current source clearly.
   - Anti-patterns: storing raw PDFs outside `.raw/`, sidecars with different basenames, replacing a distinct historical artifact silently, creating duplicate artifact pages, storing the email body as the sidecar.

8. Apply the smallest durable canonical update.
   - Write concise source-aware context such as `Alfredo shared an updated IQ197 information deck by email, presenting a Bloom-first accelerated power strategy and a parallel Hydro One/IESO pathway; timing and capacity remain subject to technical, commercial, permitting, utility, and end-user confirmation.`
   - Include exact wording only when the wording itself is material. Keep raw message identifiers and technical cursor details in automation memory, not user-facing page prose, unless the destination provenance schema requires them.
   - Create a new standalone page only when no canonical owner exists and the thread provides enough durable evidence for a useful record.
   - Anti-patterns: transcript dumps, generic email-log pages, speculative synthesis, verbose audit trails in stable page bodies, duplicating comprehensive attachment extraction on the canonical page.

9. Verify and advance cursors.
   - Read back every changed page and task through the same destination Brain used for the write.
   - Read back each stored PDF and its sidecar. Compare the stored raw bytes with the Gmail attachment by exact byte length and SHA-256 when the tools expose raw content; otherwise report the narrower verification achieved.
   - Treat successful same-Brain read-back as complete verification for page and task writes. MCP mutations are propagated and backed up automatically; never invoke maintenance, propagation, or backup operations.
   - Re-search or re-read affected canonical records when needed to confirm no duplicate page was created.
   - For a qualifying calendar acceptance notification, confirm through same-Brain read-back that the canonical record shows the attendee's accepted status and the upcoming meeting. If already current, verified no-op reconciliation satisfies this gate. Only then move the notification to Gmail Trash.
   - Move clearly verified My Wellness Cloud and GitHub Security Advisory messages to Gmail Trash under the standing rules without creating Brain records for the notifications themselves.
   - Move clearly verified automated Preply session-scheduling and reminder messages to Gmail Trash immediately under the standing rule. Do not create Brain records for these notifications and do not wait for the lesson time to pass.
   - Read Gmail state back after every authorized cleanup and confirm the exact message is in `TRASH`. If the Brain or Gmail verification fails, leave the message in place and report it as partial.
   - Atomically update only the successfully verified thread cursors. Preserve prior cursors for partial, ambiguous, failed, or held threads.
   - Anti-patterns: trusting write responses without read-back, treating a sidecar as raw-file verification, trashing a calendar acceptance before Brain verification, permanently deleting email, cleaning by display name alone, advancing a cursor after partial writes, one global mailbox cursor, marking an unverified thread ingested.

10. Report results.
   - Start with a plain count sentence: `0 email threads ingested`, `1 email thread ingested`, `3 email threads ingested`, or a concise mixed outcome such as `2 email threads ingested, 3 notifications moved to Trash, 1 left partial`.
   - Add one heading for each destination Brain that received an update. Under it, list each thread by subject and outcome.
   - Nest affected pages beneath category labels such as `Deals`, `Projects`, `Organizations`, `People`, `Concepts`, or `Tasks`. Put each page on its own bullet prefixed exactly `Created:` or `Updated:`.
   - Add an `Artifacts` category for relevant PDFs. List each stored or reused PDF sidecar as `Created:` or `Updated:` and state skipped attachment counts only when nonzero or useful.
   - Add `Needs attention`, `Issues`, `Errors`, or `Warnings` only when the user should act.
   - State `No email was sent or modified.` when no Gmail write occurred. When standing cleanup occurred, state `No email was sent. Gmail changes were limited to <count> authorized notification(s) moved to Trash.`
   - Keep message IDs, thread IDs, hashes, slugs, paths, cursor internals, credentials, private bodies, and attachment contents out of the report by default.
   - Anti-patterns: burying the count, exposing private content, combining page names on category lines, listing technical IDs, hiding authorized cleanup, implying that any email was sent.

## Authorized Gmail Cleanup

These standing rules authorize only a recoverable move to Gmail Trash during an in-scope run:

- My Wellness Cloud: move every message clearly verified as originating from My Wellness Cloud to Trash. Do not create or update Brain records for these notifications unless the message contains independently durable context outside the routine notification.
- GitHub Security Advisory: move every message clearly verified as a GitHub Security Advisory notification to Trash. Do not create or update Brain records for the notification itself.
- Calendar acceptance: when a message is only a notification that an invitee accepted the user's calendar invitation, reconcile the attendee's accepted status and the upcoming meeting into the correct canonical Brain record. Read that state back through the same Brain, then move the notification to Trash. If the Brain cannot be updated or verified, leave the email in place.
- Preply scheduling and reminders: move every clearly automated Preply message about lesson booking, upcoming-session reminders, rescheduling, cancellation, or other session scheduling to Trash immediately. Verify official Preply sending infrastructure and automated authorship first. Preserve human-authored tutor correspondence and Preply payment, account, or support messages unless separately authorized.

These rules do not authorize cleanup of other wellness services, GitHub mail types, calendar changes, declines, tentative responses, invitations, cancellations, reschedules, non-Preply reminders, or human-authored correspondence. When identity or notification type is ambiguous, leave the message unchanged and report it for review.

## Cursor Memory

Use this logical shape in the automation's `memory.md`; human-readable Markdown or structured JSON blocks are both acceptable when updated atomically:

- last successful run boundary and `run_started_at`;
- one entry per Gmail thread;
- stable thread ID and newest verified message ID;
- newest verified source timestamp and direction;
- content fingerprint or equivalent deduplication evidence;
- selected destination Brain;
- created or updated canonical pages;
- stored or reused PDF raw files and sidecars, including verification state;
- read-back and artifact verification result;
- unresolved or partial status without cursor advancement.
- authorized cleanup classification, Gmail action, and `TRASH` read-back result without storing message content.

Do not store full message bodies, full attachment text, credentials, or unrelated personal content in cursor memory.

## Anti-Patterns

- Treating email bodies as document artifacts or creating `.raw/` email files.
- Failing to preserve a relevant substantive PDF under the owning collection.
- Storing irrelevant attachments, signature assets, or exact duplicates without durable value.
- Modifying Gmail outside the exact standing Trash rules or a separate explicit user request.
- Permanently deleting messages covered by a standing cleanup rule.
- Trashing a calendar acceptance notification before the upcoming meeting and accepted status are verified in the owning Brain.
- Trashing human tutor correspondence or unrelated Preply payment, account, or support mail under the Preply scheduling rule.
- Ingesting every new message merely because it arrived.
- Routing a single durable update to multiple Brains.
- Editing Brain files, databases, indexes, or local mirrors outside the selected destination Brain's MCP.
- Invoking maintenance, propagation, or backup operations after MCP writes.
- Using stale memory instead of live Brain descriptions, filing rules, and canonical state.
- Treating sender assertions, projections, deck claims, or proposed commercial terms as verified facts.
- Treating a quoted request as newly made by the latest sender or ignoring message direction and chronology when assigning ownership.
- Creating or updating a task without first reconciling the candidate through `$bigbrain-action-review`.
- Turning an external party's action or Harry's uninvoked optional offer into a Harry-facing task.
- Creating vague umbrella tasks when Brain context supports a named next actor, concrete action, purpose, dependency, approval gate, and completion test.
- Creating meeting pages outside the live filing rules, generic email-log pages, or duplicate deal/entity pages.
- Advancing cursors before same-Brain read-back and artifact verification.
- Reporting a partial or blocked thread as successfully ingested.

## Output

Use this template:

```text
<count and outcome summary>

<Destination Brain>
- <Email subject> - <outcome>
  - <Page category>:
    - Created: <page title>
    - Updated: <page title>
  - Artifacts:
    - Created: <PDF artifact sidecar title>, raw PDF verified

<Another Destination Brain>
- <Email subject> - <outcome>
  - <Page category>:
    - Updated: <page title>, marked waiting on Harry

Gmail cleanup
- Moved to Trash: <count> My Wellness Cloud notification(s)
- Moved to Trash: <count> GitHub Security Advisory notification(s)
- Moved to Trash: <count> verified calendar acceptance notification(s)
- Moved to Trash: <count> verified automated Preply scheduling or reminder notification(s)

<Needs attention heading, only when applicable>
- <Actionable issue>

No email was sent. Gmail changes were limited to <count> authorized notification(s) moved to Trash.
```

If nothing changed:

```text
0 email threads ingested

No email was sent or modified.
```
