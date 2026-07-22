# Install BigBrain for Agents

BigBrain is expected to be a global CLI. Agents should be able to run commands
such as `bigbrain sync --json` from any working directory.

## Ask before setup

Ask the user only for choices that change the installation. Ask one question at
a time, show numbered option answers, mark exactly one answer with
`(recommended)`, and wait for the user's answer before proceeding.

Ask this first. These are the only two primary setup paths:

```text
How do you want to set up BigBrain?

1. Run BigBrain on this device (recommended)
2. Connect to an existing BigBrain
```

If the user instead wants to deploy a BigBrain service, route that to the
advanced deployment flow rather than adding a third setup path. Docker is the
canonical package for server deployment. Hosted-by-us, self-hosted, and
on-premises are deployment variants; private and shared access are separate
access choices. Once the service is running, clients use **Connect to an
existing BigBrain** whether the service is on the same physical machine, on an
organization's network, or online.

Ask this before creating or selecting a brain folder for **Run BigBrain on this
device**:

```text
Do you want to back up this brain to GitHub?

1. Yes, create or connect a private GitHub backup (recommended; STRONGLY RECOMMENDED: everything in your brain could be lost if you delete the folder or lose access to your device)
2. No, keep it only on this device
```

If the user chooses no, repeat the warning once in the final setup summary and
do not configure a GitHub remote.

Ask this only if the brain folder is not obvious from the workspace or existing
BigBrain config. Use the path in `~/.config/bigbrain/default-brain-home` as the
default expected location when that file exists, and display it with `~`
instead of the full home directory when possible:

```text
Where on this device should I store the brain?

1. The default (`~/.config/bigbrain/default-brain-home`) (recommended)
2. Somewhere else (tell me where)
```

Ask this only in the advanced deployment flow when a server database is needed:

```text
Where should the server database live?

1. Local development database (recommended)
2. Supabase
3. Another hosted Postgres database
```

Ask this only when configuring a service's access policy. Treat it as separate
from where the service is deployed and from how a client connects:

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

Verify the binary is on the active shell `PATH`:

```bash
command -v bigbrain
bigbrain --help
```

Also verify the Codex shell can resolve the same command from outside the
BigBrain repo:

```bash
cd /tmp
zsh -lc 'command -v bigbrain && bigbrain --help'
```

If either `command -v bigbrain` check fails, add npm's global binary directory
to the shell startup file used by Codex, then open a fresh shell and verify
again:

```bash
global_bin="$(npm prefix -g)/bin"
case ":$PATH:" in
  *":$global_bin:"*) ;;
  *) printf '\nexport PATH="%s:$PATH"\n' "$global_bin" >> "$HOME/.zprofile" ;;
esac

zsh -lc 'command -v bigbrain && bigbrain --help'
```

Do not continue setup until `bigbrain` resolves in a fresh Codex-style shell.
Automation and MCP health checks depend on the global CLI being available from
ordinary working directories.

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

Ask for the human-facing brain name when creating a new brain. Initialize it
with `bigbrain init /path/to/brain-home --name "Personal Brain"`. BigBrain
stores an immutable generated `brain_id` plus the editable `brain_name`; it does
not store a canonical slug.

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

If the user chooses GitHub backup, configure it before finishing setup on this
device.
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

8. Run a no-op backup check after the on-device MCP service is installed:

   ```bash
   git status --short
   ```

The on-device BigBrain MCP service is configured with git backup enabled. Once
the brain is a git repository with a working GitHub remote, the service can
commit and push future brain changes. If GitHub MCP setup, repository creation,
or push authentication fails, report that backup is not complete and do not
claim the brain is protected.

## Automation sync command

Use the global CLI directly:

```bash
bigbrain sync --json
```

Sync writes to the runtime state directory:

```text
<brain-home>/.bigbrain-state/
```

## Install automations

BigBrain automation templates are provided from this repo under `automations/`.
Install every direct child directory that contains an `automation.toml` file into
the active Codex automation directory. Prefer copying automation templates rather
than symlinking them, because installed automations usually need local `cwds`
values:

```bash
repo_root="$(pwd)"
automation_root="${CODEX_HOME:-$HOME/.codex}/automations"
brain_home="/path/to/brain-home"
bigbrain_repo="$repo_root"

mkdir -p "$automation_root"
find "$repo_root/automations" -mindepth 2 -maxdepth 2 -name automation.toml -print \
  | while IFS= read -r automation_file; do
  automation_dir="$(dirname "$automation_file")"
  automation_id="$(basename "$automation_dir")"
  rm -rf "$automation_root/$automation_id"
  cp -R "$automation_dir" "$automation_root/$automation_id"
  perl -0pi -e "s#<brain-home>#$brain_home#g" "$automation_root/$automation_id/automation.toml"
  perl -0pi -e "s#<bigbrain-repo>#$bigbrain_repo#g" "$automation_root/$automation_id/automation.toml"
done
```

The bundled automations currently include:

- `bigbrain-check-update`
- `bigbrain-route-granola` (installed paused until routing cutover)
- `bigbrain-nightly-maintenance`

The router is the sole supported machine-wide Granola writer. Before activating
it, register and verify every destination brain, approve each brain's
`BRAIN.md`, reconcile existing `granola_id` provenance, and pause or remove all
retired Granola automations listed in `automations/retired.json`. Put rollback
copies outside the live automation root.

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
same Node version and shell environment used by the agent or automation, then
repair the Codex shell `PATH` as described in One-time setup.

## Install the on-device MCP service

For **Run BigBrain on this device** on macOS, install and start the always-on
loopback MCP service after the CLI and brain home are configured:

```bash
repo_root="$(pwd)"
brain_home="/path/to/brain-home"

node "$repo_root/scripts/install-local-mcp-service.mjs" \
  --repo-root "$repo_root" \
  --brain-home "$brain_home" \
  --local-person-slug people/hani \
  --local-owner-name "Hani" \
  --local-owner-email hani@example.com
```

The default label and port preserve compatibility with existing single-brain
installs. For an additional brain running on this device, choose a distinct
persisted service label, port, and Codex MCP registration derived from its name,
for example `local.bigbrain.research-brain`, port `3334`, and `research_brain`.
Do not rename those aliases automatically when `brain_name` changes.

Use the target brain owner's real `people/<slug>` page, display name, and email.
The installer creates or repairs an active local owner row before starting the
service, then persists `BIGBRAIN_MCP_LOCAL_PERSON_SLUG` in the LaunchAgent so
`assignee=me` works for single-user brains running on this device.

If the brain already has exactly one active owner/member, `me` can resolve
without an explicit slug, but fresh installs should still pass
`--local-person-slug` so the identity is stable after future collaborators are
added.

To repair an existing local install where `assignee=me` fails because the
members table is empty, first bootstrap the owner:

```bash
bigbrain --brain-home "$brain_home" members ensure-local-owner people/hani \
  --name "Hani" \
  --email hani@example.com
```

Then reinstall or refresh the local service with the same identity:

```bash
node "$repo_root/scripts/install-local-mcp-service.mjs" \
  --repo-root "$repo_root" \
  --brain-home "$brain_home" \
  --local-person-slug people/hani \
  --local-owner-name "Hani" \
  --local-owner-email hani@example.com
```

This writes a brain-specific LaunchAgent. For example, a brain named
`Personal Brain` uses:

```text
~/Library/LaunchAgents/local.bigbrain.personal-brain.plist
```

Older installs may still use `~/Library/LaunchAgents/local.bigbrain.mcp.plist`;
verify the label that exists on the machine instead of assuming the legacy
name.

It starts BigBrain with:

```bash
bigbrain --brain-home "$brain_home" mcp --host 127.0.0.1 --port 55560
```

The service is configured with `RunAtLoad` and `KeepAlive`, so macOS starts it
at login and restarts it if it exits. Logs are written to brain-specific files
such as:

```text
~/.config/bigbrain/local.bigbrain.personal-brain.log
~/.config/bigbrain/local.bigbrain.personal-brain.err.log
```

Verify it is running:

```bash
curl http://127.0.0.1:55560/health
launchctl print "gui/$(id -u)/local.bigbrain.personal-brain"
```

Use `codex mcp list` to verify the Codex registration separately from service
health. On Harry's current machine, the loopback endpoint is registered as
`personal_brain` at `http://127.0.0.1:55560/mcp`; absence of an older `bigbrain`
entry is not a service-health failure.

For a headless source installation, the local MCP installer also installs the
separate stable-channel updater by default. To install or repair it directly:

```bash
node scripts/install-headless-updater.mjs \
  --repo-root /path/to/bigbrain \
  --channel stable
```

The updater checks at login and every six hours. It applies compatible stable
releases only when the source checkout is safe to fast-forward, then restarts
and verifies every local MCP service running from that checkout. Major-version
updates remain pending until explicitly approved. Test the same one-shot path
without installing the schedule with:

```bash
node scripts/run-headless-update.mjs \
  --repo-root /path/to/bigbrain \
  --channel stable
```

Pass `--no-auto-update` to `install-local-mcp-service.mjs` only when the user
explicitly wants to manage source updates themselves. Packaged desktop installs
do not install this scheduler because the desktop owns their update lifecycle.

The MCP endpoint is:

```text
http://127.0.0.1:55560/mcp
```

This on-device service uses `BIGBRAIN_MCP_AUTH_MODE=none` and binds only to
`127.0.0.1`. In this mode, `assignee=me` resolves to the configured
`BIGBRAIN_MCP_LOCAL_PERSON_SLUG`, the single active owner, or the single active
member. Ambiguous membership fails with setup guidance instead of guessing.
Do not expose this unauthenticated loopback service for network-accessible or
shared access. For Docker, server, or team deployments, use the advanced MCP
deployment setup in `docs/mcp-hosting.md`.

## Install automations

BigBrain automation templates live under `automations/`. They are repo-owned
templates, not the active local install. The templates intentionally use:

```toml
cwds = ["<brain-home>"]
cwds = ["<bigbrain-repo>"]
```

When installing them into the agent runtime, copy the automation directories to
`${CODEX_HOME:-$HOME/.codex}/automations`, replace `<brain-home>` with the
real on-device brain path, and replace `<bigbrain-repo>` with the local BigBrain
source repo path in the installed copy only:

```bash
repo_root="$(pwd)"
automation_root="${CODEX_HOME:-$HOME/.codex}/automations"
brain_home="/path/to/brain-home"
bigbrain_repo="$repo_root"

mkdir -p "$automation_root"
for id in bigbrain-check-update bigbrain-route-granola bigbrain-nightly-maintenance; do
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
It also fails health when retired or duplicate Granola writers remain active.
Keep `bigbrain-route-granola` paused until the profile and provenance cutover is
complete.

The old scheduled sync and Git backup automations are intentionally not
installed here. The on-device event-driven MCP service handles sync/index
freshness and Git backup for brains running this way.
