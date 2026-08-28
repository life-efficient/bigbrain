---
name: bigbrain-ingest
description: Route new information into the narrowest BigBrain ingest workflow while preserving provenance and the correct source shape.
---

Route new information into the narrowest BigBrain ingest workflow and verify the resulting Brain state.

## Contract

This skill guarantees:
- Choose the narrowest fitting ingest subroute instead of using one generic path for everything.
- File new knowledge by primary subject, not by source or format.
- Read and follow the target Brain's filing rules before writing.
- Preserve raw supporting material according to those filing rules.
- Update an existing canonical page when one already exists.
- Re-sync the index after meaningful Brain changes.

## Routing Rules

Choose the first matching route:

1. RSS item, web article, blog post, essay, or canonical web source:
   - use `bigbrain-source-article-ingest`
2. Specific meeting transcript, call notes, or post-meeting summary:
   - use `BigBrain: Meeting Ingest`
3. PDF, deck, memo, screenshot, or exported notes:
   - use `BigBrain: Document Ingest`
4. Audio, video, podcast, or mixed-media input:
   - use `BigBrain: Media Ingest`
5. Durable knowledge said directly in chat:
   - use `BigBrain: Conversation Ingest`
6. If multiple routes apply:
   - prefer the highest-signal source
   - preserve all raw inputs according to the target Brain's filing rules

## Shared Ingest Rules

- Before any MCP or service-backed write, call `filing_rules` and use the paths and tools it specifies.
- Check whether the target page already exists before creating a new one.
- Apply the digest-value test before preserving a source or creating a page.
- Use `.raw/` and raw-file tools when the filing rules require raw source preservation there.
- Use `.artifacts/` only when the target Brain's filing rules or directly accessed folder structure explicitly call for artifacts.
- Prefer updating compiled truth above the separator and appending evidence below it.
- Run `bigbrain sync --json` after the write path completes.
- Report no-op, hold, draft, and completed outcomes distinctly.

## Guardrails

- Do not create duplicate pages when a canonical page already exists.
- Do not file raw attachments directly inside entity directories.
- Do not assume a generic raw-material folder when a Brain publishes filing rules.
- Do not dump raw source text into canonical pages when an artifact is the right container.
- Do not store irrelevant source material merely because it came from a trusted feed.
- Do not create a new specialized route on the fly when one of the existing subroutes already fits.

## Output

Report the chosen ingest route, relevance decision, canonical pages updated or created, raw files or artifacts preserved, linked entities, read-back status, sync status, and any follow-on enrichment recommendation.
