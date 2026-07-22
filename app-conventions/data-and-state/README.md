# Data And State

Document state ownership, persistence, imports, derived values, supported admin
configuration, and app data assumptions.

## Initial State And Loading

- Separate shell-ready state from data-ready state.
- Keep route chrome renderable before the first successful data fetch.
- Use static seed/baseline content for public surfaces when the content is
  mostly fixed and live data is only hydrating details.
- Use explicit empty states only after the relevant request resolves; before
  that, use skeletons in the affected data region.
- Treat static labels and loaded values independently. A pending count or metric
  should not force its surrounding header, label, action area, or explanatory
  copy into a skeleton state.

## Operational Analytics

- Load analytics only when the user opens the secondary Analytics view.
- Show aggregate MCP audit counts and bounded event metadata; never expose page
  bodies, prompts, search queries, headers, credentials, or audit detail payloads.
- State the active retention period in the view so totals are not mistaken for
  lifetime usage.

## Brain Routing Profiles

- Treat root `BRAIN.md` as version-controlled configuration, not an indexed
  knowledge page. Exclude it even when a legacy brain has custom include or
  exclude globs.
- Missing, invalid, draft, or unapproved profiles fail closed to review and can
  never authorize automatic ingestion.
- Keep authored routing policy separate from computed capabilities such as
  current authentication, writability, health, and available operations.
- Send `Cache-Control: no-store` with authenticated profile API responses.
