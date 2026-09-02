---
name: bigbrain-create-page
description: Create one new BigBrain page when a distinct subject has enough durable evidence for a useful record.
---

Create one new BigBrain page after resolving its owner, evidence, and page shape.

## Contract Checklist

- Resolve the active Brain and read its live identity and filing rules before filing.
- Search for an existing canonical owner and read plausible matches directly.
- Read `../_shared/canonical-page-one-pager-standard.md` before writing an ordinary subject page.
- Use the selected Brain's MCP `create_page` tool with its required mutation metadata, then read the result back.
- Keep specialized tasks, meetings, and source sidecars on their required shapes.

## Workflow

1. Resolve:
   - Classify the primary subject and search exact names, aliases, and identifiers.
   - Existing owner -> `$bigbrain-update-page`; ambiguity -> stop and report candidates.
   - Anti-patterns: memory-only routing, fuzzy-first ownership, duplicate pages.

2. Draft:
   - Use verified evidence to write the subject-focused body and add only contextual inline links.
   - Send current truth only; omit `---` and `## Timeline`; apply the shared standard to current or regulated subjects.
   - Stop if evidence supports only a stub; keep source-specific detail in its sidecar.
   - Anti-patterns: generic filler, source dumps, link inventories, taxonomy commentary.

3. Create and verify:
   - Call `create_page` with path, title, body, `commit_message`, provenance (`event_id`, `source_type`, `source_label`, `source_message`), timeline entry, `significance` (`patch`, `minor`, or `major`), and applicable domains.
   - Read back the path, body, resolved links, timeline, provenance, duplicate state, and health result through the same Brain.
   - Anti-patterns: direct filesystem writes, missing provenance, trusting the write response alone.

## Anti-Patterns

- Create no page from a passing mention or unverified inference.
- Do not reproduce a linked subject's full account.
- Do not put page-system commentary in subject prose.

## Output

Report the destination Brain, created page, evidence, links, read-back, and uncertainty.
