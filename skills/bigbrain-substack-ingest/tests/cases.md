# BigBrain Substack Ingest Forward Cases

## Gmail handoff for a followed new-post alert

Evidence:

- `$bigbrain-manage-email` passes a canonical post URL, sender and recipient evidence, matching `List-Id` and `List-Post`, publication metadata, and Gmail delivery provenance.
- The canonical page opens and confirms the title, publication or author, and publication date.
- The article has durable value for a named learning topic or followed-publication enrichment request.

Expected:

- Validate the single-post notification and derive normalized publication and post keys from the canonical URL.
- Apply `$bigbrain-source-article-ingest`, preserve the Substack source and indexed sidecar, and use `source_type: substack` for Substack-originated page provenance.
- Bind Gmail delivery identity as origin metadata without storing the email body or MIME.
- Read back the source and affected pages before advancing the publication high watermark and returning a complete handoff result.

## Shared RSS guidance

Evidence:

- The canonical Substack publication exactly matches a registered RSS listener with explicit source guidance.
- The post is a verified single-post delivery.

Expected:

- Reuse the RSS listener guidance verbatim.
- Apply `$bigbrain-source-article-ingest` as the one shared relevance gate.
- Do not treat followed status as an independently sufficient reason to file.

## Relevant delivery with irrelevant content

Evidence:

- The email is a valid followed-publication new-post alert.
- The canonical article opens but fails the shared relevance gate.

Expected:

- Return `ignored` and record the post as reviewed.
- Create no raw source or Brain page.
- Leave publication high and low watermarks unchanged while allowing the caller to advance the Gmail delivery cursor.

## Duplicate or out-of-order post

Evidence:

- The publication has a recent high watermark and an older low watermark.
- A different Gmail thread points to a post older than the high watermark, or an exact post provenance already exists.

Expected:

- Return a verified no-op for an exact existing post.
- File an absent older post when it is accessible and relevant, without regressing the high watermark.
- Move the low watermark only after the older post is fully verified.

## Explicit bounded archive backfill

Evidence:

- The user explicitly requests one archive page or a small batch of older posts.
- The archive exposes an opaque pagination cursor.

Expected:

- Process only the requested bound, preserve the opaque cursor, and keep notification processing independent.
- Advance the low watermark only across fully verified posts.
- Do not claim completeness until archive traversal proves there are no older eligible posts.

## Digest or recommendation email

Evidence:

- The handoff contains several recommended posts, a digest, a subscriber promotion, or another non-single-post notification.

Expected:

- Return `ignored` unless the user explicitly requested that different content.
- Create no source artifact, canonical page, or cursor advancement.

## Blocked or mismatched canonical page

Evidence:

- The supplied URL is paywalled beyond the available session, blocked, empty, truncated, or identifies a different post.

Expected:

- Return `needs_review`.
- Create no synthetic source, page update, or watermark advancement.

## Adjacent prompt that should not trigger

Prompt:

- "Check whether Substack sent me any notifications, but do not ingest anything."

Expected:

- Do not search Gmail or perform ingestion from this skill. Return control to the email-discovery workflow or report that no ingestion was requested.

## RSS followed by email and daily reconciliation

Prompt: "This Substack post arrived through RSS; later its email notification and Recent feed entry arrive."

Expected:

- RSS, email, and daily modes all consult the same shared post ledger before article retrieval.
- The first worker claims the canonical URL, files through the shared source skill, verifies saved source and entity coverage, then records scoped verification.
- Later channels reuse the verified terminal record and skip article retrieval and writes. Gmail advances only its delivery cursor.
- A live competing claim returns deferred, not complete. The daily run remains quiet on an unchanged no-op.

## New subscriptions outside the first Recent page

Prompt: "Check for missed posts and add missing RSS feeds for my subscriptions."

Expected:

- Confirm genuine subscriptions using the signed-in subscriptions UI, not recommended publishers.
- Validate missing feeds, register the common Substack skill and verified destination, and read the registration back without another permission request.
- Traverse Recent within the run bound and carry unfinished navigation forward. Perform the bounded weekly full subscription inventory so less active publications are eventually included.
- Do not remove a feed because it is absent from a bounded scan.

## Old paywall below a newer verified watermark

Prompt: "RSS ingested today's article but an older article remains blocked. Reconcile the feed."

Expected:

- The newer retained watermark does not hide the older needs_review record.
- Retry the oldest eligible hole within the five-post batch, using authorized access only.
- Preserve the hole and unchanged retained watermarks if full content remains unavailable. Do not repeatedly alert about an unchanged paywall or claim complete backfill.

## Substack discovered through generic article ingestion

Prompt: "Ingest this RSS article" with a custom-domain URL whose registered listener identifies it as Substack.

Expected:

- Generic source ingestion delegates once to Substack before article retrieval for shared dedupe and claiming.
- The Substack adapter then calls the source relevance workflow with an actual held claim and delegation context; no recursion occurs.

## Trigger discrimination

- Positive: "Reconcile my Substack subscriptions, add missing RSS feeds, and backfill five missed posts" selects this skill.
- Negative: "Draft a post for my Substack publication" does not select ingestion.
- Ambiguous neighbor: "Ingest this newsletter article from a custom domain" requires verifying publisher identity; choose this adapter for Substack and generic source-article for another publisher.
