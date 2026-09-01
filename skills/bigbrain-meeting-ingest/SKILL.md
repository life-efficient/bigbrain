---
name: bigbrain-meeting-ingest
description: Ingest one meeting into its canonical BigBrain record, either directly or as the per-meeting worker for a source-specific ingestion skill.
---

# BigBrain Meeting Ingest

Turn one meeting transcript, summary, or set of call notes into a verified canonical meeting record and supported follow-on updates.

## Contract Checklist

- Exactly one meeting is processed per invocation.
- Standalone mode owns destination resolution, final sync, and the user-facing result for that meeting.
- Delegated mode accepts a resolved destination and source evidence from a calling ingestion skill, performs the per-meeting work, then returns control to that caller.
- Delegated completion is an intermediate result. It never implies that the caller's routing, ledger, cursor, batch, or reporting lifecycle is complete.
- One canonical meeting page is used across preparation and post-meeting updates, and existing `## Prep` content is preserved.
- The meeting page contains an evidence-backed summary, decisions, actual-owner action items, and discussion context.
- Follow the generic page-writing schema for the current page body; do not define a meeting-specific page contract.
- Valuable raw transcripts and attachments follow live filing rules and have verified same-basename indexed sidecars.
- Speaker, responsible actor, and commitment strength remain distinct, with transcript evidence preferred over generated-summary attribution when they conflict.
- Candidate task changes pass through `$bigbrain-action-review`; external actions and optional offers remain useful context without becoming backlog tasks unless a member owns a concrete follow-up.
- Supported attendee, organization, deal, project, relationship, and task updates are applied and read back through the destination Brain.
- Every action bullet backed by a created or updated task includes one concise inline link to that exact task page, using the verified path returned by the task write and a path relative to the page being rendered.
- Broken or unreadable task links are recoverable consistency errors: repair the task or source page in the same run, read it back again, and do not leave a broken link behind.
- Do not introduce a fixed action or failure schema. If a problem remains after repair attempts, explain it directly in the Codex chat where the skill was run, naming the affected pages and attempted repair.

## Invocation Modes

### Standalone mode

Use when the user directly provides or identifies one meeting. Resolve the destination Brain, read its live filing rules, complete and verify the meeting ingest, sync that Brain, and report the result to the user.

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
   - Extract attendees, date or timeframe, summary, decisions, action-relevant statements, and material discussion context.
   - For every action-relevant statement, preserve the source speaker separately from the responsible actor and distinguish accepted commitments, requests, external actions, optional offers, proposals, and discussion.
   - Prefer the transcript over a generated summary or `Action Items` heading when ownership, wording, or commitment strength conflicts.
   - Mark uncertain identities, affiliations, authority, ownership, decisions, and commitments explicitly rather than resolving them by proximity or action verbs.
   - Review transcripts for specifically unsafe, slanderous, highly personal, or sensitive spans. Redact only the unsafe span when required and leave a clear marker.
   - Anti-patterns: conflating speaker with actor, treating a request as acceptance, converting optional help into a commitment, broad redaction, promoting a summary inference over transcript evidence
4. Plan the canonical meeting and source artifacts.
   - Compose the current meeting page from the supported facts, chronology, decisions, discussion context, and owner-labelled actions. Preserve existing `## Prep` content when present, but do not require fixed meeting headings.
   - Send only current page content to the generic page writer. Do not include its separator, `## Timeline`, or a verbose provenance or raw-file wrapper section.
   - Record external actions with their actual owner and preserve optional offers in the most natural meeting, sidecar, deal, project, or relationship context.
   - Keep comprehensive transcript extraction and document-specific synthesis in the indexed sidecar rather than forcing raw dumps into the canonical meeting page.
   - Store each valuable raw artifact at the path required by filing rules and create its deterministic same-basename indexed sidecar.
   - Use the actual fetched transcript content, never a pointer, placeholder, provenance note, or generated summary as the raw transcript.
   - Anti-patterns: fake action items, backlog tasks for uninvoked offers, raw dumps in the canonical page, orphan raw artifacts, placeholder transcripts
5. Reconcile supported entity and task updates.
   - Read the most relevant people, organizations, deals, projects, relationships, and open, in-progress, or waiting tasks.
   - Update an attendee or represented organization when identity, affiliation, and durable context are supported strongly enough for a useful canonical record.
   - Keep lightly mentioned entities in meeting context instead of creating pages for every name.
   - Pass source-attributed action evidence, relevant Brain context, live tasks, and approval limits to `$bigbrain-action-review` before any task creation or update.
   - Use Brain context to sharpen a supported action, never to override source ownership or manufacture acceptance.
   - Create or update tasks only for concrete member-owned actions returned by Action Review. Preserve approval at action time for messages, introductions, scheduling, sharing, publication, or other externally visible work.
   - Keep each member-owned action associated with its task create or update while the task write is read back and the meeting and sidecar text is rendered. This is temporary working context, not a persisted action schema.
   - Anti-patterns: entity proliferation, duplicate tasks, vague umbrella tasks, assigning another party's obligation to a member, treating execution mode as external-action approval
6. Apply the smallest supported write set.
   - Create or update supported tasks through the destination Brain's live write tools before finalizing action sections. Capture the exact returned task path, read that task back, and use that verified path for the corresponding action.
   - Render each task-backed action with one concise inline Markdown link to the verified task page. Compute the link relative to the page being rendered, such as `../tasks/example.md` from `meetings/example.md` or `../../tasks/example.md` from `meetings/.raw/example.md`; never invent or reuse a stale path.
   - Link meeting, sidecar, entity, deal, project, and task records where live filing rules expect reciprocal context.
   - Keep standalone safety, authorization, or no-external-action statements out of `## Action Items` and out of the sidecar's action-review list. Attach a short boundary to a real action only when it materially affects execution or completion.
   - Keep source provenance and material uncertainty internally while avoiding private transcript content in user-facing or machine-routing state.
   - Do not perform external sends, invitations, publication, Calendar changes, or other externally visible actions.
   - Anti-patterns: direct file or database edits when an owning Brain service exists, duplicated facts across many pages, lost provenance, unauthorized external action
7. Verify the per-meeting result.
   - Read back every changed meeting, sidecar, entity, deal, project, and task page through the same destination Brain.
   - Verify each raw transcript or attachment against the source content or available size and metadata evidence.
   - Re-scan for duplicate meeting provenance, confirm canonical links and filing-rule compliance, and check that every task-backed action bullet links exactly once to the verified task path.
   - If a task is unreadable, a link is broken, or an action bullet is missing its task link, repair the affected task or source page in the same run, then read back both sides again. Repeat while a concrete repair is available; do not leave a known broken link or task-backed action unresolved.
   - If an owning Brain or source remains unavailable after repair attempts, explain the concrete failure directly in the current Codex chat with the affected paths and what was tried. Do not add a new persisted failure state or opaque handoff result for this issue.
   - Anti-patterns: trusting write responses without read-back, treating a sidecar as proof of raw content, ignoring duplicate provenance, returning complete with an unverified required artifact
8. Finalize according to invocation mode.
   - In standalone mode, sync the destination Brain after successful read-back, verify the sync result, and provide the standalone user-facing output.
   - In delegated mode, do not independently sync, advance a cursor, verify a source ledger, or emit the caller's user-facing report.
   - In delegated mode, return the compact delegated result below and explicitly return control to the named caller so it can resume its recorded continuation checklist.
   - A delegated `complete` result means only that this one meeting's delegated work and read-back succeeded. The caller still owns all post-delegation lifecycle steps.
   - Anti-patterns: ending the overall run after delegated completion, emitting a competing batch report, advancing caller state, skipping standalone sync

## Anti-Patterns

- Treating a successful delegated meeting result as completion of the calling ingestion workflow.
- Taking over Granola or another source adapter's discovery, routing, ledger, cursor, or batch responsibilities.
- Creating a second meeting page when a canonical page exists.
- Erasing `## Prep` during the post-meeting update.
- Conflating speaker, responsible actor, request, acceptance, external action, and optional offer.
- Creating task or entity sprawl from vague discussion or passing mentions.
- Reporting success before per-meeting writes and artifacts are read back.

## Output

### Standalone output

Report the meeting page created, updated, repaired, or unchanged; whether prep was preserved; transcript or attachment verification; supported entity and task changes; sync result; and any issue requiring attention.

### Delegated output

Return a compact internal handoff to the named caller:

```text
Delegated meeting result
- Status: complete | partial | failed
- Canonical meeting: created | updated | repaired | unchanged
- Required artifacts: verified | partial | unavailable
- Related changes: <concise page and task outcomes>
- Needs attention: <none or concise blockers>
- Return control to: <calling ingestion skill>
```

This is an ephemeral coordination format, not a persisted Brain schema and not a user-facing batch report.
