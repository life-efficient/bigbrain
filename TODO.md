# TODO

## Recently Completed

- **2026-07-20 — Hosted MCP authorization policy:** Done. Reconciled the
  previously shipped scoped tool policy across read, create, publishing,
  destructive raw-file operations, Git backup, maintenance, and admin access.
  Hardened it to fail closed when a tool lacks a policy entry, limited new OAuth
  grants with a server-controlled scope ceiling, kept public group writes behind
  `brain:publish`, and preserved legacy `brain:write` only for non-destructive
  create/update operations.

- **2026-07-14 — Structured bounded MCP audit logging:** Done. Added
  request/event correlation, structured actor/resource/outcome and service/brain
  metadata, additive SQLite/Postgres migrations, configurable 360-day retention,
  and admin-only cursor-paginated list/NDJSON export tools. Audit access is itself
  audited, ordinary read failures remain outside the stream, and forbidden
  request/content metadata remains excluded.

- **2026-07-11 — Hosted-brain Git durability health review:** Done. Kept
  durability visibility inside the existing health check and API, made Git
  backup optional with a low-severity recommendation when it is not configured,
  and added factual warnings when configured changes are not backed up. No
  successor task is needed for the approved scope.

## Hosted Brain Service

- Keep packaging focused on the two supported product modes: local brain and
  remote brain. Docker, bundled Postgres, Supabase, and thin clients should be
  implementation details or roadmap variants around those modes.
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
- Make the desktop app a local service controller: default brain selection,
  LaunchAgent install/start/stop/restart, `/health`, direct MCP `tools/list`,
  local owner identity, and the local MCP URL for agent setup.
- Keep the dashboard endpoint-relative so the same UI works against localhost
  and hosted BigBrain endpoints.
- Add source/ingest logs so agent-written or imported knowledge can be audited
  and reversed.
- Add agent-readable install and operations docs for deploying, connecting,
  rotating secrets, restoring, reindexing, and migrating.

## Open Design Decisions

- Freshness automation inputs: markdown change history, conversation transcripts, meeting ingests, or a bounded mix.

## Decided Design Directions

- Keep the dashboard inside the shared BigBrain runtime for now. Package it
  through wrappers such as CLI, Electron, local service, Docker, and hosted
  service instead of splitting it into a separate dashboard app.

## Dashboard UI

- Add regression coverage for the graph visualizer registry and style switcher
  so future custom and vendor renderers keep the same graph contract.
- Persist graph visualizer/style preferences per user or brain instead of
  resetting them on each dashboard load.
