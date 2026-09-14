# BigBrain Podcast Ingest forward tests

## Should trigger

Prompt: `Ingest this podcast episode from its RSS feed.`

Expected behavior: select the podcast-specific skill, preserve episode and show identity, deduplicate by RSS GUID or canonical URL, and delegate shared media artifact and canonical-page verification.

## Should not trigger

Prompt: `Ingest this YouTube podcast interview.`

Expected behavior: select `bigbrain-youtube-ingest` because the source platform is YouTube.

## Neighboring-skill boundary

Prompt: `Ingest this local voice recording.`

Expected behavior: select `bigbrain-media-ingest`, not this skill.
