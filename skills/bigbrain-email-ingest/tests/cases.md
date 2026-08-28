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
