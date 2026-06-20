# TODO

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

## Raw File Storage

- Change the raw-file convention to flat files directly under each collection
  sidecar, using `<collection>/.raw/<filename>` instead of
  `<collection>/.raw/<page-slug>/<filename>` for new uploads.
- Update filing rules, schema guidance, MCP tool descriptions, ingest skills,
  docs, and tests so agents consistently create flat `.raw` paths and link them
  from the canonical markdown page.
- Add a migration/health-check path that finds existing nested `.raw`
  directories, moves files to collision-safe flat names, and rewrites
  frontmatter plus markdown links that point at the old nested locations.

## Search And Query

- Adapt GBrain's retrieval architecture as the reference model for BigBrain:
  vector search, BM25/lexical search, RRF fusion, typed graph traversal,
  source-aware ranking, reranking, token-budget enforcement, and final
  per-page deduplication. Reference:
  https://github.com/garrytan/gbrain/blob/master/docs/architecture/RETRIEVAL.md
- Port the GBrain explainability contract into BigBrain search results:
  preserve `chunk_id`, chunk/page score, source/type, boost attribution,
  evidence tag, and enough context to explain why a page ranked.
- Add GBrain-style best-chunk-per-page pooling before result limits, so one
  page with many weak chunks cannot crowd out stronger pages and each page
  surfaces on its strongest evidence.
- Add title and alias matching based on GBrain's named-thing retrieval model:
  title-phrase boosts, alias lookup/projection, evidence tags, and duplicate
  creation safety hints.
- Add deterministic intent-aware query routing like GBrain's entity, temporal,
  event, and general query classes; use it to select graph, timeline, source,
  and ranking behavior without an LLM call.
- Implement multi-query expansion in the GBrain style: optional by search mode
  or detail level, 2-3 LLM-generated query variants, each run through the full
  hybrid stack and merged via RRF rather than as a blanket default.
- Add GBrain-inspired source-aware ranking so curated folders and canonical
  pages outrank bulk or noisy sources, with temporal queries able to bypass
  normal source demotion when freshness matters.
- Add graph-aware ranking only after the graph/eval harness can prove the lift:
  typed-edge traversal, backlink/adjacency signals, and tests that relationship
  queries beat vector-only results.
- Persist query-result telemetry so ranking changes can be judged against real
  queries instead of only spot checks.
- Add a small semantic-query cache keyed by query text, model, index revision,
  and embedding model to reduce repeated embedding work.
- Add answer-grounding tests that assert generated `query` answers cite source
  slugs and refuse when retrieved context is insufficient.
- Extend the built-in retrieval eval harness beyond top-hit/top-3 fixture
  checks with noise and answer-usefulness metrics.

## Data Model

- Store chunk source or section type in indexed embedding rows so ranking can
  distinguish compiled truth, timeline, and raw body text.
- Add effective-date metadata to page, chunk, or activity rows so temporal
  ranking can be implemented without reparsing whole files at query time.

## Evaluation

- Add real-brain saved query case support for `bigbrain eval retrieval`, so
  project-specific misses can be replayed without hard-coding private data in
  the repo.
- Cover citations, time-sensitive questions, people/company/deal lookups,
  project overviews, recent-mention searches, and questions that should refuse
  when the brain lacks evidence in the eval suite.
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

## Open Design Decisions

- Freshness automation inputs: markdown change history, conversation transcripts, meeting ingests, or a bounded mix.
- Whether the dashboard should remain inside the CLI runtime or split into a separate app later.

## Dashboard UI

- Add regression coverage for the graph visualizer registry and style switcher
  so future custom and vendor renderers keep the same graph contract.
- Persist graph visualizer/style preferences per user or brain instead of
  resetting them on each dashboard load.
