#!/usr/bin/env python3
"""Static contract checks for the BigBrain Email Ingest skill."""

from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
SKILL = (ROOT / "SKILL.md").read_text(encoding="utf-8")
AGENT = (ROOT / "agents" / "openai.yaml").read_text(encoding="utf-8")
CASES = (ROOT / "tests" / "cases.md").read_text(encoding="utf-8")

assert "name: bigbrain-email-ingest" in SKILL
assert "## Contract Checklist" in SKILL
assert "## Workflow" in SKILL
assert "## Anti-Patterns" in SKILL
assert "## Output" in SKILL
assert "Anti-patterns:" in SKILL
assert "Gmail is read-only except for the standing Trash rules" in SKILL
assert "## Authorized Gmail Cleanup" in SKILL
assert "My Wellness Cloud" in SKILL
assert "GitHub Security Advisory" in SKILL
assert "Calendar acceptance" in SKILL
assert "move to Gmail Trash" in SKILL
assert "never permanent deletion" in SKILL
assert "If the Brain cannot be updated or verified, leave the email in place" in SKILL
assert "confirm the exact message is in `TRASH`" in SKILL
assert "declines, tentative responses, invitations, cancellations, reschedules" in SKILL
assert "Do not preserve whole messages" in SKILL
assert "Preserve every relevant substantive PDF" in SKILL
assert "deterministic same-basename indexed sidecar" in SKILL
assert "byte length and SHA-256" in SKILL
assert "Skip irrelevant attachments" in SKILL
assert "## IQ197" not in SKILL
assert "Do not create a meeting page" in SKILL
assert "live registered Brain descriptions" in SKILL
assert "live filing rules" in SKILL
assert "$find-missing-tools" in SKILL
assert "same destination Brain" in SKILL
assert "## Outbound Email State Contract" in SKILL
assert "## Timeline Significance Contract" in SKILL
assert "`patch`:" in SKILL
assert "`minor`:" in SKILL
assert "`major`:" in SKILL
assert "Never rewrite or suppress prior history" in SKILL
assert "Prefix the appended timeline entry with `[patch]`, `[minor]`, or `[major]`" in SKILL
assert "draft_prepared" in SKILL
assert "sent_and_logged" in SKILL
assert "send_unverified" in SKILL
assert "needs_review" in SKILL
assert "reconciliation_incomplete" in SKILL
assert "reconcile Gmail and do not send it again." in SKILL
assert "actual Gmail message rather than the prepared draft" in SKILL
assert "stable outbound action ID and the provider message ID as idempotency keys" in SKILL
assert "A generic page or task update appends a timeline entry each time it is called." in SKILL
assert "verified no-op" in SKILL
assert "Do not call a send tool during this recovery path." in SKILL
assert "replaying the same event would be a no-op while a deliberate correction would create a distinct significance-labeled entry" in SKILL
assert "assume it may have persisted" in SKILL
assert "separate verified cursor for each Gmail thread" in SKILL
assert "prior 24 hours" in SKILL
assert "small overlap" in SKILL
assert "Advance a thread cursor only after" in SKILL
assert "Perform every Brain mutation through the selected destination Brain's MCP tools" in SKILL
assert "Never edit a Brain checkout, database, index, or local mirror directly" in SKILL
assert "MCP mutations are propagated and backed up automatically" in SKILL
assert "never invoke maintenance, propagation, or backup operations" in SKILL.lower()
assert "Apply page and supported task changes only through the selected destination Brain's MCP" in SKILL
assert "sender, recipients, incoming or outgoing direction, chronology, quoted-history boundary" in SKILL
assert "Separate newly authored text from quoted or forwarded history" in SKILL
assert "The newest meaningful message does not inherit ownership from an older speaker." in SKILL
assert "Automated notifications are ineligible for ingest even when they are actionable." in SKILL
assert "Keep requests to Harry, Harry's accepted commitments, external promises, optional offers, proposals, and discussion distinct" in SKILL
assert "Treat a candidate action as evidence, not as a task." in SKILL
assert "Invoke `$bigbrain-action-review`" in SKILL
assert "Do this before every task write." in SKILL
assert "Do not turn another party's action into Harry-facing work" in SKILL
assert "Do not turn an optional offer into a commitment unless the offer was invoked or explicitly accepted." in SKILL
assert "never use context to override source ownership" in SKILL
assert "next actor, concrete action, purpose, dependency or lack of one, approval gate when relevant" in SKILL
assert "These are prose quality requirements, not new task-schema fields." in SKILL
assert "This skill remains responsible for deduplication, mutation, read-back, and cursor gating." in SKILL
assert SKILL.index("Invoke `$bigbrain-action-review` with that evidence packet") < SKILL.index(
    "Apply page and supported task changes"
)
assert "/Users/hq/.codex/automations/<automation-id>/memory.md" in SKILL
assert "No email was sent or modified." in SKILL
assert "Gmail changes were limited to <count> authorized notification(s) moved to Trash." in SKILL
assert "Gmail cleanup" in SKILL
assert "Moved to Trash: <count> My Wellness Cloud notification(s)" in SKILL
assert "<count and outcome summary>" in SKILL
assert "    - Created: <page title>" in SKILL
assert "    - Updated: <page title>" in SKILL
assert "  - Artifacts:" in SKILL
assert "raw PDF verified" in SKILL
assert "$bigbrain-email-ingest" in AGENT
assert "$bigbrain-action-review" in AGENT
assert "reconcile user-reported outbound sends through Gmail without resending" in AGENT
assert "draft_prepared" in AGENT
assert "sent_and_logged" in AGENT
assert "label every timeline update as patch, minor, or major" in AGENT
assert "preserve append-only history including deliberate corrections" in AGENT
assert "sender and recipient direction" in AGENT
assert "quoted-history boundaries" in AGENT
assert "automated-versus-human authorship" in AGENT
assert "standing authorized Gmail Trash rules" in AGENT
assert "preserve relevant substantive PDFs" in AGENT
assert "owning Brain's MCP" in AGENT
assert "## External promise in a current message" in CASES
assert "Do not create a Harry-facing task merely because Harry made the older quoted request." in CASES
assert "## Optional outbound offer" in CASES
assert "Create no introduction task unless a later message invokes the offer" in CASES
assert "## Accepted introduction request" in CASES
assert "action-time approval" in CASES
assert "## Automated notification is not an action candidate" in CASES
assert "Do not create a task from automated action language." in CASES
assert "## User-reported outbound send" in CASES
assert "Reconcile Gmail without calling a send tool." in CASES
assert "## Retry after canonical update" in CASES
assert "exactly one timeline entry" in CASES
assert "## Timeline significance" in CASES
assert "Classify the factual correction by its impact" in CASES
assert "sync" not in SKILL.lower()

assert "—" not in SKILL
assert "—" not in AGENT
assert "—" not in CASES

print("bigbrain-email-ingest contract checks passed")
