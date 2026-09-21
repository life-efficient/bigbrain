# Shared RSS ingestion ledger

All registered RSS feeds use one shared operational store for article identity, claims, verified outcomes, and per-feed watermarks. Substack RSS, email, and daily reconciliation use this same store through the Substack adapter. Canonical sources and pages belong in the owning Brain and must be written and read back through that Brain's MCP.

## Tools and ownership

Call the owning Brain's `rss/workflow` (`rss_workflow` alias) with `{}` for the fixed trusted workflow bundle. Its `documents` array supplies document names and content, including this reference, the article relevance gate, the shared completeness checklist, and the page-writing workflow. Already supplied complete text need not be reread.

Call `rss/ledger` (`rss_ledger` alias) with `{operation, input}`. The server chooses the shared store; do not pass a filesystem or database path. Use `$find-missing-tools` for targeted discovery when slash or underscore aliases are missing. If the required workflow or state tools remain unavailable, stop before retrieval or writes and leave the ingestion state unchanged. Browser tools are for article and publisher webpages only.

Never use TextEdit, Finder, Terminal UI, another desktop editor, or browser `file://` navigation to read workflow files, configuration, scratch files, or the database. No desktop workaround is needed to run this protocol. Do not create an automation-local ledger, manually edit configuration watermarks, or use a prose memory entry as completion evidence.

## Feed and article identity

- Use the verified RSS listener's exact ID as `feedId`. Resolve it from the supplied event and live registry, and preserve its feed URL, title, provider, allowed Brain IDs, and source guidance. A feed hosted on a different domain from its articles is valid; do not guess publisher aliases from the feed-host domain.
- Every feed is distinct even when two feeds share a publisher origin. Never use a bare publisher origin instead of the listener ID.
- Use the observed canonical article URL and exact publication timestamp with a timezone. Do not invent a date from the run time, a feed's update time, or a date-only label. Missing or conflicting identity evidence remains unresolved rather than moving a watermark.
- Preserve query parameters that identify content. Do not strip all query parameters, force unrelated domains into one publisher, or treat different articles as duplicates because their paths match. Generic URL identity preserves the scheme, host, path, and query; only fragments are removed. Let the ledger return its normalized URL, and reuse that URL for subsequent calls. Follow aliases only when supported by observed canonical or redirect evidence.
- A Substack-originated item goes through `$bigbrain-substack-ingest` and `substack/ledger`, including custom domains identified by the registered provider. When that adapter already holds a real claim and passes `substack_context: {ledger_preflight_complete: true, claimed: true}`, the source skill returns evidence to it. Do not acquire or complete a second generic claim. A `feed-upsert` with `provider: "substack"` associates an existing matching registered publication automatically; do not create a parallel outcome store.

## Operations

Use JSON objects directly, with camelCase input fields. This example reads one feed:

```json
{"operation":"status","input":{"feedId":"verified-listener-id"}}
```

| Operation | Input | Meaning |
| --- | --- | --- |
| `feed-upsert` | `{"feedId":"verified-listener-id","feedUrl":"https://publisher.example/feed","title":"Publisher","provider":"rss"}` | Bind the verified registry identity in shared state. This does not create or enable a listener. Preserve the actual provider when supplied. |
| `discover` | `{"feedId":"verified-listener-id","url":"https://publisher.example/article?id=42","publishedAt":"2026-09-14T08:00:00Z","title":"Article title","channel":"rss"}` | Record the observed article and feed association without declaring ingestion. Use the actual discovery channel. |
| `status` | `{"feedId":"verified-listener-id"}`, `{"url":"https://publisher.example/article?id=42"}`, `{"outstandingOnly":true}`, or `{}` | Read shared outcomes and per-feed verified coverage. Combine applicable filters and follow returned pagination. |
| `claim` | `{"url":"https://publisher.example/article?id=42","owner":"unique-run-worker","leaseSeconds":3600}` | Atomically lease unresolved work. Only `claimed: true` with the returned `leaseToken` grants this worker a claim. |
| `renew` | `{"url":"https://publisher.example/article?id=42","leaseToken":"returned-token","leaseSeconds":3600}` | Extend this worker's unexpired lease before lengthy work. |
| `complete` | `{"url":"https://publisher.example/article?id=42","leaseToken":"returned-token","outcome":"needs_review","reason":"Full article unavailable in authorized session"}` | Record this claim's actual outcome. Retained or ignored outcomes require the scoped verification envelope below. |
| `release` | `{"url":"https://publisher.example/article?id=42","leaseToken":"returned-token","reason":"Transient retrieval failure"}` | Return retryable work without declaring completion. |
| `retry` | `{"url":"https://publisher.example/article?id=42","reason":"Full-text access is now available"}` | Reopen an outcome only when new evidence warrants another attempt. |

Status returns `feeds` with `feed_id`, `feed_url`, `title`, `provider`, `filed_low_watermark`, `filed_high_watermark`, and `outstanding_count`. Post records include the stored outcome, `published_at`, and verification. Use the returned structured fields, not prose interpretations.

Feeds without verified retained records show unset values for both watermarks. The low watermark is the earliest retained verified post; the high watermark is the latest. These bounds do not prove contiguous coverage, including holes below the high watermark. Keep removed or excluded feeds excluded from completeness claims.

Keep tokens and internal IDs out of user-facing output. A success response alone does not prove a claim was acquired or an article was ingested. Follow `nextOffset` using the same original filters plus `offset` until the relevant result set is exhausted; use `limit` for bounded reads. Never infer completeness from one page of results.

## Required ordering and verification

1. Resolve the live owning Brain, verified registry feed, guidance, and exact article identity. Call `feed-upsert`, then `discover`, then `status` before fetching article content. Inspect both saved outcome and verification, not just the watermark or RSS queue status.
2. Reuse a terminal record only when its identity and verification are complete for the same owning Brain. Retained outcomes are `source_only`, `source_partial`, `source_and_update`, and `verified_noop`. A reviewed `ignored` record also skips repeat work when its scoped review remains valid. Preserve the stored outcome and evidence rather than completing it again. An event marked filed without that evidence is not a verified duplicate.
3. Claim unresolved work. A competing live claim is deferred, never ingested. A failed claim requires inspecting the returned post state. Do not steal a lease, invent a token, or reopen every ignored or blocked record on each poll. Recheck shared status and claim after lease expiry.
4. For the held claim, retrieve the canonical article and apply the sole shared article relevance gate. Preserve full source fidelity when available and execute the article branch of the shared completeness checklist. If the canonical page exposes a substantive, identity-confirmed preview before access stops, preserve only that readable portion as an explicitly partial capture after it passes relevance. Do not create Brain content for irrelevant, empty, thin, or mismatched articles.
5. Complete after same-Brain read-back of the indexed article, required source artifact, provenance, and any canonical pages actually changed. Use real paths and saved-state evidence. Further entity enrichment is separate and must not leave a verified article outstanding. On a relevant partial preview, use `source_partial` with a concrete access-boundary reason plus the saved partial paths; this advances retained coverage without claiming full capture. On an empty or ambiguous retrieval, use `needs_review` without content paths. A transport or execution failure remains retryable separately from these semantic outcomes.
6. Read the post and feed status back to confirm the result and remaining holes. Queue completion, a worker's final prose, and polling cursor movement do not replace this verification.

A retained completion has this shape:

```json
{
  "operation": "complete",
  "input": {
    "url": "https://publisher.example/article?id=42",
    "leaseToken": "returned-token",
    "outcome": "source_and_update",
    "reason": "Matches the named source-guidance clause",
    "verification": {
      "readBack": true,
      "verifiedAt": "2026-09-14T09:00:00Z",
      "brainId": "live-owning-brain-id",
      "paths": ["collection/article.md", "collection/.raw/article.html", "organizations/subject.md"],
      "evidence": "Same-Brain MCP read-back verified the full indexed article, provenance, and the canonical page actually updated."
    }
  }
}
```

All retained outcomes require nonempty `paths`, `evidence`, a valid `verifiedAt`, `readBack: true`, and the allowed owning `brainId`. When recording existing historical coverage, read back the exact article's saved source and canonical coverage before completing as `verified_noop`. Old automation prose or feed publication dates do not prove retained coverage.

`ignored` requires the actual relevance reason and the same verification envelope, with `paths: []` permitted and `evidence` describing the canonical identity and relevance review. In this case `readBack` attests the review, not a content write. It creates no Brain content and does not move retained watermarks. `needs_review` preserves an explicit outstanding hole and does not move those watermarks. When a substantive preview was retained, use `source_partial`; its verification must include nonempty saved paths and confirm that the raw artifact, sidecar, and any scoped canonical updates were read back. This establishes retained coverage with an explicit partial-capture note.

## Watermarks and configuration

RSS configuration owns each registered feed's view of ingestion progress. Its low/high watermarks are derived from verified retained article records in the shared store. The low watermark is the earliest retained verified post; the high watermark is the latest. Feeds without verified retained records show unset values, not a guessed start date or polling timestamp.

These bounds do not prove contiguous coverage. A later verified article can move the high watermark while an older missing article remains outstanding; an older verified backfill can move the low watermark earlier. Always consider per-article holes, including holes below the high watermark. Ignored posts, failed retrievals, live claims, discovery checkpoints, and polling cursors do not move retained bounds. A finite RSS window never proves full historical ingestion.

Keep removed or excluded feeds excluded. Recording an article outcome must not reactivate a listener, re-subscribe the user, or authorize backfilling a removed feed. Honor explicit source exclusions in the caller's scope.
