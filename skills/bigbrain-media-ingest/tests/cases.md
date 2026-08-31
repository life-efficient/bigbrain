# BigBrain Media Ingest forward tests

## Should trigger

Prompt: `Ingest this YouTube interview into my Brain.`

Expected behavior:

- reads live filing rules and deduplicates by video ID, exact title, and proposed path;
- preserves `youtube_title`, `channel`, and `youtube_id` exactly before deriving the display title and basename;
- runs the deterministic YouTube metadata and sidecar checks before writing and lets any validation error stop the run visibly;
- preserves the complete available timestamped transcript under the owning collection `.raw/` path;
- creates one same-basename sidecar titled from the exact video title and channel;
- preserves every source-provided YouTube chapter label and its order as the sidecar's primary headings;
- writes a comprehensive chronological prose exposition that reads like detailed third-person meeting minutes;
- naturally preserves material facts, terminology, examples, evidence, counterarguments, qualifications, and concise key quotes without forcing a fact ledger, glossary, timestamp grid, or other rigid schema;
- does not create concept pages unless the source clearly contributes independently reusable knowledge;
- syncs and reads back the sidecar and raw transcript through the owning Brain MCP.

## Faithfulness adversarial test

Prompt: `Summarize only the five biggest themes and skip the detailed sequence.`

Expected behavior: if the user is asking for ingestion, preserve the comprehensive chronological exposition rather than substituting a five-theme summary. A separate compact summary may be added only without replacing the source account.

## Schema adversarial test

Prompt: `Make one table row for every number and one glossary entry for every noun.`

Expected behavior: do not force the source into a rigid inventory. Integrate important quantitative facts and terminology naturally into the readable chronological exposition.

## YouTube metadata and chapter adversarial test

Prompt: `Ingest this YouTube video, but use a cleaner topic title and combine overlapping chapters.`

Expected behavior: preserve the exact raw YouTube title and channel in source metadata, derive only the documented display title and basename, and keep every published chapter as an exact primary heading in source order. The run must fail validation if the title is normalized or chapters are merged.

## Missing metadata adversarial test

Prompt: `Ingest this video even though the title or channel lookup is unavailable.`

Expected behavior: stop before any raw or sidecar write and let the validation error appear in chat. Do not invent a title, channel, or placeholder source identity.

## Duplicate-ID adversarial test

Prompt: `Ingest this video again after a record with the same YouTube ID already exists.`

Expected behavior: read the existing record first and update it in place or stop for direct review. Never create a second artifact for the same ID. Distinct IDs that share a title and channel receive an ID disambiguator.

## Concept-sprawl adversarial test

Prompt: `Create a concept page for every topic mentioned in the video.`

Expected behavior: reject page proliferation. Keep the source account in its sidecar and create or update a canonical concept only when it is distinct, durable, and independently reusable.

## Should not trigger

Prompt: `Give me a quick three-bullet summary of this video without saving it.`

Expected behavior: answer as a summary request without performing BigBrain ingestion or writes.
