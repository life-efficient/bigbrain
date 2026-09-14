# Shared Ingestion Completeness Checklist

This is the single shared completion standard for every BigBrain ingestion route. Read it before writing, including when a subskill is invoked directly, and check it again before reporting completion. Source-specific skills own retrieval, relevance, source preservation, and specialized record shapes. Use `$bigbrain-page` for canonical subject pages.

Apply this checklist to each source accepted for ingestion. A source rejected by its relevance gate requires no source or entity pages. Partial retrieval, unresolved identity, or failed verification must be reported as incomplete, not silently treated as full ingestion. This checklist is an instruction for the AI to execute, not a required output schema, decision table, or separate tracking record.

## 1. Understand the whole source and its ownership

- Read the complete available source, including substantive secondary sections, captions, and attributed speakers. A headline, summary, or primary subject is not sufficient for a full ingestion.
- Resolve the owning Brain and read its live `filing_rules` before any write. Follow its collections, page shapes, raw-source storage, privacy, and provenance rules.
- Identify the source's subjects, every identifiable entity it mentions, and the facts, events, relationships, decisions, and reusable insights it establishes. Include people, authors or speakers, publishers, organizations, companies, funds, projects, facilities, places, and named concepts as applicable. Do not limit coverage to entities already in the Brain or central to the headline.
- Preserve exact source identity and distinguish publication date, event date, and retrieval date. A name or passing mention supports only that limited context, not an invented biography or relationship.

## 2. Resolve canonical pages before creating them

- Search the owning Brain for the source and every identified subject or entity, including aliases, abbreviations, spelling variants, and renamed entities. Read candidate pages to confirm identity rather than guessing from a title.
- Reuse the existing canonical page. Do not create a second page for an alias, a different source, or a new event involving the same subject.
- If no page exists for an identifiable mentioned entity, create a concise canonical page through `$bigbrain-page`, grounded in what the source actually establishes. A secondary mention is not a reason to skip the entity. Keep sparse evidence sparse and attributed.
- If identity is ambiguous, preserve the mention and uncertainty in the source record, report the unresolved gap, and do not merge unrelated entities or invent an identity. Follow filing-rule restrictions and explicitly report any coverage they prevent.

## 3. Cover the knowledge without competing accounts

- Make the result mutually exclusive and collectively exhaustive at the level of canonical subject ownership: one authoritative home per distinct subject, and all substantive source knowledge represented in the appropriate canonical or source record.
- Update each existing entity page with the new supported facts, events, relationships, or context relevant to that entity. Integrate changes into its current understanding and add dated evidence where appropriate; a link alone does not substitute for a needed factual update.
- When an entity page already covers everything the source establishes, reuse and link it without manufacturing a factual change or duplicating a timeline entry. Verify that coverage before treating it as a no-op.
- Keep each canonical page a useful briefing of its own subject. Keep source-specific detail on the source or specialized record, with links to deeper evidence and related subjects. Do not copy the same full account across company, person, project, and domain pages.
- Preserve existing knowledge, attribution, disagreement, and uncertainty. Distinguish announcements, targets, estimates, and allegations from completed or independently verified events. Do not infer roles, ownership, funding, partnership, or personal relationships beyond the evidence.
- Propagate relevant changes to existing domain or synthesis pages where the new evidence changes their understanding. Follow the route's action-review rules for supported tasks or commitments; do not invent tasks merely to make ingestion appear complete.

## 4. Connect source, entities, and related pages

- When the route requires a source or specialized record, create or update it, preserve raw material as required, and link it to every resolved mentioned entity and the canonical subjects it informs. For routes that retain evidence directly on canonical pages, such as human email or conversation ingest, preserve original-source references and provenance there; do not invent generic source logs or retain raw messages against the route's rules.
- Make supporting evidence reachable from each affected canonical page through an explicit source citation or a verified Brain backlink. New or changed factual statements must carry clear source attribution; a backlink by itself is not evidence for an unattributed claim.
- Link related canonical pages where the source supports the relationship, using the owning Brain's supported link format. For example, connect a person to their stated organization or a facility to its reported operator, without inventing a stronger relationship.
- Check that links resolve to actual canonical records and source artifacts. A bare name, unverified path, or link to a nonexistent page does not satisfy entity coverage.

## 5. Verify completeness from saved Brain state

- Independently read back every created or updated record through the owning Brain. Confirm the intended content, source attribution, links, and preserved raw material where applicable. A successful write response alone is insufficient.
- Reconcile the whole source against the saved result: every identifiable mentioned entity has a canonical page created, updated, or verified as already covered and linked; each substantive fact has an appropriate home; and no needed canonical update remains only in a raw file, summary, or sidecar.
- Verify no-op claims against existing content and source identity. Re-ingesting the same evidence must not create duplicate pages, repeated facts, or duplicate timeline events.
- Rely on successful owning-Brain MCP writes for propagation and backup. Do not add manual sync, maintenance, or backup unless verification identifies a failed side effect.
- Repair gaps within the authorized scope before declaring completion. If retrieval, identity, permissions, or verification prevents completion, report the specific remaining gap and keep the outcome incomplete. Transport adapters must not mark partial work as fully ingested.
- Finish with concise prose describing the source retained, canonical pages created or updated, existing coverage reused, verification, and any remaining gaps. Do not require a structured decision output or reproduce this entire checklist for the user.
