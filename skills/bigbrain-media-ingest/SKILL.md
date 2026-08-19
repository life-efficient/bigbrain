---
name: bigbrain-media-ingest
description: Ingest audio, video, podcast, or other time-based media into BigBrain while preserving complete raw support and a durable synthesis.
---

# BigBrain Media Ingest

Ingest time-based media into its canonical BigBrain subject while preserving complete source evidence.

## Contract Checklist

- Read live `filing_rules` before choosing a destination or writing.
- Treat the recording or transcript as a raw attachment, not the canonical subject page.
- Preserve the complete timestamped transcript when one is available or can reasonably be produced.
- Store transcript-like support under the owning collection's flat `.raw/` path.
- Create exactly one same-basename Markdown sidecar for each valuable raw artifact.
- For YouTube, name the transcript page from the exact video title with the exact channel name as the final suffix.
- Distill the source into a concise canonical subject-page update with links to the source sidecar.
- Preserve user-highlighted timestamps, interpretations, and significance as first-class evidence.
- Run BigBrain sync after writes, then read back the canonical page, sidecar, raw file, and raw-file listing through the owning Brain MCP.

## YouTube Naming Standard

For every YouTube transcript ingest:

- Set the transcript sidecar page title to `<exact YouTube video title> - <exact YouTube channel name>`.
- Derive the sidecar and raw transcript basename from `<slugified video title>-<slugified channel name>`.
- Keep the channel name as the final suffix in both the display title and normalized basename.
- Keep the sidecar and transcript file on the same basename, for example:
  - page title: `How New Models are Changing the AI Investment Landscape - Goldman Sachs`
  - sidecar: `concepts/.raw/how-new-models-are-changing-the-ai-investment-landscape-goldman-sachs.md`
  - transcript: `concepts/.raw/how-new-models-are-changing-the-ai-investment-landscape-goldman-sachs.srt`
- Preserve the source's displayed capitalization and punctuation in the page title where BigBrain permits it. Normalize only the file basename.
- Do not use a generated topic label, `Source and Transcript`, `Machine Transcript`, the YouTube ID, or a generic media label as the page identity.
- Use the YouTube ID in frontmatter for deduplication and provenance. If two distinct videos have the same title and channel, place a short ID disambiguator before the channel suffix so the channel remains last.
- If the video title or channel cannot be resolved from live metadata, stop before writing and resolve it. Do not invent either value.

## Workflow

1. Resolve the source and destination:
   - identify the source URL or local media, primary subject, source title, publisher or channel, and stable source ID
   - call live `filing_rules` and select the owning collection by primary subject
   - for YouTube, apply the YouTube Naming Standard before constructing any write arguments
   - Anti-patterns: filing by format, guessing the channel, using a generated summary title for a YouTube transcript page
2. Deduplicate before retrieval and mutation:
   - search the owning Brain for the stable source ID, exact title, proposed page path, and close subject matches
   - read direct candidate pages rather than treating semantic-search absence as proof of nonexistence
   - update the existing source record when the same stable source ID is already present
   - Anti-patterns: duplicate pages for the same YouTube ID, relying only on semantic search, creating before reading candidates
3. Retrieve complete source support:
   - capture metadata, duration, publication date, speakers when known, and the complete available transcript
   - prefer published manual captions, then published automatic captions, then a clearly labelled local machine transcription when captions are unavailable
   - preserve timestamp coverage and state completeness, transcription method, model, diarization status, and accuracy caveats
   - Anti-patterns: preserving only excerpts, calling a partial transcript complete, silently presenting machine transcription as human-verified
4. Create the raw transcript and indexed sidecar:
   - store the complete transcript under `<collection>/.raw/<basename>.<ext>`
   - create `<collection>/.raw/<basename>.md` as the sole indexed sidecar
   - for YouTube, use the exact video-title plus channel-suffix display title and normalized basename from the naming standard
   - include provenance, completeness, whole-source summary, section map, themes, durable conclusions, evidence caveats, related pages, and the raw-file link
   - Anti-patterns: mismatched sidecar and raw basenames, generic transcript titles, transcript sprawl in the canonical subject page
5. Update the canonical subject page:
   - add durable knowledge, mechanisms, distinctions, caveats, and links to the source sidecar
   - update an existing canonical page when the subject already has one; create a new page only for a genuinely distinct durable subject
   - separate speaker claims from independently verified facts and analytical synthesis
   - Anti-patterns: creating competing concept pages, copying the full transcript into the subject page, upgrading source claims into facts
6. Preserve explicit user highlights:
   - create a clearly labelled `User Highlight` section with timestamp, source link, the user's interpretation, and why it matters
   - preserve all explicitly highlighted passages without substituting them for the complete transcript
   - Anti-patterns: dropping the user's interpretation, preserving only the highlight, moving a highlight into unsupported fact language
7. Sync and verify:
   - run the selected Brain's maintenance sync
   - directly read back the canonical page and source sidecar
   - directly read the raw transcript and confirm it appears in the raw-file listing
   - verify the YouTube page title and basename still end with the channel suffix after any automatic raw-file or page operations
   - Anti-patterns: declaring success from a write response alone, skipping raw-file verification, allowing automatic renames to violate the YouTube naming standard

## Anti-Patterns

- Naming a YouTube transcript page after a generated concept instead of the video.
- Omitting the YouTube channel suffix from the page title or basename.
- Appending `Source and Transcript`, `Machine Transcript`, or the YouTube ID after the channel suffix.
- Dumping a long transcript into the canonical subject page.
- Treating every mentioned person or organization as a new canonical page.
- Losing raw evidence or completeness caveats.
- Manually editing Brain files after a successful owning-MCP write.
- Reporting completion without same-MCP read-back and sync verification.

## Output

Report:

- canonical subject page created or updated;
- transcript page title and path, including the YouTube channel suffix when applicable;
- complete transcript or media attachment path and explicit completeness status;
- user-highlighted timestamps preserved, if any;
- major themes and durable conclusions captured;
- sync and same-MCP read-back results;
- whether follow-on verification or enrichment is recommended.
