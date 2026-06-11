# Install BigBrain for Agents

BigBrain is expected to be a global CLI. Agents should be able to run commands
such as `bigbrain sync --json` from any working directory.

## One-time setup

From the BigBrain repo:

```bash
cd /path/to/bigbrain
npm link
```

Verify the binary is on `PATH`:

```bash
command -v bigbrain
bigbrain --help
```

## Install skills

BigBrain skills are provided from this repo under `skills/`. Install those
directories into the user's real active skills directory exactly as written:

- `skills/bigbrain-maintain/`
- `skills/bigbrain-query/`
- `skills/task-refresh/`

First determine the active skills directory for the current harness. Common
locations are:

- `~/.agents/skills`
- `~/.codex/skills`

Prefer the directory that is already in active use. If both exist, use the one
that already contains the user's custom skills. Prefer symlinks so edits in this
repo remain the source of truth:

```bash
repo_root="$(pwd)"
mkdir -p ~/.agents/skills
ln -sfn "$repo_root/skills/bigbrain-maintain" ~/.agents/skills/bigbrain-maintain
ln -sfn "$repo_root/skills/bigbrain-query" ~/.agents/skills/bigbrain-query
ln -sfn "$repo_root/skills/task-refresh" ~/.agents/skills/task-refresh
```

If the harness does not support symlinks, copy the directories exactly. Do not
rewrite the skill contents. Skill names in `SKILL.md` frontmatter use quoted
`BigBrain: ...` values so the colon remains valid YAML.

## Brain selection

BigBrain resolves the brain home without relying on the current directory:

1. `--brain-home /path/to/brain-home`
2. `BIGBRAIN_HOME=/path/to/brain-home`
3. the saved default pointer at `~/.config/bigbrain/default-brain-home`

For the selected brain, the default pointer should resolve to:

```text
/path/to/brain-home
```

If the pointer is missing, initialize or select the brain home before running
automation commands:

```bash
bigbrain init /path/to/brain-home
```

## Automation sync command

Use the global CLI directly:

```bash
bigbrain sync --json
```

Sync writes to the runtime state directory:

```text
<brain-home>/.bigbrain-state/
```

The automation environment must be able to write there. Read-only access is not
sufficient because sync updates `bigbrain.sqlite`, `state.json`, and SQLite
sidecar files.

Use `BIGBRAIN_STATE_ROOT` only when an automation intentionally needs a separate
state root. For the selected brain, the normal root is:

```text
/path/to/brain-home/.bigbrain-state
```

## Quick health check

Run this from any directory:

```bash
bigbrain sync --json
bigbrain health --json
```

If `bigbrain` is not found, rerun `npm link` from the BigBrain repo using the
same Node version and shell environment used by the agent or automation.
