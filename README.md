# bigbrain

Standalone task refresh package for gbrain-style markdown directories.

## Files

- `bigbrain.config.json` — stable target config, always read from this package directory
- `bigbrain.state.json` — committed run state baseline, updated after successful refreshes
- `bin/bigbrain.js` — CLI with `recent`
- `scripts/refresh-tasks.mjs` — conservative task reconciler
- `skills/task-refresh/SKILL.md` — reusable skill definition

## Behavior

- `bigbrain` always reads `bigbrain.config.json` from the package directory
- `bigbrain` always reads `bigbrain.state.json` next to that config file
- if the configured `brain_dir` or `tasks_file` does not exist, `bigbrain` exits with a setup error telling the caller to update the config and ask the user where the paths should point if unknown

## Commands

```bash
npm run recent -- --json
npm run refresh-tasks -- --dry-run --json
npm test
```
