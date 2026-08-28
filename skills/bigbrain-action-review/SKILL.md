---
name: bigbrain-action-review
description: Review action evidence prepared by a source-ingestion workflow before it creates or updates BigBrain tasks.
---

# BigBrain Action Review

Reconcile source-attributed action evidence into specific task proposals, existing-task updates, contextual records, conditional follow-ups, or explicit non-task outcomes.

## Contract Checklist

- The calling ingestion skill has already interpreted the source and preserved speaker or sender, responsible actor, direction, chronology, and relevant excerpts.
- Source evidence, current Brain context, and related live tasks are reviewed together without allowing context to overwrite source ownership or commitment strength.
- Another party's responsibility remains an external action unless an active Brain member separately owns executing, monitoring, chasing, confirming, or unblocking it.
- Requests, suggestions, optional offers, discussion, accepted commitments, and external commitments are distinguished before proposing tasks.
- Optional offers are returned as contextual outcomes for the caller to preserve on the source or owning page, not as backlog tasks, until invoked or accepted.
- New task proposals identify the next actor, concrete action, purpose, dependency, externally checkable completion condition, and approval boundary when relevant in natural prose.
- Existing tasks are updated instead of duplicated, and broad umbrella work is split when actors, purposes, dependencies, channels, approval boundaries, or completion conditions differ.
- The skill proposes dispositions only. The calling workflow owns filing-rule decisions, writes, read-back, sync, cursors, Calendar changes, replies, and external actions.

## Workflow

1. Confirm the evidence handoff is sufficient.
   - Require the destination Brain, source page or durable source reference, action-relevant excerpts, source-specific interpretation, relevant Brain context, related live tasks, and applicable mutation or approval limits.
   - Preserve distinctions supplied by the caller, including speaker versus grammatical actor, sender versus recipient, quoted or forwarded authorship, proposal versus agreement, and transcript versus generated-summary authority.
   - If the responsible actor or commitment is genuinely unresolved after using nearby evidence, return a needs-review outcome instead of guessing.
   - Anti-patterns: rereading a raw source without its source adapter, treating a summary label as stronger than primary evidence, collapsing speaker and actor, inventing acceptance
2. Separate evidence from inference.
   - Treat a person's explicit self-commitment or explicit acceptance as evidence of ownership.
   - Treat an inbound request as a request until acceptance or a direct user instruction establishes the member-owned next step.
   - Treat another party's requirement or promise as an external action. Do not turn it into a member task unless the member separately owns a concrete follow-up such as confirming, chasing, monitoring, or unblocking it.
   - Treat language such as `I can help`, `happy to help`, `if useful`, or `if needed` as an optional offer until it is invoked or accepted.
   - Treat proposals, aspirations, brainstorming, and descriptive recommendations as context unless the source or an authoritative user correction establishes an owned action.
   - Prefer a direct user correction over an earlier model summary while retaining source provenance.
   - Anti-patterns: equating mention with ownership, equating a request with acceptance, converting optional help into backlog work, assigning an external obligation to the nearest active member
3. Use Brain context to make supported actions more intuitive.
   - Read the most relevant entity, deal, project, and live task pages supplied or identified by the calling workflow.
   - Use a unique, well-supported match to resolve names, recipients, routes, purpose, dependencies, or completion evidence.
   - Allow context to sharpen an already supported action, such as identifying the appropriate person for a specific introduction.
   - Never use context alone to manufacture a commitment, reassign the responsible actor, or strengthen possibility into certainty.
   - When context supports several materially different next steps, keep them separate or return needs review rather than producing a vague umbrella task.
   - Anti-patterns: creating work from contextual possibility alone, overriding transcript ownership, choosing a person from a weak name match, replacing specific actions with broad themes
4. Reconcile every supported action against live tasks.
   - Update an existing task when it already represents the same actor, action, purpose, and outcome.
   - Propose a new task only when an active Brain member owns a concrete next action and no existing task covers it.
   - Use a conditional follow-up when a later member-owned action depends on a named event, decision, response, or fit test.
   - Record an external action on the source or owning entity page when another party owns it and no member owns follow-up.
   - Record an optional offer as context on the source or owning page so it remains discoverable without bloating the backlog.
   - Return an explicit non-task outcome for discussion, unsupported inference, superseded work, or a request that requires clarification.
   - Anti-patterns: creating duplicates, using waiting to assign someone else's obligation to a member, hiding non-task outcomes, losing optional offers because they are not tasks
5. Test task quality without forcing a storage schema.
   - Express the next actor, concrete verb and object, purpose, named dependency or lack of one, completion evidence, and approval boundary naturally in the proposed title and body.
   - Use named people, organizations, deliverables, and outcomes when the evidence supports them.
   - Split work when the actor, purpose, dependency, communication channel, approval boundary, or completion test differs.
   - Reject vague formulations such as `find partners`, `build the pipeline`, or `follow up` when the evidence or Brain context supports a more concrete next action.
   - Preserve action-time approval for outreach, messages, scheduling, sharing confidential material, publication, or other externally visible actions.
   - Anti-patterns: fixed field inventories, vague nouns without a next action, combining unrelated routes, treating execution mode as action-time approval
6. Return proposals to the calling workflow.
   - Return proposed task creates, existing-task updates, conditional follow-ups, contextual external actions, contextual optional offers, needs-review items, and non-task conclusions with concise evidence-backed reasons.
   - Include enough source and Brain references for the caller to file and verify the outcome.
   - Do not write Brain pages, mutate tasks, sync, update cursors, change Calendar state, draft or send replies, or perform external actions.
   - Anti-patterns: writing directly, omitting contextual outcomes, reporting a proposal as completed work, exposing private source content unnecessarily

## Source Adapter Boundary

The caller owns source interpretation. Meeting and Granola callers preserve speaker turns, grammatical actors, and transcript authority. Email callers preserve sender and recipient direction, chronology, quoted history, and automated authorship. WhatsApp callers preserve the visible sender, forwarding uncertainty, explicit agreement, latest meaningful direction, reply lifecycle, and Calendar consequences.

The caller also owns where non-task outcomes are preserved. For a meeting, an external action may remain in `## Action Items` with its actual owner while an optional offer may remain in `## Discussion Notes` or the indexed sidecar. Email and WhatsApp callers should preserve useful context on the most relevant source, relationship, deal, or project page according to live filing rules and privacy boundaries.

## Anti-Patterns

- Reading every raw source directly and bypassing the source-specific ingestion skill.
- Treating all action-shaped language as a task.
- Creating a member-facing task for another party's obligation without a separate member-owned follow-up.
- Losing an optional offer merely because it should not become a task.
- Using Brain context to rewrite source ownership.
- Enforcing a new persisted action schema or fixed reasoning taxonomy.
- Performing writes, sends, scheduling, or other mutations that belong to the caller.

## Output

Return a concise evidence-backed review containing:

- proposed new tasks;
- proposed updates to existing tasks;
- conditional member-owned follow-ups;
- external actions to preserve as context;
- optional offers to preserve as context;
- needs-review and non-task conclusions;
- the source and Brain references the caller should use when filing and verifying each outcome.

Use natural prose or a compact working table when helpful. Do not require the caller to persist the review format as a schema.
