---
name: bigbrain-source-article-ingest
description: Save a web article, blog post, essay, or RSS article to BigBrain. Use for individual published articles, including articles delivered through feeds or email. For Substack posts, start with `bigbrain-substack-ingest`; for human email correspondence, use `bigbrain-email-ingest`.
---

Review one canonical web article through BigBrain's single shared relevance and filing workflow.

## Contract Checklist

- Decide relevance for the user's digest before creating any Brain page or raw artifact.
- Filing is optional: the valid outcomes are `ignored`, `source_only`, `source_and_update`, `verified_noop`, or `needs_review`.
- This skill is the sole article relevance and filing owner for RSS, Substack, email-delivered article notifications, and direct web URLs. Transport adapters must not create competing relevance rules.
- Apply the shared decision contract in `references/relevance-gate.md` before any source or page write.
- Read and follow [the shared ingestion completeness checklist](../bigbrain-ingest/references/ingestion-completeness.md) before writing and again before declaring completion, including when this skill is invoked directly. It owns canonical entity coverage, creation and updates, deduplication, links, and saved-state verification for every accepted article.
- When a registered source provides guidance, treat it as the source-specific inclusion and exclusion policy. It expresses why the source is followed and what should be prioritized or ignored.
- Do not apply one global content taxonomy across different sources. Source guidance may legitimately differ by publication, including how it treats company news, regulation, startup ideas, research, or promotion.
- Require either a clear match to the registered source guidance or a named, current user anchor: an active project, task, question, learning topic, tracked entity with live significance, or explicitly requested enrichment topic.
- First-party or promotional status is not a universal verdict. Apply the registered source guidance and current user context to decide whether the item has durable value.
- Require a short user-specific relevance rationale before any raw-file or Brain-page write.
- If relevance is ambiguous, stop before writing and either return `ignored` or ask for clarification when the intended scope cannot be inferred safely.
- Fetch and preserve the canonical source for every relevant article when the source is available and the filing rules permit it.
- Visit the supplied article page and confirm that you landed on the correct article. If the page is blocked or cannot be accessed, stop and let me know. Do not substitute another page.
- Keep the source text faithful to the publisher; never replace it with an AI rewrite.
- Create an indexed Markdown source sidecar with standard Brain page structure, provenance, and entity links required by the shared completeness checklist.
- Route canonical page creation and updates through `$bigbrain-page`; keep the article sidecar source-specific.
- Use stable provider IDs and canonical URLs for deduplication and provenance. Preserve the actual channel as `rss`, `substack`, or the most specific supported provenance type.
- Treat an unavailable source as `needs_review`, not as a complete filing.

## Workflow

1. Establish the source and retrieve the article:
   - Use the canonical article URL from the RSS item, not only the feed description.
   - Identify the transport as RSS, Substack, email-delivered article notification, or direct URL.
   - Read registered source guidance from the event, listener, publication registry, or exact publication match before applying the relevance test.
   - For Substack, an exact canonical publication match to a registered RSS listener reuses that listener's guidance. Do not duplicate or paraphrase it into a second policy.
   - If no guidance is present, use the conservative generic test in `references/relevance-gate.md` and say that source-specific guidance was unavailable.
   - Visit the supplied article URL and confirm that the page title and publisher identify the requested article.
   - If the page is blocked or cannot be accessed, return `needs_review` and report that the source could not be retrieved. Do not substitute another page or invent content.
   - Preserve the fetched source bytes through the runtime's `raw_content_source: event.source_document.raw_body` placeholder when filing.
   - Keep retrieval metadata, source URL, publisher, author, publication date, stable RSS ID, content type, and fetch status.
   - Stop with `needs_review` if the supplied page cannot be fetched or does not identify the requested article.
   - Anti-patterns: treating the RSS description as the article, stopping after one blocked transport, trusting a search snippet as source text, inventing missing article text, filing an incomplete source as full capture.

2. Apply the shared relevance gate before filing:
   - Apply `references/relevance-gate.md` identically regardless of transport.
   - Ask whether the item matches the registered source guidance and fulfills the source's stated purpose, or whether it serves a named current user anchor: an active Brain page, project, task, question, learning topic, tracked entity with live significance, or explicit conversation or enrichment intent.
   - State which source-guidance clause or user anchor the item satisfies before writing. If neither can be named, choose `ignored`.
   - Ignore privacy-policy changes, routine collaborations, generic announcements, awards, hiring notices, and promotional updates unless they have a concrete durable implication for the user's existing knowledge or work.
   - Entity mention, topical similarity, regional relevance, or a generic company or sector lesson are not enough when the item does not match the registered source guidance or a named user anchor. The article must change durable understanding, provide reusable learning for the stated purpose, or record a material event for the user.
   - Do not let a generic default override an explicit source rule. For example, a source may prioritize broad policy analysis while excluding routine company profiles, or it may explicitly collect a particular company's updates.
   - Subscription or followed status proves delivery eligibility, not content relevance. It is never sufficient by itself.
   - For first-party promotional material, apply the registered source guidance and name the concrete durable value or exclusion that determines the outcome. Do not infer a verdict from first-party status alone.
   - Write the relevance rationale before proceeding to any source-artifact or Brain-page write. This is a decision gate, not a post-hoc justification.
   - Anti-patterns: filing everything from a trusted feed, treating entity relevance or topical similarity as automatic user relevance, using a project link to justify filing, storing raw material for a no-op, justifying a write after it has begun.

3. Choose the filing outcome:
   - `ignored`: no Brain page or raw source; retain only the transport's reviewed-outcome record. This is the required outcome when the item does not match the registered source guidance or a named user anchor, even if the user asked to ingest the item.
   - For an accepted article, before choosing `source_only` or `source_and_update`, read the shared ingestion completeness checklist and compare the whole article with existing canonical coverage.
   - `source_only`: preserve the source and create its indexed sidecar only when the article has durable value and the shared checklist confirms all mentioned entities already have sufficient canonical coverage and need no page changes. Establish and verify the required source links.
   - `source_and_update`: preserve the source, create the indexed sidecar, and create or update the canonical pages required by the shared checklist. This includes missing secondary entities, not just changes to existing primary subjects.
   - A relevance decision accepts or rejects the article; it must not become a second filter that silently excludes entities from an accepted article.
   - When relevance is uncertain, do not resolve the uncertainty by creating a source artifact or new concept page. Return `ignored` or ask for clarification if the user's intended retention scope is genuinely unclear.
   - Anti-patterns: choosing `source_only` before checking canonical coverage, manufacturing updates to already complete pages, making a source page the compiled truth for an entity, writing before the outcome is selected.

4. Build the source sidecar:
   - Follow the active Brain `filing_rules` for the owning collection and `.raw/` path.
   - Use a collision-safe raw filename and stable article path derived from the source identity.
   - Preserve transport metadata without letting it determine relevance. Use `source_type: rss` for RSS and `source_type: substack` for Substack.
   - The indexed Markdown sidecar must contain frontmatter, title, `## Summary`, `## Compiled Truth` or `## Current Relevance`, `## Key Facts` when useful, `## Related Pages`, `## Source`, a `---` separator, and `## Timeline`.
   - Put the original source in the raw artifact; put only structured synthesis and provenance in the sidecar body.
   - Apply the shared checklist's source-to-entity links, using only relationships and identity supported by the article.
   - Anti-patterns: putting raw source text into the compiled-truth section, omitting source links, using an unstructured summary as a canonical page, filing raw files directly in entity directories.

5. Complete and verify the ingestion:
   - Execute the shared ingestion completeness checklist for canonical page reconciliation and saved-state verification, then check it again before reporting completion.
   - Keep the article sidecar source-specific and use `$bigbrain-page` for canonical subjects.
   - Reconcile the final outcome with verified writes. Do not report `source_only` when canonical pages needed creation or updates, or completion while coverage gaps remain.
   - Anti-patterns: treating a linked name as a created or updated entity page, leaving new entity facts only in the sidecar, declaring success without completing the shared checklist.

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
- Treating a source's guidance as decoration and making the filing decision without it.
- Treating followed or subscribed status as proof of relevance.
- Applying different relevance standards to RSS and Substack copies of the same article.
- Using a company or entity mention to manufacture a named user anchor after retrieval.
- Treating a short RSS description as sufficient source content.
- Rewriting a strong author's prose into an AI-authored substitute.
- Creating a raw artifact for an item that failed the digest-value test.
- Skipping secondary entities or manufacturing factual changes when existing coverage is sufficient.
- Using source pages as replacements for canonical entity pages.
- Treating publisher claims, intentions, or announcements as independently verified facts.
- Reporting `filed` when the source was unavailable or the page was not read back.

## Output

Report the relevance decision and concise user-specific rationale first, followed by the chosen outcome, source artifact and sidecar paths, stable event or RSS ID, and the shared checklist's completion result. Use concise prose, with no required decision table or structured output. For `ignored`, explicitly state that no raw artifact or Brain page was created.
