# TODO

## Roadmap

- Continue moving toward a package layout with clearer command, indexing,
  storage, search, and automation boundaries.
- Add migration support for existing markdown brain corpora.

## Hosted Brain Service

- Add a generic Postgres storage adapter behind `DATABASE_URL`, with pgvector
  support for embeddings.
- Store hosted MCP OAuth clients, grants, sessions, token hashes, sync runs,
  embeddings, and audit logs in durable storage rather than app-container files.
- Define remote-safe MCP tools separately from admin/maintenance tools.
- Add a bundled deployment recipe for app + local Postgres/pgvector so a shared
  brain can run without a separate managed Supabase project.
- Add migration/export/import commands so local, bundled, and remote Postgres
  backends can be moved or rebuilt cleanly.

## Search And Query

- Improve chunk-level ranking now that sync can store multiple embedding rows per page.
- Add compiled-truth-aware deduplication once chunk metadata exists.
- Add cosine re-scoring after RRF so the final ranking is not only list-position fusion.
- Add recency and salience layers once BigBrain has the metadata needed to support them cleanly.
- Add backlink-aware boosts after the link graph is reliable enough to use as a ranking signal.
- Add query-result telemetry so ranking changes can be judged against real queries instead of only spot checks.
- Add a small search cache for repeated semantic queries to reduce repeated embedding work.
- Improve answer grounding so `query` answers cite the highest-ranked result more explicitly and avoid weak generic summaries.
- Add regression fixtures for representative query shapes like direct entity lookups, project overviews, and recent-mention searches.
- Decide whether BigBrain should keep LLM query expansion on by default or move toward an intent-first default.

## Data Model

- Store chunk source or section type so future ranking can distinguish compiled truth, timeline, and raw body text.
- Add effective-date metadata to indexed rows so temporal ranking can be implemented without reparsing whole files at query time.

## Evaluation

- Build a repeatable retrieval eval harness against a fixed fixture brain home.
- Score queries on top-hit quality, top-3 quality, noise, and answer usefulness.
- Use the eval harness before and after each ranking change so search work does not drift into unmeasured tweaks.
- Add eval cases for citations, time-sensitive questions, people/company/deal
  lookups, and questions that should refuse when the brain lacks evidence.

## GBrain-Inspired Improvements

- Document explicit operating topologies: local, bundled server, remote
  database, and thin-client MCP.
- Add stdio and HTTP MCP serve modes with a consistent tool contract.
- Add a dashboard activity view for MCP clients, recent tool calls, sync status,
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

- Exact markdown link syntax support: wikilinks, markdown links, or both.
- Frontmatter contract.
- Chunk source/type metadata for embeddings.
- Freshness automation inputs: markdown change history, conversation transcripts, meeting ingests, or a bounded mix.
- Whether the dashboard should remain inside the CLI runtime or split into a separate app later.

## Dashboard UI

- Replace the hand-rolled graph renderer with a pluggable visualizer layer built around polymorphic React components.
- Start with at least one third-party graph visualizer, but keep the adapter boundary explicit so built-in custom visualizers can live beside vendor-backed ones.
- Add a subtle in-app dropdown to switch between graph visualizers without leaving the dashboard.
- Keep the graph data contract visualizer-agnostic so the same nodes and edges can feed third-party and custom renderers.
- Separate visualizer selection, graph data fetching, and graph interaction state so future renderers can reuse zoom, pan, focus, and selection behavior where possible.
