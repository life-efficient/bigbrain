---
name: bigbrain-granola-ingest
description: Use when the user asks to import or process recent Granola meetings into the correct BigBrain brain, including machine-wide routing by brain description.
---

# BigBrain Granola Ingest

Ingest recent Granola meetings into BigBrain with correct brain routing, source preservation, entity/task updates, sync, and privacy-safe reporting.

## Contract Checklist

- The active brain or routed destination is resolved before any write.
- Machine-wide routing uses each reachable brain's live description as the routing source of truth.
- Machine-wide routing ingests every processable meeting; when no specialized brain clearly wins, route to Personal Brain if it is reachable and writable.
- An optional user-level meeting-ingestion protocol is checked in Personal Brain before destination writes; a missing protocol is a non-blocking no-op.
- Live destination filing rules are read before paths, page types, entities, tasks, or raw sidecars are chosen.
- Existing Granola coverage is checked before creating or repairing pages.
- Substantive meetings get canonical meeting pages and full raw transcript sidecars when transcripts are available and safe to store.
- Attendee and represented-organization pages are created or updated after the meeting record is verified.
- Durable entity, deal, project, concept, and task updates are made only when supported by meeting evidence, destination filing rules, and mention depth.
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
6. Plan destination writes.
   - Create or update one canonical meeting page per ingested meeting.
   - Run an identity and affiliation pass before writing summaries; preserve transcript-backed participant identity, affiliation, relationship, authority, decision, and commitment facts.
   - Mark uncertain roles, employers, mandates, source authority, and commitments explicitly.
   - Review related people, organizations, companies, deals, concepts, projects, and supported entity pages for durable updates.
   - Review open, in-progress, and waiting tasks before creating new tasks; update existing tasks when meeting evidence changes status, owner, due date, next action, or completion criteria.
   - Anti-patterns: inventing attendees or affiliations, flattening uncertainty, creating a task when an existing task should be updated, dumping deal context into a person page, skipping durable entity updates when evidence supports them
7. Review and preserve transcripts.
   - Inspect transcripts for unsafe, slanderous, highly personal, or sensitive spans before saving.
   - Save transcripts verbatim when no targeted redaction is needed.
   - Use the fetched transcript payload as the raw attachment content; never use a placeholder, pointer, provenance note, summary, or "see source" text as the raw transcript.
   - If the destination write API creates a raw file and page together, still verify the raw file content or metadata after the write before calling the meeting complete.
   - Redact only the specific unsafe span with a clear redaction marker.
   - If a transcript cannot be fully captured or reviewed, leave the meeting partial and report the issue.
   - Anti-patterns: omitting transcript sidecars for substantive meetings, broad redaction without cause, storing unsafe spans verbatim, writing a placeholder transcript attachment, claiming complete ingest when transcript capture failed
8. Write pages and sidecars.
   - Follow live filing rules for page paths, raw paths, sidecar paths, frontmatter, links, and timeline entries.
   - Preserve source provenance internally on meeting pages and sidecars.
   - Link transcript sidecars from canonical meeting pages when the destination pattern expects it.
   - Keep entity and task timeline entries evidence-backed and concise.
   - Never store transcript, summary, notes, participant names, credentials, or private meeting content in the machine catalog or routing ledger.
   - Anti-patterns: writing raw files outside the owning collection, losing source provenance, storing private content in routing state, making public pages or raw files without explicit approval, placing technical audit data in user-facing content
9. Verify meeting artifacts.
   - Re-scan for duplicate Granola coverage after writes.
   - Read back the canonical meeting page, provenance, and transcript sidecar when created.
   - For raw transcript attachments, confirm the stored attachment is full-text by checking the read-back content or size against the fetched transcript payload.
   - If the raw attachment is missing, tiny, placeholder-like, truncated, or otherwise inconsistent with the fetched transcript, repair it before syncing or report the meeting as partial.
   - Confirm meeting pages and sidecars match live filing rules before expanding entity pages.
   - Treat missing provenance, broken source links, duplicate coverage, or mismatched transcript sidecars as repair work before entity expansion.
   - Anti-patterns: creating entity pages from an unverified meeting page, skipping meeting read-back, ignoring duplicate coverage after writes, treating a missing sidecar as success, treating placeholder raw text as a transcript
10. Create or update entity pages.
   - Create or update pages for meeting attendees when they are identified with enough confidence from Granola metadata, transcript evidence, user clarification, or existing brain context.
   - Create or update the organization represented by each attendee when the affiliation is transcript-backed, user-confirmed, or otherwise explicitly evidenced.
   - Create or update other entities mentioned in detail only when the meeting contains enough durable context for a useful standalone page under the destination filing rules.
   - Keep lightly mentioned people, organizations, companies, deals, products, places, and concepts embedded in the meeting summary instead of creating full pages.
   - Link created or updated entity pages back to the canonical meeting page and link the meeting page to the entity pages when the destination pattern expects it.
   - Mark uncertain identities, affiliations, roles, authority, and entity names explicitly instead of converting them into firm facts.
   - Anti-patterns: creating pages for every named entity, treating a passing mention as a durable entity, guessing attendee affiliations, overwriting existing entity facts without read-back, leaving attendee pages unlinked from the meeting
11. Sync and final read-back.
   - Read back any affected stable pages, entity pages, deal/project pages, and tasks after entity expansion.
   - Confirm changed pages match live filing rules.
   - Run `bigbrain sync --json` from the selected brain root or use the destination brain's live sync tool.
   - Treat sync warnings and read-back mismatches as issues to report or repair before success.
   - Anti-patterns: reporting success before final read-back, skipping sync, hiding sync failures, ignoring stale task or entity links
12. Report results.
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
- Storing secrets, credentials, transcript content, summaries, participant lists, notes, or model prompts in machine-wide routing state.
- Quoting unsafe, slanderous, highly personal, sensitive, or private transcript text in the final report.

## Output

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
