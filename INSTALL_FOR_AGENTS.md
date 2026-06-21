# Install BigBrain for Agents

BigBrain is expected to be a global CLI. Agents should be able to run commands
such as `bigbrain sync --json` from any working directory.

## Ask before setup

Ask the user only for choices that change the installation. Ask one question at
a time, show numbered option answers, mark exactly one answer with
`(recommended)`, and wait for the user's answer before proceeding.

Ask this first:

```text
Where should BigBrain run?

1. On this computer (recommended)
2. On a server
3. Connect to an already-hosted BigBrain
```

Ask this only if the brain folder is not obvious from the workspace or existing
BigBrain config. If asking, use "server" instead of "computer" when the user
requested server mode. Use the path in
`~/.config/bigbrain/default-brain-home` as the default expected location when
that file exists, and display it with `~` instead of the full home directory
when possible:

```text
Where on your computer should I store the brain?

1. The default path from ~/.config/bigbrain/default-brain-home, using ~ when possible (recommended)
2. Somewhere else (tell me where)
```

Ask this only if a server database is needed:

```text
Where should the server database live?

1. Local development database (recommended)
2. Supabase
3. Another hosted Postgres database
```

Ask this only if BigBrain will run on a server or connect to a hosted BigBrain:

```text
Who can use this brain?

1. Just me / private (recommended)
2. A shared allowlist
3. Another access setup
```

Ask this only if no OpenAI API key is already available in the environment or
BigBrain config:

```text
How should BigBrain get the OpenAI API key?

1. Save a new key in ${HOME}/.config/bigbrain/.env (recommended)
2. Use a deployment secret store
3. Use another secret location I provide
```

Do not ask for values that can be discovered safely from the repo, current
environment, or existing BigBrain config. Never write secrets into this source
repo or the markdown brain repo.

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

BigBrain skills are provided from this repo under `skills/`. Install every
direct child directory that contains a `SKILL.md` file into the user's real
active skills directory exactly as written.

First determine the active skills directory for the current harness. Common
locations are:

- `~/.agents/skills`
- `~/.codex/skills`

Prefer the directory that is already in active use. If both exist, use the one
that already contains the user's custom skills. Prefer symlinks so edits in this
repo remain the source of truth:

```bash
repo_root="$(pwd)"
# Set this to the active harness directory, for example:
#   "$HOME/.agents/skills"
#   "$HOME/.codex/skills"
skills_root="$HOME/.agents/skills"

mkdir -p "$skills_root"
find "$repo_root/skills" -mindepth 2 -maxdepth 2 -name SKILL.md -print \
  | while IFS= read -r skill_file; do
  skill_dir="$(dirname "$skill_file")"
  skill_id="$(basename "$skill_dir")"
  ln -sfn "$skill_dir" "$skills_root/$skill_id"
done
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

## Install automations

BigBrain automation templates live under `automations/`. They are repo-owned
templates, not the active local install. The templates intentionally use:

```toml
cwds = ["<brain-home>"]
```

When installing them into the agent runtime, copy the automation directories to
`${CODEX_HOME:-$HOME/.codex}/automations` and replace `<brain-home>` with the
real local brain path in the installed copy only:

```bash
repo_root="$(pwd)"
automation_root="${CODEX_HOME:-$HOME/.codex}/automations"
brain_home="/path/to/brain-home"

mkdir -p "$automation_root"
for id in bigbrain-frequent-sync bigbrain-git-backup bigbrain-hourly-task-refresh bigbrain-nightly-maintenance; do
  rm -rf "$automation_root/$id"
  cp -R "$repo_root/automations/$id" "$automation_root/$id"
  perl -0pi -e "s#<brain-home>#$brain_home#g" "$automation_root/$id/automation.toml"
done
```

The active install may contain machine-local paths because the runtime needs a
real cwd. Do not commit those installed files back to the BigBrain repo.
`bigbrain health --json` ignores install-local `cwds`, `created_at`, and
`updated_at` when checking the active install against the repo templates.

## Git backup authentication

The `bigbrain-git-backup` automation uses the brain repo's normal Git remote.
Set up non-interactive Git authentication outside both repositories. Acceptable
places include the GitHub CLI credential store, the platform keychain, the SSH
agent, global Git config, or an ignored file under the agent runtime directory.

Do not store tokens, SSH keys, `.netrc` files, generated credential files, or
absolute personal credential-helper paths in either the BigBrain repo or the
brain repo. If a helper file is necessary, keep it outside the repos, for
example under:

```text
${CODEX_HOME:-$HOME/.codex}/automations/bigbrain-git-backup/
```

Before relying on the automation, verify the remote can be read without a
prompt:

```bash
GIT_TERMINAL_PROMPT=0 git -C "$brain_home" ls-remote origin HEAD
GIT_TERMINAL_PROMPT=0 git -C "$brain_home" pull --rebase --autostash
```
