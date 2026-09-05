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
