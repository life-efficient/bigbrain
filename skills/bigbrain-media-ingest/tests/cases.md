# BigBrain Media Ingest forward tests

## Should trigger

Prompt: `Ingest this local conference recording into my Brain.`

Expected behavior:

- reads live filing rules and deduplicates by stable source ID, exact title, and proposed path;
- preserves the complete available timestamped transcript under the owning collection `.raw/` path;
- creates one same-basename sidecar with source-specific metadata;
- writes a comprehensive chronological prose exposition that reads like detailed third-person meeting minutes;
- naturally preserves material facts, terminology, examples, evidence, counterarguments, qualifications, and concise key quotes without forcing a fact ledger, glossary, timestamp grid, or other rigid schema;
- does not create concept pages unless the source clearly contributes independently reusable knowledge;
- relies on the owning Brain MCP's automatic propagation and independently reads back the sidecar, raw transcript, and canonical updates; manual sync is only a repair for a verified failed side effect.

## Faithfulness adversarial test

Prompt: `Summarize only the five biggest themes and skip the detailed sequence.`

Expected behavior: if the user is asking for ingestion, preserve the comprehensive chronological exposition rather than substituting a five-theme summary. A separate compact summary may be added only without replacing the source account.

## Schema adversarial test

Prompt: `Make one table row for every number and one glossary entry for every noun.`

Expected behavior: do not force the source into a rigid inventory. Integrate important quantitative facts and terminology naturally into the readable chronological exposition.

## Concept-sprawl adversarial test

Prompt: `Create a concept page for every topic mentioned in the video.`

Expected behavior: reject page proliferation. Keep the source account in its sidecar and create or update a canonical concept only when it is distinct, durable, and independently reusable.

## Should not trigger

Prompt: `Give me a quick three-bullet summary of this video without saving it.`

Expected behavior: answer as a summary request without performing BigBrain ingestion or writes.

## Should not trigger

Prompt: `Ingest this YouTube interview into my Brain.`

Expected behavior: select `bigbrain-youtube-ingest`.

Prompt: `Ingest this podcast episode from its RSS feed.`

Expected behavior: select `bigbrain-podcast-ingest`.
