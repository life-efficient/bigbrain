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

Ask this before creating or selecting a local brain folder:

```text
Do you want to back up this brain to GitHub?

1. Yes, create or connect a private GitHub backup (recommended; STRONGLY RECOMMENDED: everything in your brain could be lost if you delete the folder or lose access to your device)
2. No, keep it only on this device
```

If the user chooses no, repeat the warning once in the final setup summary and
do not configure a GitHub remote.

Ask this only if the brain folder is not obvious from the workspace or existing
BigBrain config. If asking, use "server" instead of "computer" when the user
requested server mode. Use the path in
`~/.config/bigbrain/default-brain-home` as the default expected location when
that file exists, and display it with `~` instead of the full home directory
when possible:

```text
Where on your computer should I store the brain?

1. The default (`~/.config/bigbrain/default-brain-home`) (recommended)
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

Before declaring setup or update work complete, read `CHANGELOG.md`. For each
release applied to this checkout, perform the listed `Agent update actions` or
report why an action is not applicable.

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
rewrite the skill contents. Some legacy skill names in `SKILL.md` frontmatter
use quoted `BigBrain: ...` values so the colon remains valid YAML.

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

## GitHub backup

If the user chooses GitHub backup, configure it before finishing local setup.
The backup should be a private GitHub repository unless the user explicitly asks
for a public one.

Use the user's GitHub account through the GitHub MCP server:

1. Check whether the GitHub MCP server is already configured:

   ```bash
   codex mcp list
   ```

2. If no `github` server is configured, add the official remote GitHub MCP
   server to `~/.codex/config.toml`:

   ```toml
   [mcp_servers.github]
   url = "https://api.githubcopilot.com/mcp/"
   enabled = true
   ```

3. Run `codex mcp list` again. If GitHub is not logged in, run:

   ```bash
   codex mcp login github
   ```

4. If the user does not have a GitHub account, stop and have them create one at
   `https://github.com/signup`, then continue the MCP login after they confirm
   the account exists.

5. Verify the GitHub MCP tools are callable in a fresh agent session. Use a
   harmless read first, such as checking the authenticated account or listing
   repositories.

6. Create a new private repository through GitHub MCP, or use the existing
   GitHub repository the user names. Prefer a clear repo name such as
   `brain`, `bigbrain-home`, or the user's chosen brain name.

7. Initialize git in the brain home if needed, set the GitHub repository as
   `origin`, commit the current brain contents, and push:

   ```bash
   cd /path/to/brain-home
   git init
   git branch -M main
   git remote get-url origin >/dev/null 2>&1 \
     && git remote set-url origin https://github.com/<owner>/<repo>.git \
     || git remote add origin https://github.com/<owner>/<repo>.git
   git add -A
   git commit -m "Initialize BigBrain backup"
   git push -u origin main
   ```

8. Run a no-op backup check after the local MCP service is installed:

   ```bash
   git status --short
   ```

The local BigBrain MCP service is configured with git backup enabled. Once the
brain is a git repository with a working GitHub remote, the service can commit
and push future brain changes. If GitHub MCP setup, repository creation, or push
authentication fails, report that backup is not complete and do not claim the
brain is protected.

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

## Install local MCP service

For local setup on macOS, install and start the always-on local MCP service
after the CLI and brain home are configured:

```bash
repo_root="$(pwd)"
brain_home="/path/to/brain-home"

node "$repo_root/scripts/install-local-mcp-service.mjs" \
  --repo-root "$repo_root" \
  --brain-home "$brain_home"
```

If the local brain has multiple active members or owners, choose the local
identity explicitly:

```bash
node "$repo_root/scripts/install-local-mcp-service.mjs" \
  --repo-root "$repo_root" \
  --brain-home "$brain_home" \
  --local-person-slug people/hani
```

This writes a LaunchAgent at:

```text
~/Library/LaunchAgents/local.bigbrain.mcp.plist
```

It starts BigBrain with:

```bash
bigbrain --brain-home "$brain_home" mcp --host 127.0.0.1 --port 3333
```

The service is configured with `RunAtLoad` and `KeepAlive`, so macOS starts it
at login and restarts it if it exits. Logs are written to:

```text
~/.config/bigbrain/bigbrain-mcp.log
~/.config/bigbrain/bigbrain-mcp.err.log
```

Verify it is running:

```bash
curl http://127.0.0.1:3333/health
launchctl print "gui/$(id -u)/local.bigbrain.mcp"
```

The MCP endpoint is:

```text
http://127.0.0.1:3333/mcp
```

This local service uses `BIGBRAIN_MCP_AUTH_MODE=none` and binds only to
`127.0.0.1`. In this mode, `assignee=me` resolves to the configured
`BIGBRAIN_MCP_LOCAL_PERSON_SLUG`, the single active owner, or the single active
member. Ambiguous local membership fails with setup guidance instead of guessing.
Do not use this unauthenticated local service for remote or shared brains. For
server or team access, use the hosted MCP setup in `docs/mcp-hosting.md`.

## Install automations

BigBrain automation templates live under `automations/`. They are repo-owned
templates, not the active local install. The templates intentionally use:

```toml
cwds = ["<brain-home>"]
cwds = ["<bigbrain-repo>"]
```

When installing them into the agent runtime, copy the automation directories to
`${CODEX_HOME:-$HOME/.codex}/automations`, replace `<brain-home>` with the
real local brain path, and replace `<bigbrain-repo>` with the local BigBrain
source repo path in the installed copy only:

```bash
repo_root="$(pwd)"
automation_root="${CODEX_HOME:-$HOME/.codex}/automations"
brain_home="/path/to/brain-home"
bigbrain_repo="$repo_root"

mkdir -p "$automation_root"
for id in bigbrain-check-update bigbrain-nightly-maintenance; do
  rm -rf "$automation_root/$id"
  cp -R "$repo_root/automations/$id" "$automation_root/$id"
  perl -0pi -e "s#<brain-home>#$brain_home#g" "$automation_root/$id/automation.toml"
  perl -0pi -e "s#<bigbrain-repo>#$bigbrain_repo#g" "$automation_root/$id/automation.toml"
done
```

The active install may contain machine-local paths because the runtime needs a
real cwd. Do not commit those installed files back to the BigBrain repo.
`bigbrain health --json` ignores install-local `cwds`, `created_at`, and
`updated_at` when checking the active install against the repo templates.

The old scheduled sync and Git backup automations are intentionally not
installed here. The local event-driven MCP service handles sync/index freshness
and Git backup for local brains.
