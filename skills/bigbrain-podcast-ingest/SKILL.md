---
name: bigbrain-podcast-ingest
description: Ingest a published podcast episode or podcast audio into BigBrain. Use for a podcast RSS item, episode page, podcast URL, show episode, or supplied podcast audio when the user asks to save, ingest, capture, or transcribe it. For YouTube uploads use `bigbrain-youtube-ingest`; for local or unsupported recordings use `bigbrain-media-ingest`; for a summary without saving use ordinary answering.
---

# BigBrain Podcast Ingest

Ingest one podcast episode with feed-aware provenance, complete transcript support, and a chronological BigBrain sidecar.

## Contract Checklist

- Use `bigbrain-media-ingest` as the shared execution contract for filing rules, completeness, canonical reconciliation, raw artifacts, sidecars, and read-back.
- Preserve the exact episode title, show name, publisher, canonical episode URL, RSS GUID or stable episode ID, publication date, duration, description, and speakers when available.
- Prefer an official publisher transcript; otherwise use clearly labelled transcription of supplied or legally accessible audio and record coverage and accuracy caveats.
- Follow the shared media skill's [Fact Sheet standard](../bigbrain-ingest/references/fact-sheet.md) for substantial attributed quantitative facts supported by the verified transcript. Default to numbers with units, time periods, and comparison baselines; omit the section when none qualify.
- Do not write when the episode identity or source content cannot be verified.

## Workflow

1. Identify and validate the episode:
   - Resolve the podcast URL, RSS item, or supplied audio to the canonical episode and preserve exact feed and publisher metadata.
   - Establish the stable identity using RSS GUID or provider episode ID, falling back to the canonical episode URL only when necessary.
   - Read live filing rules and select the owning collection by primary subject, not by the podcast format.
   - Anti-patterns: treating an RSS description as the transcript, guessing the show or episode identity, filing by format alone.
2. Check for an existing source:
   - Deduplicate by stable episode ID, canonical URL, exact episode title and show, and proposed sidecar path; directly read plausible matches.
   - Update a compatible existing source in place or stop for direct review when identities conflict.
   - Anti-patterns: title-only deduplication, duplicate artifacts for one episode, overwriting conflicting provenance.
3. Retrieve and preserve the source:
   - Prefer a complete official transcript, then a complete accessible audio transcription; record whether speakers were diarized and any missing sections.
   - Preserve episode metadata and the complete raw transcript under the owning collection `.raw/` path with one same-basename sidecar.
   - Delegate shared media-ingest rules for chronological exposition, canonical entity reconciliation, and verification while retaining podcast-specific provenance.
   - Anti-patterns: excerpt-only capture, presenting machine output as verified, replacing chronology with a thematic summary, writing an inaccessible episode as complete.
4. Verify completion:
   - Read back the episode sidecar, raw transcript, source metadata, and any canonical updates through the owning Brain.
   - Confirm the stable episode identity, canonical source link, coverage method, transcript gaps, and raw-file linkage.
   - Anti-patterns: trusting a write response, skipping raw-artifact verification, advancing from an unresolved or partial retrieval.

## Podcast Identity Standard

Podcast identity is episode-specific. Preserve show and episode names separately, retain the canonical episode URL, and record the RSS GUID or provider ID whenever available. A display title may combine episode and show names for readability, but it must not replace the raw identity fields. If no stable provider ID exists, use the canonical URL and record that fallback explicitly.

## Anti-Patterns

- Do not route a podcast RSS episode through the YouTube-specific workflow merely because it contains audio or video.
- Do not treat a publisher description, show notes, or search result as a transcript.
- Do not invent speaker attribution or fill missing audio coverage silently.
- Do not create concept pages for every topic mentioned; reconcile only durable, independently reusable knowledge.

## Output

Briefly report the exact episode and show, preserved source and transcript coverage, source artifacts, canonical pages created or updated, and read-back status. State any access, transcription, speaker, or coverage gaps.
