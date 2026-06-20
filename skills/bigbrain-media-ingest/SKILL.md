---
name: "BigBrain: Media Ingest"
version: 1.0.0
description: |
  Ingest audio, video, podcast, or mixed-media material into BigBrain. Use when
  the source includes transcript-like content, time-based media, or other rich
  files that should be preserved as raw attachments while distilled into a canonical page.
triggers:
  - "media ingest"
  - "ingest this video"
  - "ingest this audio"
  - "ingest this podcast"
  - "save this recording"
tools:
  - shell
mutating: true
---

# BigBrain: Media Ingest

Use this skill for time-based or mixed-media sources where the raw material is
important and should remain attached to a canonical page.

## Contract

This skill guarantees:
- Treat the media file or transcript as a raw attachment, not the canonical page itself
- Distill the source into a concise canonical page update
- Preserve transcript-like raw support under the `.raw/` path specified by `filing_rules`
- Capture notable sections, themes, and follow-on implications
- Re-sync the index after the write path completes

## Workflow

1. Identify the primary subject:
   - a person, company, project, meeting, concept, or media-specific note
2. Decide the canonical page to update or create
3. Extract the usable signal from the media:
   - summary
   - major themes
   - notable sections or timestamps when available
   - people, companies, or projects that materially matter
4. Preserve the source:
   - transcript, recording, or supporting files under `<collection>/.raw/<page-slug>/`
   - call `filing_rules` first when using an MCP or remote brain connector
5. Update the canonical page with durable knowledge rather than transcript sprawl
6. Re-index:
   - `bigbrain sync --json`

## Guardrails

- Do not dump long raw transcripts into the canonical page body unless the page is explicitly a raw source page
- Do not treat every mentioned name as worthy of a new page
- Do not lose the raw transcript or recording when it matters for provenance
- Do not file media under a generic format bucket when the primary subject is clear

## Output

Report:
- canonical page updated or created
- raw media attachments preserved
- major themes captured
- whether follow-on enrichment is recommended
