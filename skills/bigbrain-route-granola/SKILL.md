---
name: "BigBrain: Route Granola"
version: 1.0.0
description: |
  Operate the single machine-wide Granola ingestion route across registered
  BigBrain instances. Use when the unified Granola router automation runs.
triggers:
  - "route Granola meetings"
  - "run the BigBrain Granola router"
  - "operate the single machine-wide Granola ingestion route"
tools:
  - mcp
  - shell
mutating: true
---

# BigBrain: Route Granola

Use this skill for the unified machine-wide Granola router. It discovers recent
Granola items once, chooses exactly one eligible BigBrain destination when the
routing evidence is clear, delegates actual ingestion to that destination's
live BigBrain meeting-ingest workflow, and holds ambiguous or unsafe items for
review.

## Contract

This skill guarantees:
- Use the private BigBrain machine catalog and authenticated about/profile
  contracts for registered brains
- Use only safe routing metadata in the catalog and routing ledger
- Never store transcript, summary, notes, participant names, credentials, or
  meeting content in the catalog or routing ledger
- Apply hard exclusions, source-folder rules, auth/write state, and approved
  purpose profiles before model-assisted classification
- Auto-ingest only when exactly one verified, reachable, authenticated,
  writable brain has an approved auto-ingest profile and a clear routing margin
- Hold ambiguous, mixed-purpose, unprofiled, unhealthy, unavailable, or
  unverified items instead of guessing
- Never fan one meeting out to multiple brains automatically
- Delegate destination writes to that brain's live `filing_rules` and
  meeting-ingest behavior
- Verify the destination write/read-back before marking a route verified
- Finish with a privacy-safe count summary only

## Workflow

1. Resolve the machine catalog and registered BigBrain destinations.
   - Include local and remote brains only when they are verified BigBrain
     services.
   - Confirm each candidate's auth state, write state, health, and approved
     about/profile status.
   - Exclude any destination with missing, draft, invalid, or unapproved routing
     profile.
2. Discover recent Granola items once.
   - Skip exact-title `New note` / `New Note` records before fetching details or
     transcripts.
   - Prefer bounded recent windows and small overlap rather than unbounded
     backfills.
   - Use folder-aware Granola tools when exact permitted or excluded source
     folders matter.
3. Check global routing provenance.
   - Acquire the routing-ledger lease before writing.
   - Check source/provenance by Granola ID across destinations before attempting
     a write.
   - If a prior verified route exists, skip rather than duplicate.
4. Decide the destination.
   - Apply deterministic hard rules first: folder ownership, exclusions,
     approval gates, health, auth, write permission, and profile policy.
   - Use model-assisted classification only on allowed routing metadata.
   - Fetch transcript or summary for classification only when all relevant
     profiles allow local transcript-assisted routing and metadata is
     insufficient.
   - Hold the item when scores are close, multiple destinations match, or the
     destination would require approval.
5. Delegate ingestion.
   - Use the selected destination brain's authenticated `filing_rules`.
   - Use the destination brain's current meeting-ingest behavior rather than
     duplicating its filing rules in the router.
   - Preserve approved raw sidecars only inside the selected destination.
   - Do not broadcast meeting content to candidate brains.
6. Verify and record.
   - Read back the canonical meeting page, provenance, transcript sidecar when
     created, and any affected stable pages/tasks.
   - Mark the ledger verified only after successful read-back.
   - Treat failed read-back as a failed route, not success.

## Guardrails

- Do not route from title keywords alone.
- Do not let a model guess override explicit exclusions, approval gates, auth,
  write state, or profile policy.
- Do not store secrets, credentials, transcript content, summaries, participant
  lists, or model prompts in the machine catalog or routing ledger.
- Do not write one meeting to multiple brains without a later explicit
  multi-brain policy and approval.
- Do not fall back to Personal Brain when the correct destination is
  unavailable.
- Do not report meeting titles, people, transcripts, or private content in the
  automation's final output.

## Output

Return a privacy-safe count summary:
- discovered
- auto-routed
- held
- skipped
- failed
- verified
- destinations by brain name or approved safe label only when that label itself
  is safe to report
