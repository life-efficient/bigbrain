---
name: "BigBrain: Ingest"
version: 1.0.0
description: |
  Route new material into BigBrain. Use when the user wants to save something
  to the brain, process a meeting, ingest a document, capture a conversation
  insight, or preserve media with the right page and artifact shape.
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
- Preserve raw supporting material under `.artifacts/` when applicable
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
   - preserve all raw inputs as artifacts or source notes

## Shared Ingest Rules

- Check whether the target page already exists before creating a new one
- Use one canonical page for the enduring knowledge
- Use `.artifacts/` for transcript dumps, decks, PDFs, images, audio, and generated outputs
- Prefer updating compiled truth above the separator and appending evidence below it
- Run `bigbrain sync --json` after the write path completes

## Guardrails

- Do not create duplicate pages when a canonical page already exists
- Do not file raw attachments directly inside entity directories
- Do not dump raw source text into canonical pages when an artifact is the right container
- Do not create a new specialized route on the fly when one of the existing subroutes already fits

## Output

Report:
- chosen ingest route
- canonical page updated or created
- artifacts preserved, if any
- whether sync completed
- whether follow-on enrichment is recommended
