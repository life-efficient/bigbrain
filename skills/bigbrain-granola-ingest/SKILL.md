---
name: "BigBrain: Granola Ingest"
version: 1.1.0
description: |
  Ingest recent Granola meetings into BigBrain. Supports both selected-brain
  ingestion and the machine-wide unified router mode used by the Granola
  automation.
---

# BigBrain: Granola Ingest

Ingest recent Granola meetings into BigBrain.

Use selected-brain mode when a target brain is already selected. Use
machine-wide routing mode when the automation needs to discover all registered
brains, choose the one correct destination, and delegate the destination write.

## Contract Checklist

- Resolve the target brain through the user's selected BigBrain context,
  `--brain-home`, `BIGBRAIN_HOME`, or the saved default pointer, unless running
  in machine-wide routing mode.
- In machine-wide routing mode, resolve the private BigBrain machine catalog and
  authenticated about/profile contracts for registered brains.
- Read live filing rules before writing.
- Use direct Granola MCP tools with folder support when folder exclusions are
  required.
- Resolve and skip user-named or filing-rule-named excluded Granola folders
  before writing pages.
- In machine-wide routing mode, apply destination hard rules, source-folder
  rules, auth/write state, health, and approved purpose profiles before any
  model-assisted classification.
- In machine-wide routing mode, auto-ingest only when exactly one verified,
  reachable, authenticated, writable brain has an approved auto-ingest profile
  and a clear routing margin; otherwise hold for review.
- Never store transcript, summary, notes, participant names, credentials, or
  meeting content in the machine catalog or routing ledger.
- Never fan one meeting out to multiple brains automatically.
- Stop instead of risking cross-boundary writes when required folder tools or
  folder filters are unavailable.
- Consider only recent meetings, or meetings since the newest ingested Granola
  meeting with a small overlap window, unless the user asks for a backfill.
- Ignore exact-title `New note` and `New Note` records before fetching details,
  transcripts, or writing pages.
- Check existing meeting pages and raw sidecars for duplicate Granola coverage
  before writing.
- Create or update meeting pages, raw sidecars, entity pages, and task pages
  only according to live filing rules.
- Preserve transcript-backed participant identity, affiliation, relationship,
  authority, decision, and commitment facts; mark uncertainty explicitly.
- Update existing task pages before creating new tasks when meeting evidence
  changes status, owner, due date, next action, or completion criteria.
- Save transcripts verbatim after safety review; redact only specific unsafe or
  highly sensitive spans.
- Run `bigbrain sync --json` after writes.
- Keep the final user-facing output simple: first line must be a count summary
  such as `5 meetings ingested`.

## Workflow

1. Resolve the brain and read filing rules.
   - Work from the selected brain home unless the user names another brain.
   - In machine-wide routing mode, resolve candidate brains from the private
     machine catalog, confirm each candidate's auth state, write state, health,
     and approved about/profile status, then choose the destination before
     reading that destination's filing rules.
   - Read the top-level `FILING.md` and relevant collection `FILING.md` files
     before choosing paths or page types.
   - Follow live rules rather than hard-coding paths from this skill.
   - Anti-patterns: guessing paths, writing before reading filing rules,
     defaulting to the wrong brain
2. Confirm Granola access.
   - Prefer direct Granola MCP tools such as `get_account_info`,
     `list_meeting_folders`, `list_meetings`, `get_meetings`, and
     `get_meeting_transcript`.
   - Use the active harness's MCP discovery process before concluding Granola is
     unavailable.
   - Do not use a wrapper that omits folder tools when folder-sensitive
     ingestion is required.
   - Anti-patterns: using non-folder-aware wrappers, skipping tool discovery,
     continuing without required authentication
3. Resolve excluded Granola folders.
   - Check user instructions and brain filing rules for excluded folders or
     separate ingestion workflows.
   - Use `list_meeting_folders` and folder-filtered `list_meetings` to build an
     exclusion set.
   - Stop if required exclusion folders cannot be resolved.
   - Anti-patterns: keyword-based exclusion, ignoring required folders, exposing
     folder IDs in the final report
4. Check existing coverage.
   - Search existing meeting pages and raw sidecars for Granola provenance.
   - In machine-wide routing mode, also check the global routing ledger and
     destination provenance by Granola ID before attempting any write.
   - Treat matching Granola coverage as already ingested even if the title
     changed.
   - Query from two days before the newest ingested meeting, or the last 30 days
     when no prior import exists.
   - Anti-patterns: title-only duplicate checks, no overlap window, duplicate
     meeting pages
5. Fetch candidate meetings.
   - Drop exact-title `New note` / `New Note` records before fetching details.
   - Fetch meeting details in batches of at most 10.
   - Fetch transcripts only for new meetings or explicit repair/update work.
   - Anti-patterns: unbounded backfills, fetching placeholder notes, fetching
     every transcript before de-duplication
6. Plan writes.
   - In machine-wide routing mode, apply deterministic destination rules before
     write planning: folder ownership, exclusions, approval gates, health, auth,
     write permission, and profile policy.
   - In machine-wide routing mode, use model-assisted classification only on
     allowed routing metadata; fetch transcript or summary for classification
     only when all relevant profiles allow local transcript-assisted routing and
     metadata is insufficient.
   - In machine-wide routing mode, hold the item when scores are close, multiple
     destinations match, the destination would require approval, or the correct
     destination is unavailable.
   - Skip excluded-folder candidates and track only counts for the final report
     unless exact references are needed for a blocker.
   - Skip duplicates unless a missing transcript, missing source sidecar, or
     clear entity/task update needs repair.
   - Create or update one canonical meeting page per ingested meeting.
   - Run an identity and affiliation pass before writing summaries.
   - Review related people, company/organization, deal, concept, project, and
     supported entity pages for durable updates.
   - Review open, in-progress, and waiting tasks before creating new tasks.
   - Anti-patterns: inventing affiliations, creating duplicate tasks, omitting
     stable entity updates
7. Review transcript safety before saving.
   - Inspect transcripts for unsafe, slanderous, highly personal, or sensitive
     spans.
   - Save transcripts verbatim when no targeted redaction is needed.
   - Redact only the specific unsafe span with a clear redaction marker.
   - If a transcript cannot be fully captured or reviewed, leave the meeting
     partial and report the issue.
   - Anti-patterns: reconstructed transcripts, broad redaction, calling partial
     capture complete
8. Write artifacts.
   - Follow live filing rules for page paths and raw sidecar paths.
   - In machine-wide routing mode, delegate the destination write to the selected
     brain's live filing rules and meeting-ingest behavior; do not duplicate
     that brain's filing rules in the router.
   - In machine-wide routing mode, preserve approved raw sidecars only inside
     the selected destination and do not broadcast meeting content to candidate
     brains.
   - Preserve source provenance internally on pages and sidecars.
   - Link sidecars from meeting pages when the local page pattern expects it.
   - Keep entity and task timeline entries evidence-backed.
   - Anti-patterns: writing outside filing rules, unlinked sidecars, unsupported
     task history
9. Verify and sync.
   - Re-scan for duplicate Granola coverage.
   - In machine-wide routing mode, read back the canonical meeting page,
     provenance, transcript sidecar when created, and any affected stable
     pages/tasks before marking the route verified.
   - Confirm changed pages match live filing rules.
   - Confirm transcript sidecars passed safety review or contain only targeted
     redactions.
   - Confirm task pages are visible through the task surface when available.
   - Run `bigbrain sync --json` from the selected brain root.
   - Anti-patterns: reporting before sync, skipping read-back, leaving duplicate
     coverage unresolved
10. Report simply.
   - First line must be a plain count sentence: `0 meetings ingested`,
     `1 meeting ingested`, `5 meetings ingested`, or `2 meetings repaired`.
   - If multiple outcomes occurred, use one concise first line such as
     `3 meetings ingested, 1 repaired`.
   - Add optional headings only when useful: `Issues`, `Errors`, `Warnings`, or
     `Needs review`.
   - Do not include IDs, hashes, folder IDs, meeting slugs, page paths, raw
     paths, or sync JSON unless an error cannot be acted on without the exact
     reference.
   - Anti-patterns: leading with audit metadata, dumping verification details,
     exposing hashes or slugs by default

## Anti-Patterns

- Duplicating filing rules inside this skill instead of reading live rules.
- Ingesting material from required excluded Granola folders.
- Relying on title or keyword matching when required folder exclusions cannot be
  built.
- Creating placeholder pages for exact-title `New note` / `New Note` records.
- Flattening uncertain role, employer, mandate, or source-authority facts.
- Inventing attendees, decisions, facts, owners, due dates, or task status.
- Omitting raw transcript sidecars for substantive meetings when transcript
  content is available.
- Quoting unsafe, slanderous, highly personal, or sensitive text in the final
  report.
- Including technical audit identifiers in the final report when a count and
  issue list is enough.
- Falling back to Personal Brain when the correct routed destination is
  unavailable.
- Storing secrets, credentials, transcript content, summaries, participant
  lists, or model prompts in the machine catalog or routing ledger.

## Output

Use this shape:

```text
5 meetings ingested

Warnings
- One transcript was unavailable, so that meeting was left partial.
```

If nothing changed:

```text
0 meetings ingested
```

Only add `Issues`, `Errors`, `Warnings`, or `Needs review` sections when there
is something the user should act on. Keep IDs, hashes, slugs, page paths, raw
paths, folder IDs, and sync JSON out of the user-facing output by default.
