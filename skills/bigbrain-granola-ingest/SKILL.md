---
name: bigbrain-granola-ingest
description: Use when the user asks to import or process recent Granola meetings into the correct BigBrain brain, including machine-wide routing by brain description.
---

# BigBrain Granola Ingest

Discover and route recent Granola meetings, delegate each claimed meeting to `$bigbrain-meeting-ingest`, then resume the Granola ledger, cursor, sync, and batch-reporting lifecycle.

## Contract Checklist

- The active brain or routed destination is resolved before any write.
- Machine-wide routing uses each reachable brain's live description as the routing source of truth.
- Machine-wide routing ingests every processable meeting; when no specialized brain clearly wins, route to Personal Brain if it is reachable and writable.
- An optional user-level meeting-ingestion protocol is checked in Personal Brain before destination writes; a missing protocol is a non-blocking no-op.
- Live destination filing rules are read before paths, page types, entities, tasks, or raw sidecars are chosen.
- Existing Granola coverage is checked before creating or repairing pages.
- Every claimed standard-path meeting is delegated exactly once to `$bigbrain-meeting-ingest` in delegated mode for canonical meeting, transcript, entity, and task processing.
- Before delegation, a continuation checklist records the Granola-owned steps that remain after the delegated result returns.
- A delegated Meeting Ingest result is intermediate and cannot complete the Granola run, verify a route, advance a cursor, or emit the batch report.
- Partial or failed delegated results never verify the route or advance the cursor.
- The destination brain is synced and read back before reporting success.
- Final output is count-first, grouped by destination-brain headings with meeting-title bullets and created-page sub-bullets, and privacy-safe.

## Scheduled machine-wide ledger control

Scheduled machine-wide runs use the repo-owned `bigbrain-granola-ledger` JSON
helper. Do not use removed `bigbrain granola cursor` or low-level
`bigbrain granola routes` write commands.

1. Run `bigbrain-granola-ledger preflight --source granola` before discovery.
   Stop when the ledger is not writable, its schema is incompatible, integrity
   is not `ok`, or foreign-key violations are present.
2. Run `bigbrain-granola-ledger inspect --source granola --item ID` before
   recording a route. A verified route is a duplicate and permits no new write.
3. Record one decision with `bigbrain-granola-ledger record`, then atomically
   claim an approved route with `bigbrain-granola-ledger claim`. A response with
   `claimed: false` permits no worker and no destination write.
4. Keep the lease token private. Use `renew` while work continues. After every
   destination write and same-Brain read-back succeeds, use `verify` with a
   non-sensitive verification reference. Use `fail` with a non-sensitive error
   code for a terminal failure.
5. Use `advance` only after the matching route is verified. The helper enforces
   that gate and monotonic cursor ordering. Held, failed, partial, unavailable,
   or merely claimed routes never advance the cursor.

See `docs/granola-routing-ledger.md` in the BigBrain repository for the exact
invocations. Never pass meeting titles, participants, summaries, transcripts,
prompts, credentials, or other private content to the ledger helper.

## Workflow

1. Resolve candidate brains and routing context.
   - In selected-brain mode, resolve the target through selected BigBrain context, `--brain-home`, `BIGBRAIN_HOME`, or the saved default pointer.
   - In machine-wide routing mode, list registered machine-wide brains first, then read each reachable brain's live description and authenticated capability/about state.
   - Consider only brains that are reachable, authenticated, writable, and have a valid description.
   - Route machine-wide candidates by comparing allowed meeting metadata to brain descriptions only; do not use per-brain examples, purpose tags, source rules, profile approval state, or private filing hints as routing inputs.
   - Prefer the specialized brain when a clear description match exists.
   - If no specialized brain clearly wins and Personal Brain is reachable, authenticated, writable, and has a valid description, route to Personal Brain as the fallback destination.
   - Hold the item for review only when the likely destination is unavailable, Personal Brain fallback is unavailable, required folder exclusions cannot be enforced, or the meeting cannot be fetched safely enough to ingest.
   - Anti-patterns: reading filing rules before knowing candidate brains, routing from examples or keyword lists, treating unclear specialized routing as ambiguous when Personal Brain is available, fan-out to multiple brains, writing to an unavailable brain
2. Read the optional Personal Brain protocol and destination filing rules.
   - Before any destination write, check Personal Brain for `protocol/meeting-ingestion-protocol.md`.
   - If the protocol page exists, read it and apply any explicit meeting-specific route or output override before continuing.
   - If the protocol selects a specialized workflow, delegate to that workflow and stop the standard BigBrain meeting-write path for that meeting. Do not name or hardcode a personal sub-skill in this shared skill.
   - If the protocol page is absent, continue with standard Granola ingestion and apply no protocol-specific override. Do not search other brains and do not create the page automatically.
   - For meetings that remain on the standard BigBrain path, read the selected destination's top-level `FILING.md` and relevant collection filing rules before choosing paths or page types.
   - Treat live filing rules as authoritative for meeting pages, raw transcript sidecars, entity pages, deal/project updates, and tasks.
   - In machine-wide routing mode, delegate destination write behavior to the selected brain's live filing rules instead of duplicating those rules in this router skill.
   - Anti-patterns: writing before the optional protocol check, searching every brain for the protocol, hardcoding destination paths, duplicating filing rules, using stale memory instead of live rules, creating pages before reading rules
3. Confirm Granola access and exclusions.
   - Prefer direct Granola MCP tools such as `list_meeting_folders`, `list_meetings`, `get_meetings`, and `get_meeting_transcript`.
   - Use the active harness's MCP discovery process before concluding Granola tools are unavailable.
   - Check user instructions and destination filing rules for excluded Granola folders or separate ingestion workflows.
   - Use folder-aware Granola listing to enforce required exclusions; stop if required folder filters cannot be resolved.
   - Anti-patterns: ignoring required excluded folders, using broad queries when folder filtering is required, assuming Granola is unavailable without tool discovery, continuing when exclusions cannot be enforced
4. Identify candidate meetings.
   - Consider only recent meetings or meetings since the newest ingested Granola meeting with a small overlap window, unless the user asks for a backfill.
   - Query from two days before the newest ingested meeting, or the last 30 days when no prior import exists.
   - Drop exact-title `New note` and `New Note` records before fetching details, transcripts, or writing pages.
   - Fetch meeting details in batches of at most 10.
   - Fetch transcripts only for new meetings or explicit repair/update work.
   - Anti-patterns: backfilling without request, processing placeholder notes, fetching transcripts for known duplicates without repair need, over-fetching beyond tool limits
5. Check existing coverage and repair needs.
   - Search existing meeting pages and raw sidecars for Granola provenance before writing.
   - In machine-wide routing mode, also check the global routing ledger and destination provenance by Granola ID before attempting any write.
   - Treat matching Granola coverage as already ingested even if the title changed.
   - Skip duplicates unless a missing transcript, missing sidecar, stale participant/entity link, or clear task/status update needs repair.
   - Anti-patterns: duplicate meeting pages, relying on title-only dedupe, ignoring changed titles with same Granola ID, skipping a new processable meeting because it feels low-value, repairing pages without a concrete gap
6. Prepare the delegated meeting handoff and continuation checklist.
   - Complete the routing-ledger `record` and `claim` steps before allowing any destination write. Invoke Meeting Ingest only after the route is successfully claimed with `claimed: true`; a route with `claimed: false` permits no delegation.
   - Before delegation, record an ephemeral continuation checklist for this route: receive and validate the delegated result, run destination sync, perform Granola final read-back, verify or fail the route, advance only after verification, then continue the batch and emit the Granola report.
   - Prepare a natural-language delegated handoff containing caller identity `$bigbrain-granola-ingest`, the resolved destination, live filing context, Granola source identity and provenance, meeting metadata, fetched transcript and notes, source-specific authority boundaries, privacy constraints, and allowed mutations.
   - Explicitly instruct `$bigbrain-meeting-ingest` to use delegated mode and return control to `$bigbrain-granola-ingest` after one meeting. Do not pass the ledger lease token, cursor state, credentials, or private batch-control data.
   - Renew the private ledger lease while delegated work continues when necessary.
   - Anti-patterns: delegating before claim, relying on memory for remaining Granola steps, passing routing secrets to Meeting Ingest, asking Meeting Ingest to process a batch, omitting the return-control instruction
7. Delegate one meeting and regain control.
   - Invoke `$bigbrain-meeting-ingest` exactly once for the claimed route and wait for its delegated result.
   - The delegated result is not completion of the Granola item, the Granola run, or the batch.
   - Immediately resume Granola processing from the recorded continuation checklist after the delegated result returns. Do not stop, summarize to the user, or move to another route before resolving the current route's post-delegation lifecycle.
   - Require the delegated result to identify `complete`, `partial`, or `failed`, the canonical meeting outcome, required-artifact verification, related changes, blockers, and explicit return of control.
   - Partial or failed delegated results must not run ledger verification or cursor advancement.
   - If the delegated result is incomplete, malformed, partial, failed, or lacks required verification, record a non-sensitive terminal failure code with `bigbrain-granola-ledger fail`; leave the route unverified and the cursor unchanged.
   - Anti-patterns: treating delegated success as overall success, losing the caller continuation, emitting Meeting Ingest output to the user, invoking Action Review or duplicating meeting interpretation in Granola, verifying a partial result
8. Complete the Granola-owned post-delegation lifecycle.
   - For a delegated `complete` result, run `bigbrain sync --json` from the destination Brain root or use the destination Brain's live sync tool.
   - After sync succeeds, perform the final read-back of the referenced canonical meeting, provenance, required transcript sidecar or artifact, affected stable pages, and tasks through the same destination Brain.
   - Confirm the stored raw transcript is full-text using content, size, or equivalent metadata against the fetched transcript payload when available.
   - Re-scan the destination for duplicate Granola provenance and confirm changed pages match live filing rules.
   - Only after delegated completion, destination sync, Granola final read-back, and required-artifact verification succeed may the caller run `bigbrain-granola-ledger verify` with a non-sensitive verification reference.
   - Run `bigbrain-granola-ledger advance` only after the same route is verified. If any post-delegation check fails, use `fail` with a non-sensitive code and leave the cursor unchanged.
   - Mark the route's continuation checklist complete only after verify and any eligible advance succeed.
   - Anti-patterns: trusting the delegated report without independent caller read-back, failing to resume after delegation, verifying before sync or final read-back, advancing before verify, leaving a claimed route unresolved, treating a failed advance as successful completion
9. Continue the batch.
   - Repeat claim, continuation recording, one-meeting delegation, caller resumption, final verification, and cursor handling for every processable candidate.
   - Keep each route isolated so one partial or failed meeting does not erase verified results for other meetings.
   - Do not expose internal delegated results, lease state, continuation notes, identifiers, or private source content in the final report.
   - Anti-patterns: parallel writes under one lease, sharing state across routes, abandoning remaining candidates after one delegated result, leaking internal coordination into user output
10. Report results.
   - First line must be a plain count sentence: `0 meetings ingested`, `1 meeting ingested`, `5 meetings ingested`, or `2 meetings repaired`.
   - If multiple outcomes occurred, use one concise first line such as `3 meetings ingested, 1 repaired`.
   - When one or more meetings were ingested, always add a heading for each destination brain that received at least one meeting and list each ingested meeting as one bullet underneath.
   - Meeting bullets must include the meeting title and high-level outcome, such as `ingested`, `repaired`, or `left partial`.
   - Under each meeting bullet, add indented sub-bullets for any non-meeting pages newly created from that meeting's content, grouped by page type when useful, such as `Tasks: ...`, `People: ...`, `Organizations: ...`, `Projects: ...`, `Deals: ...`, `Concepts: ...`, or the destination brain's own page type labels.
   - Do not list the canonical meeting page or raw transcript sidecar as created pages; those are assumed artifacts of a successful ingest.
   - If no non-meeting pages were created for a meeting, omit created-page sub-bullets for that meeting.
   - Add `Needs attention`, `Issues`, `Errors`, or `Warnings` headings only when the user should act; place every non-ingest blocker, unavailable destination, unavailable transcript, or held item under one of those headings.
   - Keep IDs, hashes, slugs, page paths, raw paths, folder IDs, sync JSON, participants, private summaries, transcripts, notes, credentials, and private content out of the user-facing output by default.
   - Anti-patterns: exposing private content in the report, listing technical identifiers by default, burying the count summary, omitting brain headings after successful ingest, hiding attention items in prose, listing assumed meeting pages as created pages

## Anti-Patterns

- Treating the router as a source of per-brain filing policy instead of reading live destination rules.
- Treating an absent optional Personal Brain protocol as a blocker or searching every brain for one.
- Reintroducing purpose tags, approved profiles, examples, or source rules as machine-wide routing gates.
- Using ambiguous meeting titles or keywords as a substitute for brain-description classification.
- Leaving processable meetings un-ingested when Personal Brain is reachable and writable as the fallback destination.
- Crossing brain boundaries when routing confidence, authentication, write access, or folder exclusion enforcement is unclear.
- Inventing facts, decisions, owners, due dates, task status, affiliations, or participant identities.
- Treating external actions, unaccepted requests, or optional offers as member-owned backlog tasks.
- Performing meeting interpretation directly instead of delegating the claimed standard-path meeting to `$bigbrain-meeting-ingest`.
- Treating the delegated per-meeting result as completion and failing to resume Granola sync, ledger, cursor, batch, or reporting work.
- Allowing partial, failed, or unverified delegated work to verify a route or advance the cursor.
- Storing secrets, credentials, transcript content, summaries, participant lists, notes, or model prompts in machine-wide routing state.
- Quoting unsafe, slanderous, highly personal, sensitive, or private transcript text in the final report.

## Output

Granola Ingest is the sole owner of the batch user-facing report. Delegated Meeting Ingest results are internal handoffs and must never be emitted as competing user-facing output.

Use this shape:

```text
5 meetings ingested

Personal Brain
- Quarterly planning sync - ingested
  - Tasks: Prepare budget options, Schedule partner follow-up
  - Organizations: Example Foundation
- Health protocol review - ingested

ICAIRE Brain
- Programme standup - ingested
  - People: New facilitator profile
  - Projects: Cohort delivery tracker

Needs attention
- One destination was unavailable, so its matching meeting was not ingested.
```

If nothing changed:

```text
0 meetings ingested
```

Only add `Issues`, `Errors`, `Warnings`, or `Needs review` sections when there
is something the user should act on. Keep IDs, hashes, slugs, page paths, raw
paths, folder IDs, sync JSON, participants, private summaries, transcripts,
notes, credentials, and private content out of the user-facing output by
default.
