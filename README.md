# bigbrain

Standalone task refresh package for gbrain-style markdown directories.

## Files

- `bigbrain.config.json` — stable target config
- `bigbrain.state.json` — mutable run state, ignored by git
- `bin/bigbrain.js` — CLI with `recent`
- `scripts/refresh-tasks.mjs` — conservative task reconciler
- `skills/task-refresh/SKILL.md` — reusable skill definition

## Commands

```bash
npm run recent -- --json
npm run refresh-tasks -- --dry-run --json
npm test
```
