---
name: bigbrain-document-ingest
description: Save information from a PDF, presentation, memo, screenshot, or other document to BigBrain. Use when the document itself is the supplied source. For meeting notes or a published article available at a supplied URL, use the corresponding ingestion skill.
---

# BigBrain: Document Ingest

Preserve a document and reconcile its supported knowledge into canonical BigBrain pages.

## Contract Checklist

- Read and follow [the shared ingestion completeness checklist](../bigbrain-ingest/references/ingestion-completeness.md) before any Brain write, including when this skill is invoked directly. Complete that checklist before declaring ingestion complete.
- File the durable knowledge by primary subject rather than document format
- Preserve the raw input and its same-basename indexed sidecar under the `.raw/` path specified by `filing_rules`
- Keep document-specific comprehensive extraction on the sidecar and compiled cross-document belief on subject pages
- Route canonical subject-page creation and updates through `$bigbrain-page`
- Verify source artifacts and canonical changes through the owning Brain's MCP

## Workflow

1. Classify the primary subject of the document:
   - Read the shared ingestion completeness checklist linked above, even on direct invocation.
   - organization, person, project, concept, deal, writing artifact, protocol, or supporting evidence
   - Anti-patterns: filing by format, skipping the shared checklist
2. Decide the owner collection and subject pages:
   - Read the owning Brain's live `filing_rules` before choosing paths or making any write.
   - the raw binary and deterministic same-basename sidecar go under the owning collection `.raw/` folder
   - Use the shared checklist to resolve existing canonical subjects and entities before planning new pages.
   - Anti-patterns: choosing paths before live filing rules, duplicating canonical subjects
3. Extract and summarize the document at the right level:
   - Read the complete available document and state any missing or unreadable coverage.
   - executive summary
   - key facts or sections
   - notable open threads or implications
   - Anti-patterns: excerpt-only review, omitting secondary entities, treating claims as verified facts
4. Preserve the original file and searchable representation:
   - store it under `<collection>/.raw/<filename>`
   - create `<collection>/.raw/<basename>.md` with comprehensive extraction, summary, provenance, and links
   - link relevant subject pages to the sidecar and raw attachment
   - Anti-patterns: orphan raw files, incomplete source extraction, generic document logs
5. Reconcile canonical coverage under the shared checklist:
   - Use `$bigbrain-page` for an existing or new canonical subject page; let its owner check choose the operation.
   - Keep the document-specific sidecar on its own specialized source shape.
   - Anti-patterns: skipping mentioned entities, manufacturing updates for already-covered facts, copying the sidecar into subject pages
6. Verify completion:
   - Complete the shared checklist and independently read back the raw artifact, sidecar, and affected canonical pages through the owning Brain's MCP.
   - Rely on the owning MCP's automatic propagation and backup; do not add manual sync or maintenance after a successful write and read-back.
   - Anti-patterns: trusting a write response as completion, broken source links, unverified artifacts

## Anti-Patterns

- Do not file by format alone
- Do not put PDFs or decks directly into entity directories
- Do not collapse a rich subject page into a document dump
- Do not place a document sidecar outside `.raw/` to make it searchable; sidecars are indexed in place
- Do not use `sources/` as the default when a clearer canonical page exists

## Output

Briefly report the canonical pages created, updated, or linked as already covered, why the destination was chosen, preserved raw support, verified read-back, and any unresolved coverage gaps. Do not repeat the internal checklist or require a fixed output schema.
