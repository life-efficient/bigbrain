# Ingestion Completeness Forward Cases

These are prose behavior checks for the router and every direct ingestion route.
Use supplied source fixtures and a test Brain or a read-only walkthrough; do not
write fictional test evidence to a user's live Brain. Evaluate against
`../references/ingestion-completeness.md`. No structured response is required.

## Accepted article with secondary entities

Prompt: "Ingest this complete article into my AI infrastructure domain."

Fixture: A supplied article discusses a fictional Humain investment, quotes a
named DataVolt executive, identifies PIF as a shareholder, and describes a
separate named facility. The test Brain already has Humain and PIF pages, an
alias for DataVolt under its canonical company page, and no executive or
facility page. Some new details concern only DataVolt.

Expected: Read the full article and source gate, then the shared checklist.
Reuse DataVolt's canonical page, update each existing entity whose evidence has
changed, create evidence-limited executive and facility pages, and connect the
source and supported relationships. Verify all saved pages. Do not stop after
updating Humain or the domain overview, duplicate DataVolt under its alias, or
turn a reported investment target into completed spending.

## Direct invocation across source types

Prompts: "Use $bigbrain-media-ingest for this YouTube interview";
"Use $bigbrain-meeting-ingest for these call notes";
"Use $bigbrain-document-ingest for this memo";
"Use $bigbrain-ingest to remember these facts from our conversation."

Fixture: Each source includes a secondary named person and organization absent
from the test Brain. The media fixture has exact title, channel, and chapter
metadata; the meeting fixture has explicit speakers and unresolved actions.

Expected: Each directly invoked skill reads the same shared reference before
writing and checks it again before completion. Cover the secondary entities
while preserving each route's source shape, media metadata, and action review.
Do not rely on the router having run first or create unsupported commitments.

## Transport handoff

Prompts: "Ingest this Substack post"; "Ingest this human email thread";
"Ingest this Granola meeting."

Fixture: Each accepted source requires a missing canonical entity page. A
subsequent read-back fails for that page.

Expected: The adapter and delegated route apply the shared checklist, preserve
their existing transport and identity controls, report the failed verification,
and keep the work incomplete. Do not mark a cursor or meeting ledger complete
merely because the source record was written.

## Existing coverage and repeat ingestion

Prompt: "Ingest this additional article about the same facility."

Fixture: All named entities have canonical pages whose content fully covers the
article's facts. The source itself has not yet been retained and qualifies as
useful reference material. On a second run, the exact source already exists too.

Expected: Verify existing canonical coverage before selecting `source_only`;
retain and link the source without manufacturing factual changes. If an entity
page needs a link edit, report that change accurately. On the repeat run, verify
the source identity and saved coverage before reporting a no-op. Create no
duplicate pages, facts, or timeline entries.

## Ambiguous name or incomplete source

Prompt: "Ingest this source mentioning Alex Smith and the Hexagon project."

Fixture: Two Alex Smith pages match the name but neither can be identified as
the quoted person. An unrelated company also has the name Hexagon. In a separate
case, the supplied article is blocked after its first paragraph.

Expected: Do not guess identity, conflate the project with the company, or fill
the unread article from a search snippet. Preserve and report unresolved
coverage where the route permits partial capture; otherwise return its review
outcome. Do not call either case fully ingested.

## Adjacent requests and rejected sources

Prompts: "Summarize this article here without saving it";
"Check this routine promotion against my registered source guidance."

Fixture: The first request explicitly excludes Brain writes. The second source
fails its article relevance gate.

Expected: No ingestion writes for the first request and no source or entity
pages for the rejected article. The completeness checklist does not expand the
user's authorization or force retention of rejected material.
