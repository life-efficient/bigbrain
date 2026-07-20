# BigBrain Automations

This directory contains the repo-owned automation templates for BigBrain.

Install active automation definitions into the agent runtime's automation
directory, usually under `$CODEX_HOME/automations` or `~/.codex/automations`.
Keep this repo directory as the source of truth for prompts, schedules, models,
and execution settings.

`cwds = ["<brain-home>"]` and `cwds = ["<bigbrain-repo>"]` are portable
placeholders. The active installed automation should replace them with the local
brain home path or BigBrain source repo path for that machine.
`bigbrain health --json` compares active automations against these templates
while ignoring install-local `cwds`, `created_at`, and `updated_at` fields.

Do not store credentials, access tokens, or machine-local paths in this repo.
Machine-local values belong only in the active agent install, Git config,
credential manager, environment, or another ignored local file outside the
BigBrain and brain repositories.

## Install

From the BigBrain repo, copy each automation directory into the active Codex
automation directory and replace only the placeholder cwd:

```bash
repo_root="$(pwd)"
automation_root="${CODEX_HOME:-$HOME/.codex}/automations"
brain_home="/path/to/brain-home"
bigbrain_repo="$repo_root"

mkdir -p "$automation_root"
for id in bigbrain-check-update bigbrain-ingest-granola bigbrain-nightly-maintenance; do
  rm -rf "$automation_root/$id"
  cp -R "$repo_root/automations/$id" "$automation_root/$id"
  perl -0pi -e "s#<brain-home>#$brain_home#g" "$automation_root/$id/automation.toml"
  perl -0pi -e "s#<bigbrain-repo>#$bigbrain_repo#g" "$automation_root/$id/automation.toml"
done
```

Keep the resulting local `cwds` entries in the active install only. Do not copy
those machine-specific files back into this repo.

The old scheduled sync and Git backup automations are intentionally not bundled
for install anymore. The local event-driven MCP service handles sync/index
freshness and Git backup when BigBrain runs on the device.
