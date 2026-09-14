---
name: bigbrain-substack-ingest
description: Ingest a verified Substack post or explicitly requested bounded archive item into BigBrain by validating publication identity, preserving the canonical source, and reconciling canonical subjects and entities with the shared ingestion checklist.
---

# BigBrain Substack Ingest

Ingest one verified Substack post into the correct BigBrain while preserving source fidelity, publication-level cursor state, and delegated delivery provenance.

## Contract Checklist

- Read and follow [the shared ingestion completeness checklist](../bigbrain-ingest/references/ingestion-completeness.md) before any Brain write, including when this skill is invoked directly. Complete that checklist before declaring ingestion complete.
- Use this skill for a canonical Substack post received from `$bigbrain-manage-email`, a direct user request to ingest a Substack URL, or an explicitly requested bounded archive backfill.
- This skill does not search Gmail, change Gmail state, send email, or own the Gmail delivery cursor. The email skill routes candidate notifications here with a compact evidence packet.
- For a Gmail handoff, require the post URL, sender and recipient evidence, notification type when known, `List-Id` and `List-Post` when present, publication identity, and stable Gmail delivery identity. A direct user URL may omit email evidence.
- A Gmail notification is eligible only when it is a new-post alert from a publication the user follows or has explicitly placed in scope. Recommendations, digests, comments, likes, subscriber notices, unsubscribe mail, and promotions are not new-post alerts.
- Use a normalized `publication_key` from the canonical publication origin and path and a normalized `post_key` from the canonical post URL. Do not use a Gmail subject or thread ID as article identity.
- Use `source_type: substack` for Substack-originated article provenance. Preserve a Gmail delivery identity in `origin_id` or the delegated cursor metadata when one exists; do not store the full notification body or MIME.
- Delivery eligibility and article relevance are separate decisions. Automated Substack delivery is allowed here, but it never proves that the post should be retained.
- Valid article outcomes are `source_only`, `source_and_update`, `ignored`, `needs_review`, and verified no-op. State the relevance rationale before any source or page write.
- Keep one `substack_publications` cursor entry per normalized publication. Store `publication_url`, `high_watermark`, `low_watermark`, and optional `backfill_status` and `backfill_page_cursor`.
- Advance a watermark only after the canonical source, every intended Brain write, every required raw artifact, and same-Brain read-back are verified. Never regress `high_watermark` for an older out-of-order post.
- Backfill is opt-in, bounded to a small batch or one archive page per run, and independent of the Gmail cursor. Preserve opaque pagination state and do not claim completeness from watermarks alone.
- Route all article relevance and source filing through `$bigbrain-source-article-ingest`, the single shared gate also used by RSS. Route canonical entity page mutations through `$bigbrain-page`.
- Read the selected Brain's live identity, filing rules, and canonical pages before writing. Perform all Brain mutations through that Brain's MCP and read them back through the same MCP.

## Handoff Packet

`$bigbrain-manage-email` should pass the smallest packet that allows this skill to verify the notification and preserve provenance:

```json
{
  "mailbox": "account@example.com",
  "gmail_message_id": "provider-message-id",
  "gmail_thread_id": "provider-thread-id",
  "internal_date": "2026-09-03T08:00:00+00:00",
  "sender": "Publication Author <author@substack.com>",
  "recipient_headers": {"to": "account@example.com"},
  "subject": "Post title",
  "notification_type": "new_post",
  "list_id": "publication.substack.com",
  "list_post": "https://publication.substack.com/p/post-slug",
  "publication_key": "https://publication.substack.com/",
  "publication_url": "https://publication.substack.com/",
  "post_key": "https://publication.substack.com/p/post-slug",
  "post_url": "https://publication.substack.com/p/post-slug",
  "post_title": "Post title",
  "post_author": "Author name",
  "post_published_at": "2026-09-02T12:00:00+00:00",
  "source_guidance": "Named source guidance or null",
  "user_anchor": "Followed publication enrichment request",
  "delivery_provenance": "gmail:account@example.com:provider-message-id"
}
```

Do not expose this packet's provider identifiers in the user-facing report. Use them for idempotency, provenance, and cursor reconciliation.

## Cursor Memory

Use the active automation's `memory.md` when a named automation is available. For direct interactive use without named automation memory, deduplicate against Brain provenance and report that persistent cursor state was not written.

```yaml
substack_publications:
  <publication_key>:
    publication_url: <canonical publication URL>
    high_watermark:
      published_at: <newest verified post date>
      post_key: <canonical post key>
    low_watermark:
      published_at: <oldest verified post date represented>
      post_key: <canonical post key>
    backfill_status: disabled | active | complete | needs_review
    backfill_page_cursor: <opaque source cursor or null>
    last_verified_gmail_message_id: <provider ID or null>
    last_outcome: source_only | source_and_update | ignored | needs_review | verified_noop
    last_verified_at: <timestamp>
```

For each verified post, retain its normalized `post_key`, canonical URL, publication metadata, outcome, affected sidecar or pages, delivery provenance when available, and read-back result. Keep the normal high watermark monotonic. A post older than the high watermark may still be filed if it is absent from Brain. Move the low watermark only when an older post has been fully verified.

## Workflow

1. Establish the request and owning Brain:
   - Read the shared ingestion completeness checklist linked above and use it throughout this workflow, even on direct invocation.
   - Determine whether the input is a Gmail handoff, direct post request, or explicit archive backfill. Require a canonical post URL or stop with `needs_review`.
   - Read the live Brain identity and filing rules. Route the durable content to exactly one owning Brain.
   - Set a bounded run boundary and locate the named automation memory when available. Do not search Gmail from this skill.
   - Anti-patterns: searching Gmail here, accepting a subject without a URL, choosing a Brain from stale memory, silently broadening a single-post request into archive backfill.

2. Verify the notification and canonical post identity:
   - For a Gmail handoff, inspect the supplied sender, headers, notification type, and newly authored evidence. Treat matching `List-Id` and `List-Post` headers as strong evidence of the followed publication; generic Substack platform mail is insufficient.
   - Confirm that the notification announces one new post. Exclude recommendations, digests, comments, likes, subscriber notices, unsubscribe messages, and promotions unless the user explicitly asks for that different content.
   - Open the supplied post URL with the available browser or web retrieval capability. Follow redirects, then confirm the canonical title, publication or author, and publication date.
   - Ignore tracking parameters and unrelated links. Derive `publication_key` and `post_key` from the canonical URL after normalization.
   - If the page is blocked, paywalled beyond the available session, empty, truncated, or mismatched, return `needs_review` without creating content or moving a cursor.
   - Anti-patterns: trusting a search result or email preview, treating a digest as one post, using a Gmail thread as article identity, filing a substituted URL, inventing missing article text.

3. Resolve guidance, then preflight deduplication, relevance, and cursor state:
   - Search existing Brain provenance and source sidecars for the normalized `post_key` and canonical URL before writing. An exact existing post is a verified no-op only when no new evidence exists and shared-checklist coverage is complete.
   - Read the publication's cursor entry. A new post may advance `high_watermark`; an older out-of-order post must not regress it. Only explicit backfill may use archive pagination or move the low watermark.
   - Read live registered source listeners when available. If the canonical Substack publication exactly matches an RSS listener or registered source, reuse its guidance verbatim.
   - Otherwise use explicit publication guidance or a named current user anchor. Followed status proves delivery eligibility only and is not a relevance anchor.
   - Apply `$bigbrain-source-article-ingest` and its `references/relevance-gate.md` contract. If no durable value remains, choose `ignored` and create no raw artifact or Brain page.
   - For explicit backfill, process only the requested bounded batch or archive page, retain the opaque page cursor, and leave normal notification state independent.
   - Record the per-post reviewed outcome in automation memory. A verified `ignored` is terminal for that post and may let the caller advance its Gmail delivery cursor, but it does not move the publication high or low watermark.
   - Anti-patterns: writing before the relevance decision, filing every followed post without a value rationale, treating topical similarity as enough, moving publication watermarks for `ignored`, silently starting backfill, treating a low watermark as proof of completeness.

4. File the canonical source and update durable Brain context:
   - For a relevant post, use `$bigbrain-source-article-ingest` to preserve the publisher source faithfully in the owning collection's `.raw/` location with its indexed Markdown sidecar.
   - Include Substack metadata such as `source_kind: substack`, publication URL, author, publication date, normalized publication and post keys, canonical source URL, retrieval date, and raw-file reference. Keep raw source in the raw artifact and structured synthesis in the sidecar.
   - Use `source_type: substack` in every Substack-originated page provenance entry. When routed from Gmail, bind the delivery identity through `origin_id` or supported handoff metadata without copying the email body.
   - Require the article worker to complete the shared ingestion checklist for canonical subjects and every identifiable mentioned entity. Reuse already-covered pages without manufactured updates.
   - Apply every canonical page change through `$bigbrain-page`, with required significance and provenance, and keep claims attributed and uncertainty explicit.
   - Anti-patterns: storing the email as the source, rewriting the publisher's source as the raw artifact, creating a generic article-log page, skipping secondary entities, duplicating already-covered updates, converting claims into verified facts, bypassing Brain MCP writes.

5. Verify, advance the publication cursor, and return the handoff result:
   - Confirm the shared checklist is complete before declaring the post ingested or advancing publication watermarks.
   - Read back every source sidecar, raw artifact, and affected canonical page through the same Brain MCP. Confirm links, provenance, and expected content.
   - Advance `high_watermark` only for a newer fully verified post. Advance `low_watermark` only for a fully verified older post or bounded backfill result. Preserve both on any failure or ambiguity.
   - Update `backfill_page_cursor` only after the bounded page result is verified. Mark backfill complete only after the archive traversal itself proves completion.
   - Return the outcome, publication and post titles, affected pages or sidecar, verification result, and cursor advancement status to `$bigbrain-manage-email`. The caller decides whether its Gmail cursor may advance.
   - Anti-patterns: advancing after a successful write response without read-back, moving the high watermark backwards, updating cursor state after `needs_review` or partial writes, claiming archive completeness without traversal, changing Gmail here.

## Anti-Patterns

- Treating the Gmail notification as the article or storing its body or MIME in Brain.
- Using Gmail subject, thread ID, or notification timestamp as the canonical post identity.
- Assuming every Substack email is a followed new-post alert.
- Treating automated delivery as a reason to block canonical article review.
- Treating followed status as sufficient article relevance.
- Applying a different relevance gate from RSS.
- Filing a blocked, truncated, mismatched, or unresolved page as if it were complete.
- Creating raw artifacts or canonical pages before the relevance decision.
- Maintaining a global cursor instead of one publication entry per normalized publication.
- Advancing either watermark after a failed source retrieval, relevance decision, Brain write, artifact check, or read-back.
- Regressing a high watermark when processing an older out-of-order post.
- Starting a backfill because a notification arrived, or treating a bounded backfill as complete without verified archive traversal.
- Searching or modifying Gmail from this skill.
- Writing to a Brain checkout, database, index, or local mirror instead of the owning Brain MCP.
- Reporting success without the same-Brain read-back and delegated handoff result.

## Output

Return a compact prose handoff with the existing outcome `source_only`, `source_and_update`, `ignored`, `needs_review`, or verified no-op. State the publication and post titles, relevance rationale, owning Brain, affected source and canonical pages, read-back result, and whether publication cursors advanced. Mention bounded backfill progress only when requested. For a Gmail handoff, return control to `$bigbrain-manage-email` with delivery provenance bound internally.

For `ignored` or `needs_review`, state that no synthetic source was created and whether cursors remained unchanged. Do not require a field template. Do not include provider IDs, full email text, raw source text, credentials, or opaque cursor values.
