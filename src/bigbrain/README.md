# BigBrain Runtime Notes

This directory holds the runtime implementation for `bigbrain`.

## Search And Query

The current retrieval stack in [search.js](./search.js) is intentionally close
to the small, portable part of `gbrain`'s search-lite path rather than a new
ranking design.

### Current flow

1. `queryBrain()` calls `searchBrain()` and then sends the fused result context
   to `answerQuestion()` in [openai.js](./openai.js).
2. `searchBrain()` optionally expands the user query into up to 2 alternate
   phrasings through `expandQueryVariants()`.
3. Each query variant runs:
   - lexical retrieval from SQLite FTS5 via `lexicalSearch()` in [db.js](./db.js)
   - semantic retrieval from stored embedding chunks
4. The ranked lists are merged with reciprocal-rank fusion using the same
   general shape as `gbrain` search-lite:
   - multiple ranked lists
   - weighted RRF
   - light intent-based weighting
   - exact-match boost for direct entity lookups
   - lexical tie-break preference when fused scores are equal
5. The fused results become the retrieval context for answer generation.

### What was copied in spirit from `gbrain`

- expansion before semantic retrieval
- multiple ranked lists instead of one lexical list plus one semantic list
- weighted reciprocal-rank fusion
- intent-aware keyword vs semantic weighting
- exact-match boost for direct lookups
- robust punctuation handling for natural-language queries

### What is deliberately not ported yet

`bigbrain` now stores multiple embedding chunks per page during sync, but it
does not yet have the full metadata and ranking machinery needed to cleanly
carry over the full `gbrain` pipeline. The following are still intentionally
absent:

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

The goal here is not to drag `gbrain` wholesale into `bigbrain`. The goal is to
reuse the parts of the ranking/query system that are already proven, while
keeping the implementation compatible with BigBrain's simpler local index.

That means:

- port the retrieval logic when it is self-contained
- avoid bringing in unrelated engine, auth, cache, or graph code
- keep the search path understandable from this directory alone

### Relevant files

- [search.js](./search.js): retrieval orchestration, expansion hookup, weighted RRF
- [openai.js](./openai.js): embeddings, query expansion, grounded answer generation
- [db.js](./db.js): FTS5 lookup and page metadata access for ranking
- [sync.js](./sync.js): keeps the search index and embeddings aligned with markdown

