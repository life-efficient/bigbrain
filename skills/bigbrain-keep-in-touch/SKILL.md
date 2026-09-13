---
name: bigbrain-keep-in-touch
description: Review recently updated people pages, maintain the private Keep in Touch registry and cursor, and report every outcome without sending messages.
---

Run one evidence-based Keep in Touch review for the selected BigBrain and report the complete result as ordinary prose.

## Contract Checklist

- Use only people pages returned by `playbooks/keep-in-touch/review`; do not broaden the daily scan to other page types.
- Keep all Keep in Touch state in the playbook overlay: enablement, the review cursor, review history, and per-person frequency and contact state.
- Do not add Keep in Touch markers, fields, schemas, notes, or status flags to person pages.
- Read every candidate people page before deciding its outcome. Page body, timeline, and source references are the evidence for judgement.
- Record exactly one outcome for every candidate in one `playbooks/keep-in-touch/record_review` call.
- Use `added`, `frequency_changed`, `due`, `no_change`, or `needs_review` as the only outcomes.
- Use 7 days as the default frequency for an automatic addition. Review changes may use only 3, 7, 14, 30, or 60 days.
- Store a concise reason, evidence, and confidence for every decision. The cursor advances only after the complete review is recorded.
- Suggest a channel and optional message in the report from page evidence, but never send, queue, or log an external message from this skill.
- If the user explicitly overrides a frequency, use `playbooks/keep-in-touch/set_frequency` and report the new value and resulting due date.
- If Keep in Touch is disabled, leave its cursor and registry unchanged and report that the daily review is paused.

## Workflow

1. Open the frozen review window:
   - Call `playbooks/keep-in-touch/review`, optionally with the current run timestamp as `as_of` when a deterministic replay is needed.
   - If the result is disabled, do not read candidate pages or call a write tool. Report the paused state and stop.
   - Treat the returned `review_id`, `as_of`, `cursor_before`, and candidate list as the complete scope for this run.
   - Anti-patterns: scanning `list` broadly, including companies or concepts, inventing a second cursor, or continuing after a disabled result.

2. Read and judge every candidate:
   - Call `read` for each returned `page_slug`. Do not decide from the compact review metadata alone.
   - Classify a person as `added` when the page gives meaningful evidence of direct contact or a relationship worth deliberately maintaining and there is no existing registry entry.
   - Classify research-only or merely mentioned people as `no_change`. A person appearing in the Brain is not by itself a relationship.
   - Classify an enrolled person with a materially changed relationship context as `frequency_changed` only when the evidence supports a different rhythm. Use one of 3, 7, 14, 30, or 60 days.
   - Classify an enrolled person as `due` when the current overlay says their next touch is due. Use `no_change` when they are enrolled but not due and the page does not change the relationship context.
   - Use `needs_review` when the evidence is genuinely ambiguous. Do not turn a plausible deal, vague message, or weak page mention into a relationship.
   - For every decision, include the relevant page evidence, a short reason, and `low`, `medium`, or `high` confidence. Do not invent contact details, relationship depth, or a channel that the page does not support.
   - Anti-patterns: treating page existence as contact, using a rigid relationship mode, silently enrolling colleagues or research subjects, changing frequency without evidence, or omitting a candidate.

3. Commit the playbook result:
   - Call `playbooks/keep-in-touch/record_review` exactly once with the exact `review_id`, `as_of`, and `cursor_before` from the review and one decision for every candidate.
   - Include a short single-line `commit_message` and provenance required by the MCP. The write may update only the Keep in Touch overlay and its private cursor.
   - If the commit fails, do not retry with a different cursor or claim completion. Report that the cursor was not advanced.
   - Do not call `enroll` separately for automatic additions. The review commit owns the batch and is idempotent for its review identifier.
   - Anti-patterns: partial writes, manual cursor edits, advancing the cursor before the batch is complete, storing rationale on person pages, or treating a successful tool transport as proof without the returned recorded result.

4. Produce the visible automation report:
   - Write ordinary natural-language output, not raw MCP JSON or a schema-shaped user report.
   - Start with the run status and counts: people pages scanned, additions, frequency changes, due items, no-change items, and items needing review.
   - List every scanned people page and its outcome. For additions and frequency changes, include the reason and old/new frequency where applicable. For no-change and needs-review outcomes, include the reason.
   - Separately list every currently due or overdue enrolled person, with a suggested channel and an optional message when page evidence supports one. Make clear that the suggestion has not been sent.
   - State the cursor result, including whether it advanced, and mention that all state remains in the Keep in Touch playbook overlay.
   - Anti-patterns: reporting only mutations, hiding ignored or ambiguous pages, claiming a message was sent, emitting only structured tool output, or claiming a complete run when the cursor did not advance.

## Anti-Patterns

- Do not modify person pages, person frontmatter, page schemas, task pages, or global CRM-like state for this workflow.
- Do not use external messaging, email, LinkedIn, WhatsApp, Calendar, or contact-channel tools. Suggestions remain in the report until the user chooses an action.
- Do not infer a relationship from a name mention, research page, company role, generic inbound pitch, or apparent deal without direct evidence.
- Do not skip pages because they seem unimportant. Every candidate receives an explicit outcome in the review history.
- Do not replace the playbook cursor with a local timestamp or a second automation-specific store.

## Output

Return a prose report with:

- run status, frozen window, and counts;
- one bullet for every updated people page and its evidence-backed outcome;
- additions and frequency changes with justifications;
- the due and overdue queue with optional channel and message suggestions, clearly marked as unsent;
- needs-review items and the reason they were held;
- cursor advancement and confirmation that the result was stored in the Keep in Touch overlay.
