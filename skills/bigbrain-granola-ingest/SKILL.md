---
name: "BigBrain: Granola Ingest"
version: 1.0.0
description: |
  Ingest recent Granola meetings into a selected BigBrain brain when asked to
  import, sync, backfill, or automate Granola meeting capture.
triggers:
  - "granola ingest"
  - "import granola meetings"
  - "sync granola meetings"
  - "backfill granola meetings"
  - "automate granola meeting capture"
tools:
  - shell
mutating: true
---

# BigBrain Granola Ingest

Ingest recent Granola meetings into the selected BigBrain brain. Treat the
brain's live filing rules, user instructions, and local exclusion policy as the
source of truth.

## Contract

Use this skill when the user asks to import, sync, backfill, or automate Granola
meetings into BigBrain.

Successful completion means:

- the target brain is the selected BigBrain brain home, resolved through
  `--brain-home`, `BIGBRAIN_HOME`, or the saved default pointer
- current brain filing rules are checked before writing
- Granola access uses a direct Granola MCP server with folder-aware tools when
  folder exclusions are required
- user-named or filing-rule-named excluded Granola folders are resolved and
  skipped before writing pages
- when excluded folders are required but folder tools or folder filters are
  unavailable, new meeting ingestion stops instead of risking cross-boundary
  writes
- only recent meetings, or meetings since the newest ingested Granola meeting
  with a small overlap window, are considered unless the user requests a
  backfill
- meetings whose Granola title is exactly `New note` or `New Note` are ignored
  before fetching details, transcripts, or writing pages
- existing `granola_id` values and raw sidecars are checked before writing
- duplicate meetings are skipped unless repairing missing sidecars or entity
  updates
- meeting pages, raw sidecars, entity pages, and task pages are created or
  updated only according to the brain filing rules
- task work is handled as part of the ingestion run: check existing open,
  in-progress, and waiting tasks before creating new ones; update matching task
  pages when meeting evidence changes status, owner, due date, next action, or
  completion criteria; create new task pages only for concrete assignable
  follow-ups
- transcripts are saved verbatim by default after an explicit safety check, with
  targeted redaction only where unsafe or highly sensitive content appears
- every substantive ingested meeting has a raw transcript sidecar unless
  Granola returns no transcript content
- `bigbrain sync --json` runs after writes

## Workflow

1. Resolve the brain and read filing rules.
   - Work from the selected brain home unless the user names another brain.
   - Read the top-level `FILING.md` and any relevant collection `FILING.md`
     files before choosing paths or page types.
   - Follow the live brain rules rather than hard-coding paths from this skill.
2. Confirm Granola access.
   - Prefer direct Granola MCP tools such as `get_account_info`,
     `list_meeting_folders`, `list_meetings`, `get_meetings`, and
     `get_meeting_transcript`.
   - If direct Granola tools are unavailable, use the active harness's MCP
     discovery process before concluding Granola is unavailable.
   - Do not use a wrapper that omits folder tools when folder-sensitive
     ingestion is required.
3. Resolve excluded Granola folders.
   - Check user instructions and brain filing rules for excluded folders or
     separate workflows.
   - Use `list_meeting_folders` to find excluded folder IDs, then call
     `list_meetings` with those folder IDs to build an exclusion set.
   - If exclusion folders are required and cannot be resolved, report the
     blocker and do not ingest new meetings.
4. Check existing coverage.
   - Search existing meeting pages and raw sidecars for `granola_id:`.
   - Treat a matching Granola UUID as already ingested even if the title
     changed.
   - Determine the newest ingested Granola meeting date. Query from two days
     before that date to catch late summaries, or use the last 30 days when no
     prior Granola import exists.
5. Fetch candidate meetings.
   - Drop exact-title `New note` / `New Note` records before fetching details.
   - Fetch meeting details in batches of at most 10.
   - Fetch transcripts only for new meetings or explicit repair/update work.
6. Plan writes.
   - Skip excluded-folder candidates and report their IDs, titles, dates, and
     destination workflow when known.
   - Skip duplicates unless there is a missing transcript, missing source
     sidecar, or clear entity/task update to apply.
   - Create or update one canonical meeting page per ingested meeting.
   - Update related people, companies, deals, concepts, projects, or other
     entity pages only when the meeting contains durable facts and the filing
     rules support that placement.
   - Review existing open, in-progress, and waiting task pages for matching or
     related follow-ups before creating any new task.
   - Update existing task pages when the meeting changes their status, owner,
     due date, next action, or completion criteria. Add an evidence-backed
     timeline entry citing the Granola meeting ID and date.
   - Create new task pages only for concrete assignable follow-ups with an
     owner or clear assignee. Use the brain's task tools when available, or
     write page-backed `tasks/*.md` files that follow the live task filing
     rules.
7. Review transcript safety before saving.
   - Explicitly inspect transcripts for unsafe, slanderous, highly personal, or
     sensitive spans.
   - Save transcripts verbatim when the review finds no material that should be
     removed.
   - Redact only the specific unsafe span, using a marker such as
     `[redacted: category]`.
   - If a transcript cannot be fully captured or reviewed, do not save a
     reconstructed transcript and do not mark the meeting as fully ingested.
8. Write artifacts.
   - Follow the brain filing rules for page paths and raw sidecar paths.
   - Preserve Granola metadata, source-note context, and transcript provenance.
   - Link sidecars from the meeting page when the local page pattern expects it.
   - Keep entity and task timeline entries evidence-backed and cite the Granola
     meeting ID/date.
9. Verify and sync.
   - Re-scan for duplicate `granola_id` values.
   - Confirm created or updated pages match the live filing rules.
   - Confirm transcript sidecars either passed safety review or contain only
     targeted redactions.
   - Confirm any task pages created or updated by the run are visible through
     the brain task surface, such as `tasks/list`, when that tool is available.
   - Run `bigbrain sync --json` from the selected brain root.

## Guardrails

- Do not duplicate filing rules inside this skill. Always read the live rules.
- Do not ingest material from user-named excluded Granola folders.
- Do not rely on title or keyword matching when required folder exclusions
  cannot be built.
- Do not create placeholder pages for exact-title `New note` / `New Note`
  records.
- Do not invent attendees, decisions, facts, owners, due dates, or task status.
- Do not omit raw transcript sidecars for substantive meetings when transcript
  content is available.
- Do not quote unsafe, slanderous, highly personal, or sensitive text in the
  final report.
- Do not ingest old meetings outside the cutoff window unless the user asks for
  a backfill.

## Output

Report briefly:

- Granola window checked
- meetings found, skipped as duplicates, ingested, repaired, or skipped
- excluded folder IDs used, or the folder-tool blocker
- meeting pages, entity pages, task pages, and sidecars changed
- meetings left partial because transcript capture or attachment failed
- transcript safety result and targeted redaction count
- `bigbrain sync --json` result
- warnings or unresolved questions
