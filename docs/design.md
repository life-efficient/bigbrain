# Bigbrain Design

`bigbrain` is a local-first personal knowledge runtime. The code lives in this
repo; each actual brain instance lives in an external brain home selected at
runtime.

The design goal is to keep the parts that materially help an individual operate:

- MECE markdown file structure
- linked entity store
- bidirectional relative links
- hybrid retrieval with keyword + semantic fusion
- automations that keep markdown and database state aligned
- git-backed durability
- a small set of maintenance and freshness workflows
- a scoped CLI
- a lightweight dashboard

## Product Definition

`bigbrain` should be:

- a local-first personal operating system for notes, entities, tasks, and meetings
- markdown-native for canonical authored pages
- database-backed for links, search, embeddings, and operational state
- opinionated about filing and consistency
- OpenAI-first for embeddings and query-time synthesis

`bigbrain` should not be:

- a general-purpose agent platform
- a heavy remote multi-tenant service
- a broad auth and OAuth product
- a kitchen-sink workflow framework

## Core Requirements

The initial system must support:

- MECE markdown layout with typed top-level directories
- CRUD for canonical pages
- relative wikilink or markdown-link parsing
- bidirectional link index in the database
- hybrid search:
  - syntactic search over markdown content and selected metadata
  - semantic search over embeddings
  - reciprocal-rank fusion over both result sets
- automations for:
  - link consistency
  - citation consistency
  - freshness updates from recent conversations and recent file changes
  - markdown/database sync
- git backup and GitHub-friendly workflows
- ingestion and enrichment workflows
- lightweight dashboard for graph, inbox, and tasks
- migration from an existing markdown brain corpus

## What You Are Missing

The current requirement list is strong, but a few pieces need to be explicit so
the system stays coherent:

- canonical entity schema
- source provenance model
- versioning and migration strategy
- idempotent sync rules
- search/query contract
- conflict rules between markdown truth and database projections
- testable automation boundaries

Without these, the system will drift back into hidden complexity.

## Source of Truth

`bigbrain` should use a split-brain model with clear authority.

### Markdown in the external brain home is authoritative for:

- canonical page bodies
- human-authored structure
- explicit links written in the notes
- inbox and tasks content

### Database in the external brain home is authoritative for:

- parsed entity metadata
- forward and backward link index
- embeddings
- lexical search index
- recent activity index
- automation state
- health and consistency reports

This keeps authored knowledge readable in git while allowing fast graph and
search operations.

## Proposed File Structure

The top-level structure should stay intentionally small:

- `people/`
- `companies/`
- `deals/`
- `meetings/`
- `projects/`
- `ideas/`
- `personal-protocol/`
- `concepts/`
- `writing/`
- `sources/`
- `inbox/`
- `archive/`
- `dreams/`
- `ops/`
- `.artifacts/`

Repo documentation pages such as directory `README.md` files are not canonical
brain pages and should stay outside the indexed graph.

Each page should have:

- stable relative path
- stable slug
- page type derived from path
- optional frontmatter for metadata
- body content with relative links

### Page Shape

Generic canonical pages should use:

1. YAML frontmatter
2. Title and short executive summary
3. Compiled truth / current state / key context
4. Open threads where relevant
5. `---`
6. Append-only timeline / evidence log

Artifacts should not be forced into canonical page directories. Instead, keep
them in a top-level attachment store:

```text
.artifacts/<artifact-slug>/
  artifact.md
  <raw-files...>
```

This is the right place for:

- transcript dumps
- source PDFs and decks
- generated diagrams and images
- spreadsheets and models
- sendable outward-facing deliverables

The artifact store is deliberately neutral about "input" versus "output"
because a generated output may later become a reused input.

## Meeting Lifecycle Model

Meetings should use one canonical page across the full lifecycle:

- prep before the meeting
- summary and decisions after the meeting
- attached transcript dumps or other supporting files under `.artifacts/`

The meeting page format is intentionally lighter than the generic entity-page
schema. A meeting page may include:

- title and metadata
- optional `## Prep`
  - `### Context`
  - `### Meeting Plan`
- `## Summary`
- `## Key Decisions`
- `## Action Items`
- `## Discussion Notes`

For meetings, `---` and `## Timeline` are optional rather than required.

Raw transcript dumps should not be forced into page schema; they belong under
`.artifacts/`.

## Artifact Shape

Artifacts live outside the canonical page directories:

```text
.artifacts/<artifact-slug>/
  artifact.md
  <raw-files...>
```

`artifact.md` is a lightweight companion page, not a full entity page. It
should usually include:

1. YAML frontmatter
2. Short description of what the artifact is
3. Parent page references
4. Optional timeline when iteration or reuse history matters

Suggested frontmatter:

```yaml
type: artifact
title: ExampleCo Advisory Contract Draft v1
parents:
  - deals/exampleco-advisory-arrangement
files:
  - contract-draft-v1.pdf
kind: contract
created: 2026-05-19
```

The canonical graph is bidirectional:

- brain pages link outward to artifacts
- `artifact.md` records one or more `parents:` back to canonical pages

Artifacts may contain both upstream inputs and generated outputs. That semantic
distinction is intentionally not hard-coded at the storage layer because an
output may become a future input.

## Filing Rules

- File by primary subject, not by source or format.
- Use cross-links instead of duplicate pages.
- Use `inbox/` when a page does not clearly fit yet.
- Do not store attached files directly in entity directories; place them under
  `.artifacts/` and reference them from canonical pages.
- Repo documentation pages such as directory `README.md` files are not part of
  the canonical brain graph and should be excluded from indexing and strict
  page validation.

## Data Model

The database should stay narrow and derived from the markdown layer.

### Primary tables

- `pages`
  - `id`
  - `slug`
  - `path`
  - `type`
  - `title`
  - `frontmatter_json`
  - `body_markdown`
  - `body_text`
  - `content_hash`
  - `created_at`
  - `updated_at`
  - `last_indexed_at`

- `links`
  - `from_page_id`
  - `to_slug`
  - `to_page_id`
  - `link_text`
  - `link_kind`
  - `is_resolved`

- `artifact_links`
  - `from_page_id`
  - `artifact_slug`
  - `link_text`
  - `file_path`
  - `is_resolved`

- `sources`
  - `id`
  - `page_id`
  - `source_type`
  - `source_ref`
  - `source_url`
  - `source_note`

- `embeddings`
  - `page_slug`
  - `chunk_id`
  - `chunk_text`
  - `embedding_model`
  - `embedding_json`
  - `content_hash`

- `activity_log`
  - `id`
  - `page_id`
  - `activity_type`
  - `timestamp`
  - `details_json`

- `automation_state`
  - `name`
  - `last_run_at`
  - `last_success_at`
  - `last_status`
  - `cursor_json`

- `health_findings`
  - `id`
  - `finding_type`
  - `severity`
  - `page_id`
  - `details_json`
  - `created_at`

### Optional later tables

- `entities`
- `conversation_ingests`
- `tasks_index`
- `graph_cache`
- `artifacts`

These should come later, only if the page-derived tables are insufficient.

## Search vs Query

These should not be the same command.

### `search`

`search` is retrieval only.

It should:

- return matching pages or chunks
- support exact terms and fuzzy lexical matches
- support semantic retrieval
- optionally show the fused score components
- never synthesize an answer

### `query`

`query` is answer generation over retrieved context.

It should:

- call `search` internally
- use OpenAI for synthesis
- return a concise answer with citations back to pages
- remain grounded in retrieved context

This distinction matters because you use both modes differently.

## Hybrid Retrieval

The retrieval stack should be:

1. lexical retrieval over page text and titles
2. semantic retrieval over chunk embeddings
3. reciprocal-rank fusion over both lists
4. optional lightweight re-ranking later

The first version should avoid over-optimizing. The key is predictable results
and debuggability.

## Link Model

Relative links in markdown are core to the system.

`bigbrain` should support:

- wikilinks if present
- standard relative markdown links
- path-based resolution into canonical slugs
- backlinks computed from the indexed `links` table
- artifact-link detection for paths under `.artifacts/`

There are two distinct link classes:

- page links: canonical brain page to canonical brain page
- artifact links: canonical brain page to attached artifact files or
  `.artifacts/*/artifact.md`

Artifact links should not be treated as unresolved graph-page links.

Required maintenance flows:

- detect broken outgoing links
- detect unresolved slugs
- detect missing reciprocal reference opportunities
- optionally rewrite moved links during file moves or migrations
- detect orphaned artifacts with no remaining parent references
- verify consistency between page-authored artifact links and
  `artifact.md` `parents:` metadata

## Automations

Automations should be narrow, explicit, and idempotent.

### Required automations

- `sync`
  - detect changed files
  - parse markdown
  - update page rows
  - update links
  - refresh embeddings for changed content
  - split oversized page content into compiled-truth chunks before embedding
  - report per-page embedding failures without aborting page and link indexing

- `fix-citations`
  - find malformed or missing source attribution patterns
  - repair safe cases
  - emit findings for ambiguous cases

- `fix-links`
  - find broken relative links and unresolved references
  - repair safe cases
  - emit findings when confidence is low

- `refresh-tasks`
  - already seeded in the current repo

- `freshness`
  - inspect recent conversations, meetings, or file changes
  - update relevant MECE pages or produce queued findings

### Optional later automations

- `dream`
- `orphan-review`
- `stale-entity-review`

Those should only return if they prove useful.

## CLI Surface

The CLI should stay close to the operating needs you named.

### Phase 1 commands

- `bigbrain init`
- `bigbrain migrate`
- `bigbrain import`
- `bigbrain sync`
- `bigbrain get <slug>`
- `bigbrain put <slug>`
- `bigbrain list`
- `bigbrain search <query>`
- `bigbrain query <question>`
- `bigbrain links <slug>`
- `bigbrain backlinks <slug>`
- `bigbrain health`
- `bigbrain recent`

### Phase 2 commands

- `bigbrain fix citations`
- `bigbrain fix links`
- `bigbrain enrich <slug>`
- `bigbrain ingest <source>`
- `bigbrain dashboard`

## Migration

Migration is a first-class feature, not an afterthought.

`bigbrain migrate` should support:

- importing an existing markdown tree
- normalizing paths into the target MECE structure
- rewriting links where needed
- backfilling page metadata
- indexing the imported corpus
- generating a migration report with:
  - moved files
  - rewritten links
  - unresolved references
  - skipped files

A migration target can be any selected markdown brain home, such as `/path/to/brain-home`.

## Embeddings and Query Provider

Use OpenAI by default for:

- embeddings
- grounded answer generation for `query`
- optional enrichment transforms

The system should be provider-aware, but not provider-complicated.

Practical default:

- `text-embedding-3-small` for embeddings first
- a chat model for `query`

`bigbrain sync` embeds page title plus compiled truth. Changed pages are split
into bounded word chunks before calling the embeddings API, then stored as
multiple rows in `embeddings` with stable `chunk_id` values. The sync report
separates `index_totals_after_sync` from `outstanding_work` and `run_work` so
automation can distinguish current index size, remaining embedding work, and
work completed during the current run. Legacy top-level fields such as
`indexed_pages`, `indexed_links`, `embeddings_generated`,
`embedding_chunks_generated`, `embedding_pages_failed`, and
`embedding_failures` remain for compatibility.

## Dashboard

The web surface should stay lightweight.

Initial screens:

- graph explorer
- tasks view
- inbox view
- health findings
- recent changes

The dashboard is for sanity and triage, not for full authoring.

## Health Model

`bigbrain health` should report:

- missing files or bad config
- parse failures
- unresolved links
- citation issues
- embedding lag
- stale automation runs
- git dirty state
- backup remote status

It should be concise and operational.

## Recommended Implementation Order

### Milestone 1: repository foundation

- formalize config
- define database schema
- add markdown parser and link extractor
- add `sync`
- add `get`, `put`, `list`

### Milestone 2: retrieval

- lexical index
- embeddings
- RRF fusion
- `search`
- `query`

### Milestone 3: integrity

- backlinks
- `health`
- `fix links`
- `fix citations`

### Milestone 4: workflows

- `ingest`
- `enrich`
- improved `refresh-tasks`
- freshness automation

### Milestone 5: visibility

- lightweight dashboard
- graph visualization
- inbox/tasks pages

## Opinionated Non-Goals

At least initially, `bigbrain` should not include:

- complex OAuth
- remote multi-tenant access control
- general-purpose job orchestration
- broad admin product surface
- many-client MCP hosting

If needed later, these can be layered on after the core system proves itself.
