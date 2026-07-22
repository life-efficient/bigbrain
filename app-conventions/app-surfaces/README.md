# App Surfaces

Document boundaries between public, authenticated, admin, internal, preview, and
debug surfaces.

## Loading And Shells

- Render stable route chrome, navigation, and headers immediately when a user
  can already know where they are.
- Do not block an entire public, authenticated, or admin surface behind a
  generic loading page when only data regions are pending.
- Do not skeletonize known static content such as route names, stable headings,
  descriptions, tabs, or action buttons. Skeletonize only the unknown value.
- Use route-level skeletons for panels, cards, tables, counts, and lists while
  live data resolves.

## Brain Profiles

- A brain's purpose and routing policy live in the reserved root `BRAIN.md`
  manifest and are exposed only through authenticated application surfaces.
- Keep public `/health` output minimal. Do not add a public `/about` route or
  expose routing descriptions through public/shared page APIs.
- Use authenticated `/api/about`, the MCP `about` tool, and CLI `about show` as
  views over the same normalized profile contract.
