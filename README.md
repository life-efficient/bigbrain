# bigbrain

`bigbrain` is a distributable personal knowledge runtime.

The code lives in this repo. The actual brain pages live in a selected
markdown brain home. The SQLite index, config, and runtime state live outside
that repo under a per-brain directory in your home folder.

The goal is not to rebuild everything in `gbrain`. The goal is to keep the
useful parts:

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
- external config and SQLite index under `~/.bigbrain-state/brains/<brain-id>/`
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

- [`docs/architecture.md`](./docs/architecture.md)
- [`docs/roadmap.md`](./docs/roadmap.md)
- [`docs/schema.md`](./docs/schema.md)
- [`src/bigbrain/README.md`](./src/bigbrain/README.md)
- [`TODO.md`](./TODO.md)

## Brain Home

Running `bigbrain init /path/to/home` creates:

- the canonical top-level page directories
- `ops/tasks.md`
- `~/.bigbrain-state/brains/<brain-id>/config.json`
- `~/.bigbrain-state/brains/<brain-id>/state.json`
- `~/.bigbrain-state/brains/<brain-id>/bigbrain.sqlite`

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

The runtime config, state, and SQLite index live under
`~/.bigbrain-state/brains/<brain-id>/` by default. Agents or automations that
run `bigbrain sync` must be able to write to that state directory because sync
updates the SQLite index and state file.

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

`bigbrain sync --json` reports indexed page and link counts plus embedding
status. `embeddings_generated` is the number of pages successfully embedded;
`embedding_chunks_generated` is the number of stored embedding chunks;
`embedding_pages_failed` and `embedding_failures` identify pages whose
embedding refresh failed while page/link indexing still completed.

Task refresh still works:

```bash
bigbrain refresh-tasks --json
```

## Tests

```bash
npm test
```
