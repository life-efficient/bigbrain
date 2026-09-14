# BigBrain Runtime Notes

This directory holds the runtime implementation for `bigbrain`.

## Search And Harness Answers

The current retrieval stack in [search.js](./search.js) is deliberately small
and inspectable. It combines lexical retrieval, optional semantic retrieval,
and lightweight fusion rather than trying to hide ranking behind a larger
engine.

### Current flow

1. `searchBrain()` runs retrieval. The default `balanced` mode enables neither
   query expansion nor reranking; `tokenmax` retains both.
2. When expansion is enabled, `searchBrain()` applies the expansion heuristic.
   - direct entity/title lookups stay unexpanded
   - broader question-style queries can expand into up to 2 alternate
     phrasings through `expandQueryVariants()`
3. Each query variant runs:
   - lexical retrieval from SQLite FTS5 via `lexicalSearch()` in [db.js](./db.js)
   - semantic retrieval from stored full-document embeddings
   - temporary per-page fallback to legacy compiled-truth vectors only where a
     full-document embedding has not been created yet
4. The ranked lists are merged with reciprocal-rank fusion:
   - multiple ranked lists
   - weighted RRF
   - light intent-based weighting
   - exact-match boost for direct entity lookups
   - lexical tie-break preference when fused scores are equal
5. `searchBrain()` hydrates ranked pages from indexed Markdown and builds
   `retrieval_context` for the calling agent harness.
6. The context contains:
   - the top-ranked source slugs first
   - then complete page embedding payloads in rank order
   - only a contiguous ranked prefix that fits within the shared
     `search_context_max_bytes` budget
   - no partially truncated page content
7. The calling harness generates the answer from that evidence, cites source
   slugs, and identifies gaps. BigBrain performs no internal answer synthesis.

`retrieval_context` has the shape
`{context, max_bytes, used_bytes, included_pages, omitted_pages, stop_reason}`.
The default `search_context_max_bytes` is `65536`, configurable with
`BIGBRAIN_SEARCH_CONTEXT_MAX_BYTES`. Legacy `answer_context_max_bytes` and
`BIGBRAIN_ANSWER_CONTEXT_MAX_BYTES` are supported as fallbacks. The budget counts
the exact UTF-8 bytes of the rendered context, including labels and separators;
it is not a token budget or a cap on the entire response. It applies in all
modes, including `tokenmax`.

Packing stops at the first missing or over-budget ranked page. Later pages are
reported as omitted, even if a smaller one could fit; no page is partially
truncated. Full page content is emitted only in `retrieval_context.context`,
without duplicate full bodies or embedding payloads in `lexical`, `semantic`,
`fused`, or explanation diagnostics. Ranked metadata and snippets remain useful
for inspection, with summary and snippet previews capped at 240 characters
each even when `explain` is enabled. These previews are not complete evidence.

`queryBrain()` is a deprecated compatibility wrapper around `searchBrain()`.
It returns `{answer: null, preferred_sources, search, warnings}`, with context
at `search.retrieval_context`. The MCP `query` tool remains callable but is
omitted from `tools/list`. New CLI and MCP callers should use `search`, for example:

```bash
bigbrain search "What changed in this deal?" --mode balanced --json
```

### Current heuristics

#### Expansion default

Expansion is off in `balanced` and `conservative`. When enabled by `tokenmax`
or an explicit expansion option, the current heuristic is:

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

- optional expansion before semantic retrieval
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

The report includes Hit@1, Hit@3, Hit@5, MRR, recall@k, hard-negative cleanliness,
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

Private real-brain evals use the configured `OPENAI_API_KEY` for semantic
retrieval, reranking, and query expansion where the selected mode enables them.
Pass `--no-ai` only when an intentionally lexical, deterministic baseline is
required. The built-in synthetic fixture remains key-free by default.

Baseline replay and mode comparison are available through:

```bash
bigbrain eval export --private > baseline.ndjson
bigbrain eval replay --against baseline.ndjson
bigbrain eval compare --private --modes conservative,balanced,tokenmax
```

Replay reports mean Jaccard@k, top-1 stability, moved queries, and latency
deltas where available. Compare reports summarize the same retrieval metrics
across modes and can render Markdown with `--markdown`.

Retrieval-channel ablations are separate from search modes. Run all four arms
against one fixed mode and one identical case set:

```bash
bigbrain eval compare --private \
  --mode balanced \
  --arms lexical-only,semantic-only,hybrid-fusion,hybrid-reranked \
  --markdown
```

The arms are:

- `lexical-only`: FTS retrieval plus alias and deterministic lexical boosts;
  no embedding or reranking calls
- `semantic-only`: embedding retrieval only; no lexical search, alias
  injection, deterministic lexical boosts, or reranking
- `hybrid-fusion`: lexical and semantic retrieval, reciprocal-rank fusion,
  aliases, and deterministic boosts; no reranking
- `hybrid-reranked`: the hybrid-fusion pipeline followed by OpenAI reranking

The default `balanced` production mode uses hybrid fusion without expansion or
reranking and defaults to 10 results. `conservative` also defaults to 10 results
with both stages disabled; `tokenmax` defaults to 25 with both enabled.
This keeps the broad candidate coverage and avoids paying the reranker latency
on every normal search. `tokenmax` and the explicit `hybrid-reranked`
evaluation arm retain reranking for deliberate high-cost or experimental use.
Normal search also applies the validated `combined` deterministic ranking
policy: full-title matches for entity queries, canonical-page preference over
attachments unless raw evidence is requested, and active-task preference for
current-state queries. Retrieval evaluations can select `baseline` or any
individual policy with `--ranking-policy`, or compare policies with
`eval compare --policies ...`.

Graph traversal remains opt-in. The `combined-graph-relational` policy performs
a bounded bidirectional one-hop expansion from the top fused seeds only for
queries with explicit relationship language. Candidates retain graph-path
provenance, hop count, direction, and score contribution. Broader one-hop and
two-hop policies remain available for controlled evaluation, but are not
production defaults because they can displace strong direct matches.

```bash
bigbrain eval compare \
  --cases ~/.config/bigbrain/evals/retrieval-dev-v2.jsonl \
  --mode balanced \
  --arm hybrid-fusion \
  --policies combined,combined-graph-relational \
  --reference-policy combined \
  --markdown
```

Query expansion is disabled for all four arms so it does not become an
uncontrolled fifth variable. Semantic arms fail closed when API access,
embeddings, or the provider are unavailable instead of silently degrading to
lexical retrieval. `--no-ai` can therefore only be combined with
`lexical-only`.

### What is deliberately not ported yet

`bigbrain` now stores one `full_document` embedding per page from the title,
aliases, and complete body after frontmatter, including timeline. It does not
yet have the hierarchy and ranking machinery needed for more granular
retrieval. The following are still intentionally absent:

- summary, section, and timeline-entry embeddings
- parent-child embedding relationships
- hierarchical candidate expansion and reranking
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

- [search.js](./search.js): retrieval orchestration, expansion, weighted RRF, and bounded whole-page context
- [openai.js](./openai.js): embeddings, optional query expansion, and reranking
- [db.js](./db.js): FTS5 lookup and page metadata access for ranking
- [sync.js](./sync.js): keeps the search index and embeddings aligned with markdown
