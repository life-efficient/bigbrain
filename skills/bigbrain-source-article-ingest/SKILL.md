---
name: bigbrain-source-article-ingest
description: Ingest a web article or RSS item by applying its registered source guidance and current user context, preserving the source and updating linked Brain entities when warranted.
---

Review one web article through the BigBrain source-article workflow, applying registered source guidance before deciding whether to file it.

## Contract Checklist

- Decide relevance for the user's digest before creating any Brain page or raw artifact.
- Filing is optional: the valid outcomes are `ignored`, `source_only`, `source_and_update`, or `needs_review`.
- When an RSS listener provides source guidance, treat it as the source-specific inclusion and exclusion policy. It expresses why the feed is subscribed to and what should be prioritized or ignored.
- Do not apply one global content taxonomy across different RSS feeds. Feed guidance may legitimately differ by source, including how it treats company news, regulation, startup ideas, research, or promotion.
- Require either a clear match to the registered source guidance or a named, current user anchor: an active project, task, question, learning topic, tracked entity with live significance, or explicitly requested enrichment topic.
- First-party or promotional status is not a universal verdict. Apply the registered source guidance and current user context to decide whether the item has durable value.
- Require a short user-specific relevance rationale before any raw-file or Brain-page write.
- If relevance is ambiguous, stop before writing and either return `ignored` or ask for clarification when the intended scope cannot be inferred safely.
- Fetch and preserve the canonical source for every relevant article when the source is available and the filing rules permit it.
- Visit the supplied article page and confirm that you landed on the correct article. If the page is blocked or cannot be accessed, stop and let me know. Do not substitute another page.
- Keep the source text faithful to the publisher; never replace it with an AI rewrite.
- Create an indexed Markdown source sidecar with standard Brain page structure, provenance, and links to the author, publisher, primary subject, and materially mentioned entities.
- Update existing canonical pages only when the article changes durable understanding or records a meaningful event.
- Use stable RSS IDs and canonical URLs for deduplication and provenance.
- Treat an unavailable source as `needs_review`, not as a complete filing.
- Read back every write and confirm the owning Brain reflects the expected changes.

## Workflow

1. Establish the source and retrieve the article:
   - Use the canonical article URL from the RSS item, not only the feed description.
   - Read the registered source guidance from the RSS listener or event before applying the relevance test. If no guidance is present, use the conservative generic test and say that source-specific guidance was unavailable.
   - Visit the supplied article URL and confirm that the page title and publisher identify the requested article.
   - If the page is blocked or cannot be accessed, return `needs_review` and report that the source could not be retrieved. Do not substitute another page or invent content.
   - Preserve the fetched source bytes through the runtime's `raw_content_source: event.source_document.raw_body` placeholder when filing.
   - Keep retrieval metadata, source URL, publisher, author, publication date, stable RSS ID, content type, and fetch status.
   - Stop with `needs_review` if the supplied page cannot be fetched or does not identify the requested article.
   - Anti-patterns: treating the RSS description as the article, stopping after one blocked transport, trusting a search snippet as source text, inventing missing article text, filing an incomplete source as full capture.

2. Apply the digest-value test before filing:
   - Ask whether the item matches the registered source guidance and fulfills the feed's stated purpose, or whether it serves a named current user anchor: an active Brain page, project, task, question, learning topic, tracked entity with live significance, or explicit conversation or enrichment intent.
   - State which source-guidance clause or user anchor the item satisfies before writing. If neither can be named, choose `ignored`.
   - Ignore privacy-policy changes, routine collaborations, generic announcements, awards, hiring notices, and promotional updates unless they have a concrete durable implication for the user's existing knowledge or work.
   - Entity mention, topical similarity, regional relevance, or a generic company or sector lesson are not enough when the item does not match the registered source guidance or a named user anchor. The article must change durable understanding, provide reusable learning for the stated purpose, or record a material event for the user.
   - Do not let a generic default override an explicit source rule. For example, a feed may prioritize broad policy analysis while excluding routine company profiles, or it may explicitly collect a particular company's updates.
   - For first-party promotional material, apply the registered source guidance and name the concrete durable value or exclusion that determines the outcome. Do not infer a verdict from first-party status alone.
   - Write the relevance rationale before proceeding to any source-artifact or Brain-page write. This is a decision gate, not a post-hoc justification.
   - Anti-patterns: filing everything from a trusted feed, treating entity relevance or topical similarity as automatic user relevance, using a project link to justify filing, storing raw material for a no-op, justifying a write after it has begun.

3. Choose the filing outcome:
   - `ignored`: no Brain page or raw source; retain only the event audit record. This is the required outcome when the item does not match the registered source guidance or a named user anchor, even if the user asked to ingest the item.
   - `source_only`: preserve the source and create its indexed sidecar when it is useful for learning, enrichment, or awareness but does not change a canonical entity page.
   - `source_and_update`: preserve the source, create the indexed sidecar, and update existing canonical pages when the article changes durable understanding or records a meaningful event.
   - Create a new canonical entity page only when the article establishes a distinct durable person, organization, company, project, concept, deal, or other Brain subject that does not already exist.
   - When relevance is uncertain, do not resolve the uncertainty by creating a source artifact or new concept page. Return `ignored` or ask for clarification if the user's intended retention scope is genuinely unclear.
   - Anti-patterns: treating `source_and_update` as the default, updating every mentioned entity, creating duplicate canonical pages, making a source page the compiled truth for an entity, writing before the outcome is selected.

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

- Treating “ingest this article” or “put it in the right Brain pages” as permission or instruction to file without independently applying the relevance gate.
- Filing every RSS item merely because the feed is trusted.
- Applying a universal promotional or company-news taxonomy instead of reading the registered source guidance.
- Treating a feed's source guidance as decoration and making the filing decision without it.
- Using a company or entity mention to manufacture a named user anchor after retrieval.
- Treating a short RSS description as sufficient source content.
- Rewriting a strong author's prose into an AI-authored substitute.
- Creating a raw artifact for an item that failed the digest-value test.
- Updating every entity named in an article without a durable change.
- Using source pages as replacements for canonical entity pages.
- Treating publisher claims, intentions, or announcements as independently verified facts.
- Reporting `filed` when the source was unavailable or the page was not read back.

## Output

Report the relevance decision and concise user-specific rationale first. Then report the chosen outcome, source artifact and sidecar paths, canonical pages created or updated, linked entities, read-back status, stable event or RSS ID, and any uncertainty or follow-up needed. For `ignored`, explicitly state that no raw artifact or Brain page was created.
