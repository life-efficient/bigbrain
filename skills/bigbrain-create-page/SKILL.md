---
name: bigbrain-create-page
description: Create one new BigBrain page when a distinct subject has enough durable evidence for a useful record.
---

Create one new BigBrain page after resolving its owner, evidence, and page shape.

## Contract Checklist

- Read live filing rules and search for an existing canonical owner first.
- Read `../_shared/canonical-page-one-pager-standard.md` before writing an ordinary subject page.
- Use the selected Brain's MCP `create_page` tool and read the result back.
- Keep specialized tasks, meetings, and source sidecars on their required shapes.

## Workflow

1. Resolve:
   - Classify the primary subject, read filing rules, and search exact names, aliases, and identifiers.
   - Existing owner -> `$bigbrain-update-page`; ambiguity -> stop and report candidates.
   - Anti-patterns: memory-only routing, fuzzy-first updates, duplicate pages.

2. Draft:
   - Use verified evidence to write the subject-focused body and add only contextual inline links.
   - Stop if evidence supports only a stub; keep source-specific detail in its sidecar.
   - Anti-patterns: generic filler, source dumps, link inventories, taxonomy commentary.

3. Create and verify:
   - Call `create_page` with title, body, provenance, timeline entry, significance, and applicable domains.
   - Read back the path, body, links, timeline, and health result through the same Brain.
   - Anti-patterns: direct filesystem writes, missing provenance, trusting the write response alone.

## Anti-Patterns

- Create no page from a passing mention or unverified inference.
- Do not reproduce a linked subject's full account.
- Do not put page-system commentary in subject prose.

## Output

Report the destination Brain, created page, evidence, links, read-back, and uncertainty.
