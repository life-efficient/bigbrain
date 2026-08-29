# BigBrain Email Ingest Forward Cases

Use these cases to verify that Email Ingest interprets email evidence before handing candidate actions to `$bigbrain-action-review`.

## External promise in a current message

Evidence:

- Incoming current message from the vendor: `We will send the revised EPC pack on Tuesday.`
- The quoted history contains Harry's earlier request for the pack.
- Harry has not promised to chase, confirm, or unblock delivery.

Expected:

- Attribute delivery to the vendor and preserve Tuesday as timing.
- Pass the vendor promise to action review as an external action.
- Do not create a Harry-facing task merely because Harry made the older quoted request.
- If Harry later writes `I will chase on Wednesday if it has not arrived`, review that separate Harry-owned follow-up as a conditional task candidate.

## Optional outbound offer

Evidence:

- Harry writes: `Happy to introduce WSP if useful.`
- No later message invokes or accepts the offer.

Expected:

- Preserve Harry as the speaker and classify the statement as an optional offer.
- Pass it to action review as context, not an accepted commitment.
- Create no introduction task unless a later message invokes the offer or Harry gives a direct instruction to proceed.

## Accepted introduction request

Evidence:

- A counterparty asks Harry to introduce Data Center Danny to test EPC and hyperscaler-introduction fit.
- Harry replies in a later message: `Yes, I will make the introduction.`
- Brain context uniquely identifies the relevant Danny relationship.

Expected:

- Preserve the inbound request and Harry's later explicit acceptance as separate messages.
- Use Brain context to sharpen the recipient and purpose without changing ownership.
- Pass one concrete Harry-owned introduction candidate to action review.
- The resulting task proposal includes action-time approval before any external message or introduction.

## Automated notification is not an action candidate

Evidence:

- An official automated Preply reminder says the lesson starts tomorrow.
- There is no human-authored tutor message in the thread.

Expected:

- Classify the message as cleanup-only under the standing Preply rule.
- Do not pass notification wording to action review as a human commitment or request.
- Do not create a task from automated action language.

## User-reported outbound send

Evidence:

- The user says a prepared follow-up was sent manually in Gmail.
- The prepared draft has a known subject, recipient set, and attachment expectation.
- Gmail search returns one matching `SENT` message with a provider message ID and thread ID.

Expected:

- Reconcile Gmail without calling a send tool.
- Bind the actual sent recipients, timestamp, final body, thread, and attachment manifest.
- Record `sent` before the Brain update and `sent_and_logged` only after the owning Brain record is read back.
- Treat the provider message ID as the primary idempotency key.

## Retry after canonical update

Evidence:

- The same outbound message is reconciled twice with the same provider message ID.
- The first Brain update succeeded and its canonical page was read back.

Expected:

- Read back the existing action and return a verified no-op.
- Keep exactly one timeline entry for the outbound action.
- Do not call the generic page or task update a second time.

## Ambiguous Brain write result

Evidence:

- Gmail read-back proves one sent message.
- The canonical Brain update times out after the request is submitted.

Expected:

- Assume the write may have persisted and read the canonical page, task, and provenance using the action and provider keys.
- Return `sent_and_logged` if the exact action is present and read-back succeeds.
- Retry the generic update only if the exact action is absent, and never append a second timeline entry.

## Timeline significance

Evidence:

- A person page records routine message coordination, an accepted introduction, and a later job change.
- A deal page records meeting coordination, a newly agreed diligence step, and the deal closing.
- One earlier timeline entry contains a material factual error that needs correction.

Expected:

- Provide `significance: patch` for routine coordination, `significance: minor` for meaningful progress or an accepted introduction, and `significance: major` for the job change or deal closing when those events change the owning page's durable trajectory.
- Classify the factual correction by its impact, append it as a new entry, and reference the earlier entry instead of rewriting history.
- Do not assign significance from message length, emotional salience, or sender status.
