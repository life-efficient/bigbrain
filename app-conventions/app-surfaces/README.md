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
