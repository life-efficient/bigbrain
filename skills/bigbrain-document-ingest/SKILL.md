---
name: "BigBrain: Document Ingest"
version: 1.0.0
description: |
  Ingest document-like material into BigBrain. Use when the source is a PDF,
  deck, memo, article text, screenshot, or another document that should produce
  a canonical page plus preserved raw support.
triggers:
  - "document ingest"
  - "ingest this PDF"
  - "ingest this deck"
  - "ingest this memo"
  - "save this document"
tools:
  - shell
mutating: true
---

# BigBrain: Document Ingest

Use this skill when the input is document-first rather than meeting-first or
conversation-first.

## Contract

This skill guarantees:
- File the durable knowledge by primary subject rather than document format
- Preserve the raw input under the `.raw/` path specified by `filing_rules` when the original document matters
- Avoid treating raw source material as if it were already a polished canonical page
- Prefer updating an existing page when the document adds to an established topic
- Re-sync the index after the write path completes

## Workflow

1. Classify the primary subject of the document:
   - company, person, project, concept, deal, writing artifact, or source material
2. Decide the canonical destination:
   - durable page under the appropriate directory
   - `sources/` only when the item is truly a raw import without a clearer primary subject
3. Extract and summarize the document at the right level:
   - executive summary
   - key facts or sections
   - notable open threads or implications
4. Preserve the original file when useful:
   - store it under `<collection>/.raw/<page-slug>/`
   - call `filing_rules` first when using an MCP or remote brain connector
   - link the canonical page to the raw attachment
5. Update or create the canonical page
6. Re-index:
   - `bigbrain sync --json`

## Guardrails

- Do not file by format alone
- Do not put PDFs or decks directly into entity directories
- Do not collapse a rich subject page into a document dump
- Do not use `sources/` as the default when a clearer canonical page exists

## Output

Report:
- canonical page updated or created
- why that filing decision was chosen
- whether a raw attachment was preserved
- whether sync completed
