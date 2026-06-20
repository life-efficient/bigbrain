# BigBrain Runtime Notes

This directory holds the runtime implementation for `bigbrain`.

## Search And Query

The current retrieval stack in [search.js](./search.js) is deliberately small
and inspectable. It combines lexical retrieval, optional semantic retrieval,
and lightweight fusion rather than trying to hide ranking behind a larger
engine.

### Current flow

1. `queryBrain()` calls `searchBrain()` and then sends the fused result context
   to `answerQuestion()` in [openai.js](./openai.js).
2. `searchBrain()` decides whether the query should auto-expand.
   - direct entity/title lookups stay unexpanded
   - broader question-style queries can expand into up to 2 alternate
     phrasings through `expandQueryVariants()`
3. Each query variant runs:
   - lexical retrieval from SQLite FTS5 via `lexicalSearch()` in [db.js](./db.js)
   - semantic retrieval from stored embedding chunks
4. The ranked lists are merged with reciprocal-rank fusion:
   - multiple ranked lists
   - weighted RRF
   - light intent-based weighting
   - exact-match boost for direct entity lookups
   - lexical tie-break preference when fused scores are equal
5. The fused results become the retrieval context for answer generation.
6. `queryBrain()` formats that context so the answer model sees:
   - the top-ranked source slugs first
   - then the retrieved summaries/snippets for the full fused set
7. `answerQuestion()` answers only from that retrieved context and is told to:
   - prefer the top-ranked sources when possible
   - cite source slugs inline
   - admit when the context is insufficient instead of guessing

### Current heuristics

#### Expansion default

Expansion is no longer "always on when an API key exists."

The current heuristic is:

- no expansion for short/direct lookups such as `Jordan Lee` or `Who is Jordan Lee?`
- yes expansion for broader question-style queries such as:
  - `What's next on my TODO list?`
  - `what did i mention recently about example ai?`
  - `What seed-stage companies have I advised?`

The current implementation lives in `shouldAutoExpandQuery()` in
[search.js](./search.js).

#### Lexical query normalization

Before a query hits SQLite FTS5, `safeFtsQuery()`:

- lowercases tokens
- strips punctuation safely
- removes a small set of conversational filler words such as `what`, `did`,
  `my`, and `about`
- splits hyphenated terms like `seed-stage` into plain FTS terms

This is intentionally light normalization, not a full stemming or lemmatization
layer.

#### Intent weighting

The current intent classifier is deliberately small:

- `entity`: favors keyword retrieval and exact-match boosting
- `event`: slightly favors keyword retrieval over semantic retrieval
- `general`: neutral weights

This is intentionally narrow and easy to test.

### Current Retrieval Behaviors

- expansion before semantic retrieval
- multiple ranked lists instead of one lexical list plus one semantic list
- weighted reciprocal-rank fusion
- intent-aware keyword vs semantic weighting
- exact-match boost for direct lookups
- robust punctuation handling for natural-language queries

### Current regression coverage

The live regression file is [test/bigbrain/search-regression.test.mjs](../../test/bigbrain/search-regression.test.mjs).

It currently covers:

- direct entity lookup with safe real-entity names
- current-state/process retrieval
- canonical project lookup beating adjacent notes
- todo-list style retrieval
- recent-mention recall
- advisory-history retrieval

The fixtures are intentionally minimal and non-sensitive, but the query shapes
are meant to resemble real usage rather than placeholder nonsense.

### Retrieval eval harness

The CLI also exposes a GBrain-style retrieval eval harness through
`bigbrain eval`.

The built-in `bigbrain eval retrieval` suite uses synthetic fixtures and covers:

- `title-substring`
- `generic-to-named`
- `alias-synonym`
- `multi-chunk-dilution`
- `short-vs-rich`
- `graph-relationship`
- `hard-negative`

The report includes Hit@1, Hit@3, MRR, recall@k, hard-negative cleanliness,
per-family summaries, gates, warnings, and a single metric glossary block in
JSON output.

Private real-brain cases must stay outside the repo. By default,
`bigbrain eval retrieval --private` reads:

```text
~/.config/bigbrain/evals/retrieval-cases.jsonl
```

An explicit file can be passed with `--cases`. Case files can be JSON or JSONL
and support both the older `expected_slug`/`acceptable_slugs` shape and the
newer `family`, `relevant_slugs`, and `forbidden_slugs` fields. Private cases
warn by default; `--fail-on-private-regression` promotes private gate failures
to command failures. `--redact` removes query text and replaces slugs with
opaque stable IDs in reports.

Baseline replay and mode comparison are available through:

```bash
bigbrain eval export --private > baseline.ndjson
bigbrain eval replay --against baseline.ndjson
bigbrain eval compare --private --modes conservative,balanced,tokenmax
```

Replay reports mean Jaccard@k, top-1 stability, moved queries, and latency
deltas where available. Compare reports summarize the same retrieval metrics
across modes and can render Markdown with `--markdown`.

### What is deliberately not ported yet

`bigbrain` now stores multiple embedding chunks per page during sync, but it
does not yet have all of the metadata and ranking machinery that would make
retrieval richer. The following are still intentionally absent:

- compiled-truth chunk boosting
- chunk dedup pipeline
- chunk source/type metadata
- backlink boosts
- recency and salience scoring
- query cache
- two-pass graph/code expansion
- engine-level source scoping and multi-source search

Those belong in later expansion work once the local data model supports them.

### Why this stays narrow

The goal here is to keep retrieval useful while preserving a simple local
index.

That means:

- add retrieval logic only when it is self-contained
- avoid bringing in unrelated engine, auth, cache, or graph code
- keep the search path understandable from this directory alone

### Relevant files

- [search.js](./search.js): retrieval orchestration, expansion hookup, weighted RRF
- [openai.js](./openai.js): embeddings, query expansion, grounded answer generation
- [db.js](./db.js): FTS5 lookup and page metadata access for ranking
- [sync.js](./sync.js): keeps the search index and embeddings aligned with markdown
