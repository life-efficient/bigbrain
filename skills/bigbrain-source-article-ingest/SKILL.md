---
name: bigbrain-source-article-ingest
description: Save a web article, blog post, essay, newsletter article, or RSS article to BigBrain's articles collection. Use for individual published online sources, including Bloomberg and other publishers delivered through feeds, email, or direct URLs. For Substack posts, start with `bigbrain-substack-ingest`; for human email correspondence, use `bigbrain-email-ingest`.
---

# BigBrain Source Article Ingest

Review one canonical web article through BigBrain's single shared relevance and filing workflow.

## Contract Checklist

- Decide relevance for the user's digest before creating any Brain page or raw artifact.
- Filing is optional: the internal workflow outcomes are `ignored`, `source_only`, `source_partial`, `source_and_update`, `verified_noop`, or `needs_review`. Keep these labels in operational state and tool handoffs only; never present them as user-facing output categories.
- This skill is the sole article relevance and filing owner for RSS, Substack, email-delivered article notifications, and direct web URLs. Transport adapters must not create competing relevance rules.
- Accepted online articles, Substack posts, newsletters, and RSS-delivered publications file as first-class Markdown pages under the owning Brain's `articles/` collection. Preserve original HTML, PDFs, or other source bytes only as optional archival evidence under `articles/.raw/`.
- Apply the shared decision contract in `references/relevance-gate.md` before any source or page write.
- Read and follow [the shared ingestion completeness checklist](../bigbrain-ingest/references/ingestion-completeness.md) before writing and again before declaring completion, including when this skill is invoked directly. For articles, source capture and same-Brain read-back determine ingestion completion. Canonical entity creation and enrichment are separate work; verify any such changes actually made, but do not hold an article open for exhaustive entity coverage.
- When a registered source provides guidance, treat it as the source-specific inclusion and exclusion policy. It expresses why the source is followed and what should be prioritized or ignored.
- Do not apply one global content taxonomy across different sources. Source guidance may legitimately differ by publication, including how it treats company news, regulation, startup ideas, research, or promotion.
- Require either a clear match to the registered source guidance or a named, current user anchor: an active project, task, question, learning topic, tracked entity with live significance, or explicitly requested enrichment topic.
- First-party or promotional status is not a universal verdict. Apply the registered source guidance and current user context to decide whether the item has durable value.
- Require a short user-specific relevance rationale before any raw-file or Brain-page write.
- If relevance is ambiguous, stop before writing and either return `ignored` or ask for clarification when the intended scope cannot be inferred safely.
- Fetch and preserve the canonical source for every relevant article when the source is available and the filing rules permit it. If access ends after a substantive, identity-confirmed preview, preserve the accessible portion as an explicitly partial capture rather than discarding it.
- Visit the supplied article page and confirm that you landed on the correct article. Do not substitute another page.
- Subscriber-only or other access limits are an access constraint, not a relevance decision. Never bypass a paywall or treat a feed description, email preview, search snippet, or notification body as the article. If the canonical page confirms the article and exposes a substantive preview before the block, apply the normal relevance gate to what is actually readable and retain that portion as a partial capture when it passes. Mark the raw artifact, sidecar, and provenance as preview-only, record the access boundary, use `source_partial`, and advance the verified watermark after same-Brain read-back. If the readable material is empty, thin, mismatched, or insufficient to support the relevance decision, complete the semantic result as `needs_review` with a reason and no source or Brain content; this is not a runtime execution error.
- For RSS-triggered ingestion, use any available documented browser or article-retrieval tool to visit and verify the canonical page. Prefer the in-Codex browser (`iab`) when available, but do not block ingestion when another supported browser or retrieval path is available. Never open Finder, TextEdit, Terminal UI, an editor, a file-open dialog, or browser `file://` URLs to inspect local workflow files or state. If every supported retrieval path fails, retain the unresolved state internally and explain the access problem in natural prose.
- Keep the substantive source text faithful to the publisher; never replace it with an AI rewrite. Apply [article reading copy cleanup](references/reading-copy-cleanup.md) to bounded promotional calls to action, without treating a promotional post itself as irrelevant by default.
- Create one indexed Markdown article page containing the faithful substantive publisher text when full content is accessible. Keep provenance in frontmatter and optional unchanged raw evidence; record any promotional blocks omitted from the indexed reading copy. Apply [the Fact Sheet standard](../bigbrain-ingest/references/fact-sheet.md) as a clearly separated editorial preface when substantial facts qualify.
- Route canonical page creation and updates through `$bigbrain-page`; keep the article sidecar source-specific.
- Do not create a canonical entity page for every named organization, person, country, place, planet, or concept in a retained article. Create or update one only when it has durable standalone value, is material to active user work, or needs links and context across multiple pages; otherwise retain the reference in the article or its true owning page.
- For generic RSS work, `rss/workflow` (`rss_workflow` alias) supplies this skill and its required reference text through MCP, and `rss/ledger` (`rss_ledger` alias) supplies shared state. Read [the RSS ledger contract](references/rss-ledger.md). For Substack work, `substack/workflow` supplies the adapter workflow and `substack/ledger` supplies the same shared article state. Never open TextEdit, Finder, Terminal UI, another desktop editor, or browser `file://` URLs for local skill or ledger access. If required instructions cannot be read through MCP or a real file-reading tool, stop before retrieval or writes and return the setup gap to the caller.
- Every registered RSS feed owns verified low/high ingestion watermarks in the RSS configuration area, backed by shared per-article records. Low means the earliest retained verified post; high means the latest. Neither proves contiguous coverage. Polling cursors, queued events, ignored posts, and unresolved holes never establish retained coverage. A verified `source_partial` record is retained coverage with an explicit partial-capture note.
- Use stable provider IDs and canonical URLs for deduplication and provenance. Preserve the actual channel as `rss`, `substack`, or the most specific supported provenance type.
- Treat an unavailable or insufficient source as semantic `needs_review`, not as a successful ingestion. A substantive partial preview is `source_partial`: it is ingested successfully, advances the verified watermark after read-back, and must never be presented as a full article capture.

## Workflow

1. Establish the source and retrieve the article:
   - Before retrieval, route a Substack-originated URL or Substack RSS event through `$bigbrain-substack-ingest` for the shared ledger preflight and claim, unless this call already carries `substack_context: {ledger_preflight_complete: true, claimed: true}` from that adapter. Return to the adapter after filing so it completes the shared record. The marker prevents recursion and must represent a real held claim, not an invented bypass. A verified terminal record skips duplicate article retrieval and writes.
   - For a generic RSS event, read `rss/workflow` and follow `references/rss-ledger.md` before article retrieval. Resolve the verified listener ID and live owning Brain, register that exact feed with `feed-upsert`, record discovery, inspect shared status, then atomically claim unresolved work. Reuse adequately verified terminal outcomes for the same Brain without another fetch or write. A live competing claim is deferred. Missing tools after `$find-missing-tools` leave ingestion state unchanged and stop retrieval and writes.
   - If the Substack adapter already holds the real claim represented by `substack_context`, it owns completion. Do not open a second generic RSS claim or complete its claim here. This shared-source call returns verified evidence to the adapter. Direct URLs without a verified feed match do not invent a feed registration.
   - Use the canonical article URL from the RSS item, not only the feed description.
   - Identify the transport as RSS, Substack, email-delivered article notification, or direct URL.
   - Read registered source guidance from the event, listener, publication registry, or exact publication match before applying the relevance test.
   - For Substack, an exact canonical publication match to a registered RSS listener reuses that listener's guidance. Do not duplicate or paraphrase it into a second policy.
   - If no guidance is present, use the conservative generic test in `references/relevance-gate.md` and say that source-specific guidance was unavailable.
   - Visit the supplied article URL and confirm that the page title and publisher identify the requested article. For RSS-triggered work, follow the flexible browser and retrieval policy above. Keep the RSS or Substack preflight and claim ahead of any article retrieval.
   - If the page cannot identify the requested article, or exposes no substantive readable body, retain `needs_review` internally with no content writes. If a paywall or block follows a substantive readable portion, keep that exact portion, mark it as a partial preview in the raw artifact, sidecar, and provenance, and continue through the relevance and scoped filing workflow. Do not substitute another page, bypass access controls, or invent content beyond the visible preview.
   - Preserve the fetched source bytes through the runtime's `raw_content_source: event.source_document.raw_body` placeholder when filing.
   - Keep retrieval metadata, source URL, publisher, author, publication date, stable RSS ID, content type, and fetch status.
   - Stop with `needs_review` if the supplied page cannot be fetched or does not identify the requested article.
   - Anti-patterns: treating the RSS description as the article, stopping after one blocked transport when a substantive preview is readable, trusting a search snippet as source text, inventing missing article text, filing a partial preview as a full capture.

2. Apply the shared relevance gate before filing:
   - Apply `references/relevance-gate.md` identically regardless of transport.
   - Apply the gate to the verified readable body. A substantive, identity-confirmed partial preview is eligible for the same relevance test as a complete article; incompleteness affects capture status and watermark handling, not the relevance standard.
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
   - For an accepted article, read the shared ingestion completeness checklist and check for an existing verified copy before filing.
   - `source_only`: preserve the source and create its indexed article when the article has durable value and no canonical page change was made. Verify the article and any links actually added.
   - `source_and_update`: preserve the source and create or update at least one canonical page when it adds durable knowledge to the Brain. Verify every changed page.
   - For a relevant substantive partial preview, preserve the exact accessible source bytes separately when available and create the indexed sidecar with only logged promotional omissions and only those canonical updates supported by the visible material. Record `source_partial` with the missing-content boundary and keep the capture explicitly incomplete; do not use a full retained outcome.
   - A relevance decision accepts or rejects the article. Preserve the complete accessible substantive source in the indexed reading copy, subject only to the bounded promotional cleanup in `references/reading-copy-cleanup.md`, even when some mentioned entities receive no separate page.
   - Anti-patterns: calling an unsaved article ingested, manufacturing updates to already complete pages, making a source page the compiled truth for an entity, writing before the outcome is selected.

4. Build the article page:
   - Follow the active Brain `filing_rules` for the `articles/` collection and `articles/.raw/` path.
   - Use a collision-safe raw filename and stable article path derived from the source identity.
   - Preserve transport metadata without letting it determine relevance. Use `source_type: rss` for RSS and `source_type: substack` for Substack.
   - The indexed Markdown article page must contain the article title and faithful substantive publisher body. Keep publication metadata in frontmatter. When facts qualify under the linked Fact Sheet standard, place `## Fact Sheet` with concise attributed bullets after the title and before a clearly marked publisher-text section. Keep the remaining publisher text verbatim and in order after applying `references/reading-copy-cleanup.md` to subscription, channel-join, sponsorship, and similar promotional boilerplate. Otherwise begin directly with the publisher body. Do not add a general BigBrain summary, relevance note, or internal links to the publisher text. The writer-managed timeline may follow the standard `---` separator.
   - Preserve unchanged original source bytes in `.raw/` when useful for audit or rendering, but do not rely on raw files for searchability. Keep derived synthesis and canonical links on their own appropriate pages rather than altering the source article. If promotional blocks were omitted from the indexed copy, record their types and source locations in page provenance without repeating the sales text or contact details.
   - When capture is partial, include a prominent `Preview only` or equivalent note in the sidecar and provenance, identify where access stopped, and scope all facts and entity links to the readable portion. Never imply that the unseen remainder was reviewed.
   - Link canonical pages actually resolved or updated when the article supports the relationship. Do not require a page or link for every name before completing article ingestion. Apply `$bigbrain-page`'s standalone-value test before creating any new entity page.
   - Anti-patterns: storing the only complete substantive source in an unindexed raw file, replacing publisher text with an AI rewrite, retaining subscription or sponsorship pitches in the indexed reading copy, dropping substantive text adjacent to a pitch, omitting source links, creating incidental entity stubs, treating a source claim as independently verified, filling a Fact Sheet with trivia, filing raw files directly in entity directories.

5. Complete and verify the ingestion:
   - Execute the shared ingestion completeness checklist's article capture and saved-state verification, then check it again before reporting completion. Treat further canonical page enrichment as separate work.
   - Keep the article sidecar source-specific and use `$bigbrain-page` for canonical subjects.
   - For a generic RSS claim owned by this call, complete shared `rss/ledger` state only after same-Brain read-back of the article, using the verification envelope in `references/rss-ledger.md`, then read the post and feed status back. Record irrelevant articles as reviewed `ignored` without content writes; record unresolved source identity, capture, or verification as `needs_review` with a concrete reason and no watermark advance. Return evidence to a claiming Substack adapter instead of completing twice.
   - Reconcile the final outcome with verified writes. Use `source_only` when the article alone was verified and `source_and_update` when at least one canonical change was also verified. Report unfinished entity enrichment as a separate follow-up, not an article coverage gap.
   - For a relevant partial preview, read back every saved artifact and supported canonical update, then complete the shared record as `source_partial` with the saved paths and access limitation. Verify that any Fact Sheet bullet is supported by the readable preview and keeps its limitation visible. Verify that any promotional cleanup removed only visible boilerplate, logged its location, and did not alter the preview boundary. Verify that the RSS, Substack, or Gmail watermark advanced based on that verified partial ingestion. A successful partial capture is not full ingestion.
   - Anti-patterns: treating a linked name as a created or updated entity page, claiming an unverified entity update, declaring success without reading back the article, leaving a verified article outstanding solely for entity enrichment.

## Article Page Template

Use this shape for the indexed article, adapting metadata to the owning Brain. The body placeholder represents the accessible substantive publisher text in its original wording and order, with only logged promotional blocks omitted, not a summary:

```markdown
---
title: Article title
article_url: https://example.com/article
source_feed: feed-id
author: Author name
published_date: 2026-08-29T00:00:00Z
retrieved: 2026-08-29
rss_id: stable-id
raw_file: articles/.raw/article-slug.html
source_kind: online-article
# Only when applicable: reading_copy_omissions: ["subscription CTA after opening section"]
---

# Article title

## Fact Sheet

- [Only when substantial: attributed, contextual, source-supported recall fact. Omit this whole section otherwise.]

## Publisher text

[Faithful substantive publisher article body or clearly marked substantive preview]

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
- Discarding a substantive, relevance-clearing preview solely because the full article is blocked.
- Treating a saved partial preview as a complete article or omitting its explicit partial-capture note.
- Rewriting a strong author's prose into an AI-authored substitute.
- Keeping standalone subscription, channel-join, or sponsorship calls to action in the indexed reading copy, or removing meaningful analysis with them.
- Creating a raw artifact for an item that failed the digest-value test.
- Omitting secondary content from the saved article or manufacturing factual changes when existing coverage is sufficient.
- Using source pages as replacements for canonical entity pages.
- Reporting `filed` when the source was unavailable or the page was not read back.
- Fetching an RSS article before shared preflight, using polling cursors as ingestion proof, or treating a high watermark as permission to skip older holes.
- Opening workflow or state files through desktop apps when MCP tools are unavailable.

## Output

For RSS-triggered ingestion, respond in natural prose. First explain whether the article is relevant and why, then say whether it was ingested, partially ingested, or already covered. Mention useful source or saved-page links and explain anything that went wrong, including access failures or incomplete writes or verification. Do not emit a structured schema, decision table, category labels, or internal outcome names such as `needs_review`. Keep event IDs and operational state internal.

Include one paragraph summarizing the article's substance whenever the article was readable. A legitimate public preview may support both a summary and a partial capture when it contains enough substantive content, and the response must say that only the preview was retained. A verified duplicate may use its previously verified source content without fetching the article again. If a subscriber-only paywall or other access block leaves no reliable substantive content, explain why a reliable summary cannot be provided; never fabricate one from a title, snippet, or feed description. Do not create a source artifact or Brain page merely to produce a summary for a non-ingested article.

For other article routes, also explain the relevance, ingestion result, and any gaps in concise prose without surfacing internal outcome labels. A not-ingested article's response must make clear that nothing was added to the Brain.
