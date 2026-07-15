# bigbrain

Copy this into your agent (Codex/Claude Code)

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

`bigbrain` treats the brain as three related surfaces:

- canonical brain pages under typed top-level directories like `people/`,
  `organizations/`, `deals/`, `projects/`, `ideas/`, `meetings/`, `tasks/`,
  `concepts/`, `writing/`, and `protocol/`
- first-class indexed attachment sidecars under per-collection `.raw/` directories
- raw binaries beside those sidecars

Subject pages and attachment sidecars are both authored, indexed knowledge pages.
Every valuable raw artifact has exactly one same-basename Markdown sidecar beside
it. Sidecars may contain comprehensive extraction and synthesis and control the
artifact's visibility and groups. Raw binaries are never indexed directly. When
a sidecar is public, its public route renders the artifact rather than exposing
the private searchable Markdown body.

Examples of raw attachments:

- transcript dumps
- source decks and PDFs
- generated diagrams or images
- spreadsheets and financial models
- sendable proposals, contracts, and briefs

Raw attachments live under the same collection as the markdown page they
support. The default shape is:

```text
<collection>/.raw/<filename>
<collection>/.raw/<basename>.md
<collection>/.raw/<filename>
```

Do not nest page-slug folders or any other folders inside `.raw`; use
collision-safe filenames such as `meeting-slug-transcript.txt` or
`report-slug-final.pdf`.

Prefer the owning collection whenever one is clear: for example, deal-owned
teasers and models belong in `deals/.raw/`, meeting transcripts belong in
`meetings/.raw/`, writing exports belong in `writing/.raw/`, and protocol
templates belong in `protocol/.raw/`. The `filing_rules` tool is the operational
source of truth for the active brain; legacy `sources/.raw/` and `.artifacts/`
directories remain readable when a specific brain's filing rules require them.

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

BigBrain currently optimizes for two supported product modes:

- `local brain`: a selected markdown brain home on this machine, local runtime
  state under `.bigbrain-state/`, and localhost CLI/MCP/dashboard access.
- `remote brain`: one selected markdown brain served by a hosted BigBrain
  MCP/API/dashboard endpoint, with durable server state in Postgres.

Other shapes, such as Docker Compose, bundled Postgres, Supabase, and thin
clients, should stack around those two modes instead of becoming separate
products. Docker or Compose is the practical way to run a remote brain locally
or on a small server. Supabase is a managed Postgres target for a remote brain.
A thin client is any agent, browser, or desktop shell pointed at a remote brain
endpoint.

Connect Codex to a hosted remote brain with the BigBrain-owned bootstrap:

```sh
bigbrain connect codex https://your-service.example.com/mcp \
  --name example-brain \
  --auth oauth
```

OAuth is the hosted default and gives every connection its own Codex-managed
credential. Use `--auth token --token-stdin` only for a trusted single-operator
deployment; never pass a bearer token as an argument or store it in a repository
or Codex configuration. The command keeps connections isolated by name and
verifies the Codex registration. Complete the authenticated tool and
brain-identity check in a fresh Codex task. Existing Codex processes need
restarting only for the token fallback, not for the standard OAuth flow. See
[`docs/mcp-hosting.md`](./docs/mcp-hosting.md) for the full auth, verification,
and migration contract.

The database is service state, not the source of truth for authored knowledge.
For hosted brains such as Example Brain, markdown in git remains canonical.
Postgres can always be rebuilt from the markdown repo, but mutable runtime state
such as OAuth clients, grants, hosted git health state, embedding rows, and
bounded audit logs should persist outside the app container.

## Architecture

See:

- [`CHANGELOG.md`](./CHANGELOG.md)
- [`docs/design.md`](./docs/design.md)
- [`docs/packaging-architecture.md`](./docs/packaging-architecture.md)
- [`docs/mcp-hosting.md`](./docs/mcp-hosting.md)
- [`docs/postgres-migration.md`](./docs/postgres-migration.md)
- [`docs/example-brain-deployment.md`](./docs/example-brain-deployment.md)
- [`docs/releases.md`](./docs/releases.md)
- [`src/bigbrain/README.md`](./src/bigbrain/README.md)
- [`TODO.md`](./TODO.md)

## Brain Home

BigBrain is the software; a brain is one isolated knowledge system. Each brain
has an immutable `brain_id` and an editable `brain_name`. One running BigBrain
MCP service serves exactly one configured brain, including its own content,
database, members, authentication boundary, secrets, and backups. A machine may
run several isolated BigBrain services, each with its own brain home, port, and
MCP client registration.

Create a named brain or inspect and rename an existing one with:

```sh
bigbrain init /path/to/personal-brain --name "Personal Brain"
bigbrain --brain-home /path/to/personal-brain identity show
bigbrain --brain-home /path/to/personal-brain identity set-name "Private Brain"
```

MCP registration names and deployment/service labels are client-owned aliases.
They may be normalized from the brain name during installation, but they are
persisted independently so renaming a brain does not break existing clients.
There is intentionally no canonical brain slug.

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
title: Follow up on proposal
status: open
readiness: underspecified
execution_mode: agent
priority: p1
assignees: [people/hani]
source: [meetings/proposal-review]
due: 2026-07-01
---
```

Task identity is derived from the `tasks/` path. Legacy `type: task`
frontmatter may appear, but it is optional and not used for behavior.
Valid statuses are `open`, `in_progress`, `waiting`, `done`, and `archived`.
Use `open` for known work that is not actively being worked, `in_progress` for
active work currently underway, `waiting` for work paused on an external
dependency, reply, approval, access, or date, `done` for completed work, and
`archived` for work intentionally closed without treating it as active. Valid
readiness values are `underspecified` and `ready`; treat readiness as an
agent-authored handoff hint. Use `underspecified` when useful work cannot begin
without more context, and use `ready` when the task appears specified enough to
work. Status and readiness are independent: a task can be `open` but
`underspecified`, or `in_progress` and `ready`. Open questions in the task body
can still cause what's-next or fanout output to ask for user input. Valid
execution modes are `agent`, `interactive`, and `user`. Use
`agent` only when Codex or another agent can complete the task autonomously with
the available context, tools, and files. Use `interactive` when Codex can
advance the task but needs the user's judgement, preferences, review, or
decisions along the way. Use `user` only when the task requires a real-world
action Codex cannot meaningfully perform, such as sending a personal WhatsApp,
conducting a meeting, signing a physical document, or obtaining approval. Valid
priorities are `p0`, `p1`, `p2`, and `p3`. `due` is optional and
must be `YYYY-MM-DD` when present. Keep the current task context above the
separator, structured as Summary, What Counts as Completed, Body Context, Open
Questions, and Anti-Patterns, and append evidence or state changes under
`## Timeline`.
Use the MCP task tools
(`tasks/list`, `tasks/create`, `tasks/update`) when writing through an agent.
For new intake, create or update a task by default when the item is actionable,
needs an owner, needs status, or represents follow-up work. Historical
`inbox/` pages may remain in existing brains, but there is no inbox API or
dashboard workflow; do not use inbox as a parallel task queue.
When marking a task `done` or `archived`, include a completion handoff in the
timeline: either `Next task: tasks/<slug>` or
`No successor task needed: <reason>`.
Do not use `ops/tasks.md` or recreate a single-file task list.

The dashboard and `bigbrain tasks --assignee people/hani` only resolve
assignees that match active members. External people can still be linked in
notes, sources, or stakeholder fields; they are not assignable until they are
added as members.

For a private local MCP service running with `BIGBRAIN_MCP_AUTH_MODE=none`,
`assignee=me` resolves to `BIGBRAIN_MCP_LOCAL_PERSON_SLUG`, the single active
owner, or the single active member when there is no owner. For local single-user
brains, bootstrap the local owner during service installation:

```sh
bigbrain members ensure-local-owner people/hani --name Hani --email hani@example.com
```

The local service installer can run that bootstrap step and persist
`BIGBRAIN_MCP_LOCAL_PERSON_SLUG` in the LaunchAgent when called with
`--local-person-slug people/hani`. If a local brain has multiple active owners
or members, set that local person slug explicitly so `me` is deterministic.

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
items. The generated `build/dev/BigBrain.app` is also self-launching: opening it
from Finder or Spotlight loads this source checkout exactly like
`npm run desktop:dev`. It is a disposable development artifact and continues to
use the same brain registry and persistent MCP services; it does not copy brain
data or install a second service.

By default, the desktop app uses the selected local brain and starts the
built-in local dashboard server. To wrap a hosted remote brain dashboard with
the same desktop shell, set `BIGBRAIN_DASHBOARD_URL` or pass
`--dashboard-url`:

```bash
BIGBRAIN_DASHBOARD_URL=https://your-service.example.com/dashboard npm run desktop:dev
```

To build distributable artifacts:

```bash
npm run desktop:dist
```

This writes the packaged app outputs to `dist/electron/`.
