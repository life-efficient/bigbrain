---
name: bigbrain-source-article-ingest
description: Ingest a web article or RSS item when it is relevant to the user's learning, conversation, or sector awareness, preserving the source and updating linked Brain entities when warranted.
---

Route one relevant web article into BigBrain as a source record, preserved source artifact, and evidence-backed entity update when appropriate.

## Contract Checklist

- Decide relevance for the user's digest before creating any Brain page or raw artifact.
- Ignore routine, administrative, promotional, or otherwise low-value updates even when they mention a tracked entity.
- Fetch and preserve the canonical source for every relevant article when the source is available and the filing rules permit it.
- Use the source-retrieval fallback order: direct web search, in-Codex browser, `curl`, then an external browser.
- Keep the source text faithful to the publisher; never replace it with an AI rewrite.
- Create an indexed Markdown source sidecar with standard Brain page structure, provenance, and links to the author, publisher, primary subject, and materially mentioned entities.
- Update existing canonical pages only when the article changes durable understanding or records a meaningful event.
- Use stable RSS IDs and canonical URLs for deduplication and provenance.
- Treat an unavailable source as `needs_review`, not as a complete filing.
- Read back every write and re-sync after meaningful changes.

## Workflow

1. Establish the source and retrieve the article:
   - Use the canonical article URL from the RSS item, not only the feed description.
   - Retrieve in this order: search for the exact URL or title with the direct web search tool; open the result in the in-Codex browser; retry with `curl`; then use an external browser if available.
   - Treat redirects, trailing-slash changes, and canonical-link metadata as normal URL resolution. Confirm that the final page title and publisher match the RSS item before using it.
   - Do not treat a search snippet, browser summary, or alternate article as a substitute for the canonical source bytes. If a browser can read the page but the runtime cannot export faithful source bytes, preserve the browser-retrieved source only through the approved source-preservation mechanism and record the retrieval method.
   - If every retrieval method fails, return `needs_review` with the attempts and errors; do not invent content or file an incomplete source.
   - Preserve the fetched source bytes through the runtime's `raw_content_source: event.source_document.raw_body` placeholder when filing.
   - Keep retrieval metadata, source URL, publisher, author, publication date, stable RSS ID, content type, and fetch status.
   - Stop with `needs_review` if a relevant article cannot be fetched after all fallbacks or the source identity is ambiguous.
   - Anti-patterns: treating the RSS description as the article, stopping after one blocked transport, trusting a search snippet as source text, inventing missing article text, filing an incomplete source as full capture.

2. Apply the digest-value test before filing:
   - Ask whether the item will help the user master an idea, stay current in a sector they care about, bring something useful up in conversation, or read for enrichment.
   - Ignore privacy-policy changes, routine collaborations, generic announcements, awards, hiring notices, and promotional updates unless they have a concrete durable implication for the user's existing knowledge or work.
   - Entity mention alone is not enough. A tracked company or person may still have an irrelevant update.
   - Anti-patterns: filing everything from a trusted feed, treating entity relevance as automatic user relevance, storing raw material for a no-op.

3. Choose the filing outcome:
   - `ignored`: no Brain page or raw source; retain only the event audit record.
   - `source_only`: preserve the source and create its indexed sidecar when it is useful for learning, enrichment, or awareness but does not change a canonical entity page.
   - `source_and_update`: preserve the source, create the indexed sidecar, and update existing canonical pages when the article changes durable understanding or records a meaningful event.
   - Create a new canonical entity page only when the article establishes a distinct durable person, organization, company, project, concept, deal, or other Brain subject that does not already exist.
   - Anti-patterns: updating every mentioned entity, creating duplicate canonical pages, making a source page the compiled truth for an entity.

4. Build the source sidecar:
   - Follow the active Brain `filing_rules` for the owning collection and `.raw/` path.
   - Use a collision-safe raw filename and stable article path derived from the source identity.
   - The indexed Markdown sidecar must contain frontmatter, title, `## Summary`, `## Compiled Truth` or `## Current Relevance`, `## Key Facts` when useful, `## Related Pages`, `## Source`, a `---` separator, and `## Timeline`.
   - Put the original source in the raw artifact; put only structured synthesis and provenance in the sidecar body.
   - Link to the author, publisher, primary subject, and any mentioned entity whose relationship is materially supported by the source.
   - Anti-patterns: putting raw source text into the compiled-truth section, omitting source links, using an unstructured summary as a canonical page, filing raw files directly in entity directories.

5. Update the Brain graph conservatively:
   - Search for existing canonical pages before creating or updating anything.
   - Add an evidence-backed timeline entry and update compiled truth only for a durable change, material event, or reusable insight.
   - Use relative Markdown links so the source sidecar is visible from entity pages through the Brain graph and backlinks.
   - Preserve uncertainty, distinguish publisher claims from verified facts, and do not infer a transaction, partnership, or relationship beyond the source.
   - Read back every created or updated page and confirm the expected source link, entity links, and provenance.
   - Run `bigbrain sync --json` after the write path completes.
   - Anti-patterns: silently overwriting compiled truth, converting claims into facts, adding speculative relationships, declaring success without read-back.

## Article Page Template

Use this shape for the indexed source sidecar, adapting the owning collection and links to the active Brain:

```markdown
---
title: Article title
source_url: https://example.com/article
source_feed: feed-id
author: Author name
published: 2026-08-29
retrieved: 2026-08-29
rss_id: stable-id
raw_file: <collection>/.raw/article-slug.html
---

# Article title

## Summary

Neutral summary of the source.

## Compiled Truth

What this establishes for the Brain, with uncertainty and attribution preserved.

## Related Pages

- [Author](../../people/author.md)
- [Primary subject](../../organizations/subject.md)

## Source

[Read the original article](https://example.com/article)

---

## Timeline

- **2026-08-29** | Captured from the RSS source.
```

## Anti-Patterns

- Filing every RSS item merely because the feed is trusted.
- Treating a short RSS description as sufficient source content.
- Rewriting a strong author's prose into an AI-authored substitute.
- Creating a raw artifact for an item that failed the digest-value test.
- Updating every entity named in an article without a durable change.
- Using source pages as replacements for canonical entity pages.
- Treating publisher claims, intentions, or announcements as independently verified facts.
- Reporting `filed` when the source was unavailable, the page was not read back, or sync did not complete.

## Output

Report the relevance decision, chosen outcome, source artifact and sidecar paths, canonical pages created or updated, linked entities, read-back and sync status, stable event or RSS ID, and any uncertainty or follow-up needed.
