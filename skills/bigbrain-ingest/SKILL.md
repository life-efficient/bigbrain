---
name: bigbrain-ingest
description: Save new information to BigBrain using the appropriate ingestion workflow. Use for general “ingest this” requests or mixed source types. Do not use for questions about existing Brain content or summaries that should not be saved.
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
   - Human-written email correspondence: use `bigbrain-email-ingest`; route newsletter articles by their published source instead.
   - Meetings to retrieve from Granola: use `bigbrain-granola-ingest`.
   - Specific meeting transcript, call notes, or post-meeting summary: use `BigBrain: Meeting Ingest`.
   - PDF, deck, memo, screenshot, or exported notes: use `BigBrain: Document Ingest`.
   - Audio, video, podcast, or mixed-media input: use `BigBrain: Media Ingest`.
   - Durable knowledge said directly in chat, including “remember this” requests: follow the conversation guidance below, the shared completeness checklist, and `$bigbrain-page` directly.
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

## Conversation guidance

For requests to save facts, decisions, preferences, relationship context, original ideas, or frameworks from the current conversation:

- Establish the requested scope and read its full available context, including corrections. Preserve durable knowledge without ingesting every message or routine operational chatter.
- Preserve the user's meaning, attribution, uncertainty, and conversation provenance. Do not turn tentative ideas or half-formed discussion into settled facts.
- Apply the shared completeness checklist and `$bigbrain-page` directly to canonical subjects and mentioned entities. Use live filing rules to select the owning collection; put preferences and operating rules in `protocol/` when appropriate rather than generic notes. Keep projects, concepts, ideas, writing, and entity knowledge in their subject homes.
- For actionable work or follow-ups, use `$bigbrain-action-review` before writing tasks. An idea or open thread does not by itself establish an accepted commitment.
- Retain evidence directly on the affected pages when appropriate; do not create a generic chat log or dump the raw conversation into canonical pages.
- Report whether the conversation contained durable knowledge, why the destinations were chosen, and the shared checklist's verified result, including any unresolved gaps.

## Anti-Patterns

- Do not create duplicate pages when a canonical page already exists.
- Do not file raw attachments directly inside entity directories.
- Do not assume a generic raw-material folder when a Brain publishes filing rules.
- Do not dump raw source text into canonical pages when an artifact is the right container.
- Do not store irrelevant source material merely because it came from a trusted feed.
- Do not create a new specialized route on the fly when one of the existing subroutes already fits.

## Output

Report the chosen ingest route and the shared checklist's completion result in concise prose. No structured decision output is required.
