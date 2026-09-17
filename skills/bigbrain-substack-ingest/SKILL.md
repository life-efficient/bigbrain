---
name: bigbrain-substack-ingest
description: Save and reconcile Substack posts in BigBrain using one shared article ledger across RSS events, email notifications, direct URLs, subscription-page reconciliation, and bounded archive backfills. Use for ingesting Substack, checking missed subscribed posts, or maintaining their RSS registrations and per-publication watermarks. Do not use for Gmail discovery alone, non-Substack articles, or publishing posts.
---

# BigBrain Substack Ingest

Ingest and reconcile Substack posts through one shared ledger while preserving source fidelity and the owning Brain's relevance rules.

## Contract Checklist

- Read and follow [the shared ingestion completeness checklist](../bigbrain-ingest/references/ingestion-completeness.md) before any Brain write and before declaring ingestion complete.
- This is the common transport adapter for RSS, email, direct posts, daily subscription reconciliation, and bounded backfill. It does not search Gmail, change Gmail state, send email, or own the Gmail delivery cursor.
- Load this workflow and its required references through the owning Brain's `substack/workflow` MCP tool (`substack_workflow` alias) when a file-reading tool is unavailable. Use `substack/ledger` (`substack_ledger` alias) with `{operation, input}` for shared state as described in [the ledger contract](references/shared-ledger.md).
- Never open TextEdit, Finder, Terminal UI, another desktop editor, or browser `file://` URLs to read skills, references, configuration, scratch files, or the ledger. Browser access is for publisher and Substack webpages only. If required workflow text or ledger tools remain unavailable after targeted discovery, stop before retrieval or writes and report a setup gap; do not work around it with desktop apps.
- RSS configuration owns each registered feed's verified low/high ingestion watermarks, backed by the shared article ledger used by generic RSS and this Substack adapter. Low is the earliest retained verified post and high is the latest, not contiguous completeness. Keep one cross-channel outcome and claim per article.
- Automation memory is a delivery log or run summary, never the authority for Substack post outcomes or watermarks.
- Resolve the live owning Brain and filing rules before content mutations. Write and perform same-Brain read-back only through that Brain's MCP. The local ledger stores operational metadata, not Brain content.
- File accepted Substack posts as first-class Markdown pages in the owning Brain's `articles/` collection, alongside other newsletters and online articles. Retain publisher HTML or another original artifact under `articles/.raw/` only when it adds audit or rendering value.
- Normalize `publication_key` from the verified canonical publication origin and `post_key` from the canonical article URL. Register custom-domain aliases only with observed redirect or publication evidence, never guessed slug similarity.
- Check the shared post record before fetching article content. Verified terminal records with unchanged source identity and complete saved verification for the same owning Brain are no-ops across all channels. A watermark alone never establishes a duplicate.
- Atomically claim an unresolved post before retrieval or any content write. A live claim held by another worker means deferred, not ingested; do not duplicate that work. Expired claims are reclaimable.
- Keep article relevance separate from followed status. Use exact registered source guidance or a named current user anchor. `$bigbrain-source-article-ingest` is the sole relevance and filing gate; `$bigbrain-page` owns canonical page mutations.
- Preserve full accessible publisher content faithfully, including required source artifacts. When a canonical Substack page confirms the post and exposes a substantive preview before a paywall or other block, apply the normal relevance gate to the readable portion and retain that portion as an explicitly partial capture when it passes. Mark the limitation in the raw artifact, sidecar, and provenance, use `source_partial`, and advance the publication watermarks only after the saved partial content and supported canonical updates are read back. Never bypass a paywall or use an email preview, RSS description, search snippet, or synthetic substitute as the article.
- Internal outcomes are `source_only`, `source_partial`, `source_and_update`, `ignored`, `needs_review`, and `verified_noop`. `ignored` is terminal reviewed metadata without source artifacts. `source_partial` is a successful ingestion of a substantive preview and keeps the access boundary explicit. `needs_review` is an unresolved semantic hole, not an execution error. These labels belong only in operational state and tool handoffs, never in user-facing output categories.
- Retained outcomes, including `source_partial`, advance verified `high_watermark` and `low_watermark` only after the saved source/artifact/entity coverage and read-back. `ignored` and `needs_review` do not move those watermarks. Discovery checkpoints are separate and never prove ingestion completeness.
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
   - Identify the mode, live owning Brain, exact input source, run boundary, and allowed bounds. Call `substack/workflow` with `{}` to read the complete workflow bundle, including the completeness checklist and ledger contract. Already supplied complete skill/reference text need not be reread. If the tool is missing, use targeted MCP discovery first.
   - Read the shared publication/post status and outstanding holes. Import legacy automation-memory claims only after exact Brain provenance and saved-state verification; prose saying "ingested" is not completion evidence.
   - For known post identities, record discovery channel, then use a terminal record with complete verification to return `verified_noop` without another article fetch or write. Preserve the prior stored outcome and read-back evidence rather than overwriting an ignored or retained record.
   - Otherwise claim the post. If another live owner holds it, return deferred without advancing a Gmail delivery cursor or claiming completeness. Release recoverable failures and preserve retryable holes.
   - Anti-patterns: fetching before ledger preflight, trusting automation prose, using a watermark as dedupe, stealing a live claim, writing Brain content into the operational ledger, opening local files in TextEdit or other desktop apps.

2. Verify identity and discover/register subscriptions:
   - Confirm the canonical title, publication or author, and publication date from accessible source evidence. Follow observed redirects; normalize tracking parameters. Do not replace the supplied post with a different page.
   - In reconciliation mode, enumerate subscribed publications and candidates within the stated boundaries, then `publication-upsert` and `discover` in the shared ledger. A newly discovered URL must reach the same preflight/claim gate as a supplied URL before article retrieval.
   - Read live `events/listeners` and `events/subscriptions`. Validate each missing publication's advertised RSS link or `<canonical-publication-origin>/feed` as an actual RSS/Atom feed with matching publisher metadata. Do not register an HTML login or error page.
   - Use `events/listener_upsert` with the full `listener` object, `type: rss`, `provider: substack`, `skill: bigbrain-substack-ingest`, `bootstrap: all`, verified feed URL, personal scope, existing supported execution placement, and registered owning Brain IDs. The `all` setting drains every eligible item oldest first without losing bursts to the per-poll limit. Reuse exact existing guidance; for a new feed specify the user's stated purpose and relevance gate without inventing subject preferences. Create an `events/subscription_upsert` only if required by the live registry topology. Read both back before saving `rssRegistrationId`.
   - Handle custom domains by observed canonical/alias evidence. Never create a second listener for an already registered alias or overwrite unrelated settings. Missing tools trigger `$find-missing-tools`, not invented local registry writes.
   - Anti-patterns: registering recommendations, assuming all subscriptions appear on one page, guessing feed validity or Brain IDs, dropping existing guidance, deleting absent feeds, asking again for already-authorized registration.

3. Retrieve and apply the shared relevance gate:
   - For a claimed, unresolved post, read exact registered source guidance or resolve a named current user anchor. Followed status proves delivery eligibility only.
   - Delegate to `$bigbrain-source-article-ingest` with `substack_context: {ledger_preflight_complete: true, claimed: true}` and the verified identity, claim context, source guidance, and delivery provenance. This marker prevents recursive transport delegation; it does not replace the actual ledger claim. RSS-triggered work inherits that skill's flexible documented browser and article-retrieval policy, preferring the in-Codex browser when available without blocking supported alternatives.
   - For a Substack post whose canonical page is a podcast or other audio item, identify the publisher's audio URL from the page or feed metadata and download that URL with cURL or an equivalent shell retrieval tool. Clicking the audio control and opening its media element in a separate browser tab is not a download. Preserve the downloaded audio as the source input and obtain a complete transcript through the supported transcription path before substantive ingestion.
   - Confirm complete accessible article content or an authorized full transcript. A paywalled or otherwise blocked post can proceed when its legitimately accessible preview is substantively sufficient to pass the relevance gate: preserve exactly the readable portion, label it preview-only, record the access boundary, and complete the shared outcome as `source_partial` after read-back. An unavailable, thin, empty, or mismatched source remains `needs_review` with a reason and no content writes. Another legitimate transport for the same canonical source is allowed; access controls are not bypassed.
   - Require the shared source workflow to state its relevance rationale before any content/artifact write. If irrelevant, complete the claim as `ignored` with the reason, scoped verification of canonical identity and the relevance review, and no raw artifact or Brain page.
   - Anti-patterns: treating subscription as relevance, storing a notification body as the article, treating a teaser as complete, applying competing RSS/email gates, recursive Substack delegation.

4. File and verify durable coverage:
   - For accepted posts, the source workflow creates one searchable Markdown article page whose body is the faithful full publisher text when available, or exactly the readable substantive preview when access is blocked. Keep any archived raw artifact faithful, but never let it be the only complete source copy.
   - Include canonical source URL, publication URL, author, publication date, retrieval date, normalized publication/post keys, and raw reference. Use `source_type: substack` for Substack-originated provenance even when RSS or Gmail discovered it; retain stable transport identities in supported origin metadata.
   - Apply every canonical entity change through `$bigbrain-page`, with required significance and provenance. Complete primary and secondary entity coverage without manufactured changes to sufficient pages.
   - Read back the complete article page, any archival artifact, and affected canonical pages through the same Brain MCP. For a partial preview, verify the saved readable content and scoped entity coverage, then complete the shared record as `source_partial` with the access limitation in the reason and page content. A success response without read-back or a partial set of writes is not completion.
   - Anti-patterns: filing generic article-log pages, copying mail MIME, rewriting raw source, discarding a relevant substantive preview, treating a partial preview as a full article, ignoring secondary entities visible in the preview, bypassing MCP, reporting partial writes as complete ingestion.

5. Complete shared outcomes and reconcile checkpoints:
   - Use `complete` with the live lease token only after the outcome is known. Retained outcomes, including `source_partial`, require verified Brain identity, nonempty paths, timestamp, and explicit saved-state evidence. Ignored outcomes require scoped verification of canonical/relevance review, with an empty paths array permitted. Use `needs_review` with a concrete reason for unresolved source or coverage; it remains an outstanding semantic hole but is not an execution error.
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

For a single post, explain its relevance, whether it was ingested, partially ingested, or already covered, and anything that went wrong in natural prose. Follow the shared article skill's RSS output contract: include one paragraph summarizing every article with enough readable substance when readable; reuse previously verified source content for duplicates without fetching again. If a subscriber-only paywall leaves a substantive preview, say that only the preview was ingested and that the saved page is explicitly partial. If it leaves only an insufficient preview or no verified content, explain why a reliable summary is unavailable instead of inventing one. Do not emit a structured schema, decision table, category labels, or internal outcome names such as `needs_review`.

For an interactive batch, explain what was added, not ingested, already covered, or could not be completed, plus useful source/page links, new feeds, and remaining backfill scope. Keep provider IDs, lease tokens, raw text, opaque cursors, watermark bookkeeping, and internal outcomes out of the user-facing response.

A daily no-op exits quietly. An unchanged blocked backlog remains recorded for retry without another alert. Do not claim all history is ingested unless archive and subscription traversal prove it.
