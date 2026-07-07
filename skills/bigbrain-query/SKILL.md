---
name: "BigBrain: Query"
version: 1.0.0
description: |
  Answer questions using the selected BigBrain brain home. Use when the user
  asks what the brain knows, wants a lookup, or mentions a person, company,
  meeting, project, deal, or other entity that may have prior context.
triggers:
  - "what do we know about"
  - "tell me about"
  - "who is"
  - "what happened"
  - "search the brain"
  - "look up in BigBrain"
tools:
  - shell
mutating: false
---

# BigBrain: Query

Use this skill to answer from BigBrain rather than from general memory. The
brain is the source of truth for people, organizations, meetings, projects,
deals, tasks, writing, and protocol context.

## Contract

This skill guarantees:
- Search BigBrain before answering when the question depends on brain context
- Ground every factual answer in retrieved brain pages
- Cite page slugs in the answer
- Flag gaps explicitly instead of guessing
- Use direct page reads when search results show a relevant canonical page

## Workflow

1. Run keyword search first for specific names, slugs, or phrases:
   - `bigbrain search "Alex Rivera" --json`
2. Run hybrid query for broader questions:
   - `bigbrain query "what do we know about Alex Rivera?" --json`
3. Read the most relevant page when the user wants a complete picture or the
   result needs verification:
   - `bigbrain get people/alex-rivera`
4. Use structural commands when the relationship matters:
   - `bigbrain backlinks <slug> --json`
   - `bigbrain links <slug> --json`
   - `bigbrain list --type people --json`
5. Synthesize only from the retrieved material. Include source slugs such as
   `[Source: people/alex-rivera]`.

## Command Selection

- Specific entity lookup: start with `bigbrain search`, then `bigbrain get`.
- Broad question: use `bigbrain query`, then read the top 1-3 pages if needed.
- Known slug: use `bigbrain get` directly.
- Relationship question: combine `bigbrain backlinks` / `bigbrain links` with
  `bigbrain get`.
- Suspected stale or missing index: run `bigbrain sync --json`, then retry.

## Quality Rules

- Do not answer from general knowledge when BigBrain has relevant content.
- Do not invent missing details. Say what the brain does and does not contain.
- Treat user-authored brain pages and compiled truth as higher authority than
  older raw timeline entries.
- When results conflict, cite both sources and name the conflict.
- If OpenAI-backed query generation fails but retrieval succeeds, use the
  retrieved context rather than treating the whole lookup as failed.

## Output

Keep answers direct:
- Answer the question first
- Include cited source slugs inline or in a short source line
- Add a gap note only when information is missing or stale
