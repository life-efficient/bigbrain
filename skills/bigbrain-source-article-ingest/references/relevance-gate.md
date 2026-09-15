# Shared Article Relevance Gate

Apply this gate to every canonical article regardless of whether it arrived through RSS, Substack, an email notification, or a direct URL.

## Required Inputs

- Canonical article URL and successfully retrieved article body.
- Publisher, author when available, and publication date.
- Exact registered source guidance when available.
- Named current user anchor when source guidance does not independently justify retention.
- Existing Brain coverage and duplicate provenance.

## Guidance Resolution

Use the first available source-specific rule without inventing a substitute:

1. Explicit user instruction for this source or bounded ingestion request.
2. Exact registered source guidance carried by the event or listener.
3. Exact canonical publication match to another registered transport, including a Substack publication that matches an RSS listener.
4. Explicit publication guidance stored with the publication cursor or source registry.
5. A named current user anchor.
6. The conservative generic gate.

Do not treat subscribed, followed, authenticated, first-party, popular, or topically adjacent status as a retention rule.

## Decision Test

An article clears the gate only when its retrieved content does at least one of the following:

- materially advances a registered source purpose;
- changes durable understanding of a named concept, organization, person, deal, project, or decision;
- provides a reusable framework, mechanism, dataset, primary evidence, or synthesis for a named learning domain;
- records a material event for an actively tracked subject;
- directly answers a current question or supports an active task.

Topical similarity, entity mention, regional connection, novelty, or an interesting headline is not enough.

## Default Exclusions

Unless exact source guidance or a named anchor says otherwise, ignore:

- routine promotion, product marketing, awards, hiring, or event announcements;
- generic company profiles, portfolio spotlights, investment announcements, and partnership publicity;
- link roundups or digests with little original analysis;
- privacy, account, subscription, or platform notices;
- thin teasers whose substantive source cannot be retrieved;
- repeated coverage that adds no durable evidence or interpretation.

## Internal Outcomes

- `ignored`: canonical identity and article content were reviewed, but the article failed the gate. Create no raw artifact or Brain page.
- `source_only`: preserve the faithful source and indexed sidecar because the article has durable learning or reference value and no canonical page change is needed. Required source links must still be established and verified.
- `source_and_update`: preserve the source and create or update canonical pages when the article adds durable knowledge to the Brain.
- `needs_review`: canonical identity, complete source retrieval, or applicable guidance remains unresolved.
- `verified_noop`: the exact source and intended durable updates already exist and read back successfully.

Record the concise relevance rationale and internal outcome before any mutation. Transport cursor handling belongs to the caller, but no caller may convert `needs_review` or partial work into a completed outcome.

These labels are for operational state and tool handoffs only. Never surface them as user-facing categories or a structured schema. Explain relevance, whether the article was ingested or skipped, and anything that went wrong in natural prose. RSS responses also include the shared article skill's one-paragraph summary for readable articles, including skipped ones. The relevance gate decides whether to retain the article; the shared completeness checklist governs full coverage after acceptance.
