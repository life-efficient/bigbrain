# BigBrain YouTube Ingest forward tests

## Should trigger

Prompt: `Ingest this YouTube interview into my Brain.`

Expected behavior: select the YouTube-specific skill, preserve exact title, channel, ID, and chapters, deduplicate by ID, and delegate shared media artifact and canonical-page verification.

## Should not trigger

Prompt: `Give me a quick three-bullet summary of this video without saving it.`

Expected behavior: answer as a summary request without ingestion or Brain writes.

## Neighboring-skill boundary

Prompt: `Ingest this podcast episode from its RSS feed.`

Expected behavior: select `bigbrain-podcast-ingest`, not this skill.
