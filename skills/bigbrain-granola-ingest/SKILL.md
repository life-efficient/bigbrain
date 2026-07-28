---
name: bigbrain-granola-ingest
description: Ingest recent Granola meetings into the correct BigBrain brain, including machine-wide routing by brain description.
---

# BigBrain Granola Ingest

Ingest recent Granola meetings into BigBrain with correct brain routing, source preservation, entity/task updates, sync, and privacy-safe reporting.

## Contract Checklist

- The active brain or routed destination is resolved before any write.
- Machine-wide routing uses each reachable brain's live description as the routing source of truth.
- Live destination filing rules are read before paths, page types, entities, tasks, or raw sidecars are chosen.
- Existing Granola coverage is checked before creating or repairing pages.
- Substantive meetings get canonical meeting pages and transcript sidecars when transcripts are available and safe to store.
- Durable entity, deal, project, concept, and task updates are made only when supported by meeting evidence and destination filing rules.
- The destination brain is synced and read back before reporting success.
- Final output is count-first, grouped by brain, and privacy-safe.

## Workflow

1. Resolve candidate brains and routing context.
   - In selected-brain mode, resolve the target through selected BigBrain context, `--brain-home`, `BIGBRAIN_HOME`, or the saved default pointer.
   - In machine-wide routing mode, list registered machine-wide brains first, then read each reachable brain's live description and authenticated capability/about state.
   - Consider only brains that are reachable, authenticated, writable, and have a valid description.
   - Route machine-wide candidates by comparing allowed meeting metadata to brain descriptions only; do not use per-brain examples, purpose tags, source rules, profile approval state, or private filing hints as routing inputs.
   - Hold the item for review when no single brain has a clear description-match margin or when the likely destination is unavailable.
   - Anti-patterns: reading filing rules before knowing candidate brains, routing from examples or keyword lists, falling back to Personal Brain, fan-out to multiple brains, writing to an unavailable brain
2. Read destination filing rules.
   - Read the selected destination's top-level `FILING.md` and relevant collection filing rules before choosing paths or page types.
   - Treat live filing rules as authoritative for meeting pages, raw transcript sidecars, entity pages, deal/project updates, and tasks.
   - In machine-wide routing mode, delegate destination write behavior to the selected brain's live filing rules instead of duplicating those rules in this router skill.
   - Anti-patterns: hardcoding destination paths from this skill, duplicating filing rules, using stale memory instead of live rules, creating pages before reading rules
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
   - Anti-patterns: duplicate meeting pages, relying on title-only dedupe, ignoring changed titles with same Granola ID, repairing pages without a concrete gap
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
   - Redact only the specific unsafe span with a clear redaction marker.
   - If a transcript cannot be fully captured or reviewed, leave the meeting partial and report the issue.
   - Anti-patterns: omitting transcript sidecars for substantive meetings, broad redaction without cause, storing unsafe spans verbatim, claiming complete ingest when transcript capture failed
8. Write pages and sidecars.
   - Follow live filing rules for page paths, raw paths, sidecar paths, frontmatter, links, and timeline entries.
   - Preserve source provenance internally on meeting pages and sidecars.
   - Link transcript sidecars from canonical meeting pages when the destination pattern expects it.
   - Keep entity and task timeline entries evidence-backed and concise.
   - Never store transcript, summary, notes, participant names, credentials, or private meeting content in the machine catalog or routing ledger.
   - Anti-patterns: writing raw files outside the owning collection, losing source provenance, storing private content in routing state, making public pages or raw files without explicit approval, placing technical audit data in user-facing content
9. Verify and sync.
   - Re-scan for duplicate Granola coverage after writes.
   - Read back the canonical meeting page, provenance, transcript sidecar when created, and any affected stable pages or tasks.
   - Confirm changed pages match live filing rules.
   - Run `bigbrain sync --json` from the selected brain root or use the destination brain's live sync tool.
   - Treat sync warnings and read-back mismatches as issues to report or repair before success.
   - Anti-patterns: reporting success before read-back, skipping sync, ignoring duplicate coverage after writes, hiding sync failures
10. Report results.
   - First line must be a plain count sentence: `0 meetings ingested`, `1 meeting ingested`, `5 meetings ingested`, or `2 meetings repaired`.
   - If multiple outcomes occurred, use one concise first line such as `3 meetings ingested, 1 repaired`.
   - When one or more meetings were ingested, add a heading for each destination brain that received at least one meeting and list each ingested meeting as one bullet underneath.
   - Meeting bullets may include only the meeting title and high-level outcome, such as `ingested`, `repaired`, or `left partial`.
   - Add optional `Issues`, `Errors`, `Warnings`, or `Needs review` sections only when the user should act.
   - Keep IDs, hashes, slugs, page paths, raw paths, folder IDs, sync JSON, participants, private summaries, transcripts, notes, credentials, and private content out of the user-facing output by default.
   - Anti-patterns: exposing private content in the report, listing technical identifiers by default, burying the count summary, omitting brain headings after successful ingest

## Anti-Patterns

- Treating the router as a source of per-brain filing policy instead of reading live destination rules.
- Reintroducing purpose tags, approved profiles, examples, or source rules as machine-wide routing gates.
- Using ambiguous meeting titles or keywords as a substitute for brain-description classification.
- Crossing brain boundaries when routing confidence, authentication, write access, or folder exclusion enforcement is unclear.
- Inventing facts, decisions, owners, due dates, task status, affiliations, or participant identities.
- Storing secrets, credentials, transcript content, summaries, participant lists, notes, or model prompts in machine-wide routing state.
- Quoting unsafe, slanderous, highly personal, sensitive, or private transcript text in the final report.

## Output

Use this shape:

```text
5 meetings ingested

Personal Brain
- Quarterly planning sync ingested
- Health protocol review ingested

ICAIRE Brain
- Programme standup ingested

Warnings
- One transcript was unavailable, so that meeting was left partial.
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
