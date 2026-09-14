---
name: bigbrain-substack-ingest
description: Save and reconcile Substack posts in BigBrain using one shared article ledger across RSS events, email notifications, direct URLs, subscription-page reconciliation, and bounded archive backfills. Use for ingesting Substack, checking missed subscribed posts, or maintaining their RSS registrations and per-publication watermarks. Do not use for Gmail discovery alone, non-Substack articles, or publishing posts.
---

# BigBrain Substack Ingest

Ingest and reconcile verified Substack posts through one shared ledger while preserving source fidelity and the owning Brain's relevance rules.

## Contract Checklist

- Read and follow [the shared ingestion completeness checklist](../bigbrain-ingest/references/ingestion-completeness.md) before any Brain write and before declaring ingestion complete.
- This is the common transport adapter for RSS, email, direct posts, daily subscription reconciliation, and bounded backfill. It does not search Gmail, change Gmail state, send email, or own the Gmail delivery cursor.
- Use the shared persistent ledger through [the ledger commands](references/shared-ledger.md). Automation memory is a delivery log or run summary, never the authority for Substack post outcomes or watermarks.
- Resolve the live owning Brain and filing rules before content mutations. Write and perform same-Brain read-back only through that Brain's MCP. The local ledger stores operational metadata, not Brain content.
- Normalize `publication_key` from the verified canonical publication origin and `post_key` from the canonical article URL. Register custom-domain aliases only with observed redirect or publication evidence, never guessed slug similarity.
- Check the shared post record before fetching article content. Verified terminal records with unchanged source identity and complete saved verification for the same owning Brain are no-ops across all channels. A watermark alone never establishes a duplicate.
- Atomically claim an unresolved post before retrieval or any content write. A live claim held by another worker means deferred, not ingested; do not duplicate that work. Expired claims are reclaimable.
- Keep article relevance separate from followed status. Use exact registered source guidance or a named current user anchor. `$bigbrain-source-article-ingest` is the sole relevance and filing gate; `$bigbrain-page` owns canonical page mutations.
- Preserve full accessible publisher content faithfully, including required source artifacts. No email previews, RSS descriptions, search snippets, synthetic substitutes, or paywall bypass.
- Outcomes are `source_only`, `source_and_update`, `ignored`, `needs_review`, and `verified_noop`. `ignored` is terminal reviewed metadata without source artifacts. `needs_review` remains an explicit hole.
- Retained outcomes advance verified `high_watermark` and `low_watermark` only after source/artifact/entity coverage and read-back. `ignored` and `needs_review` do not move those watermarks. Discovery checkpoints are separate and never prove ingestion completeness.
- During authorized daily reconciliation, register RSS feeds for newly discovered genuinely followed publications without asking again. Verify the feed and registry read-back, preserve existing guidance, and never pause, remove, or unsubscribe feeds merely absent from a bounded page.
- Keep each run bounded. Default reconciliation examines at most five loaded subscription-feed pages, processes at most five unresolved posts, and uses a seven-day overlap. Prefer newest misses while reserving one slot for the oldest retryable hole so older failures are not starved.
- Existing authorization for daily reconciliation and bounded backfill persists. Do not re-ask for routine registration, deduplication, claiming, filing, or checkpoint updates within that scope.

## Modes and Discovery

- **Single post / RSS / Gmail:** process the supplied canonical post and return its verified result. Preserve stable RSS event or Gmail delivery identity internally. A Gmail handoff requires sender/recipient evidence, notification type, `List-Id` and `List-Post` when present, publication identity, and canonical post URL. Exclude recommendations, digests, comments, likes, subscriber notices, unsubscribe mail, and promotions from the single-post route.
- **Daily reconciliation:** visit the existing signed-in Codex browser tab at `https://substack.com/inbox`, confirm the subscriptions view sorted Recent, and capture the run boundary. Inspect the bounded pages plus shared outstanding records. Use actual followed indicators and the publication list to distinguish subscriptions from recommendations. If authentication is unavailable, record the access gap and continue independent known-feed work without inventing subscription evidence.
- **Subscription inventory:** a Recent page cannot prove all subscriptions are present. On the first run and at least weekly, inspect the authenticated full subscriptions/publication list in bounded pages, carrying unfinished inventory position to the next run. Do not mark inventory complete until the list's end is observed. Process at most five inventory pages per run. An absent publisher in a bounded window never means unfollowed.
- **Backfill:** the initial authorized batch starts with the newest missed posts and carries oldest holes forward. Older archive traversal is bounded to one archive page or five posts per run, with `backfill_page_cursor` and status retained as discovery metadata. Never claim an archive complete from high/low watermarks or the finite RSS window. If no opaque cursor exists, retain the last observed URL/date and rescan with overlap.

Use the ledger's scan checkpoints for durable discovery progress. Record opaque pagination or inventory resume notes in its supported checkpoint metadata when available; otherwise automation memory may retain those navigation hints only. Navigation hints never replace shared post records, known holes, or verified watermarks.

## Workflow

1. Establish scope and preflight shared state:
   - Identify the mode, live owning Brain, exact input source, run boundary, and allowed bounds. Read the completeness checklist and [ledger command contract](references/shared-ledger.md).
   - Read the shared publication/post status and outstanding holes. Import legacy automation-memory claims only after exact Brain provenance and saved-state verification; prose saying "ingested" is not completion evidence.
   - For known post identities, record discovery channel, then use a terminal record with complete verification to return `verified_noop` without another article fetch or write. Preserve the prior stored outcome and read-back evidence rather than overwriting an ignored or retained record.
   - Otherwise claim the post. If another live owner holds it, return deferred without advancing a Gmail delivery cursor or claiming completeness. Release recoverable failures and preserve retryable holes.
   - Anti-patterns: fetching before ledger preflight, trusting automation prose, using a watermark as dedupe, stealing a live claim, writing Brain content into the operational ledger.

2. Verify identity and discover/register subscriptions:
   - Confirm the canonical title, publication or author, and publication date from accessible source evidence. Follow observed redirects; normalize tracking parameters. Do not replace the supplied post with a different page.
   - In reconciliation mode, enumerate subscribed publications and candidates within the stated boundaries, then `publication-upsert` and `discover` in the shared ledger. A newly discovered URL must reach the same preflight/claim gate as a supplied URL before article retrieval.
   - Read live `events/listeners` and `events/subscriptions`. Validate each missing publication's advertised RSS link or `<canonical-publication-origin>/feed` as an actual RSS/Atom feed with matching publisher metadata. Do not register an HTML login or error page.
   - Use `events/listener_upsert` with the full `listener` object, `type: rss`, `provider: substack`, `skill: bigbrain-substack-ingest`, `bootstrap: all`, verified feed URL, personal scope, existing supported execution placement, and registered owning Brain IDs. The `all` setting drains every eligible item oldest first without losing bursts to the per-poll limit. Reuse exact existing guidance; for a new feed specify the user's stated purpose and relevance gate without inventing subject preferences. Create an `events/subscription_upsert` only if required by the live registry topology. Read both back before saving `rssRegistrationId`.
   - Handle custom domains by observed canonical/alias evidence. Never create a second listener for an already registered alias or overwrite unrelated settings. Missing tools trigger `$find-missing-tools`, not invented local registry writes.
   - Anti-patterns: registering recommendations, assuming all subscriptions appear on one page, guessing feed validity or Brain IDs, dropping existing guidance, deleting absent feeds, asking again for already-authorized registration.

3. Retrieve and apply the shared relevance gate:
   - For a claimed, unresolved post, read exact registered source guidance or resolve a named current user anchor. Followed status proves delivery eligibility only.
   - Delegate to `$bigbrain-source-article-ingest` with `substack_context: {ledger_preflight_complete: true, claimed: true}` and the verified identity, claim context, source guidance, and delivery provenance. This marker prevents recursive transport delegation; it does not replace the actual ledger claim.
   - Confirm complete accessible article content or an authorized full transcript. An unavailable, paywalled, truncated, empty, or mismatched source is `needs_review`, with no synthetic source, content writes, or watermark advancement. Another legitimate transport for the same canonical source is allowed; access controls are not bypassed.
   - Require the shared source workflow to state its relevance rationale before any content/artifact write. If irrelevant, complete the claim as `ignored` with the reason, scoped verification of canonical identity and the relevance review, and no raw artifact or Brain page.
   - Anti-patterns: treating subscription as relevance, storing a notification body as the article, treating a teaser as complete, applying competing RSS/email gates, recursive Substack delegation.

4. File and verify durable coverage:
   - For accepted posts, the source workflow preserves the full publisher source in the owning collection's `.raw/` artifact and creates its indexed sidecar. Keep raw prose faithful and synthesis in the sidecar.
   - Include canonical source URL, publication URL, author, publication date, retrieval date, normalized publication/post keys, and raw reference. Use `source_type: substack` for Substack-originated provenance even when RSS or Gmail discovered it; retain stable transport identities in supported origin metadata.
   - Apply every canonical entity change through `$bigbrain-page`, with required significance and provenance. Complete primary and secondary entity coverage without manufactured changes to sufficient pages.
   - Read back every required artifact, sidecar, and affected canonical page through the same Brain MCP. A success response without read-back or a partial set of writes is not completion.
   - Anti-patterns: filing generic article-log pages, copying mail MIME, rewriting raw source, ignoring secondary entities, bypassing MCP, reporting partial writes as ingested.

5. Complete shared outcomes and reconcile checkpoints:
   - Use `complete` with the live lease token only after the outcome is known. Retained outcomes require verified Brain identity, nonempty paths, timestamp, and explicit saved-state evidence. Ignored outcomes also require scoped verification of canonical/relevance review, with an empty paths array permitted. Use `needs_review` with a concrete reason for unresolved source or coverage; preserve watermarks.
   - Re-read shared status to verify the terminal outcome, `high_watermark`, `low_watermark`, and remaining holes. A newly discovered older post remains eligible despite a newer high watermark, and never regresses it.
   - Advance a discovery scan checkpoint only for pages actually enumerated, including every observed post as a shared record first. Partial scans retain resume position and outstanding holes. A queue event, RSS cursor, or scan checkpoint is not evidence of filing.
   - Return terminal verified handoffs to `$bigbrain-manage-email`; only that caller advances Gmail delivery state. Reconcile RSS queue state separately without treating queued work as complete.
   - For daily runs, remain quiet when there are no new feeds, no ingestion changes, and no new actionable gaps. Unchanged known paywalls or in-flight claims do not deserve repeated notifications. Report meaningful completions, newly registered feeds, new failures, or required user action only.
   - Anti-patterns: overwriting another lease, advancing on ambiguity, recording completion only in automation memory, hiding older holes, declaring full backfill complete without traversal, noisy daily no-op reports.

## Anti-Patterns

- Keeping separate RSS, Gmail, and daily publication outcome stores or automation-local watermarks.
- Trusting a completed event status without verified Brain source coverage.
- Re-fetching a known terminal post before checking the shared ledger.
- Treating `ignored` as retained or treating `needs_review` as complete.
- Losing unresolved posts below a high watermark or behind a scan checkpoint.
- Silently broadening a direct URL into full archive ingestion.
- Registering recommended publications or guessing subscription status from topic similarity.
- Storing secrets, raw source content, or email bodies in ledger records or run summaries.
- Writing to a Brain checkout, database, index, or mirror instead of the owning MCP.

## Output

For an interactive batch, report verified retained/ignored/duplicate/blocked counts, new RSS registrations, owning Brain and source/page links, watermark changes, and explicit remaining backfill scope. For a single post, return the outcome, rationale, verified saved-state result, and cursor status. Keep provider IDs, lease tokens, raw text, and opaque cursors internal.

A daily no-op exits quietly. An unchanged blocked backlog remains recorded for retry without another alert. Do not claim all history is ingested unless archive and subscription traversal prove it.
