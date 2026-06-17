---
name: "BigBrain: Understand"
version: 1.0.0
description: |
  Explain how BigBrain is structured and how to use it. Use when the user asks
  where something belongs, what page shape to use, how artifacts work, how
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
the folder structure, the page shapes, the artifact rules, and the next skill
to use.

## Contract

This skill guarantees:
- Explain the BigBrain brain-home model before giving advice
- Ground filing and page-shape advice in the live BigBrain schema
- Distinguish canonical pages from `.artifacts/`
- Distinguish meetings from generic entity pages
- Route the user to a more specific BigBrain skill when one clearly applies

## Workflow

1. Start from the built-in schema:
   - `bigbrain schema`
2. If the question is about filing or page shape, explain:
   - canonical directories such as `people/`, `companies/`, `projects/`, `concepts/`, `meetings/`, and `ops/`
   - `inbox/` as the default holding area when the canonical home is unclear
   - `.artifacts/` for raw files and generated outputs
3. If the question is about a specific item, classify it by primary subject:
   - person -> `people/`
   - company -> `companies/`
   - deal or financing item -> `deals/`
   - active build track -> `projects/`
   - reusable framework -> `concepts/`
   - personal operating preference -> `personal-protocol/`
   - specific meeting or call -> `meetings/`
   - unclear item -> `inbox/`
4. If the question is about workflow, route to the best skill:
   - lookup or context -> `BigBrain: Query`
   - setup or migration -> `BigBrain: Setup`
   - ingesting new material -> `BigBrain: Ingest`
   - updating people or company pages -> `BigBrain: Enrich`
   - maintenance or repairs -> `BigBrain: Maintain`
   - task-list reconciliation -> `BigBrain: Task Refresh`
5. If the user is unsure whether something is a page or an artifact, explain:
   - canonical page for durable authored knowledge
   - artifact for supporting raw inputs or generated deliverables attached to one or more pages

## Quality Rules

- File by primary subject, not by source or format
- Prefer cross-links over duplicate pages
- Use the same meeting page across prep and post-meeting updates
- Keep raw transcripts, decks, PDFs, and other attached files under `.artifacts/`
- When in doubt, recommend `inbox/` rather than forcing a low-confidence filing decision

## Output

Keep answers practical:
- state the recommended location or skill first
- give one short reason grounded in the BigBrain model
- add one short note about page shape or artifact handling when relevant
