---
name: "BigBrain: Conversation Ingest"
version: 1.0.0
description: |
  Capture durable knowledge from ordinary chat into BigBrain. Use when the user
  says something in conversation that should update a page, create a note, or
  preserve a preference, decision, relationship detail, or original idea.
triggers:
  - "capture this conversation"
  - "save what I just said"
  - "put this in BigBrain"
  - "remember this"
  - "conversation ingest"
tools:
  - shell
mutating: true
---

# BigBrain: Conversation Ingest

Use this skill when the source is the conversation itself. It is for durable
signal, not for every operational message.

## Contract

This skill guarantees:
- Capture only durable knowledge worth preserving
- Prefer updating an existing canonical page over creating a new one
- Use `tasks/` for actionable work, and use `protocol/`, `projects/`, `ideas/`, `concepts/`, `writing/`, entity pages, or owning collection `.raw/` files based on the substance of durable non-task material
- Avoid polluting the brain with purely procedural chatter
- Re-sync the index after a meaningful write

## What counts as durable signal

- preferences or operating rules
- relationship context about a person or organization
- new facts that materially change a page
- decisions, roadmap direction, or explicit open threads
- the user's original ideas, theses, or frameworks

## Workflow

1. Distinguish durable signal from procedural chatter
2. Classify the target:
   - person or organization page
   - project page
   - concept page
   - `protocol/`
   - `tasks/` when the message is actionable work or a follow-up
   - owning collection `.raw/` folders for evidence files
   - `inbox/`, `sources/`, or `ops/` only when the active brain's filing rules define them as legacy or domain overlays
3. Update or create the canonical page
4. Keep the update compact and source-aware
5. Re-index:
   - `bigbrain sync --json`

## Guardrails

- Do not ingest every message just because it exists
- Do not create a new page when a small update to an existing page is enough
- Do not bury user preferences in generic notes when `protocol/` is the right home
- Do not over-formalize half-formed chatter into false certainty

## Output

Report:
- whether the message was durable enough to ingest
- target page updated or created
- why that destination was chosen
- whether sync completed
