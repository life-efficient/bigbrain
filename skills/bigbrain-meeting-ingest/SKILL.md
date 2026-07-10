---
name: "BigBrain: Meeting Ingest"
version: 1.0.0
description: |
  Ingest a meeting into BigBrain using the canonical meeting lifecycle model.
  Use when the input is a meeting transcript, call notes, or a meeting summary
  that should update the meeting page, action items, and related entity context.
triggers:
  - "meeting ingest"
  - "process this meeting"
  - "ingest this call"
  - "save this transcript"
  - "update the meeting page"
tools:
  - shell
mutating: true
---

# BigBrain: Meeting Ingest

Use this skill when the source material is fundamentally about a specific
meeting or call. BigBrain meetings use one canonical page across prep and
post-meeting updates.

## Contract

This skill guarantees:
- Use one canonical meeting page rather than splitting prep and outcomes across multiple files
- Preserve any existing `## Prep` section
- Update the meeting page with summary, decisions, action items, and discussion notes
- Preserve transcript dumps and other raw support according to the target brain's filing rules
- Surface related pages that should be enriched when the meeting materially changes them

## Workflow

1. Read the target brain's filing rules before writing:
   - when using an MCP or remote brain connector, call `filing_rules`
   - use the collection path, raw-file path pattern, and raw-file tools described there
2. Identify the canonical meeting page:
   - if a prepared meeting page already exists, update that page
   - otherwise create a meeting page under `meetings/`
3. Read the source material and extract:
   - attendees
   - date or timeframe
   - summary
   - key decisions
   - action items
   - discussion notes
4. Preserve page shape:
   - keep any existing `## Prep`
   - write or refresh `## Summary`
   - write or refresh `## Key Decisions`
   - write or refresh `## Action Items`
   - write or refresh `## Discussion Notes`
5. If the raw transcript, deck, or notes should stay accessible:
   - attach them at the raw path required by the filing rules, for example `meetings/.raw/<meeting-slug>-transcript.txt`
   - use `create_raw_file_with_page` to create the deterministic same-basename indexed sidecar for each artifact
   - put comprehensive transcript extraction and document-specific synthesis in the sidecar
   - create or update the canonical meeting page separately and link it to the indexed sidecar and artifact
6. Identify follow-on updates:
   - pages that gained new durable facts
   - tasks that should be created or updated as individual `tasks/*.md` pages
7. Re-index:
   - `bigbrain sync --json`

## Guardrails

- Do not create a second meeting page when a canonical one already exists
- Do not erase `## Prep` content just because post-meeting material arrived
- Do not force raw transcript dumps into the canonical page body
- Do not create a raw artifact without its same-basename indexed `.raw/*.md` sidecar
- Do not assume `.artifacts/` when the target brain's filing rules specify `.raw/`
- Do not turn vague discussion into fake decisions or fake action items

## Output

Report:
- meeting page updated or created
- whether prep content was preserved
- raw transcript path or artifact path attached, if any
- key follow-on pages or tasks that now need attention
