# bigbrain

`bigbrain` is a distributable personal knowledge runtime.

The code lives in this repo. The actual brain pages live in a selected
markdown brain home. The SQLite index, config, and runtime state live outside
that repo under a per-brain directory in your home folder.

The goal is to keep the useful parts of a personal operating stack:

- MECE markdown file structure
- linked database
- relative markdown links and backlinks
- hybrid search with keyword + semantic fusion
- automations for consistency and freshness
- git-backed durability
- a scoped CLI that targets an external brain home
- a lightweight dashboard

## Brain Model

`bigbrain` treats the markdown brain as two related layers:

- canonical brain pages under typed top-level directories like `people/`,
  `companies/`, `deals/`, `meetings/`, and `projects/`
- attached artifacts under a top-level `.artifacts/` directory

Canonical pages are the authored knowledge graph. Artifacts are attached raw
files or generated outputs that should stay retrievable but are not themselves
expected to conform to page schema.

Examples of artifacts:

- transcript dumps
- source decks and PDFs
- generated diagrams or images
- spreadsheets and financial models
- sendable proposals, contracts, and briefs

Artifacts may have one or more parent brain pages. The default shape is:

```text
.artifacts/<artifact-slug>/
  artifact.md
  <raw-files...>
```

The `artifact.md` companion is the indexable metadata and context surface for
the artifact. Brain pages link out to artifacts, and `artifact.md` records its
parent page slugs so attachment is explicitly bidirectional.

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

## Current Runtime

Implemented foundation:

- external brain-home initialization
- external config and SQLite index under `<brain-home>/.bigbrain-state/`
- page CRUD against the brain home
- lexical search plus optional OpenAI-backed semantic/query flows
- link extraction and backlinks
- migration from an existing `brain`-style corpus
- health checks
- schema/filing guidance
- existing task refresh adapted to the new runtime model
- lightweight built-in dashboard

## Architecture

See:

- [`docs/design.md`](./docs/design.md)
- [`docs/mcp-hosting.md`](./docs/mcp-hosting.md)
- [`src/bigbrain/README.md`](./src/bigbrain/README.md)
- [`TODO.md`](./TODO.md)

## Brain Home

Running `bigbrain init /path/to/home` creates:

- the canonical top-level page directories
- `ops/tasks.md`
- `<brain-home>/.bigbrain-state/config.json`
- `<brain-home>/.bigbrain-state/state.json`
- `<brain-home>/.bigbrain-state/bigbrain.sqlite`

An example config shape is in [`bigbrain.config.example.json`](./bigbrain.config.example.json).

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
`.bigbrain-state/automation-runs/` with names such as `nightly-maintenance/` or
`hourly-task-refresh/`. Do not write runtime state into the BigBrain source
repo.

Machine-local BigBrain secrets live outside the source repo and brain home in
`${HOME}/.config/bigbrain/.env`. The CLI loads that file before commands run and
does not override variables already set in the process environment. Put
`OPENAI_API_KEY=...` there to enable embeddings, semantic search, and generated
answers.

For agent setup, see [`INSTALL_FOR_AGENTS.md`](./INSTALL_FOR_AGENTS.md).

## Commands

```bash
bigbrain init /path/to/brain-home
bigbrain sync
bigbrain search "query terms"
bigbrain query "grounded question"
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

Task refresh still works:

```bash
bigbrain refresh-tasks --json
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
