---
name: "BigBrain: Ingest"
version: 1.0.0
description: |
  Route new material into BigBrain. Use when the user wants to save something
  to the brain, process a meeting, ingest a document, capture a conversation
  insight, or preserve media with the right page and raw/source shape.
triggers:
  - "ingest this"
  - "save this to BigBrain"
  - "put this in the brain"
  - "process this meeting"
  - "ingest this document"
  - "capture this conversation"
tools:
  - shell
mutating: true
---

# BigBrain: Ingest

Use this skill as the router for new information entering BigBrain. It decides
which ingest path applies, preserves provenance, and keeps filing decisions
aligned with the BigBrain model.

## Contract

This skill guarantees:
- Choose the narrowest fitting ingest subroute instead of using one generic path for everything
- File new knowledge by primary subject, not by source or format
- Read and follow the target brain's filing rules before writing through MCP or another remote brain interface
- Preserve raw supporting material according to those filing rules
- Update an existing canonical page when one already exists
- Re-sync the index after meaningful brain changes

## Routing Rules

Choose the first matching route:

1. Specific meeting transcript, call notes, or post-meeting summary:
   - use `BigBrain: Meeting Ingest`
2. PDF, deck, article text, memo, screenshot, or exported notes:
   - use `BigBrain: Document Ingest`
3. Audio, video, podcast, or mixed-media input:
   - use `BigBrain: Media Ingest`
4. Durable knowledge said directly in chat:
   - use `BigBrain: Conversation Ingest`
5. If multiple routes apply:
   - prefer the highest-signal source
   - preserve all raw inputs according to the target brain's filing rules

## Shared Ingest Rules

- Before any MCP or remote brain write, call `filing_rules` and use the paths and tools it specifies
- Check whether the target page already exists before creating a new one
- Use one canonical page for the enduring knowledge
- Use `.raw/` and raw-file tools when the filing rules require raw source preservation there
- Use `.artifacts/` only when the target brain's filing rules or local brain structure explicitly call for artifacts
- Prefer updating compiled truth above the separator and appending evidence below it
- Run `bigbrain sync --json` after the write path completes

## Guardrails

- Do not create duplicate pages when a canonical page already exists
- Do not file raw attachments directly inside entity directories
- Do not assume a generic raw-material folder when a brain publishes filing rules
- Do not dump raw source text into canonical pages when an artifact is the right container
- Do not create a new specialized route on the fly when one of the existing subroutes already fits

## Output

Report:
- chosen ingest route
- canonical page updated or created
- raw files or artifacts preserved, if any
- whether sync completed
- whether follow-on enrichment is recommended
