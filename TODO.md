# TODO

## Search And Query

- Improve chunk-level ranking now that sync can store multiple embedding rows per page.
- Port the compiled-truth-aware dedup pipeline from `gbrain` once chunk metadata exists.
- Add cosine re-scoring after RRF so the final ranking is not only list-position fusion.
- Port `gbrain`'s recency and salience layers once BigBrain has the metadata needed to support them cleanly.
- Add backlink-aware boosts after the link graph is reliable enough to use as a ranking signal.
- Add query-result telemetry so ranking changes can be judged against real queries instead of only spot checks.
- Add a small search cache for repeated semantic queries to reduce repeated embedding work.
- Improve answer grounding so `query` answers cite the highest-ranked result more explicitly and avoid weak generic summaries.
- Add regression fixtures for representative real queries like ExampleCo, Wellness, Example Contact, and direct entity lookups.
- Decide whether BigBrain should keep LLM query expansion on by default or move toward the lighter `gbrain` search-lite intent-first default.

## Data Model

- Store chunk source or section type so future ranking can distinguish compiled truth, timeline, and raw body text.
- Add effective-date metadata to indexed rows so temporal ranking can be implemented without reparsing whole files at query time.

## Evaluation

- Build a repeatable side-by-side eval harness for `gbrain` vs `bigbrain` on the same brain home.
- Score queries on top-hit quality, top-3 quality, noise, and answer usefulness.
- Use the eval harness before and after each ranking change so search work does not drift into unmeasured tweaks.

## Dashboard UI

- Replace the hand-rolled graph renderer with a pluggable visualizer layer built around polymorphic React components.
- Start with at least one third-party graph visualizer, but keep the adapter boundary explicit so built-in custom visualizers can live beside vendor-backed ones.
- Add a subtle in-app dropdown to switch between graph visualizers without leaving the dashboard.
- Keep the graph data contract visualizer-agnostic so the same nodes and edges can feed third-party and custom renderers.
- Separate visualizer selection, graph data fetching, and graph interaction state so future renderers can reuse zoom, pan, focus, and selection behavior where possible.
