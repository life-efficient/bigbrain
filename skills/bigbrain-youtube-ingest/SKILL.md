---
name: bigbrain-youtube-ingest
description: Ingest a YouTube video, interview, lecture, podcast upload, or channel video into BigBrain. Use for a YouTube URL or YouTube video ID when the user asks to save, ingest, capture, transcribe, or preserve the video. For podcast episodes published through a podcast feed use `bigbrain-podcast-ingest`; for a summary without saving use ordinary answering; for supplied meeting notes use `bigbrain-meeting-ingest`.
---

# BigBrain YouTube Ingest

Ingest one YouTube source with exact platform provenance, complete transcript support, and a chronological BigBrain sidecar.

## Contract Checklist

- Use `bigbrain-media-ingest` as the shared execution contract for filing rules, completeness, canonical reconciliation, raw artifacts, sidecars, and read-back.
- Retrieve exact `youtube_title`, `channel`, `youtube_id`, URL, description, publication date, duration, and available chapters before drafting. Preserve source identity and chapters in the saved record; redact promotional description copy when filing it.
- Treat captions as source support, not silently human-verified transcript text; record coverage, retrieval method, diarization, accuracy caveats, and sponsor-read redactions.
- Redact paid sponsor and ad reads from the saved transcript and sidecar. Leave timestamped placeholders and a brief coverage note with the removed ranges; retain all substantive editorial content and every published chapter label.
- Follow the shared media skill's [Fact Sheet standard](../bigbrain-ingest/references/fact-sheet.md): add a near-top `## Fact Sheet` only for substantial attributed facts supported by the verified transcript; preserve the source chapter sequence.
- Do not write when exact title, channel, or stable ID cannot be verified.

## Workflow

1. Identify and validate the YouTube source:
   - Resolve the URL or ID to live metadata and preserve the exact title, channel, ID, description, chapters, and publication details.
   - Run the existing deterministic YouTube metadata validation and identity construction before any Brain or raw-file write.
   - Anti-patterns: guessing metadata, replacing the exact title with a topic label, writing before validation.
2. Check for an existing source:
   - Deduplicate by `youtube_id`, then exact title and channel and the proposed sidecar path; directly read plausible matches.
   - Update a compatible same-ID record in place, or stop for direct review when duplicate records conflict.
   - Anti-patterns: semantic-search-only deduplication, duplicate artifacts for one video, overwriting a same-ID conflict.
3. Retrieve and preserve the source:
   - Prefer published manual captions, then published automatic captions, then a clearly labelled transcription when reasonably available.
   - Parse and preserve every published chapter label and its source order.
   - Parse chapters from the full retrieved description first. In the saved description, replace sponsor offers, tracking links, and promotional copy with a brief `[Sponsor promotion redacted]` note while retaining non-promotional context and the timestamp block.
   - Identify paid sponsor and ad reads by their promotional function, including host-read ads, pre-rolls, mid-rolls, and calls to visit, subscribe to, or buy from an advertiser. Redact only those spans from the transcript to be filed. Replace each span with a timestamped `[Sponsor read redacted]` placeholder; list its start and end time in the sidecar coverage note. Approximate boundaries must be labelled approximate.
   - Keep editorial discussion, interview answers, material disclosures, and facts needed to understand the argument even when they mention a brand. If a sponsor read shares a chapter with substantive discussion, remove only the promotional portion. Keep the published chapter heading, including a sponsor-labelled heading, and note the redaction below it when appropriate.
   - Delegate the shared media-ingest workflow for raw transcript storage, chronological sidecar prose, canonical entity reconciliation, and verification.
   - Anti-patterns: excerpt-only capture, merged chapters, calling partial coverage complete, analytical rewriting of the source, deleting whole mixed-content chapters, silently omitting ad spans.
4. Verify completion:
   - Read back the sidecar, raw transcript, metadata, chapter structure, and any canonical updates through the owning Brain.
   - Check that each sponsor-read range has a transcript placeholder and sidecar coverage note, and that no ad copy remains in the sidecar or saved transcript.
   - Confirm the sidecar title and basename derive from the exact video title and channel, and that the YouTube ID is present for provenance and deduplication.
   - Anti-patterns: trusting a write response, skipping raw-artifact verification, reporting completion with unresolved metadata or coverage gaps.

## YouTube Identity Standard

Use the shared media-ingest implementation and its `validateYouTubeMetadata`, `buildYouTubeIdentity`, `findYouTubeRecordById`, `assertExistingYouTubeRecordCompatible`, `parseYouTubeChapters`, and `validateYouTubeSidecar` safeguards. The sidecar title is `<exact YouTube video title> - <exact YouTube channel name>`, and the normalized basename is derived from the video title followed by the channel name, with a short ID disambiguator only when distinct videos collide.

## Anti-Patterns

- Do not file a YouTube source as generic media when the YouTube adapter applies.
- Do not treat a transcript generated from captions as human-verified.
- Do not create a source page without the raw transcript or a clearly documented retrieval gap.
- Do not save a second unredacted ad copy artifact as a workaround; the source URL and redaction ranges provide provenance.
- Do not create concept pages for every topic mentioned; reconcile only durable, independently reusable knowledge.

## Output

Briefly report the exact video title and channel, preserved transcript and chapter coverage, source artifacts, canonical pages created or updated, and read-back status. State any caption, transcription, access, or metadata gaps.
