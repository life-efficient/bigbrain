---
name: bigbrain-source-article-ingest
description: Ingest a web article or RSS item when it has a direct, user-specific connection to an active Brain objective, question, or tracked subject, preserving the source and updating linked Brain entities when warranted.
---

Review one web article through the BigBrain source-article workflow and file it only when it clears the digest-value gate.

## Contract Checklist

- Decide relevance for the user's digest before creating any Brain page or raw artifact.
- Filing is optional: the valid outcomes are `ignored`, `source_only`, `source_and_update`, or `needs_review`.
- Ignore routine, administrative, promotional, or otherwise low-value updates even when they mention a tracked entity.
- Treat first-party promotional material as `ignored` by default unless a concrete, durable implication is clearly material to the user's existing knowledge or work.
- Require a named, current user anchor for relevance: an active project, task, question, learning topic, tracked entity with live significance, or explicitly requested enrichment topic. Generic sector awareness or possible future usefulness does not qualify.
- Do not file an unfamiliar company or person merely because the item is interesting, resembles a work topic, or might help with generic deal or sector analysis later.
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
   - Visit the supplied article URL and confirm that the page title and publisher identify the requested article.
   - If the page is blocked or cannot be accessed, return `needs_review` and report that the source could not be retrieved. Do not substitute another page or invent content.
   - Preserve the fetched source bytes through the runtime's `raw_content_source: event.source_document.raw_body` placeholder when filing.
   - Keep retrieval metadata, source URL, publisher, author, publication date, stable RSS ID, content type, and fetch status.
   - Stop with `needs_review` if the supplied page cannot be fetched or does not identify the requested article.
   - Anti-patterns: treating the RSS description as the article, stopping after one blocked transport, trusting a search snippet as source text, inventing missing article text, filing an incomplete source as full capture.

2. Apply the digest-value test before filing:
   - Ask whether the item will help the user master an idea, stay current in a sector they have explicitly identified as current, bring something useful up in conversation, or read for an explicitly intended enrichment topic.
   - Name the direct user anchor before writing: the active Brain page, project, task, question, learning topic, tracked entity with live significance, or explicit conversation or enrichment intent that the article serves. If no such anchor can be named, choose `ignored`.
   - Ignore privacy-policy changes, routine collaborations, generic announcements, awards, hiring notices, and promotional updates unless they have a concrete durable implication for the user's existing knowledge or work.
   - Entity mention, topical similarity, regional relevance, a plausible connection to a project, or a generic company or sector lesson are not enough on their own. The article must change durable understanding, provide reusable learning for the named anchor, or record a material event for the user.
   - A reusable analogue, case study, or interesting operating model is not a sufficient rationale unless the user is actively working on that domain or question.
   - For first-party promotional material, identify the promotional status and name the concrete durable implication for the named anchor that outweighs it. Generic product, strategy, platform, or company-profile claims do not qualify. If the implication cannot be stated briefly and specifically, choose `ignored`.
   - Write the relevance rationale before proceeding to any source-artifact or Brain-page write. This is a decision gate, not a post-hoc justification.
   - Anti-patterns: filing everything from a trusted feed, treating entity relevance or topical similarity as automatic user relevance, using a project link to justify filing, storing raw material for a no-op, justifying a write after it has begun.

3. Choose the filing outcome:
   - `ignored`: no Brain page or raw source; retain only the event audit record. This is the required outcome when no named user anchor survives the digest-value test, even if the user asked to ingest the item.
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
- Treating a generic company profile, sector analogue, or possible future deal usefulness as user-specific relevance.
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
