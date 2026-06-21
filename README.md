# bigbrain

Copy this into a new agent thread before asking it to install or set up
BigBrain:

```text
Install and set up BigBrain by following https://github.com/life-efficient/bigbrain/blob/main/INSTALL_FOR_AGENTS.md.
```

`bigbrain` is a local-first knowledge runtime for agents and humans working
against the same markdown brain.

It exists to make durable memory practical: agents can add, search, query,
validate, and refresh a git-backed knowledge base without turning the knowledge
base into application state. Markdown and git stay canonical. BigBrain provides
the runtime layer around that corpus: indexing, retrieval, health checks, task
refresh, MCP access, automations, and a dashboard.

The code lives in this repo. The actual brain pages live in a selected markdown
brain home. Runtime state, config, and indexes live outside this source repo,
normally under the selected brain home at `.bigbrain-state/`.

## Quick Start

```bash
cd /path/to/bigbrain
npm link
bigbrain init /path/to/brain-home
bigbrain sync --json
bigbrain query "what should I know about this project?"
```

Pass `--brain-home /path/to/brain-home` when targeting a non-default brain.

## Agent Setup

Agent setup lives in [`INSTALL_FOR_AGENTS.md`](./INSTALL_FOR_AGENTS.md).
Skill routing lives in [`skills/RESOLVER.md`](./skills/RESOLVER.md).

## Features

- MECE markdown file structure
- linked database
- relative markdown links and backlinks
- hybrid search with keyword + semantic fusion
- explicit automations for consistency and freshness
- git-backed durability
- a scoped CLI that targets an external brain home
- a lightweight dashboard
- OpenAI-native embeddings, grounded query, and enrichment defaults
- MCP server mode for hosted or shared brains
- OAuth allowlist support for team MCP access
- retrieval evals for checking search quality changes

## Brain Model

`bigbrain` treats the markdown brain as two related layers:

- canonical brain pages under typed top-level directories like `people/`,
  `companies/`, `deals/`, `meetings/`, and `projects/`
- attached raw files under per-collection `.raw/` directories

Canonical pages are the authored knowledge graph. Raw files are attached source
files or generated outputs that should stay retrievable but are not themselves
expected to conform to page schema. The markdown page remains the searchable
surface; raw files stay out of the indexed page graph.

Examples of raw attachments:

- transcript dumps
- source decks and PDFs
- generated diagrams or images
- spreadsheets and financial models
- sendable proposals, contracts, and briefs

Raw attachments live under the same collection as the markdown page they
support. The default shape is:

```text
<collection>/<page-slug>.md
<collection>/.raw/<filename>
```

Do not nest page-slug folders or any other folders inside `.raw`; use
collision-safe filenames such as `meeting-slug-transcript.txt` or
`report-slug-final.pdf`.

Use `sources/.raw/` for evidence-first uploads whose subject has not yet become
another canonical entity. The `filing_rules` tool is the operational source of
truth for the active brain; older `.artifacts/` directories are legacy unless a
specific brain's filing rules explicitly require them.

Repo documentation pages such as `README.md` files are not canonical brain
pages and should be ignored by indexing and schema validation.

Meeting pages are a separate authored class. They can share the same canonical
meeting page across the full lifecycle:

- optional pre-meeting `## Prep`
- post-meeting `## Summary`
- `## Key Decisions`
- `## Action Items`
- `## Discussion Notes`

For meetings, `---` and `## Timeline` are optional. The prep workflow should
update the same meeting page that later receives ingested meeting outcomes.

## Operating Modes

BigBrain should support the same brain model across a few deployment shapes:

- `local`: a personal brain home with local runtime state, currently SQLite
  under `.bigbrain-state/`.
- `server`: a bundled app plus local Postgres/pgvector for shared or hosted
  brains that need durable embeddings, OAuth/session state, sync state, and
  audit logs across redeploys.
- `remote`: the same Postgres storage contract pointed at an external Postgres
  or Supabase instance when operational needs justify it.
- `thin client`: agent tools connect to a hosted BigBrain over MCP/API while the
  agent runtime lives elsewhere.

The database is service state, not the source of truth for authored knowledge.
For hosted brains such as Example Brain, markdown in git remains canonical.
Postgres can always be rebuilt from the markdown repo, but mutable runtime state
such as OAuth clients, grants, sync runs, embedding rows, and audit logs should
persist outside the app container.

## Architecture

See:

- [`docs/design.md`](./docs/design.md)
- [`docs/mcp-hosting.md`](./docs/mcp-hosting.md)
- [`docs/postgres-migration.md`](./docs/postgres-migration.md)
- [`docs/example-brain-deployment.md`](./docs/example-brain-deployment.md)
- [`src/bigbrain/README.md`](./src/bigbrain/README.md)
- [`TODO.md`](./TODO.md)

## Brain Home

Running `bigbrain init /path/to/home` creates:

- the canonical top-level page directories
- `tasks/` for page-backed task records
- `<brain-home>/.bigbrain-state/config.json`
- `<brain-home>/.bigbrain-state/state.json`
- `<brain-home>/.bigbrain-state/bigbrain.sqlite`

An example config shape is in [`bigbrain.config.example.json`](./bigbrain.config.example.json).

## Members And Assignments

Brain `people/*.md` pages can describe anyone. Assignable work is restricted to
active members in the runtime `members` table. A member maps an OAuth/email
identity to a canonical person page:

```sh
bigbrain members add hani@example.com people/hani --name Hani --role owner
```

Task pages live under `tasks/*.md`. Use one page per assignable task:

```yaml
---
type: task
title: Follow up on proposal
status: open
priority: p1
assignees: [people/hani]
source: [meetings/proposal-review]
due: 2026-07-01
---
```

Valid statuses are `open`, `waiting`, `blocked`, `done`, and `archived`.
Valid priorities are `p0`, `p1`, `p2`, and `p3`. `due` is optional and must be
`YYYY-MM-DD` when present. Keep the current task context above the separator and
append evidence or state changes under `## Timeline`. Use the MCP task tools
(`tasks/list`, `tasks/create`, `tasks/update`) when writing through an agent.
Do not use `ops/tasks.md` or recreate a single-file task list.

The dashboard and `bigbrain tasks --assignee people/hani` only resolve
assignees that match active members. External people can still be linked in
notes, sources, or stakeholder fields; they are not assignable until they are
added as members.

## Install

Install the CLI globally from this repo:

```bash
cd /path/to/bigbrain
npm link
```

After linking, `bigbrain` should work from any working directory. The CLI does
not depend on the current directory for normal use. It resolves the target brain
home in this order:

1. `--brain-home /path/to/brain-home`
2. `BIGBRAIN_HOME=/path/to/brain-home`
3. the saved default pointer at `~/.config/bigbrain/default-brain-home`

The runtime config, state, and SQLite index live under the selected brain home
at `.bigbrain-state/` by default. Because that directory is already inside one
brain home, it does not contain an extra `brains/<brain-id>/` nesting. Agents or
automations that run `bigbrain sync` must be able to write there because sync
updates the SQLite index and state file. `BIGBRAIN_STATE_ROOT` remains available
as an explicit override for tests or unusual deployments; when set, it can hold
multiple brain runtimes under hashed subdirectories.

Automation run markers should live beside the runtime state under
`.bigbrain-state/automation-runs/` with names such as `nightly-maintenance/`.
Do not write runtime state into the BigBrain source repo.

Machine-local BigBrain secrets live outside the source repo and brain home in
`${HOME}/.config/bigbrain/.env`. The CLI loads that file before commands run and
does not override variables already set in the process environment. Put
`OPENAI_API_KEY=...` there to enable embeddings, semantic search, and generated
answers.

## Commands

```bash
bigbrain init /path/to/brain-home
bigbrain sync
bigbrain search "query terms"
bigbrain query "grounded question"
bigbrain eval retrieval
bigbrain eval export
bigbrain eval replay --against baseline.ndjson
bigbrain eval compare
bigbrain health
bigbrain schema
bigbrain dashboard
bigbrain migrate /path/to/existing/brain
```

Pass `--brain-home /path/to/brain-home` when targeting a non-default brain.

`bigbrain sync --json` reports index totals separately from run work and
outstanding work. `index_totals_after_sync.pages` and
`index_totals_after_sync.links` are the current index size after sync, not new
items from this run. `outstanding_work.pages_needing_embeddings` and
`outstanding_work.embedding_chunks_pending` report what remains to be done.
`run_work.pages_embedded` and `run_work.embedding_chunks_created` report work
completed during this run. Legacy top-level fields such as `indexed_pages`,
`indexed_links`, `embeddings_generated`, and `embedding_chunks_generated` remain
available for compatibility.

Tasks are authored as individual markdown pages under `tasks/*.md`. The old
single-file `ops/tasks.md` refresh workflow is deprecated and no longer exposed
by the CLI.

## Retrieval Evals

BigBrain includes a GBrain-style retrieval eval suite for checking whether
ranking changes improve or damage source selection.

The built-in suite uses synthetic, non-sensitive fixtures and covers these
families:

- `title-substring`
- `generic-to-named`
- `alias-synonym`
- `multi-chunk-dilution`
- `short-vs-rich`
- `graph-relationship`
- `hard-negative`

Run the public synthetic quality suite:

```bash
bigbrain eval retrieval
bigbrain eval retrieval --json
```

Reports include Hit@1, Hit@3, MRR, recall@k, hard-negative cleanliness,
per-family summaries, gates, warnings, and one `_meta.metric_glossary` block in
JSON output.

Private real-brain cases should live outside this repo. The default private
case path is:

```text
~/.config/bigbrain/evals/retrieval-cases.jsonl
```

Run private cases:

```bash
bigbrain eval retrieval --private
bigbrain eval retrieval --cases /path/to/cases.jsonl
```

Private cases warn by default. Use `--fail-on-private-regression` when a
private suite should fail the command. Use `--redact` when generating shareable
reports; it removes query text and replaces slugs with stable opaque IDs.

Case files can be JSON or JSONL. Existing fields remain compatible:

```json
{
  "id": "private-target",
  "family": "title-substring",
  "query": "Private Eval",
  "expected_slug": "people/private-eval",
  "acceptable_slugs": [],
  "relevant_slugs": ["people/private-eval"],
  "forbidden_slugs": []
}
```

Export and replay baselines:

```bash
bigbrain eval export --private > baseline.ndjson
bigbrain eval replay --against baseline.ndjson
```

Replay reports mean Jaccard@k, top-1 stability, moved queries, and latency
deltas where available.

Compare modes:

```bash
bigbrain eval compare --private --modes conservative,balanced,tokenmax
bigbrain eval compare --private --markdown
```

## Tests

```bash
npm test
```

## Desktop App

The dashboard can also run as a Mac desktop app.

For local development:

```bash
npm run desktop:dev
```

That launches a real `.app` wrapper around the built-in dashboard server, so it
behaves like a normal desktop app in the Dock and can be added to macOS login
items.

To build distributable artifacts:

```bash
npm run desktop:dist
```

This writes the packaged app outputs to `dist/electron/`.
