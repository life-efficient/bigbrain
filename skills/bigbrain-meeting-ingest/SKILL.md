---
name: bigbrain-meeting-ingest
description: Save meeting notes, a transcript, or a post-meeting summary to BigBrain. Use for one meeting supplied directly or passed from another ingestion skill. For retrieving meetings from Granola, start with `bigbrain-granola-ingest`; for talks or podcasts, use `bigbrain-media-ingest`.
---

# BigBrain Meeting Ingest

Turn one meeting transcript, summary, or set of call notes into a verified canonical meeting record and supported follow-on updates.

## Contract Checklist

- Read and follow [the shared ingestion completeness checklist](../bigbrain-ingest/references/ingestion-completeness.md) before any Brain write, including when this skill is invoked directly. Complete that checklist before declaring ingestion complete.
- Exactly one meeting is processed per invocation.
- Standalone mode owns destination resolution, final verification, and the user-facing result for that meeting.
- Delegated mode accepts a resolved destination and source evidence from a calling ingestion skill, performs the per-meeting work, then returns control to that caller.
- Delegated completion is an intermediate result. It never implies that the caller's routing, ledger, cursor, batch, or reporting lifecycle is complete.
- One canonical meeting page is used across preparation and post-meeting updates, and existing `## Prep` content is preserved.
- A candidate transaction is classified as an actual deal, meeting-only context, or a deal-owned artifact before any page is created. Only actual deals receive top-level `deals/` pages.
- The meeting page contains an evidence-backed summary, decisions, actual-owner action items, and discussion context.
- Follow the generic page-writing schema for the current page body; do not define a meeting-specific page contract.
- Unrecorded meetings supplied as notes or recaps have an indexed summary sidecar only, with note provenance and no raw transcript. A transcript is required only when actual transcript content is supplied or fetched.
- Valuable actual transcripts and attachments follow live filing rules and have verified same-basename indexed sidecars.
- Speaker, responsible actor, and commitment strength remain distinct, with transcript evidence preferred over generated-summary attribution when they conflict.
- Candidate task changes pass through `$bigbrain-action-review`; external actions and optional offers remain useful context without becoming backlog tasks unless a member owns a concrete follow-up.
- Supported attendee, organization, deal, project, relationship, and task updates are applied and read back through the destination Brain.
- Route canonical attendee, organization, deal, project, and relationship page creation or updates through `$bigbrain-page`; keep the canonical meeting record and task records on their specialized shapes.
- Every action bullet backed by a created or updated task includes one concise inline link to that exact task page, using the verified path returned by the task write and a path relative to the page being rendered.
- Broken or unreadable task links are recoverable consistency errors: repair the task or source page in the same run, read it back again, and do not leave a broken link behind.
- Do not introduce a fixed action or failure schema. If a problem remains after repair attempts, explain it directly in the Codex chat where the skill was run, naming the affected pages and attempted repair.

## Invocation Modes

### Standalone mode

Use when the user directly provides or identifies one meeting. Resolve the destination Brain, read its live filing rules, complete and verify the meeting ingest, and report the result to the user.

### Delegated mode

Use when a source-specific ingestion skill such as `$bigbrain-granola-ingest` has already acquired the source, resolved the destination, enforced source exclusions, and established its own continuation lifecycle.

The caller provides, in natural language:

- caller identity and an explicit instruction to return control;
- destination Brain and current filing context;
- source identity and provenance needed for deduplication;
- meeting metadata, transcript, summary, notes, and relevant attachments;
- source-specific interpretation or authority boundaries;
- allowed mutations, privacy constraints, and action-time approval limits.

Do not accept or expose routing lease tokens, cursor state, credentials, or private batch-control data. Do not run caller-owned ledger, cursor, routing, or batch-reporting steps.

## Workflow

1. Establish invocation mode and destination.
   - Read the shared ingestion completeness checklist linked above and use it throughout this workflow, even on direct invocation.
   - Identify whether the request is standalone or delegated.
   - In standalone mode, resolve one writable destination Brain before any mutation.
   - In delegated mode, confirm the caller supplied a resolved destination, source provenance, and an explicit return-control instruction. Stop with a delegated partial result if the handoff is incomplete.
   - Read the destination's live top-level and collection filing rules even when the caller already supplied a summary of them.
   - Anti-patterns: guessing the destination, processing several meetings in one invocation, accepting a delegated request without a named caller, taking ownership of source routing or cursor state
2. Find the canonical meeting record and existing coverage.
   - Search by stable source provenance first, then by prepared meeting page, date, participants, and title as supporting evidence.
   - Update an existing prepared or previously ingested meeting page instead of creating a duplicate.
   - Preserve existing `## Prep` content and its subheadings.
   - Determine whether the meeting is new, already complete, or needs a specific repair such as a missing transcript, sidecar, participant link, or follow-on update.
   - Anti-patterns: title-only deduplication, creating a second post-meeting page, erasing preparation material, repairing without a concrete gap
3. Interpret the meeting evidence.
   - First classify the available evidence as an actual recording transcript, user-supplied notes or recap, or a generated summary. A transcript-like filename does not establish that a recording or transcript exists.
   - Extract attendees, date or timeframe, summary, decisions, action-relevant statements, and material discussion context.
   - For every action-relevant statement, preserve the source speaker separately from the responsible actor and distinguish accepted commitments, requests, external actions, optional offers, proposals, and discussion.
   - Prefer the transcript over a generated summary or `Action Items` heading when ownership, wording, or commitment strength conflicts.
   - Mark uncertain identities, affiliations, authority, ownership, decisions, and commitments explicitly rather than resolving them by proximity or action verbs.
   - Classify every candidate transaction as an actual deal, meeting-only preparation or context, or a deal-owned artifact. Resolve names, counterparties, and aliases against existing deal pages. Keep an ambiguous candidate on the meeting page with its uncertainty rather than inventing a deal record.
   - Review transcripts for specifically unsafe, slanderous, highly personal, or sensitive spans. Redact only the unsafe span when required and leave a clear marker.
   - Anti-patterns: conflating speaker with actor, treating a request as acceptance, converting optional help into a commitment, broad redaction, promoting a summary inference over transcript evidence
4. Plan the canonical meeting and source artifacts.
   - Compose the current meeting page from the supported facts, chronology, decisions, discussion context, and owner-labelled actions. Preserve existing `## Prep` content when present, but do not require fixed meeting headings.
   - Keep preparation on this meeting page and update the same page with the outcome after it occurs. Create or update one canonical deal page for each sufficiently identified actual deal and set `deal_involvement` from evidence. Store a VDR inventory, diligence pack, teaser, model, or comparable evidence as a deal-owned `.raw/` sidecar linked from that deal.
   - Send only current page content to the generic page writer. Do not include its separator, `## Timeline`, or a verbose provenance or raw-file wrapper section.
   - Record external actions with their actual owner and preserve optional offers in the most natural meeting, sidecar, deal, project, or relationship context.
   - Keep comprehensive transcript extraction and document-specific synthesis in the indexed sidecar rather than forcing raw dumps into the canonical meeting page.
   - For an unrecorded meeting added from notes or a recap, retain the evidence in the indexed summary sidecar and identify it as notes or a recap. Do not create a raw transcript, rename the recap as a transcript, or treat absent transcript content as a completeness gap.
   - Store each valuable actual raw artifact at the path required by filing rules and create its deterministic same-basename indexed sidecar.
   - Use only actual supplied or fetched transcript content as the raw transcript, never a pointer, placeholder, provenance note, user recap, or generated summary.
   - When correcting a note-only meeting previously mislabeled as a transcript, preserve the note content in its summary sidecar, remove the misleading raw transcript through the owning Brain tools, repair its links and provenance, and read back the result.
   - Anti-patterns: fake action items, backlog tasks for uninvoked offers, raw dumps in the canonical page, orphan raw artifacts, placeholder transcripts
5. Reconcile supported entity and task updates.
   - Apply the shared checklist to attendees and all identifiable entities mentioned in the accepted meeting evidence, including people who did not attend. Use `$bigbrain-page` for canonical reconciliation.
   - Read open, in-progress, or waiting tasks relevant to the meeting before action review.
   - Pass source-attributed action evidence, relevant Brain context, live tasks, and approval limits to `$bigbrain-action-review` before any task creation or update.
   - Use Brain context to sharpen a supported action, never to override source ownership or manufacture acceptance.
   - Create or update tasks only for concrete member-owned actions returned by Action Review. Preserve approval at action time for messages, introductions, scheduling, sharing, publication, or other externally visible work.
   - Keep each member-owned action associated with its task create or update while the task write is read back and the meeting and sidecar text is rendered. This is temporary working context, not a persisted action schema.
   - Anti-patterns: skipping secondary entities, duplicate entity pages, duplicate tasks, vague umbrella tasks, assigning another party's obligation to a member, treating execution mode as external-action approval
6. Apply the smallest supported write set.
   - Create or update supported tasks through the destination Brain's live write tools before finalizing action sections. Capture the exact returned task path, read that task back, and use that verified path for the corresponding action.
   - Render each task-backed action with one concise inline Markdown link to the verified task page. Compute the link relative to the page being rendered, such as `../tasks/example.md` from `meetings/example.md` or `../../tasks/example.md` from `meetings/.raw/example.md`; never invent or reuse a stale path.
   - Link meeting, sidecar, entity, deal, project, and task records where live filing rules expect reciprocal context.
   - Keep standalone safety, authorization, or no-external-action statements out of `## Action Items` and out of the sidecar's action-review list. Attach a short boundary to a real action only when it materially affects execution or completion.
   - Keep source provenance and material uncertainty internally while avoiding private transcript content in user-facing or machine-routing state.
   - Do not perform external sends, invitations, publication, Calendar changes, or other externally visible actions.
   - Anti-patterns: direct file or database edits when an owning Brain service exists, duplicated facts across many pages, lost provenance, unauthorized external action
7. Verify the per-meeting result.
   - Complete the shared checklist before declaring this meeting complete, including in delegated mode.
   - Read back every changed meeting, sidecar, entity, deal, project, and task page through the same destination Brain.
   - Verify each actual raw transcript or attachment against the source content or available size and metadata evidence. For a note-only meeting, verify the summary sidecar and note provenance, and confirm that no fabricated raw transcript or dangling transcript link remains.
   - Re-scan for duplicate meeting provenance, confirm canonical links and filing-rule compliance, and check that every task-backed action bullet links exactly once to the verified task path.
   - If a task is unreadable, a link is broken, or an action bullet is missing its task link, repair the affected task or source page in the same run, then read back both sides again. Repeat while a concrete repair is available; do not leave a known broken link or task-backed action unresolved.
   - If an owning Brain or source remains unavailable after repair attempts, explain the concrete failure directly in the current Codex chat with the affected paths and what was tried. Do not add a new persisted failure state or opaque handoff result for this issue.
   - Anti-patterns: trusting write responses without read-back, treating a sidecar as proof of raw content, ignoring duplicate provenance, returning complete with an unverified required artifact
8. Finalize according to invocation mode.
   - Rely on the owning Brain MCP's automatic propagation and backup. Run manual sync or maintenance only if verification identifies a failed side effect that requires repair.
   - In standalone mode, complete verification and provide the standalone user-facing output.
   - In delegated mode, do not take over caller verification, advance a cursor, verify a source ledger, or emit the caller's user-facing report.
   - In delegated mode, return the compact delegated result below and explicitly return control to the named caller so it can resume its recorded continuation checklist.
   - A delegated `complete` result means only that this one meeting's delegated work and read-back succeeded. The caller still owns all post-delegation lifecycle steps.
   - Anti-patterns: ending the overall run after delegated completion, emitting a competing batch report, advancing caller state, skipping standalone verification

## Anti-Patterns

- Treating a successful delegated meeting result as completion of the calling ingestion workflow.
- Taking over Granola or another source adapter's discovery, routing, ledger, cursor, or batch responsibilities.
- Creating a second meeting page when a canonical page exists, or creating a top-level deal page for meeting prep, a meeting record, or a VDR inventory.
- Erasing `## Prep` during the post-meeting update.
- Conflating speaker, responsible actor, request, acceptance, external action, and optional offer.
- Creating tasks from vague discussion, inventing entity details, or skipping identifiable people because they were only mentioned in passing.
- Fabricating a raw transcript from notes or a recap, or requiring a transcript for an unrecorded meeting.
- Reporting success before per-meeting writes and artifacts are read back.

## Output

In standalone mode, briefly report the meeting page created, updated, repaired, or unchanged; whether prep was preserved; verified source artifacts; supported entity and task changes; and any issue requiring attention.

In delegated mode, return a compact prose handoff to the named caller. State whether the per-meeting result is `complete`, `partial`, or `failed`, the canonical meeting outcome, required-artifact verification, related changes, and any blockers, then explicitly return control. Preserve those existing transport outcomes without imposing a field template, persisted schema, or competing user-facing batch report.
