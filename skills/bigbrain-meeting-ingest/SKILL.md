---
name: "BigBrain: Meeting Ingest"
version: 1.0.0
description: |
  Ingest a meeting into BigBrain using the canonical meeting lifecycle model.
  Use when the input is a meeting transcript, call notes, or a meeting summary
  that should update the meeting page, action items, and related entity context.
triggers:
  - "meeting ingest"
  - "process this meeting"
  - "ingest this call"
  - "save this transcript"
  - "update the meeting page"
tools:
  - shell
mutating: true
---

# BigBrain: Meeting Ingest

Use this skill when the source material is fundamentally about a specific
meeting or call. BigBrain meetings use one canonical page across prep and
post-meeting updates.

## Contract

This skill guarantees:
- Use one canonical meeting page rather than splitting prep and outcomes across multiple files
- Preserve any existing `## Prep` section
- Update the meeting page with summary, decisions, action items, and discussion notes
- Keep transcript dumps and other raw support under `.artifacts/`
- Surface related pages that should be enriched when the meeting materially changes them

## Workflow

1. Identify the canonical meeting page:
   - if a prepared meeting page already exists, update that page
   - otherwise create a meeting page under `meetings/`
2. Read the source material and extract:
   - attendees
   - date or timeframe
   - summary
   - key decisions
   - action items
   - discussion notes
3. Preserve page shape:
   - keep any existing `## Prep`
   - write or refresh `## Summary`
   - write or refresh `## Key Decisions`
   - write or refresh `## Action Items`
   - write or refresh `## Discussion Notes`
4. If the raw transcript, deck, or notes should stay accessible:
   - attach them under `.artifacts/<artifact-slug>/`
   - link the meeting page to the artifact
5. Identify follow-on updates:
   - pages that gained new durable facts
   - tasks that should later be reconciled into `ops/tasks.md`
6. Re-index:
   - `bigbrain sync --json`

## Guardrails

- Do not create a second meeting page when a canonical one already exists
- Do not erase `## Prep` content just because post-meeting material arrived
- Do not force raw transcript dumps into the canonical page body
- Do not turn vague discussion into fake decisions or fake action items

## Output

Report:
- meeting page updated or created
- whether prep content was preserved
- whether artifacts were attached
- key follow-on pages or tasks that now need attention
