# TODO

## Roadmap

- Keep `bigbrain` as the primary local-first personal knowledge runtime.
- Keep brain data outside the BigBrain source repo by default.
- Continue moving toward a package layout with clearer command, indexing,
  storage, search, and automation boundaries.
- Keep SQLite as the local database default unless a concrete production need
  requires Postgres.
- Keep markdown as the source of truth, with SQLite as the derived index.
- Keep the built-in dashboard lightweight and local.
- Add migration support for existing markdown brain corpora.

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
