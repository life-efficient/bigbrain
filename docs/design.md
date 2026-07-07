# Bigbrain Design

`bigbrain` is a local-first personal knowledge runtime and knowledge service
for agents. The code lives in this repo; each actual brain instance lives in an
external brain home selected at runtime.

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
- OpenAI-native embeddings, grounded query, and enrichment defaults

## Product Definition

`bigbrain` should be:

- a local-first knowledge service for notes, entities, tasks, and meetings
- markdown-native for canonical authored pages
- database-backed for links, search, embeddings, and operational state
- opinionated about filing and consistency
- OpenAI-first for embeddings and query-time synthesis
- pleasant to inspect through its dashboard
- easy for agents to visit through CLI, MCP, or future API surfaces

`bigbrain` should not be:

- a general-purpose agent platform
- a heavy remote multi-tenant service
- the place the agent runtime must live
- a broad auth and OAuth product beyond what hosted MCP needs
- a kitchen-sink workflow framework
- an opaque always-on autonomous worker swarm

The core product distinction is:

```text
BigBrain is the brain agents visit.
It is not the agent home.
```

Codex, Relay, Claude, local scripts, or hosted team clients should be able to
consult and update BigBrain without BigBrain owning those runtimes. This keeps
the system portable and makes the brain useful across agent tools.

## Product Posture

BigBrain should feel like Postgres plus semantic memory plus a polished cockpit
for agents:

- markdown and git are the durable, inspectable source of truth
- the database is a rebuildable runtime projection and operational ledger
- OpenAI APIs are the opinionated default for embeddings, query synthesis, and
  future enrichment workflows
- automations are explicit, scheduled, and inspectable rather than hidden
  personalities
- the dashboard is a first-class surface for health, graph, tasks, sync, and
  agent activity inspection

This posture still leaves room for hosted or team brains. The hosted form
should preserve the same contract: agents connect to BigBrain, BigBrain indexes
and serves the selected brain, and authored knowledge remains in markdown.

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
- lightweight dashboard for graph and tasks
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
- task content

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

For hosted deployments, the same split applies even when the local SQLite index
is replaced by Postgres/pgvector. The database should persist embeddings, sync
state, OAuth/session state, audit logs, health reports, and derived indexes, but
it should not become the canonical authored content store.

## Storage Modes

The storage layer should be adapter-based so BigBrain can run in the simplest
useful mode and grow without rewriting the product:

- `sqlite`: default local state under `.bigbrain-state/` for personal use.
- `postgres`: durable server state through `DATABASE_URL`, using pgvector when
  semantic embeddings are enabled.
- `remote-postgres`: the same Postgres adapter pointed at a hosted provider
  such as Supabase when a separate managed database becomes desirable.

Postgres should be a generic BigBrain backend, not a Supabase-specific product
dependency. Supabase is a valid target because it is Postgres with useful
managed features, but a bundled server with local Postgres should work with the
same schema and migration path.

For a hosted brain such as Example Brain, a practical production shape is:

```text
app service
  -> BigBrain MCP/API/dashboard
  -> DATABASE_URL

local Postgres/pgvector service or volume
  -> embeddings
  -> sync state
  -> OAuth/session state
  -> audit logs

GitHub markdown repo
  -> canonical cortex pages
```

Because markdown remains canonical, the database can be rebuilt from git when
needed. Durable runtime state still matters because redeploys should not force
re-embedding, re-authorizing clients, or losing operational history.

## Proposed File Structure

The top-level structure should stay intentionally small:

- `people/`
- `organizations/`
- `deals/`
- `projects/`
- `ideas/`
- `meetings/`
- `tasks/`
- `concepts/`
- `writing/`
- `protocol/`
- `archive/`

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

Raw attachments should not be forced into page schema. Instead, keep them under
the same collection as the markdown page they support:

```text
<collection>/<page-slug>.md
<collection>/.raw/<filename>
```

This is the right place for:

- transcript dumps
- source PDFs and decks
- generated diagrams and images
- spreadsheets and models
- deliverable-owned raw files, filed beside the deliverable page rather than
  under sources

Prefer the owning collection whenever one is clear: for example, deal-owned
teasers and models belong in `deals/.raw/`, and meeting transcripts belong in
`meetings/.raw/`. Legacy or domain-specific `sources/.raw/` folders remain
readable when an existing brain defines them. The active brain's `filing_rules`
output is the operational source of truth for exact paths.
Do not nest page-slug folders or any other folders inside `.raw`; use
collision-safe filenames.

## Meeting Lifecycle Model

Meetings should use one canonical page across the full lifecycle:

- prep before the meeting
- summary and decisions after the meeting
- attached transcript dumps or other supporting files under `meetings/.raw/`

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
the meeting collection `.raw/` folder.

## Raw Attachment Shape

Raw attachments live outside the indexed page graph:

```text
<collection>/<page-slug>.md
<collection>/.raw/<filename>
<collection>/.raw/<filename>.md
```

A canonical markdown page is the searchable context surface. It should usually include:

1. YAML frontmatter
2. Short description of what the source is
3. A link to the raw attachment
4. Optional timeline when provenance or reuse history matters

A raw-file sidecar markdown page is different: it exists to store metadata for a
specific raw file, such as visibility, groups, provenance, MIME type, and
sharing state. Raw sidecar markdown belongs inside the same `.raw/` folder as
the raw file and should not be the public object shown when a user shares a raw
file. Group and public-folder views should show the actual raw file, while the
sidecar stores the metadata needed to control and explain that file.

Suggested frontmatter for a canonical page that discusses an attachment:

```yaml
type: source
title: ExampleCo Advisory Contract Draft v1
raw_file: deals/.raw/exampleco-advisory-arrangement-contract-draft-v1.pdf
kind: contract
created: 2026-05-19
```

Suggested frontmatter for a raw sidecar:

```yaml
title: ExampleCo Advisory Contract Draft v1
raw_file: deals/.raw/exampleco-advisory-arrangement-contract-draft-v1.pdf
raw_mime_type: application/pdf
groups: [exampleco-diligence-pack]
visibility: private
```

The canonical graph is bidirectional:

- brain pages link outward to raw attachments
- raw attachments remain associated through page links, `raw_file` frontmatter,
  and optional raw sidecar metadata under `.raw/`

Raw attachments may contain both upstream inputs and generated outputs. That
semantic distinction is intentionally not hard-coded at the storage layer
because an output may become a future input.

## Filing Rules

- File by primary subject, not by source or format.
- Use cross-links instead of duplicate pages.
- Use `tasks/` for actionable work by default; use canonical subject pages and owning collection `.raw/` folders for durable knowledge and evidence.
- Historical `inbox/`, `sources/`, and `ops/` pages may remain in existing brains or domain overlays, but new generic material should use `tasks/`, a canonical subject page, or `protocol/`.
- Do not store attached files directly in entity directories; place them under
  per-collection `.raw/` directories and reference them from canonical pages.
- Place raw-file sidecar markdown pages under the same `.raw/` directory as
  their raw files. Do not show those sidecar pages as normal public pages when a
  group or folder is sharing the raw file.
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
- `raw_attachments`
- `oauth_clients`
- `oauth_grants`
- `oauth_sessions`
- `mcp_audit_log`
- `sync_runs`

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
- raw attachment-link detection for paths under `.raw/`

There are two distinct link classes:

- page links: canonical brain page to canonical brain page
- raw attachment links: canonical brain page to attached raw files under `.raw/`

Raw attachment links should not be treated as unresolved graph-page links.

Required maintenance flows:

- detect broken outgoing links
- detect unresolved slugs
- detect missing reciprocal reference opportunities
- optionally rewrite moved links during file moves or migrations
- detect orphaned raw attachments with no remaining page references
- verify consistency between page-authored raw links and `raw_file` frontmatter

## Automations

Automations should be narrow, explicit, idempotent, and inspectable.

### Event-driven local service

- `sync`
  - detect changed files
  - parse markdown
  - update page rows
  - update links
  - refresh embeddings for changed content
  - split oversized page content into compiled-truth chunks before embedding
  - report per-page embedding failures without aborting page and link indexing

- `git-backup`
  - commit and push brain changes through the local MCP service after writes
  - avoid scheduled polling when no content changed

### Required automations

- `fix-citations`
  - find malformed or missing source attribution patterns
  - repair safe cases
  - emit findings for ambiguous cases

- `fix-links`
  - find broken relative links and unresolved references
  - repair safe cases
  - emit findings when confidence is low

- page-backed task maintenance
  - tasks live as individual `tasks/*.md` pages
  - task identity is derived from `tasks/<slug>.md`; task frontmatter uses
    `status`, `readiness`, `execution_mode`, `priority`, `assignees`,
    `source`, and optional `due`
  - valid statuses are `open`, `in_progress`, `waiting`, `done`, and
    `archived`
  - `open` means known work not actively being worked; `in_progress` means
    active work currently underway; `waiting` means work paused on an external
    dependency, reply, approval, access, or date
  - valid readiness values are `underspecified` and `ready`
  - readiness is independent from status and is an agent-authored handoff hint:
    use `underspecified` when useful work cannot begin without more context,
    and `ready` when the task appears specified enough to work
  - valid execution modes are `agent`, `user`, and `interactive`; use `agent`
    for autonomous agent-executable work, `user` for work the user must
    personally do, and `interactive` for agent-guided review or input sessions
  - valid priorities are `p0`, `p1`, `p2`, and `p3`
  - what's-next snapshots should put `readiness: ready` tasks with
    `execution_mode: agent` or `execution_mode: interactive` in the main
    actionable list
  - if a task body contains substantive open questions, what's-next can show
    it under `I also need your input on a few tasks:` even when frontmatter says
    `ready`
  - `execution_mode: user` tasks should be surfaced under `There are a few
    things I can't physically help with:` because they require real-world user
    action
  - `readiness: underspecified` tasks should be surfaced under `I also need
    your input on a few tasks:` because they need missing context before
    execution
  - fanout should create autonomous prompts for ready `agent` tasks and guided
    step-by-step prompts for ready `interactive` tasks
  - assignees are active members, not arbitrary `people/*` pages
  - use MCP `tasks/list`, `tasks/create`, and `tasks/update` for agent task
    reads and writes

- `freshness`
  - inspect recent conversations, meetings, or file changes
  - update relevant MECE pages or produce queued findings

### Optional later automations

- `dream`
- `orphan-review`
- `stale-entity-review`

Those should only return if they prove useful. BigBrain should avoid adding
background personalities or always-on agent loops by default. Maintenance jobs
should have names, schedules, inputs, outputs, logs, and dashboard visibility.

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

Embedding generation is incremental and guarded. Each page is selected for
embedding only when the stored embedding row is missing, the embedding model
changed, or the page content hash changed. The `embedding_selection` report
breaks those reasons out explicitly. To avoid accidentally re-embedding a huge
brain after a database reset or model mismatch, sync skips embedding generation
when the selected page count is above `max_embedding_pages_per_sync` while still
updating page and link indexes. Deliberate backfills should raise
`max_embedding_pages_per_sync` or `BIGBRAIN_MAX_EMBEDDING_PAGES_PER_SYNC` for
that run.

## Dashboard

The web surface should stay lightweight, polished, and operational.

Initial screens:

- graph explorer
- tasks view
- health findings
- recent changes
- sync and embedding status
- hosted MCP client activity when serving a team brain

The dashboard is for sanity, triage, and trust in agent activity. It is not
initially a full authoring environment.

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
- page-backed task workflows
- freshness automation

### Milestone 5: visibility

- lightweight dashboard
- graph visualization
- task pages

### Milestone 6: hosted brain service

- Postgres/pgvector storage adapter
- bundled server deployment recipe
- durable OAuth/session/token state
- MCP audit log
- scoped remote operation model
- sync/reindex controls with dashboard visibility

## Useful Inspiration From GBrain

GBrain is useful proof that a markdown-backed agent brain can scale, serve MCP,
and operate across local and hosted topologies. BigBrain should borrow the
operational lessons without copying the product center of gravity.

Ideas worth adapting:

- explicit topologies: local, bundled server, remote database, and thin client
- stdio MCP for local agents plus HTTP MCP for remote clients
- scoped remote operations with admin-gated writes and maintenance commands
- a small admin surface for live activity, clients, sync, embeddings, and health
- install and operations docs written so agents can execute them safely
- ingestion/source logs so imported or agent-written knowledge is reversible
- retrieval/query evals for entity lookup, temporal questions, citations, and
  top-k search quality
- migration commands that make moving between local and hosted backends boring

Things not to copy wholesale:

- making BigBrain the agent runtime
- schema-pack complexity before the simple typed-folder model needs it
- always-on autonomous operations that are hard to inspect
- Supabase-specific assumptions in the core storage model

## Opinionated Non-Goals

At least initially, `bigbrain` should not include:

- complex OAuth beyond hosted MCP needs
- remote multi-tenant access control
- general-purpose job orchestration
- a broad admin product surface unrelated to brain operations
- many-client MCP hosting as a default local concern
- an agent runtime or autonomous worker swarm

If needed later, these can be layered on after the core system proves itself.
