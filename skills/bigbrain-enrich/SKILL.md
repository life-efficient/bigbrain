---
name: "BigBrain: Enrich"
version: 1.0.0
description: |
  Update or create BigBrain pages for people, organizations, projects, or concepts
  when new signal materially changes what the brain should know. Use after
  ingest or when a thin page needs a higher-quality durable summary.
triggers:
  - "enrich this page"
  - "update this person page"
  - "update this organization page"
  - "create a page for this person"
  - "create a page for this organization"
tools:
  - shell
mutating: true
---

# BigBrain: Enrich

Use this skill to deepen an entity or topic page after new signal arrives.
Enrichment should make the page better, not noisier.

## Contract

This skill guarantees:
- Prefer updating existing canonical pages over creating duplicates
- Rewrite compiled truth when the understanding changed materially
- Keep the page grounded in actual retrieved or provided source material
- Keep enrichment proportional to the value of the entity or topic
- Stop cleanly when the next step requires more source material than is available

## Workflow

1. Resolve the target page:
   - `bigbrain search "<name>" --json`
   - `bigbrain get <slug>` when the canonical page is known
2. Determine whether enrichment is warranted:
   - material new fact
   - clearer summary now possible
   - page is too thin for a notable entity
3. Update the page in place when possible:
   - improve the executive summary or compiled truth
   - add or refine open threads when the signal supports them
   - keep timeline or evidence append-only where relevant
4. Create a new page only when:
   - the entity or concept is notable enough to track
   - no canonical page already exists
   - the available source material is enough to avoid a useless stub
5. Re-index:
   - `bigbrain sync --json`

## Guardrails

- Do not create stubs with no meaningful durable content
- Do not overwrite a strong page with weaker generic wording
- Do not invent facts or relationship context
- Do not expand scope from one entity into a broad research project unless the user asked for that

## Output

Report:
- target page updated or created
- what materially changed
- whether the enrichment was source-limited
- whether sync completed
