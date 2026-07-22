# Unified Granola Routing

Status: implementation in progress

## Decision

BigBrain owns one machine-level Granola router. The router fetches each eligible
meeting once, chooses exactly one verified BigBrain destination, delegates the
write through that brain's live contract, and records the verified outcome in a
privacy-minimized machine ledger.

All brains may auto-ingest when:

- the destination is a verified BigBrain service;
- its versioned `BRAIN.md` routing profile is valid and owner-approved;
- its profile permits automatic ingestion;
- all hard source and exclusion rules pass;
- the destination is authenticated, healthy, and writable; and
- one destination wins clearly.

Missing, invalid, draft, or unapproved profiles fail closed to review. Ambiguous
and genuinely mixed meetings are held. Version 1 never automatically fans out a
full transcript to multiple brains.

## Sources of Truth

1. `BRAIN.md` is the version-controlled authored description of one brain's
   purpose, inclusions, exclusions, sensitivity, routing rules, and synthetic
   examples. It is configuration and is never indexed as knowledge.
2. The authenticated `about` contract combines that authored profile with
   bounded runtime capability information. Public `/health` remains minimal.
3. The machine catalog records verified local and remote BigBrain connections.
   It stores invocation handles, never credentials.
4. The machine routing ledger records decisions, leases, approvals, retries, and
   destination verification. It stores no transcript, summary, participant
   list, credential, or model prompt.

## Routing Order

1. Reject placeholder `New note` records before detail or transcript fetches.
2. Apply exact source ownership and exclusion rules. Negative rules win.
3. Remove unavailable, unauthenticated, unhealthy, unwritable, invalid-profile,
   unapproved-profile, and deny-mode destinations from automatic routing.
4. Use only metadata allowed by every candidate profile.
5. Apply deterministic positive rules, then bounded model scores when needed.
6. Auto-route only one clear winner. Hold conflicts, close scores, and mixed
   meetings.
7. Acquire the global ledger lease before writing.
8. Read the chosen destination's live filing rules and ingest through that
   destination only.
9. Read back the canonical page, transcript sidecar, and provenance before
   marking the route verified.

The default model-only threshold is `0.85`, with a clear margin over the second
candidate. Hard ownership rules such as an exact Granola folder do not require a
model score, but they still require a valid approved profile and a writable
destination.

## Operational State

Machine catalog and ledger state belong under BigBrain's private machine config
root, normally `~/.config/bigbrain/`. This state must be path-injectable for
tests and packaging. The catalog and ledger may contain stable source IDs,
brain IDs, rule IDs, confidence bands, hashes, timestamps, and verification
references, but never meeting content or credentials.

Remote destinations require a verified connection handle, normally the Codex
MCP alias. A URL discovered through public health alone is not sufficient for a
routing write.

## Migration

The existing Granola writers remain active only while the unified router is in
read-only shadow mode. Cutover is atomic:

1. Reconcile existing Granola provenance across every known brain.
2. Seed the ledger without copying meeting content into it.
3. Pause every legacy writer and move rollback copies outside the live Codex
   automation directory.
4. Enable the single BigBrain-owned router automation.
5. Verify that only one Granola writer is active and perform one bounded live
   route with destination and ledger read-back.

Updater contracts must recognize retired automation IDs. A paused-only local
change is not durable because repository template refreshes can reactivate it.

## Rollback

Disable the router first, reconcile any writing or failed ledger state against
destination provenance, restore the legacy definitions from a rollback bundle
outside the live automation directory, and re-enable the personal and ICAIRE
jobs one at a time after verifying their opposite folder rules.
