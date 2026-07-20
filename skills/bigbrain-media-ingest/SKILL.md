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
- When a complete transcript is available, preserve the complete timestamped transcript rather than only excerpts or highlighted passages
- Distill the source into a concise canonical page update
- Preserve transcript-like raw support under the `.raw/` path specified by `filing_rules`
- Capture notable sections, themes, and follow-on implications
- Preserve user-highlighted timestamps as first-class evidence, including the user's interpretation and why the passage matters
- Re-sync the index after the write path completes

## Workflow

1. Identify the primary subject:
   - a person, organization, project, meeting, concept, or media-specific note
2. Decide the canonical page to update or create
3. Extract the usable signal from the media:
   - summary
   - major themes
   - notable sections or timestamps when available
   - people, organizations, or projects that materially matter
   - any timestamp or passage explicitly highlighted by the user, plus the user's stated implication
4. Preserve the source:
   - complete timestamped transcript, recording, or supporting files under `<collection>/.raw/<filename>`
   - call `filing_rules` first when using an MCP or BigBrain service connector
5. Create or update the indexed synthesis page:
   - link directly to the raw transcript or media artifact
   - include a concise whole-source summary and useful thematic sections
   - include a clearly labeled `User Highlight` section when the user called out a passage, with timestamp, source link, and their interpretation
   - if the brain's filing rules require an indexed same-basename attachment sidecar, use that sidecar for comprehensive source synthesis and keep the subject page focused on durable conclusions
6. Update the canonical subject page with durable knowledge rather than transcript sprawl, linking back to the indexed synthesis/sidecar
7. Re-index:
   - `bigbrain sync --json`

## Guardrails

- Do not dump long raw transcripts into the canonical page body unless the page is explicitly a raw source page
- Do not treat every mentioned name as worthy of a new page
- Do not lose the raw transcript or recording when it matters for provenance
- Do not substitute a highlighted excerpt for the complete transcript when the complete transcript is available
- Do not silently omit a timestamp or interpretation the user explicitly asked to preserve
- Do not file media under a generic format bucket when the primary subject is clear

## Output

Report:
- canonical page updated or created
- complete transcript or raw media attachments preserved, with completeness stated explicitly
- user-highlighted timestamps preserved, if any
- major themes captured
- whether follow-on enrichment is recommended
