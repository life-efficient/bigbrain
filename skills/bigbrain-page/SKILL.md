---
name: bigbrain-page
description: Create or update one ordinary BigBrain page from durable evidence.
---

Create or update one ordinary BigBrain page from durable evidence.

## Contract Checklist

- Standard ordinary pages use YAML frontmatter, a title, current content, one writer-managed `---` followed by `## Timeline`, and an append-only evidence timeline.
- Keep one canonical page for one primary subject. Use the filing rules and canonical folder for placement, frontmatter for mutable state and provenance, and inline links for relevant related subjects.
- Create an entity page only when the entity has durable standalone value: it is a key organization, person, product, framework, deal, or location in the user's active work; needs its own evolving context; or connects multiple material pages. A passing mention alone is not enough.
- Create a top-level `deals/` page only for one independently evolving actual transaction, raise, investment, mandate, acquisition, or commercial opportunity. Keep meeting prep on the canonical meeting page, and keep VDR inventories, diligence packs, teasers, models, and other deal evidence as `deals/.raw/` sidecars linked from that deal.
- Keep incidental places, countries, planets, broad everyday concepts, and one-off named references in the owning page or article unless they meet that standalone-value test. Do not create sparse pages for obvious topics such as Earth or Mars merely because they were named.
- Make the page the best standalone 80/20 rundown of its subject: if the reader could read only this page about the subject, they should understand what the subject is, why it matters, its current state, important context, boundaries, material relationships, and meaningful uncertainty.
- The compiled-truth paragraph is the core understanding of the page: if the reader had only one paragraph, this is what they should read. It may be longer than a one-liner when needed. Additional current-context sections may follow it before the separator.
- The current body is a synthesized subject briefing, not an accumulation of dated updates. Integrate new evidence by topic, reconcile contradictions, replace or qualify superseded claims, and preserve useful current technical and commercial details. Put change chronology in the writer-managed timeline and meeting-specific detail in the linked source meeting. Dates belong in current prose only when they define a material fact, deadline, freshness, or uncertainty.
- Existing owner -> update; no owner with sufficient evidence -> create; ambiguity or weak evidence -> stop; no material change -> no-op.
- Use the selected Brain's relevant MCP endpoint with the endpoint schema as the authority for inputs, required provenance, and significance. The writer manages Markdown framing and `## Timeline`.
- Write each timeline entry as a concise, subject-first summary of the durable page change. Page updates are already authored and attributable through the page operation and provenance, so do not lead with the current user's name or repeat an implicit approval such as `Harry approved ...`.
- Keep source wording and approval context in `provenance.source_message`; retain a person's name in the visible timeline only when the actor's identity materially changes the meaning.
- Preserve specialized task, meeting, and source-sidecar shapes in their own workflows.

## Workflow

1. Find which Brain owns the page and where the page belongs. Resolve the subject, filing rules, canonical folder and path, and any existing canonical owner. Read the existing page before updating it.
   - For a candidate deal, decide whether the evidence establishes an actual deal or only meeting prep, discussion context, or a source artifact. Search deal names, counterparties, and aliases before creating a page. Set `deal_involvement` from recorded evidence on every new actual deal page.
   - Anti-patterns: memory-only routing, fuzzy-first ownership, duplicate pages.

2. Use the selected Brain's relevant MCP to create or update the page.
   - Use the `create_page` or `update_page` endpoint that matches the ownership decision, and follow its input schema.
   - Update the compiled-truth paragraph if necessary. Keep it as the one-paragraph core understanding of the subject, then update any current-context content that the evidence requires.
   - Keep the page subject-focused, explain important context and relationships in natural prose, use inline links where relevant, and separate current understanding from timeline evidence. Treat evidence and scope boundaries as contextual prose and links by default; do not add generic `## Evidence` or `## Boundaries` headings unless the subject genuinely requires one.
   - Reconcile the entire current body before writing: consolidate dated update sections into the appropriate subject sections and retire superseded statements. Do not preserve an obsolete assertion as current merely because it appeared in an earlier body. Keep materially relevant history as brief context with attribution.
   - Record the evidence-backed timeline entry using the endpoint's required provenance and significance fields. Prefer `Added X after approval` or `Updated Y with Z` over `Harry approved adding X` or `Harry updated Y`.
   - Anti-patterns: source dumps, incidental entity stubs, invented links, taxonomy commentary, direct filesystem writes, sending `---` or `## Timeline`, copying a linked subject's full account.

3. Read the page back and verify the result.
   - Confirm the Brain and path, frontmatter, title, compiled truth, current content, single separator, timeline entry, provenance, links, and page health.
   - Read the body without its timeline: the reader must understand the current subject without reconstructing a sequence of updates. Verify useful technical detail, attribution, and unresolved uncertainty survived consolidation.
   - Do not trust the write response alone. If the read-back shows no material change was needed, leave the page untouched.
   - Anti-patterns: skipping read-back, accepting the wrong owner or path, duplicate separators or timelines, missing evidence, declaring success from the write response alone.

## Anti-Patterns

- Do not create duplicates, weak stubs, incidental entity pages, or a page-system explanation. A confidently identified entity with sparse, attributable source context is sufficient only when it passes the standalone-value test; unsupported identity or invented details are weak evidence. Do not pad a page to fill the briefing topics.
- Do not append date-stamped Update or Meeting update sections to an ordinary canonical body, retain contradictory old states as current, or replace a substantive briefing with a vague summary.
- Do not use the canonical page as a source transcript or as the full account of a linked subject.
- Do not create top-level deal pages for meeting prep, meeting records, VDR inventories, diligence checklists, teasers, or models.

## Output

Report the destination Brain, page path, create/update/no-op result, evidence, links, read-back, and uncertainty.
