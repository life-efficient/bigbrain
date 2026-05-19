# Bigbrain Schema

## Directory Structure

- `people/` — One page per human being. File by the person as the primary subject.
- `companies/` — One page per organization or company.
- `deals/` — Transactions, fundraising, and investment items with terms or decisions.
- `meetings/` — Specific meetings, calls, or transcripts.
- `projects/` — Actively built execution tracks with a repo, spec, or team.
- `ideas/` — Unbuilt possibilities that are not yet active projects.
- `concepts/` — Reusable mental models, frameworks, and general strategy.
- `writing/` — Prose artifacts, drafts, and essay-style outputs.
- `sources/` — Raw imports, archived snapshots, and source material.
- `inbox/` — Temporary unsorted captures when no canonical home is clear yet.
- `archive/` — Historical or dead pages that should not stay active.
- `dreams/` — Reserved for later dream-cycle outputs; not active in v1.
- `ops/` — Operational files such as tasks and run-state documents.
- `.artifacts/` — Attached raw files and generated outputs. Not canonical brain pages.

## Page Shape

1. YAML frontmatter
2. Title and short executive summary
3. Compiled truth / current state / key context
4. Open threads where relevant
5. `---`
6. Append-only timeline / evidence log

Meeting pages are currently authored as structured summaries and may later get
their own dedicated meeting-page schema. Raw transcript dumps should not be
forced into page schema; they belong under `.artifacts/`.

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
  the canonical brain graph and should be excluded from strict page validation.
