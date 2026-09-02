---
name: bigbrain-update-page
description: Update one existing BigBrain page when new evidence materially changes its durable understanding.
---

Update one existing BigBrain page coherently and preserve its history.

## Contract Checklist

- Resolve the active Brain, then read exactly one canonical owner through it.
- Read `../_shared/canonical-page-one-pager-standard.md` before rewriting an ordinary subject page.
- Treat no-op as valid: when there is no material change, do not call `update_page` or append a timeline entry.
- Use the selected Brain's MCP `update_page` tool with its required mutation metadata and read the result back.

## Workflow

1. Resolve and inspect:
   - Use an explicit verified path or search exact subject names, aliases, and identifiers.
   - Read plausible candidates directly and confirm the canonical path before drafting.
   - No owner -> `$bigbrain-create-page`; ambiguity -> stop and report candidates.
   - Read the current body, timeline, links, and relevant evidence; identify the material change.
   - Anti-patterns: first fuzzy match, stale memory, topical similarity.

2. Rewrite:
   - Keep the subject's identity and current context; incorporate new evidence and label uncertainty.
   - Send current truth only; omit `---` and `## Timeline`; apply the shared standard to current or regulated subjects.
   - Use natural inline links, keep source-specific detail in sidecars, and preserve timeline history.
   - Anti-patterns: note piles, broad fanout, source dumps, page-system commentary.

3. Update and verify:
   - Call `update_page` with path, replacement body, `commit_message`, provenance (`event_id`, `source_type`, `source_label`, `source_message`), timeline entry, `significance` (`patch`, `minor`, or `major`), and applicable domains.
   - Read back the body, resolved links, timeline, provenance, health, and duplicate state.
   - Anti-patterns: direct filesystem writes, deleting history, trusting the write response alone.

## Anti-Patterns

- Do not create duplicates.
- Do not treat every new source as a durable change.
- Do not replace compiled truth with a transcript.

## Output

Report the destination Brain, updated or no-op page, material change, evidence, read-back, and uncertainty.
