---
name: bigbrain-page
description: Create or update one ordinary BigBrain page from durable evidence.
---

Create or update one ordinary BigBrain page from durable evidence.

## Contract Checklist

- Resolve the destination, read its filing rules, and search and read plausible canonical owners.
- Existing owner -> update; no owner with sufficient evidence -> create; ambiguity or weak evidence -> stop; no material change -> no-op.
- Treat `compiled_truth` as the complete current content above `---`, including the opening summary and any current-context sections. The writer manages Markdown framing and `## Timeline`.
- Use the selected Brain's `create_page` or `update_page` MCP tool with required provenance and significance, then read the result back.
- Preserve specialized task, meeting, and source-sidecar shapes in their own workflows.

## Workflow

1. Resolve the subject, destination, filing rules, owner, and canonical path. Read the chosen page before updating it.
   - Anti-patterns: memory-only routing, fuzzy-first ownership, duplicate pages.

2. Rewrite the compiled truth when necessary. Make the page complete enough to explain its subject on its own: what it is, why it matters, its current state, important context, boundaries, material relationships, and uncertainty. Keep every paragraph about the subject, use inline links when another subject is relevant, and separate durable understanding from timeline evidence. For regulated or fast-changing subjects, identify the authority, jurisdiction, effective date or rule version, and distinguish confirmed source text, interpretation, and unknowns. Use headings or other structure only when they improve clarity.
   - Anti-patterns: source dumps, note piles, invented links, taxonomy commentary, copying a linked subject's full account.

3. Create or update with `compiled_truth` above the separator and a separate evidence-backed timeline entry. Skip the write for a verified no-op, then read back the page, links, timeline, provenance, and health.
   - Anti-patterns: sending `---` or `## Timeline`, direct filesystem writes, missing provenance, trusting the write response alone.

## Anti-Patterns

- Do not create duplicates, weak stubs, or a page-system explanation.
- Do not use the canonical page as a source transcript or as the full account of a linked subject.

## Output

Report the destination Brain, page path, create/update/no-op result, evidence, links, read-back, and uncertainty.
