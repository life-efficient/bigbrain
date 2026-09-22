---
name: bigbrain-youtube-ingest
description: Ingest a YouTube video, interview, lecture, podcast upload, or channel video into BigBrain as a discoverable first-class Video source page. Use for a YouTube URL or YouTube video ID when the user asks to save, ingest, capture, transcribe, preserve, or read a video like an article. For podcast episodes published through a podcast feed use `bigbrain-podcast-ingest`; for a summary without saving use ordinary answering; for supplied meeting notes use `bigbrain-meeting-ingest`.
---

# BigBrain YouTube Ingest

Ingest one YouTube source as a readable, discoverable Video page with exact platform provenance and a separate complete raw-transcript page.

## Contract Checklist

- Use `bigbrain-media-ingest` as the shared execution contract for filing rules, completeness, canonical reconciliation, raw artifacts, Video pages, and read-back.
- Retrieve exact `youtube_title`, `channel`, `youtube_id`, URL, description, publication date, duration, and available chapters before drafting. Preserve source identity and chapters in the saved record; redact promotional description copy when filing it.
- Create one visible Video source page for every successfully ingested video. It is the discoverable primary record in Stream and uses the exact YouTube title, channel, stable URL, and YouTube provenance. Topic, entity, or concept pages may link to it but must never replace it.
- Create two distinct records: an immutable raw-transcript page for exact captions, timestamps, and coverage notes; and a visible canonical Video page for reading. Link the canonical page to its raw source, but never combine them into one body.
- Make the canonical Video page read like an article faithful to the source, not an analyst summary: retain the argument, examples, sequence, and distinctive language while fixing caption noise and applying natural editorial structure. Do not show timestamps, transcript blocks, or raw-caption clutter in the canonical body.
- For a single-speaker source, write polished article-style prose in the speaker's voice. For an interview or multi-speaker source, preserve readable speaker-attributed dialogue and combine short consecutive turns naturally. Include meaningful source visuals inline at the point they are discussed when they can be captured faithfully.
- Use only the schema summary for page-level scanning. Do not add a Fact Sheet, executive summary, thesis section, or interpretive overview unless the user explicitly asks for one.
- Treat captions as source support, not silently human-verified transcript text; record coverage, retrieval method, diarization, accuracy caveats, and sponsor-read redactions.
- Redact paid sponsor and ad reads from the saved transcript and sidecar. Leave timestamped placeholders and a brief coverage note with the removed ranges; retain all substantive editorial content and every published chapter label.
- Follow the format examples in [canonical-page-examples.md](references/canonical-page-examples.md) before drafting the canonical Video page. Preserve source chapter sequence internally and in the raw record, but render only reader-useful headings in the canonical page.
- Do not write when exact title, channel, or stable ID cannot be verified.

## Workflow

1. Identify and validate the YouTube source:
   - Resolve the URL or ID to live metadata and preserve the exact title, channel, ID, description, chapters, and publication details.
   - Run the existing deterministic YouTube metadata validation and identity construction before any Brain or raw-file write.
   - Anti-patterns: guessing metadata, replacing the exact title with a topic label, writing before validation.
2. Check for an existing source:
   - Deduplicate by `youtube_id`, then exact title and channel and the proposed Video-page path; directly read plausible matches.
   - Update a compatible same-ID record in place, or stop for direct review when duplicate records conflict.
   - Anti-patterns: semantic-search-only deduplication, duplicate artifacts for one video, overwriting a same-ID conflict.
3. Retrieve and preserve the source:
   - Prefer published manual captions, then published automatic captions, then a clearly labelled transcription when reasonably available.
   - Parse and preserve every published chapter label and its source order.
   - Parse chapters from the full retrieved description first. In the saved description, replace sponsor offers, tracking links, and promotional copy with a brief `[Sponsor promotion redacted]` note while retaining non-promotional context and the timestamp block.
   - Identify paid sponsor and ad reads by their promotional function, including host-read ads, pre-rolls, mid-rolls, and calls to visit, subscribe to, or buy from an advertiser. Redact only those spans from the transcript to be filed. Replace each span with a timestamped `[Sponsor read redacted]` placeholder; list its start and end time in the sidecar coverage note. Approximate boundaries must be labelled approximate.
   - Keep editorial discussion, interview answers, material disclosures, and facts needed to understand the argument even when they mention a brand. If a sponsor read shares a chapter with substantive discussion, remove only the promotional portion. Keep the published chapter heading, including a sponsor-labelled heading, and note the redaction below it when appropriate.
   - Delegate the shared media-ingest workflow for separate raw-transcript storage, the reader-facing canonical Video page, canonical entity reconciliation, and verification.
   - Draft the canonical body against [canonical-page-examples.md](references/canonical-page-examples.md). Preserve substance and source order, but convert spoken or captioned material into natural article or dialogue form. Add source visuals inline only when they materially aid reading and their placement is clear from the source.
   - Anti-patterns: excerpt-only capture, merged chapters, calling partial coverage complete, analytical rewriting of the source, timestamping the canonical page, transcript dumps, invented visuals, deleting whole mixed-content chapters, silently omitting ad spans.
4. Verify completion:
   - Read back the separate canonical Video page and raw-transcript page, metadata, chapter structure, and any canonical updates through the owning Brain.
   - Check that each sponsor-read range has a transcript placeholder and Video-page coverage note, and that no ad copy remains in the Video page or saved transcript.
   - Confirm the Video page title derives from the exact video title, its source metadata identifies the channel, its `video_url` works, its `source_type` is `youtube`, and its YouTube ID is present for provenance and deduplication.
   - Anti-patterns: trusting a write response, skipping raw-artifact verification, reporting completion with unresolved metadata or coverage gaps.

## YouTube Identity and Video Page Standard

Use the shared media-ingest implementation and its `validateYouTubeMetadata`, `buildYouTubeIdentity`, `findYouTubeRecordById`, `assertExistingYouTubeRecordCompatible`, `parseYouTubeChapters`, and `validateYouTubeSidecar` safeguards. The Video page title starts with the exact YouTube title and identifies the channel in source metadata. Its normalized basename is derived from the video title followed by the channel name, with a short ID disambiguator only when distinct videos collide.

The Video page includes the direct YouTube URL, channel, publication date, duration, concise caption-coverage caveats, a raw-transcript link, and links to genuinely updated canonical pages. Its main body is the source turned into a readable article: article-style prose for one speaker, or clear dialogue for multiple speakers. The raw transcript remains the authority for exact wording and timestamps. The Video page is a faithful reading version, not a short thematic summary, a Fact Sheet, a transcript dump, or a new analyst thesis. See [canonical-page-examples.md](references/canonical-page-examples.md).

## Anti-Patterns

- Do not file a YouTube source as generic media when the YouTube adapter applies.
- Do not treat a transcript generated from captions as human-verified.
- Do not leave a successful video ingest only as a raw sidecar or hide it behind a concept page.
- Do not create a Video page without the raw transcript or a clearly documented retrieval gap.
- Do not put timestamps, raw captions, a Fact Sheet, or an interpretive executive summary into the canonical page unless the user explicitly requests them.
- Do not save a second unredacted ad copy artifact as a workaround; the source URL and redaction ranges provide provenance.
- Do not create concept pages for every topic mentioned; reconcile only durable, independently reusable knowledge.

## Output

Briefly report the exact video title and channel, visible Video page, preserved transcript and chapter coverage, canonical pages created or updated, Stream visibility, and read-back status. State any caption, transcription, access, or metadata gaps.
