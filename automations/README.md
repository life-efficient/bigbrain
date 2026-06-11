# BigBrain Automations

This directory contains the repo-owned automation templates for BigBrain.

Install active automation definitions into the agent runtime's automation
directory, usually under `$CODEX_HOME/automations` or `~/.codex/automations`.
Keep this repo directory as the source of truth for prompts, schedules, models,
and execution settings.

`cwds = ["<brain-home>"]` is a portable placeholder. The active installed
automation should replace it with the local brain home path for that machine.
`bigbrain health --json` compares active automations against these templates
while ignoring install-local `cwds`, `created_at`, and `updated_at` fields.
