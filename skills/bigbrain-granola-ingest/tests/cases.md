# BigBrain Granola Ingest composition forward tests

These cases test whether Granola Ingest regains control after delegated Meeting Ingest work. They define semantic outcomes rather than exact prose.

## Complete delegated result is not overall completion

Prompt state:

```text
Granola has deduplicated and successfully claimed one route. It recorded its continuation checklist and delegated the meeting to Meeting Ingest.

Meeting Ingest returns:
- Status: complete
- Canonical meeting: updated
- Required artifacts: verified
- Related changes: one deal update and one task update
- Needs attention: none
- Return control to: bigbrain-granola-ingest
```

Expected behavior:

- Granola explicitly regains control.
- Granola relies on successful destination MCP writes for automatic propagation; manual sync is only a repair for a verified failed side effect.
- Granola performs its final same-Brain read-back and duplicate-provenance check.
- Granola verifies the ledger route only after those checks succeed.
- Granola advances the cursor only after the same route is verified.
- Granola continues any remaining batch candidates before emitting its one batch report.

Forbidden behavior:

- Ending the run or reporting success immediately after the delegated result.
- Treating Meeting Ingest output as the Granola user-facing report.
- Skipping final read-back, ledger verification, cursor handling, or remaining candidates.
- Running routine manual sync after successful MCP writes and read-back.

## Partial delegated result fails closed

Prompt state:

```text
Meeting Ingest returns a partial result because the raw transcript could not be verified.
```

Expected behavior:

- Granola regains control and records a non-sensitive terminal failure for the claimed route.
- The route remains unverified and the cursor remains unchanged.
- Granola records the item as partial in its eventual batch report and continues other independently processable routes.

Forbidden behavior:

- Running ledger verification or cursor advancement for the partial route.
- Hiding the partial outcome because the canonical meeting page was created.

## Several meetings retain the outer batch loop

Prompt state:

```text
Three processable Granola meetings remain. The first delegated Meeting Ingest call returns complete.
```

Expected behavior:

- Granola completes the first route's post-delegation lifecycle.
- Granola then processes the second and third routes with isolated claim and continuation state.
- Granola emits one privacy-safe batch report only after every candidate has a resolved outcome.

Forbidden behavior:

- Returning after the first meeting.
- Reusing the first route's lease or continuation state for later meetings.
- Emitting three competing Meeting Ingest reports.

Apply the five synthetic [person identity regression cases](../../bigbrain-meeting-ingest/tests/cases.md#person-identity-regression-cases) to the indicated Granola, Meeting Ingest and Search stages.

## Confirmed participant contact after successful ingestion

Prompt state: A completed meeting has traceable participant identity and an exact timestamp newer than the enrolled person's stored contact in enabled Personal Brain Keep in Touch.

Expected: Follow Keep in Touch evidence rules, re-read current enrollment and snooze state, log the event timestamp without cadence overrides, and read back contact/due state and timeline. Preserve substantive meeting entries without duplicating any timeline side effect. Hold the correction if an active snooze would be overwritten or cannot be verified.

Forbidden: Log ingestion time, enroll automatically, use an organizational overlay, or treat an invitation or a name mentioned in the meeting as direct participation.

## Verified duplicate with a stale contact overlay

Prompt state: The Granola route is already verified and its canonical meeting proves direct participation, but the contact overlay predates it.

Expected: Reconcile only contact state using traceable existing evidence. Equal or older events are no-ops. Missing identity or exact event time remains pending.

Forbidden: Reopen the verified route, duplicate the meeting or transcript, or assume duplicate ingestion implies current contact state.

## Overlay-only failure preserves source progress

Prompt state: Meeting ingestion, read-back, ledger verification, and cursor advancement succeeded; the subsequent contact log fails.

Expected: Retain successful source progress and report contact reconciliation pending with its event reference and retry blocker.

Forbidden: Roll back the source cursor or claim the relationship backlog is reconciled.
