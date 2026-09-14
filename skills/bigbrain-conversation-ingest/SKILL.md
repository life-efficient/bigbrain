---
name: bigbrain-conversation-ingest
description: Capture durable knowledge from chat into BigBrain when the user asks to save or remember a preference, decision, relationship detail, original idea, or other substantive conversation content.
---

# BigBrain: Conversation Ingest

Capture durable conversation content and reconcile its supported knowledge into canonical BigBrain pages.

## Contract Checklist

- Read and follow [the shared ingestion completeness checklist](../bigbrain-ingest/references/ingestion-completeness.md) before any Brain write, including when this skill is invoked directly. Complete that checklist before declaring ingestion complete.
- Capture only durable knowledge worth preserving
- Prefer updating an existing canonical page over creating a new one
- Route canonical page creation and updates through `$bigbrain-page`
- Use `tasks/` for actionable work, and use `protocol/`, `projects/`, `ideas/`, `concepts/`, `writing/`, entity pages, or owning collection `.raw/` files based on the substance of durable non-task material
- Avoid polluting the brain with purely procedural chatter
- Verify canonical changes through the owning Brain's MCP

## What counts as durable signal

- preferences or operating rules
- relationship context about a person or organization
- new facts that materially change a page
- decisions, roadmap direction, or explicit open threads
- the user's original ideas, theses, or frameworks

## Workflow

1. Distinguish durable signal from procedural chatter:
   - Read the shared ingestion completeness checklist linked above, even on direct invocation.
   - Establish the requested conversation scope, read its full available context, and preserve durable signal without ingesting routine operational chatter.
   - Anti-patterns: ingesting every message, interpreting a correction without its context, silently expanding the conversation scope
2. Classify the target:
   - Resolve the owning Brain and read live filing rules before choosing canonical paths or writing.
   - person or organization page
   - project page
   - concept page
   - `protocol/`
   - `tasks/` when the message is actionable work or a follow-up
   - owning collection `.raw/` folders for evidence files
   - `inbox/`, `sources/`, or `ops/` only when the active brain's filing rules define them as legacy or domain overlays
   - Anti-patterns: generic note dumping, filing by message format, choosing paths before live filing rules
3. Route the canonical page write:
   - Apply the shared checklist to subjects and identifiable entities in the accepted conversation content, including entities outside its primary topic.
   - Use `$bigbrain-page` for both creation and updates; let its owner check choose the operation.
   - Anti-patterns: duplicate entity pages, skipping secondary entities, creating unnecessary updates to already-covered facts
4. Keep the update compact and source-aware:
   - Preserve the user's meaning, attribution, uncertainty, and relevant conversation provenance in the appropriate canonical pages.
   - Anti-patterns: turning tentative ideas into facts, inventing biographical details, raw conversation dumps
5. Verify completion:
   - Complete the shared checklist and independently read back all affected pages and source links through the owning Brain's MCP.
   - Rely on the owning MCP's automatic propagation and backup; do not add manual sync or maintenance after a successful write and read-back.
   - Anti-patterns: trusting a write response as completion, broken canonical links, reporting unresolved coverage as complete

## Anti-Patterns

- Do not ingest every message just because it exists
- Do not create a new page when a small update to an existing page is enough
- Do not bury user preferences in generic notes when `protocol/` is the right home
- Do not over-formalize half-formed chatter into false certainty

## Output

Briefly state whether the conversation contained durable knowledge worth preserving, which canonical pages were created, updated, or linked as already covered, why those destinations were chosen, and whether read-back verified completion. Mention unresolved coverage gaps directly without requiring a fixed output schema.
