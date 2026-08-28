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
- Granola runs destination sync.
- Granola performs its final same-Brain read-back and duplicate-provenance check.
- Granola verifies the ledger route only after those checks succeed.
- Granola advances the cursor only after the same route is verified.
- Granola continues any remaining batch candidates before emitting its one batch report.

Forbidden behavior:

- Ending the run or reporting success immediately after the delegated result.
- Treating Meeting Ingest output as the Granola user-facing report.
- Skipping destination sync, final read-back, ledger verification, cursor handling, or remaining candidates.

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
