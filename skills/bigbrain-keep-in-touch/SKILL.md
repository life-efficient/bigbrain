---
name: bigbrain-keep-in-touch
description: Review changed people pages and reconcile recent contact before reporting or ranking the Keep in Touch due backlog. Use for daily relationship reviews, overdue-contact checks, and requests to prioritize whom to contact. Do not use to send messages or ingest unrelated source material.
---

# BigBrain Keep in Touch

Reconcile evidenced contact with the private relationship overlay before recommending whom to contact.

## Contract Checklist

- Use the user's canonical relationship Brain, currently Personal Brain, and verify its authenticated identity and overlay enablement. Never substitute an organizational Brain.
- Keep enablement, frequency, priority, review cursor, and contact state in the overlay. Do not add reminder fields to people pages.
- Daily review candidates come only from `overlays/keep-in-touch/review`, at most 20 by default, oldest-first. Due-queue candidates come separately from `overlays/keep-in-touch/list_due`; never silently drop them because they are outside the daily batch.
- Read every candidate's page and reconcile relevant recent WhatsApp and Granola evidence before calling them overdue or ranking them. A stored due date is provisional until reconciled.
- Source reads are allowed. Access WhatsApp only through the in-Codex browser. Never send or queue a message during this workflow.
- Log only verified, newer contact at its evidenced event time. Drafts, proposals, ambiguous identities, and ingestion timestamps are not contact evidence.
- Record exactly one outcome per frozen daily candidate in one `record_review` call. Outcomes remain `added`, `frequency_changed`, `due`, `no_change`, or `needs_review`.
- Preserve the default seven-day addition frequency and supported review frequencies 3, 7, 14, 30, or 60 days. Explicit user changes use `set_frequency`; never re-enable a None frequency implicitly.
- Re-read state after writes. Report source coverage gaps and write failures separately from confirmed due status.

## Workflow

1. Establish scope and open the review:
   - Verify canonical Brain identity and enablement. If disabled, report paused and leave the registry and cursor unchanged.
   - For daily maintenance, call `review` with `limit: 20` unless the user requests another bound. Preserve its exact `review_id`, `as_of`, `limit`, `cursor_before`, and candidate list.
   - For backlog requests and the due-queue section of daily reports, read `list_due`, following pagination at the same returned `as_of`. A backlog-only request does not require creating a daily review or advancing its cursor.
   - If identity, enrollment, or tools cannot be verified, use `$find-missing-tools` when appropriate and report the unresolved scope. Do not substitute a different Brain.
   - Anti-patterns: ranking another Brain's queue, broad historical scans for a daily batch, resetting cursors, continuing writes when disabled.

2. Reconcile candidate evidence before judging due status:
   - Read each candidate page, its timeline, and relevant source references. For every proposed recommendation, inspect recent WhatsApp and Granola contact since the stored `last_contacted_at` through the report cutoff, or state the exact bounded coverage and gaps.
   - Previously ingested evidence is usable when identity, actual contact, and event time are explicit and traceable. Follow source references when those details are missing; a recent page update alone is insufficient. Check for newer source events before presenting a current ranking.
   - Build a compact reconciliation record per person: canonical slug, stored last contact and due date, latest confirmed event and source reference, source coverage, and intended action. Keep this in the working report, not person-page reminder fields.
   - Apply the Contact Evidence Rules below. Compare confirmed event time to stored last contact and recompute the implication for the due date. Recent contact may still leave the person due under their cadence.
   - If required source access or identity is unresolved, label the person `needs_review` or unreconciled. Do not present their stored overdue age as verified or use it to prioritize them.
   - Anti-patterns: treating `next_due_at` as relationship truth, treating page modification time as contact, silently treating inaccessible sources as no contact.

3. Record a frozen daily batch before contact mutations:
   - For a daily review, classify meaningful relationships as `added`, research-only pages as `no_change`, supported rhythm changes as `frequency_changed`, and ambiguous evidence as `needs_review`.
   - Use `due` only when reconciled evidence agrees with the stored due state. Use `needs_review` with an explicit pending-reconciliation reason when a newer confirmed contact still needs logging. Use `no_change` when current and not due.
   - For an addition, pass a verified `last_contacted_at` in the decision when available. Do not separately enroll automatic additions.
   - Call `record_review` exactly once with the frozen identifiers, complete decisions, concise evidence/confidence, commit message, and required provenance. Do this before `log_contact` or source ingestion that modifies candidate pages: those writes can change the frozen candidate window.
   - A failed commit does not advance the cursor. Report the failure without inventing a new cursor or claiming completion. A successful review records the pre-repair outcomes; report later repairs separately.
   - Anti-patterns: partial batches, modifying candidate pages before the frozen commit, assuming decision `last_contacted_at` updates an existing enrollment, claiming pending repairs already succeeded.

4. Apply and verify confirmed contact corrections:
   - Re-read current enrollment/contact state before writing. For an enabled, enrolled person, call `log_contact` with the canonical `page_slug` and explicit evidenced `contacted_at` only when newer than stored contact. Preserve frequency by omitting cadence overrides. Check for an explicit active snooze before logging: if the call would overwrite it, or snooze status cannot be verified, hold the repair and report the conflict unless a supported preservation mechanism is available. Never guess or silently shorten a user snooze.
   - Skip equal or older events. After an uncertain tool result, read back before retrying. Never substitute the current time for an unknown historical timestamp.
   - The live tool advertises a timeline append, while some implementations update only the overlay. Verify actual page and overlay read-back rather than assuming either behavior. Do not append a duplicate contact entry manually. If substantive source facts are missing, use the relevant ingestion skill for those facts with original provenance and preserve existing timeline milestones.
   - For unenrolled people, leave enrollment to the daily review or an explicit user request. A timeline update is not proof of an overlay update, or vice versa.
   - Verify returned/read-back last contact and resulting due state. If logging fails, retain the confirmed evidence in the report and mark overlay reconciliation pending; do not rank the obsolete due age as verified. Preserve any already-successful review cursor advancement.
   - Anti-patterns: logging drafts, duplicate contact logs, moving last contact backward, automatic enrollment during source repair, duplicate timeline notes, reporting transport success as verified state.

5. Refresh and report the reconciled queue:
   - Re-read `list_due` after corrections, at the fixed cutoff and with pagination. Reconcile any newly encountered due person using step 2 before ranking, or explicitly list them as unreviewed. Rank only reconciled candidates using relationship usefulness and current due state.
   - For every ranked person, show the latest confirmed contact date/source and resulting due date. Separate unresolved candidates with their missing evidence or write blocker. A bounded or incomplete source check must not be described as a fully reconciled backlog.
   - Suggest a supported channel for each confirmed due person and provide an unsent draft when context supports one; otherwise explain why no responsible draft is available.
   - For daily runs, report all scanned people and their recorded outcomes, counts, frozen window, batch bound, cursor result, and contact repairs separately. For backlog-only runs, state that no review cursor was advanced.
   - Anti-patterns: hiding unresolved candidates, repeating pre-repair overdue ages, omitting pagination, claiming all contacts are reconciled from a partial scan, implying a draft was sent.

## Contact Evidence Rules

- Qualifying evidence: a source-verified direct exchange with the identified person, or a completed Granola meeting with confirmed direct participation. Preserve the actual event timestamp and timezone.
- Non-qualifying evidence: unsent drafts, scheduled or proposed calls, undelivered messages, one-sided outreach without confirmation, a person merely mentioned in a transcript, assistant summaries without traceable event details, or ambiguous names.
- A delivery indicator alone must not be stretched into a meaningful exchange. If evidence cannot establish the required contact, preserve uncertainty instead of advancing the clock.
- If only a date is known and the tool requires a precise timestamp, do not invent a time. Retrieve the source timestamp or leave reconciliation pending.
- Do not infer contact merely because a person has a deal, company role, or public profile. Do not replace genuine user snoozes or frequency choices by blindly replaying historical events.

## Anti-Patterns

- Treating source ingestion and contact logging as interchangeable.
- Blocking read-only source verification under a no-outreach rule.
- Adding reminder metadata to canonical people pages.
- Sending external communications, silently broadening source ingestion, or changing other Brains.
- Claiming that written workflow rules provide a server-enforced guard.

## Validation

Use [forward cases](tests/cases.md) for routing and behavioral review. Distinguish designed scenarios from executed live-source tests.

## Output

Return a concise prose report with reconciled due recommendations, latest contact evidence, unresolved coverage or write blockers, and unsent drafts. For daily runs also report every frozen candidate's outcome, counts, and verified cursor result. State which contact corrections succeeded and which remain pending.
