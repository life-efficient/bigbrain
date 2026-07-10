---
name: "BigBrain: Document Ingest"
version: 1.0.0
description: |
  Ingest document-like material into BigBrain. Use when the source is a PDF,
  deck, memo, article text, screenshot, or another document that should produce
  an indexed attachment sidecar plus preserved raw support and subject updates.
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
- Preserve the raw input and its same-basename indexed sidecar under the `.raw/` path specified by `filing_rules`
- Keep document-specific comprehensive extraction on the sidecar and compiled cross-document belief on subject pages
- Prefer updating an existing page when the document adds to an established topic
- Re-sync the index after the write path completes

## Workflow

1. Classify the primary subject of the document:
   - organization, person, project, concept, deal, writing artifact, protocol, or supporting evidence
2. Decide the owner collection and subject pages:
   - the raw binary and deterministic same-basename sidecar go under the owning collection `.raw/` folder
   - existing durable subject pages are updated when the document changes compiled understanding
3. Extract and summarize the document at the right level:
   - executive summary
   - key facts or sections
   - notable open threads or implications
4. Preserve the original file and searchable representation:
   - store it under `<collection>/.raw/<filename>`
   - create `<collection>/.raw/<basename>.md` with comprehensive extraction, summary, provenance, and links
   - call `filing_rules` first when using an MCP or remote brain connector
   - link relevant subject pages to the sidecar and raw attachment
5. Update or create subject pages only when the document changes durable compiled understanding
6. Re-index:
   - `bigbrain sync --json`

## Guardrails

- Do not file by format alone
- Do not put PDFs or decks directly into entity directories
- Do not collapse a rich subject page into a document dump
- Do not place a document sidecar outside `.raw/` to make it searchable; sidecars are indexed in place
- Do not use `sources/` as the default when a clearer canonical page exists

## Output

Report:
- canonical page updated or created
- why that filing decision was chosen
- whether a raw attachment was preserved
- whether sync completed
