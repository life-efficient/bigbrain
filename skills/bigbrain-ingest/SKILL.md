---
name: bigbrain-ingest
description: Route new information into the narrowest BigBrain ingest workflow while preserving provenance and the correct source shape.
---

Route new information into the narrowest BigBrain ingest workflow and verify the resulting Brain state.

## Contract Checklist

This skill guarantees:
- Choose the narrowest fitting ingest subroute instead of using one generic path for everything.
- Read and follow [the shared ingestion completeness checklist](references/ingestion-completeness.md) before writing and again before declaring completion. It is the single owner of whole-source coverage, canonical entity creation and updates, links, and read-back requirements for all ingest routes.
- Route canonical page creation and updates through `$bigbrain-page`.
- Require each selected subskill to apply that same checklist, including when invoked directly.

## Workflow

1. Select the narrowest ingest route:
   - Verified Substack post or explicitly requested bounded Substack archive item: use `bigbrain-substack-ingest`.
   - RSS item, web article, blog post, essay, or other canonical web source: use `bigbrain-source-article-ingest`.
   - Specific meeting transcript, call notes, or post-meeting summary: use `BigBrain: Meeting Ingest`.
   - PDF, deck, memo, screenshot, or exported notes: use `BigBrain: Document Ingest`.
   - Audio, video, podcast, or mixed-media input: use `BigBrain: Media Ingest`.
   - Durable knowledge said directly in chat: use `BigBrain: Conversation Ingest`.
   - If multiple routes apply, prefer the highest-signal source and preserve all raw inputs according to the target Brain's filing rules.
   - Anti-patterns: using one generic route for everything, routing an article to document ingest when source-article ingest applies, inventing a route for a one-off input.

2. Apply shared filing controls:
   - Read `references/ingestion-completeness.md` before writing and execute it for every accepted source. Do not replace it with a shorter route-specific checklist.
   - Apply the selected route's relevance and retrieval rules first; the shared checklist does not require retaining rejected sources.
   - Keep source-specific handling in the subskill and use `$bigbrain-page` for canonical subject pages.
   - Anti-patterns: treating source preservation as complete ingestion, skipping secondary entities, duplicating the shared rules in individual routes.

3. Verify and report the result:
   - Recheck the shared checklist against saved Brain state, including entity coverage and source links.
   - Report no-op, hold, draft, incomplete, and completed outcomes distinctly, with any remaining gaps.
   - Anti-patterns: reporting a plan as completion, omitting no-op rationale, claiming a link or page exists without read-back.

## Anti-Patterns

- Do not create duplicate pages when a canonical page already exists.
- Do not file raw attachments directly inside entity directories.
- Do not assume a generic raw-material folder when a Brain publishes filing rules.
- Do not dump raw source text into canonical pages when an artifact is the right container.
- Do not store irrelevant source material merely because it came from a trusted feed.
- Do not create a new specialized route on the fly when one of the existing subroutes already fits.

## Output

Report the chosen ingest route and the shared checklist's completion result in concise prose. No structured decision output is required.
