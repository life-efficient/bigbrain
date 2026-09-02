---
name: bigbrain-create-page
description: Create one new BigBrain page when a distinct subject has enough durable evidence for a useful record.
---

Create one new BigBrain page with the correct subject scope, source grounding, and page shape.

## Contract Checklist

- Read the selected Brain's live filing rules before choosing a path or page type.
- Read `../_shared/canonical-page-one-pager-standard.md` before drafting an ordinary canonical subject page.
- Resolve whether a canonical page already exists before creating anything.
- Create only one page for the primary subject and only when the available evidence supports a useful durable record.
- Keep the page locally comprehensible, current, source-aware, and focused on its subject.
- Use inline links only when another subject is relevant to the explanation.
- Keep task pages, meeting pages, and indexed attachment sidecars in their required specialized shapes.
- Write through the selected Brain's MCP tools, then read the result back through the same Brain.

## Workflow

1. Establish the destination and page type:
   - Resolve the selected Brain and call its live `filing_rules` capability.
   - Classify the primary subject as a concept, organization, person, product, component, deal, project, task, meeting, source, or another supported type.
   - Use an explicit user-provided path when it is authoritative; otherwise derive a stable path from the primary subject and filing rules.
   - Anti-patterns: choosing a path from memory, filing by source format alone, treating a related subject as the owner.

2. Check for existing coverage:
   - Search for the exact subject, aliases, stable identifiers, and close canonical matches.
   - Read plausible matches rather than creating from search snippets alone.
   - If one canonical page already owns the subject, stop and hand off to `$bigbrain-update-page`.
   - If identity or ownership is ambiguous, stop with the candidates and ask for clarification.
   - Anti-patterns: duplicate pages, semantic-search-only identity decisions, creating a page because a related page mentions the subject.

3. Gather and assess the evidence:
   - Use the user-provided or retrieved material that establishes the subject and its durable relevance.
   - Distinguish confirmed facts, source claims, estimates, proposals, interpretations, and unknowns.
   - Keep detailed source extraction in the appropriate meeting, source, or attachment sidecar when one exists.
   - Stop if the evidence supports only a stub or an unresolved possibility.
   - Anti-patterns: generic filler, invented context, promoting a passing mention into a canonical subject, copying a full source into the page.

4. Draft the page:
   - Apply the shared one-pager standard.
   - Explain the subject's identity, significance, current state, important context, boundaries, material relationships, and uncertainty in a coherent briefing.
   - Add natural inline Markdown links to verified related pages where they clarify the subject.
   - Do not include the page separator or `## Timeline` in the body sent to the MCP writer.
   - Anti-patterns: rigid template completion, link inventories, taxonomy narration, unrelated context, self-referential page language.

5. Create the page:
   - Call the selected Brain's `create_page` tool with the title, compiled-truth body, provenance, timeline entry, significance, and domains when applicable.
   - Preserve any specialized frontmatter required by the page type.
   - Do not bypass the owning Brain MCP with direct filesystem or database writes.
   - Anti-patterns: writing to a local Brain checkout, omitting provenance, omitting significance, including a second timeline boundary in the body.

6. Verify the result:
   - Read the created page through the same Brain MCP.
   - Confirm the path, title, body, links, timeline, provenance, and page health.
   - Report the page created, the evidence used, any deliberate non-creation, and any remaining uncertainty.
   - Anti-patterns: trusting the write response without read-back, claiming a link exists without verification, reporting a draft as a created page.

## Anti-Patterns

- Do not create a page merely because a name or concept was mentioned.
- Do not create a duplicate when a canonical page already exists.
- Do not turn a page into an explanation of BigBrain's taxonomy or graph.
- Do not add adjacent topics solely to create links.
- Do not create a weak stub when more evidence is required.
- Do not confuse an indexed source sidecar with the canonical understanding of its subject.

## Output

Report the destination Brain, page path and title, why creation was justified, key evidence used, linked pages, same-Brain read-back status, and any unresolved uncertainty.
