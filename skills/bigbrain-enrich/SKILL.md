---
name: bigbrain-enrich
description: Update or create a grounded BigBrain entity or topic page when new signal materially changes its durable understanding, or when an existing thin page needs enrichment. Use after ingestion or for a requested page enrichment; use bigbrain-search for read-only questions and bigbrain-page for a direct ordinary page write.
---

# BigBrain: Enrich

Deepen a canonical entity or topic page when new evidence materially improves its understanding.

## Contract Checklist

This skill guarantees:
- Prefer updating existing canonical pages over creating duplicates
- Route canonical page creation and updates through `$bigbrain-page`
- Rewrite compiled truth when the understanding changed materially
- Keep each canonical page locally comprehensible as a useful 80-20 briefing without turning it into a competing full account of linked subjects or sources
- Use links for deeper detail, adjacent subjects, and related records; links are relationships, not necessarily a hierarchy.
- Keep the overall understanding of each subject on its canonical page. Mention linked subjects in context without copying their full account, and leave source-specific detail on meeting, source, or attachment pages.
- Keep the page grounded in actual retrieved or provided source material
- Keep enrichment proportional to the value of the entity or topic
- Treat indexed `.raw/*.md` attachment sidecars as document-specific brain pages: enrich them with comprehensive extraction and source-specific synthesis while keeping cross-document compiled belief on subject pages
- Stop cleanly when the next step requires more source material than is available

## Workflow

1. Resolve the target page:
   - `bigbrain search "<name>" --json`
   - `bigbrain get <slug>` when the canonical page is known
   - Anti-patterns: duplicate owners, routing from memory alone.
2. Determine whether enrichment is warranted:
   - material new fact
   - clearer summary now possible
   - page is too thin for a notable entity
   - Anti-patterns: enrichment without durable signal, generic padding.
3. Update the page in place when possible:
   - Use `$bigbrain-page` for the canonical page-writing and verification path.
   - improve the executive summary or compiled truth
   - add or refine open threads when the signal supports them
   - keep timeline or evidence append-only where relevant
   - For material deal-task progress, apply [Deal and Task Consistency](../bigbrain-page/SKILL.md#deal-and-task-consistency): reconcile the deal briefing and affected task within authorization, read back both, and report partial reconciliation if either cannot be verified.
   - Anti-patterns: timeline-only progress, contradictory linked state, treating metadata edits as substantive freshness.
4. Create a new page only when:
   - the entity or concept is notable enough to track
   - no canonical page already exists
   - the available source material is enough to avoid a useless stub
   - use `$bigbrain-page` for the canonical page-writing and verification path
   - Anti-patterns: incidental stubs, invented supporting evidence.
5. Re-index:
   - `bigbrain sync --json`
   - Anti-patterns: claiming verified content from sync alone, resending completed communications to repair logging.

## Anti-Patterns

- Do not create stubs with no meaningful durable content
- Do not overwrite a strong page with weaker generic wording
- Do not invent facts or relationship context
- Do not expand scope from one entity into a broad research project unless the user asked for that
- Never move an attachment sidecar outside `.raw/` to make it searchable; sidecars are indexed in place

## Output

Report:
- target page updated or created
- what materially changed
- whether the enrichment was source-limited
- whether sync completed
