---
name: bigbrain-onboarding
description: |
  Interview a user to initially populate a new or sparse BigBrain brain home.
  Use when the user wants to onboard into BigBrain, set up their first brain
  content, create starter people/company/project/concept pages, or answer an
  initial set of questions that should become durable brain knowledge.
---

# BigBrain: Onboarding

Use this skill to turn a blank or thin brain into a useful starting knowledge
base through a short interview. Ask one question at a time, wait for the answer,
then write only the pages justified by the user's responses.

## Contract

This skill guarantees:
- Ask focused onboarding questions instead of dumping a long form on the user
- Prefer the active BigBrain filing rules and page shapes over generic guesses
- Create or update starter pages for the user's work, people, organizations,
  projects, concepts, writing, protocol, and tasks
- Preserve uncertainty as notes or open questions instead of inventing facts
- End by filing all gathered information into the brain appropriately
- Sync the index after meaningful writes

## Before Asking

1. Resolve the target brain home:
   - use the path named by the user
   - otherwise use BigBrain's current default pointer
   - ask the user only if neither is available
2. Inspect the brain structure before writing:
   - use BigBrain tools when available, especially `filing_rules`
   - otherwise read existing top-level folders and representative pages
3. If the brain is not initialized, use `BigBrain: Setup` first.

## Interview Rules

- Ask one question at a time.
- Use plain language.
- Use numbered choices when offering options.
- Mark one choice with `(recommended)` only when there is a clear default.
- Allow free-form answers even when choices are shown.
- Stop early if the user says they are done.
- After each answer, decide whether it is enough to write now or whether one
  follow-up is needed.

## Question Flow

Start with the smallest set that will make the brain useful. Ask follow-ups only
when the answer changes what should be written.

1. Identity and context:

```text
What should this brain know about you?

1. A short personal/work profile (recommended)
2. Only work context
3. Skip this for now
```

Capture name, role, location/time zone if volunteered, recurring preferences,
and what the user wants agents to understand about them.

2. Current work:

```text
What are the main projects or responsibilities this brain should track first?
```

Create or update `projects/` pages for active work. Create `tasks/` pages for
assignable follow-ups or work items. Attach evidence under the owning
collection `.raw/` folder once ownership is clear; use `inbox/`, `sources/`,
or `ops/` only when the active brain's filing rules define them as legacy or
domain overlays.

3. People and organizations:

```text
Which people or organizations should this brain know about first?
```

Create or update `people/` and `organizations/` pages only for entities with enough
durable signal. Ask one follow-up if the relationship or relevance is unclear.

4. Source material:

```text
Do you already have notes, documents, transcripts, or links that should seed the
brain?

1. Yes, I will provide them now
2. Yes, but later
3. No / not yet (recommended)
```

Route supplied material through the relevant BigBrain ingest skill instead of
folding complex documents into this onboarding flow.

After the final question, file all gathered information into the brain
appropriately before ending the interaction. Then thank the user and tell them
they can add more information like this at any time.

## Writing Guidance

- Prefer updating existing pages over creating duplicates.
- Use canonical collections such as `people/`, `organizations/`, `deals/`,
  `projects/`, `ideas/`, `meetings/`, `tasks/`, `concepts/`, `writing/`,
  `protocol/`, and `archive/` when they exist. Use legacy or domain overlays
  such as `companies/`, `sources/`, `ops/`, or `inbox/` only when the active
  brain's filing rules call for them.
- Keep first-pass pages compact and editable.
- Include timeline entries when the brain's page shape expects them.
- Use markdown links between related pages where obvious.
- Mark unknowns explicitly, for example `Open question:` or `Needs detail:`.
- Do not write sensitive secrets, credentials, or private keys into the brain.

## Verification

After meaningful writes:

1. Run `bigbrain sync --json`.
2. Spot-check at least one created or updated page with `bigbrain get <slug>`
   or an equivalent MCP read.
3. Run a small search for a term from the onboarding answers.

## Output

Report:
- questions completed
- pages created or updated
- supporting material routed or noted
- any answers intentionally left unwritten
- sync result and one retrieval proof
- closing message thanked the user and invited future additions
