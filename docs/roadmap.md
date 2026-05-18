# Bigbrain Roadmap

## Direction

`bigbrain` becomes the primary personal operating stack.

It reconciles:

- the markdown corpus and workflows in `brain`
- the narrow automation seed already present in `bigbrain`
- the most useful parts of `gbrain`, without inheriting its full surface area
- a distributable runtime where brain data stays outside the repo

## Immediate Next Steps

1. Freeze scope around the architecture in `docs/architecture.md`
2. Convert `bigbrain` from task utility into a real package layout:
   - `src/bigbrain/commands/`
   - `src/bigbrain/indexing/`
   - `src/bigbrain/storage/`
   - `src/bigbrain/search/`
   - `src/bigbrain/automation/`
3. Choose the local database:
   - likely SQLite first for simplicity, unless Postgres is required from day one
4. Implement markdown sync and link extraction
5. Implement lexical search
6. Implement embeddings and RRF fusion
7. Add `search`, `query`, `get`, `put`, and `health`
8. Add migration from the current `brain` repo

## Open Design Decisions

These still need to be settled explicitly:

- SQLite vs Postgres for local-first default
- exact markdown link syntax support:
  - wikilinks only
  - markdown links only
  - both
- frontmatter contract
- chunking strategy for embeddings
- freshness automation inputs:
  - markdown change history only
  - conversation transcripts
  - meeting ingests
- whether the dashboard lives inside `bigbrain` or stays a sibling app

## My Recommendation

For the first working version:

- markdown as source of truth
- SQLite as local database
- OpenAI embeddings
- lexical search via SQLite FTS
- semantic search via stored vectors
- small local web server
- no remote auth layer

That gets the core value without recreating infrastructure overhead.
