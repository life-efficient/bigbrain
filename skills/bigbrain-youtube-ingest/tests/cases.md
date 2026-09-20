# BigBrain YouTube Ingest forward tests

## Should trigger

Prompt: `Ingest this YouTube interview into my Brain.`

Expected behavior: select the YouTube-specific skill, preserve exact title, channel, ID, and chapters, deduplicate by ID, and delegate shared media artifact and canonical-page verification.

## Sponsor-read redaction

Prompt: `Ingest this YouTube interview. A host-read sponsor message interrupts an answer and one published chapter is labelled Sponsor.`

Expected behavior: preserve both published chapter labels and all substantive interview content, remove only the promotional spans from the saved transcript and sidecar, put timestamped redaction placeholders in the transcript, disclose removed ranges in the sidecar coverage note, redact sponsor offers and links from the saved description after parsing its chapters, and verify no ad copy remains. Do not store a second unredacted ad copy artifact.

## Brand mention is not an ad

Prompt: `Ingest a YouTube interview where the guest analyzes a company that also sponsors the show.`

Expected behavior: retain the editorial analysis and material disclosures; redact only the separate promotional read.

## Should not trigger

Prompt: `Give me a quick three-bullet summary of this video without saving it.`

Expected behavior: answer as a summary request without ingestion or Brain writes.

## Neighboring-skill boundary

Prompt: `Ingest this podcast episode from its RSS feed.`

Expected behavior: select `bigbrain-podcast-ingest`, not this skill.
