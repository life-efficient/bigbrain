---
name: bigbrain-update-page
description: Update one existing BigBrain page when new evidence materially changes its durable understanding.
---

Update one existing BigBrain page while preserving its identity, coherence, evidence boundary, and append-only history.

## Contract Checklist

- Resolve exactly one existing canonical page before drafting an update.
- Read the selected Brain's live filing rules and the current page through the same Brain.
- Read `../_shared/canonical-page-one-pager-standard.md` before rewriting an ordinary canonical subject page.
- Rewrite the current compiled truth when the new evidence changes the understanding; do not merely append disconnected notes.
- Keep the page focused on its subject and use inline links only where they clarify relevant context.
- Preserve specialized task, meeting, and indexed-sidecar shapes when updating those records.
- Preserve prior timeline history and append one evidence-backed update entry.
- Write through the selected Brain's MCP tools, then read the result back through the same Brain.

## Workflow

1. Resolve the target page:
   - Use an explicit verified path when provided; otherwise search by exact subject, aliases, stable identifiers, and current context.
   - Read every plausible candidate and select one canonical owner.
   - If no canonical page exists, hand off to `$bigbrain-create-page` rather than silently creating one.
   - If more than one page could be the owner, stop and ask for clarification.
   - Anti-patterns: updating the first fuzzy match, relying on stale memory, creating from absence, changing several pages before establishing ownership.

2. Read the current page and evidence:
   - Call the selected Brain's live `filing_rules` capability when the destination or page shape is not already established.
   - Read the current body, timeline, outgoing links, and relevant source or meeting records.
   - Identify what is new, what it changes, what remains uncertain, and whether the change is material enough to update compiled truth.
   - Treat a no-op as a valid outcome when the page is already current.
   - Anti-patterns: overwriting without reading, treating a source claim as confirmed fact, replaying an already recorded event, updating because of topical similarity alone.

3. Rewrite the current compiled truth:
   - Apply the shared one-pager standard.
   - Preserve the subject's identity and strongest existing context while incorporating the new evidence.
   - Remove obsolete or contradicted wording when the evidence supports the correction, while preserving the historical change in the timeline.
   - Keep relevant relationships in natural prose and link them inline at the point of relevance.
   - Do not include the page separator or `## Timeline` in the body sent to the MCP writer.
   - Anti-patterns: patchwork note accumulation, source dumps, link inventories, page-system commentary, unnecessary fanout, silently suppressing prior history.

4. Update the page:
   - Call the selected Brain's `update_page` tool with the replacement compiled-truth body, provenance, timeline entry, significance, and domains when applicable.
   - Keep the timeline entry concise, evidence-backed, and distinct from the replacement body.
   - Do not bypass the owning Brain MCP with direct filesystem or database writes.
   - Anti-patterns: replacing the entire page with a weaker summary, omitting provenance, omitting significance, replaying the same timeline event on retry.

5. Verify the result:
   - Read the updated page through the same Brain MCP.
   - Confirm the compiled truth, links, appended timeline entry, provenance, page health, and absence of an unintended duplicate.
   - Report the page updated or verified as a no-op, what materially changed, evidence used, and any remaining uncertainty.
   - Anti-patterns: trusting the write response without read-back, claiming current state without evidence, reporting completion before the timeline and body are both verified.

## Anti-Patterns

- Do not create a second page when the subject already has a canonical owner.
- Do not turn an update into a broad rewrite of every related subject.
- Do not replace durable compiled truth with a source transcript or attachment dump.
- Do not add links merely because a related page exists.
- Do not erase historical timeline entries to make the page look cleaner.
- Do not treat the existence of a new source as proof that the canonical page changed.

## Output

Report the destination Brain, page path and title, whether the result was updated or a verified no-op, what changed, evidence used, linked pages, same-Brain read-back status, and any unresolved uncertainty.
