---
name: "BigBrain: Understand"
version: 1.0.0
description: |
  Explain how BigBrain is structured and how to use it. Use when the user asks
  where something belongs, what page shape to use, how raw attachments work, how
  meetings should be modeled, or which BigBrain skill should handle a task.
triggers:
  - "understand BigBrain"
  - "how does BigBrain work"
  - "where should this go"
  - "what page shape should I use"
  - "how should this be filed"
  - "which BigBrain skill should I use"
tools:
  - shell
mutating: false
---

# BigBrain: Understand

Use this skill as the orientation layer for BigBrain. It explains the model,
the folder structure, the page shapes, the raw attachment rules, and the next skill
to use.

## Contract

This skill guarantees:
- Explain the BigBrain brain-home model before giving advice
- Ground filing and page-shape advice in the live BigBrain schema
- Distinguish subject pages, indexed attachment sidecars, and raw binaries
- Distinguish meetings from generic entity pages
- Route the user to a more specific BigBrain skill when one clearly applies

## Workflow

1. Start from the built-in schema:
   - `bigbrain schema`
2. If the question is about filing or page shape, explain:
   - canonical directories such as `people/`, `organizations/`, `deals/`, `projects/`, `ideas/`, `meetings/`, `tasks/`, `concepts/`, `writing/`, `protocol/`, and `archive/`
  - `tasks/` as the default home for actionable work and follow-ups
  - owning collection `.raw/` folders as the default home for raw/rendered evidence
  - `inbox/`, `sources/`, and `ops/` as legacy or domain overlays, not generic default destinations
  - per-collection `.raw/` folders containing raw files and their same-basename indexed Markdown sidecars
   - `filing_rules` as the operational source of truth for the active brain
3. If the question is about a specific item, classify it by primary subject:
   - person -> `people/`
   - organization, company, institution, vendor, fund, or partner -> `organizations/`
   - deal or financing item -> `deals/`
   - active build track -> `projects/`
   - reusable framework -> `concepts/`
   - repeatable process, operating rule, or personal/organizational preference -> `protocol/`
   - specific meeting or call -> `meetings/`
   - actionable item or follow-up -> `tasks/`
   - unclear evidence-first material -> the owning collection `.raw/` folder once ownership is clear; otherwise `writing/` or a brain-specific source overlay if filing rules define one
   - non-actionable unresolved legacy material -> avoid by default; use `inbox/` only when the active brain's filing rules explicitly preserve it
4. If the question is about workflow, route to the best skill:
   - lookup or context -> `BigBrain: Query`
   - setup or migration -> `BigBrain: Setup`
   - ingesting new material -> `BigBrain: Ingest`
   - updating people or company pages -> `BigBrain: Enrich`
   - maintenance or repairs -> `BigBrain: Maintain`
   - task-list reconciliation -> `BigBrain: Task Refresh`
5. Apply the attachment invariant:
   - every valuable `<collection>/.raw/<basename>.<ext>` artifact has exactly one `<collection>/.raw/<basename>.md` sidecar
   - the sidecar is a first-class indexed brain page and may contain comprehensive extraction, synthesis, provenance, links, visibility, and group metadata
   - the binary is never indexed directly
   - a public ordinary page renders its Markdown; a public attachment sidecar renders its declared artifact while the Markdown remains the private searchable representation

## Quality Rules

- File by primary subject, not by source or format
- Prefer cross-links over duplicate pages
- Use the same meeting page across prep and post-meeting updates
- Keep raw transcripts, decks, PDFs, and other attached files plus their indexed same-basename sidecars under the `.raw/` path specified by `filing_rules`
- When in doubt, recommend `tasks/` for actionable work, `ideas/` for unbuilt possibilities, `protocol/` for repeatable processes, and the owning collection `.raw/` folder for evidence files

## Output

Keep answers practical:
- state the recommended location or skill first
- give one short reason grounded in the BigBrain model
- add one short note about page shape or artifact handling when relevant
