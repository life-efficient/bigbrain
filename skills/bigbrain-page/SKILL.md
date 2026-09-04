---
name: bigbrain-page
description: Create or update one ordinary BigBrain page from durable evidence.
---

Create or update one ordinary BigBrain page from durable evidence.

## Contract Checklist

- Standard ordinary pages use YAML frontmatter, a title, current content, one writer-managed `---` followed by `## Timeline`, and an append-only evidence timeline.
- Keep one canonical page for one primary subject. Use the filing rules and canonical folder for placement, frontmatter for mutable state and provenance, and inline links for relevant related subjects.
- Make the page the best standalone 80/20 rundown of its subject: if the reader could read only this page about the subject, they should understand what the subject is, why it matters, its current state, important context, boundaries, material relationships, and meaningful uncertainty.
- The compiled-truth paragraph is the core understanding of the page: if the reader had only one paragraph, this is what they should read. It may be longer than a one-liner when needed. Additional current-context sections may follow it before the separator.
- Existing owner -> update; no owner with sufficient evidence -> create; ambiguity or weak evidence -> stop; no material change -> no-op.
- Use the selected Brain's relevant MCP endpoint with the endpoint schema as the authority for inputs, required provenance, and significance. The writer manages Markdown framing and `## Timeline`.
- Write each timeline entry as a concise, subject-first summary of the durable page change. Page updates are already authored and attributable through the page operation and provenance, so do not lead with the current user's name or repeat an implicit approval such as `Harry approved ...`.
- Keep source wording and approval context in `provenance.source_message`; retain a person's name in the visible timeline only when the actor's identity materially changes the meaning.
- Preserve specialized task, meeting, and source-sidecar shapes in their own workflows.

## Workflow

1. Find which Brain owns the page and where the page belongs. Resolve the subject, filing rules, canonical folder and path, and any existing canonical owner. Read the existing page before updating it.
   - Anti-patterns: memory-only routing, fuzzy-first ownership, duplicate pages.

2. Use the selected Brain's relevant MCP to create or update the page.
   - Use the `create_page` or `update_page` endpoint that matches the ownership decision, and follow its input schema.
   - Update the compiled-truth paragraph if necessary. Keep it as the one-paragraph core understanding of the subject, then update any current-context content that the evidence requires.
   - Keep the page subject-focused, explain important context and relationships in natural prose, use inline links where relevant, and separate current understanding from timeline evidence. Treat evidence and scope boundaries as contextual prose and links by default; do not add generic `## Evidence` or `## Boundaries` headings unless the subject genuinely requires one.
   - Record the evidence-backed timeline entry using the endpoint's required provenance and significance fields. Prefer `Added X after approval` or `Updated Y with Z` over `Harry approved adding X` or `Harry updated Y`.
   - Anti-patterns: source dumps, invented links, taxonomy commentary, direct filesystem writes, sending `---` or `## Timeline`, copying a linked subject's full account.

3. Read the page back and verify the result.
   - Confirm the Brain and path, frontmatter, title, compiled truth, current content, single separator, timeline entry, provenance, links, and page health.
   - Do not trust the write response alone. If the read-back shows no material change was needed, leave the page untouched.
   - Anti-patterns: skipping read-back, accepting the wrong owner or path, duplicate separators or timelines, missing evidence, declaring success from the write response alone.

## Anti-Patterns

- Do not create duplicates, weak stubs, or a page-system explanation.
- Do not use the canonical page as a source transcript or as the full account of a linked subject.

## Output

Report the destination Brain, page path, create/update/no-op result, evidence, links, read-back, and uncertainty.
