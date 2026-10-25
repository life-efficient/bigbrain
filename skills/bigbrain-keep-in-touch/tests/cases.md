# BigBrain Keep in Touch Forward Cases

## Should add a person

A people page records a direct message or meaningful call and a current reason
to maintain the relationship. Read the page, return `added` with high or
medium confidence, use the seven-day default, and include the evidence in the
review commit and visible report.

## Should not add a research subject

A people page was created while researching a company or public figure, with
no evidence of direct contact. Return `no_change`, do not create a registry
entry, and explain that the page is research-only.

## Should hold an ambiguous relationship

A page contains a vague inbound pitch or an apparent deal with no reliable
evidence of a meaningful relationship. Return `needs_review`, do not change
the registry or frequency, and make the uncertainty visible.

## Should pause cleanly

The overlay settings record is disabled. Return a paused report, do not read
candidate pages, do not write review history, and do not advance the cursor.

## Trigger routing

- Positive: "Who in Keep in Touch is overdue, and whom should I prioritize?" Select this skill and reconcile the backlog before ranking.
- Negative: "Send this approved WhatsApp reply." Use the messaging workflow, not this review skill.
- Adjacent: "Import my recent Granola meetings." Use the ingestion skill; delegate only its contact-state reconciliation to this workflow's evidence rules.

## Later WhatsApp exchange

Input: a stored last contact in July and next due date in July; a verified direct WhatsApp exchange on 21 October with a source timestamp.
Required: inspect the identity and source, log only the newer evidenced timestamp for an enabled enrolled person, read back due state, and show the corrected date in any ranking.
Forbidden: quoting the obsolete overdue age or using ingestion time as contact time.

## Later completed Granola meeting

Input: an old due record and a completed meeting with confirmed direct participation on 23 October.
Required: use the meeting event time, compare it with stored contact, and reconcile before final ranking. A short cadence can leave the contact due even after repair.
Forbidden: treating an invitation, attendee name alone, or a person's mention as proof of completed contact.

## Non-contact evidence

Input: an unsent draft, an undelivered message, a proposed call, and one-sided outreach without confirmation.
Required: preserve each as non-contact or unresolved evidence; leave the contact clock unchanged.
Forbidden: logging any of these as completed contact.

## Canonical routing

Input: matching person names exist in Personal Brain and an organizational Brain; the user specifies Personal Brain as canonical.
Required: verify Personal Brain identity and use its person slug and overlay.
Forbidden: substituting an organizational registry or changing its enablement.

## Replay and time uncertainty

Input: one event equals stored contact time, another is older, and a third has only a date without an exact timestamp.
Required: skip equal/older events; retrieve the exact time or hold the date-only event. Read state before retrying an uncertain write result.
Forbidden: duplicate logs, regressing contact time, or inventing midnight/current timestamps.

## Frozen batch and separate due queue

Input: daily review candidates A and B, while due-queue candidate C lies outside the batch. A needs a contact correction that appends a timeline entry.
Required: read/reconcile evidence, record the exact frozen A/B batch before contact mutations, report A as pending reconciliation in that historical review if needed, then repair and read back. Independently reconcile C before ranking C.
Forbidden: changing candidate pages before record_review, adding C to frozen decisions, or treating the daily batch as full backlog coverage.

## Source access or contact write failure

Input: WhatsApp is unavailable for one person; another has verified contact but log_contact fails after a successful daily review commit.
Required: report incomplete source coverage for the first and pending overlay repair for the second. Preserve the successful review cursor and separate unresolved items from verified due rankings.
Forbidden: claiming no contact occurred, repeating obsolete overdue ages as verified, or claiming the successful cursor did not advance.

## Already-ingested evidence

Input: a canonical page already contains a verified meeting milestone, but the enrolled person's overlay is older.
Required: repair only missing contact state, checking whether the deployed log_contact appended a timeline entry; do not re-ingest the meeting or manually append the same contact again.
Forbidden: assuming an existing timeline milestone proves the overlay is current.

## Addition versus existing enrollment

Input: a new person with confirmed contact and an existing enrolled person with newer contact.
Required: the daily addition may use decision.last_contacted_at; the existing enrollment requires log_contact for a newer event. Preserve None frequency and explicit snooze choices.
Forbidden: assuming record_review last_contacted_at changes an existing enrollment, separately auto-enrolling during reconciliation, or re-enabling reminders without user instruction.


## Snooze and deployed timeline behavior

Input: a newer confirmed event for someone with an active explicit snooze; a separate deployment updates overlay contact state without appending a timeline.
Required: hold a correction that would overwrite the snooze, or use a verified supported preservation mechanism. Verify actual page and overlay state; append only missing substantive source facts once through the ingestion workflow.
Forbidden: silently shortening the snooze, assuming a tool description proves a timeline write, or duplicating an entry already created by the deployed tool.
