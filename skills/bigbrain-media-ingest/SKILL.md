---
name: bigbrain-media-ingest
description: Ingest audio, video, podcasts, or other time-based media into BigBrain as complete raw evidence plus a faithful chronological source exposition.
---

# BigBrain Media Ingest

Preserve time-based media and create a comprehensive, readable account of what the source communicates from beginning to end.

## Contract Checklist

- Read live `filing_rules` before choosing a destination or writing.
- Deduplicate by stable source ID, exact title, proposed path, and direct reads of plausible matches.
- Preserve the complete timestamped transcript when one is available or can reasonably be produced.
- Store the transcript under the owning collection's flat `.raw/` path with exactly one same-basename Markdown sidecar.
- For YouTube, use the exact video title with the exact channel name as the final suffix of the sidecar title and normalized basename.
- Make the sidecar a comprehensive chronological prose exposition, not a condensed thematic summary or an analytical rewrite.
- Write as a third-person observer taking detailed, readable meeting minutes: preserve the source's sequence, substance, reported facts, definitions, examples, evidence, counterarguments, qualifications, and key short quotes without forcing them into a rigid schema.
- Attribute claims to the source and distinguish what the source reports from independently verified facts. Do not add an unlabelled agent take.
- Treat canonical concept enrichment as optional. Create or update a concept page only when the source materially improves a durable subject beyond the source itself.
- Run BigBrain sync after writes, then read back the sidecar and raw transcript through the owning Brain MCP. Read back any optional canonical update as well.

## YouTube Naming Standard

For every YouTube transcript ingest:

- Set the sidecar title to `<exact YouTube video title> - <exact YouTube channel name>`.
- Derive the sidecar and raw transcript basename from `<slugified video title>-<slugified channel name>`.
- Keep the channel name as the final suffix in both the display title and normalized basename.
- Preserve source capitalization and punctuation in the display title where BigBrain permits it. Normalize only the basename.
- Store the YouTube ID in frontmatter for deduplication and provenance.
- If distinct videos share a title and channel, place a short ID disambiguator before the channel suffix.
- If live metadata cannot resolve the exact title or channel, stop before writing. Do not invent either value.

## Source Exposition Standard

The sidecar should feel like a written version of the recording prepared by an attentive third-person observer. Follow the source's natural progression and use readable paragraphs and descriptive headings where they help. Do not turn the page into a form, ledger, database, or repeated checklist.

As the source unfolds, naturally preserve the material a future reader would need to understand what happened and what was communicated. This can include what was discussed, reported facts and figures, definitions and terminology, examples and case studies, speaker or narrator claims, supporting evidence, counterarguments, qualifications, transitions in the argument, and concise key quotes. These are prompts for faithful writing, not required headings or a rigid schema.

Aim for comprehensive coverage rather than maximal compression. A reader should be able to follow the full source without watching it, while the raw transcript remains the authority for exact wording. Timestamps are optional navigation aids for especially useful passages, user highlights, or key quotes; timestamp ranges are not required throughout the exposition.

Keep the exposition observational. It may explain how one part leads to the next, but it should not replace the source's structure with a new framework or silently derive its own conclusions. If agent analysis would add durable value, place it on an optional canonical concept page or in a clearly labelled, brief analytical note that cannot be confused with the source account.

## Workflow

1. Resolve the source and destination:
   - identify the source URL or local media, exact title, publisher or channel, stable source ID, duration, publication date, speakers when known, and primary subject
   - call live `filing_rules` and select the owning collection by primary subject rather than media format
   - apply the YouTube Naming Standard before constructing any write arguments
   - Anti-patterns: filing by format, guessing metadata, using a generated topic label as the source identity
2. Deduplicate before retrieval or mutation:
   - search for the stable source ID, exact title, proposed sidecar path, and close source matches
   - directly read plausible matches and update the existing source record when the stable ID already exists
   - Anti-patterns: creating from semantic-search absence, duplicate pages for one source, reading only snippets
3. Retrieve complete source support:
   - prefer published manual captions, then published automatic captions, then a clearly labelled local transcription
   - preserve the complete available transcript and record coverage, method, diarization status, and accuracy caveats
   - retain source metadata and any user-highlighted passages or interpretations
   - Anti-patterns: excerpt-only capture, calling a partial transcript complete, presenting machine captions as human-verified
4. Write the raw transcript and chronological sidecar:
   - upload the transcript to `<collection>/.raw/<basename>.<ext>` and create the sole same-basename sidecar
   - write a faithful chronological exposition using the Source Exposition Standard
   - preserve source claims as attributed claims and integrate concise key quotes only where their wording materially matters
   - link the sidecar to its raw transcript and any directly relevant existing pages
   - Anti-patterns: condensed thematic summary, rigid fact ledger or glossary schema, agent-authored thesis replacing the source, long transcript copy in the Markdown page
5. Consider optional canonical enrichment:
   - search and read before any concept write
   - update an existing canonical page only when the recording contributes independently reusable knowledge beyond its own account
   - create a new concept page only for a genuinely distinct, durable concept, not for every chapter, fact, person, or example
   - keep source exposition on the sidecar and analytical synthesis on the canonical page
   - Anti-patterns: mandatory canonical update, concept-page fanout, copying the exposition into a concept page, upgrading source claims into facts
6. Sync and verify through the owning Brain:
   - run maintenance sync
   - read back the sidecar and confirm its exact title, stable source metadata, raw-file link, chronological coverage, and evidence caveats
   - read back the raw transcript, compare its bytes when practical, and confirm it appears in the raw-file listing
   - read back any optional canonical page and verify its link to the source sidecar
   - Anti-patterns: declaring success from a write response, skipping raw-file verification, reporting an optional concept update that was not read back

## Anti-Patterns

- Treating the sidecar as a short summary, list of takeaways, or new analytical framework.
- Reorganizing the source primarily by themes when that loses its original progression.
- Requiring timestamp ranges, a fact ledger, a glossary, or a coverage matrix as fixed sidecar sections.
- Omitting quantitative claims, terminology, examples, evidence, counterarguments, or key quotes merely because they are inconvenient to summarize.
- Treating every mentioned entity or concept as a reason to create another Brain page.
- Confusing source-reported claims with independently verified facts.
- Reporting completion without same-MCP sync and read-back.

## Output

Report:

- the sidecar title and path;
- the raw transcript or media path, completeness status, and transcription caveats;
- the source's coverage and progression preserved in the exposition;
- user-highlighted passages preserved, if any;
- any optional canonical page created or updated, or that none was needed;
- sync, raw-file, and same-MCP read-back verification;
- any material source gaps or transcription limitations.
