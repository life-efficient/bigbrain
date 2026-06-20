# TODO

## Roadmap

- Split the largest runtime modules into clearer command, storage, search,
  MCP, and automation packages once the current CLI/MCP contracts stabilize.

## Hosted Brain Service

- Persist sync run history and write MCP audit log entries through the Postgres
  backend; OAuth client/state/code/token records and embeddings are already
  database-backed for hosted deployments.
- Add a tool policy layer for hosted MCP that separates read-only tools,
  append/create tools, destructive raw-file updates/deletes, git backup, and
  maintenance/admin operations by auth mode or scope.
- Turn the documented bundled app + local Postgres/pgvector deployment shape
  into a checked-in runnable template with health-check and `db doctor` steps.
- Add export/import commands for moving runtime state between local SQLite,
  bundled Postgres, and remote Postgres; markdown import and sqlite-to-postgres
  migration already exist.

## Search And Query

- Preserve winning chunk metadata in fused results: `chunk_id`, chunk score,
  chunk source/type, and enough context to explain why a page ranked.
- Add compiled-truth-aware deduplication after chunk source/type metadata is in
  the embeddings table, so repeated body chunks do not outrank canonical truth.
- Add a final score pass after RRF that combines normalized lexical score,
  cosine similarity, exact-match boosts, and intent weights in an inspectable
  way.
- Add recency and salience boosts after effective dates and page/activity
  metadata are indexed.
- Add backlink-aware boosts using the existing indexed link graph, with tests
  that prove canonical pages beat isolated mentions.
- Persist query-result telemetry so ranking changes can be judged against real
  queries instead of only spot checks.
- Add a small semantic-query cache keyed by query text, model, index revision,
  and embedding model to reduce repeated embedding work.
- Add answer-grounding tests that assert generated `query` answers cite source
  slugs and refuse when retrieved context is insufficient.
- Promote the existing search regression cases into a repeatable retrieval eval
  harness that reports top-hit, top-3, noise, and answer-usefulness metrics.
- Decide whether LLM query expansion should remain automatic, become
  intent-first, or require an explicit flag; tests already cover the current
  auto-expansion heuristics.

## Data Model

- Store chunk source or section type in indexed embedding rows so ranking can
  distinguish compiled truth, timeline, and raw body text.
- Add effective-date metadata to page, chunk, or activity rows so temporal
  ranking can be implemented without reparsing whole files at query time.

## Evaluation

- Add a `bigbrain eval retrieval` command or script that runs the fixed fixture
  brain, scores saved query cases, and emits JSON plus a compact text summary.
- Cover citations, time-sensitive questions, people/company/deal lookups,
  project overviews, recent-mention searches, and questions that should refuse
  when the brain lacks evidence.
- Require the eval harness before and after ranking changes so search work does
  not drift into unmeasured tweaks.

## GBrain-Inspired Improvements

- Add a stdio MCP serve mode that shares the same tool contract as the existing
  HTTP MCP server.
- Add dashboard APIs and UI for MCP clients, recent tool calls, sync status,
  embedding backlog, and write attribution.
- Add source/ingest logs so agent-written or imported knowledge can be audited
  and reversed.
- Add agent-readable install and operations docs for deploying, connecting,
  rotating secrets, restoring, reindexing, and migrating.
- Keep schema/type behavior simple and tied to BigBrain's typed folders rather
  than adopting a complex schema-pack system prematurely.
- Keep maintenance jobs explicit, scheduled, and inspectable rather than adding
  always-on autonomous worker loops.

## Open Design Decisions

- Freshness automation inputs: markdown change history, conversation transcripts, meeting ingests, or a bounded mix.
- Whether the dashboard should remain inside the CLI runtime or split into a separate app later.

## Dashboard UI

- Add regression coverage for the graph visualizer registry and style switcher
  so future custom and vendor renderers keep the same graph contract.
- Persist graph visualizer/style preferences per user or brain instead of
  resetting them on each dashboard load.
