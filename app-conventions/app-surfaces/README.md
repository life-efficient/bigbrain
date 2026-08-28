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
- When the desktop opens a local Brain, keep the shell visible with a neutral startup status while managed-service reconciliation completes and `/ready` becomes healthy. Retry transient connection refusals automatically, reveal the dashboard view only after navigation succeeds, and never present a routine startup race as a raw error or blank surface.

## Brain Profiles

- A brain's purpose and routing policy live in the reserved root `BRAIN.md`
  manifest and are exposed only through authenticated application surfaces.
- Keep public `/health` output minimal. Do not add a public `/about` route or
  expose routing descriptions through public/shared page APIs.
- Use authenticated `/api/about`, the MCP `about` tool, and CLI `about show` as
  views over the same normalized profile contract.

## Updates

- Show the installed BigBrain version and a manual **Check for Updates** action
  in the desktop app even when background checks are enabled.
- Keep the current app version visible in the dashboard header. When an update
  is available, turn that compact header item into the blue download, progress,
  or restart control without adding another toolbar.
- A desktop-managed local MCP updates with the desktop. Explain that shared
  scope before asking the user to restart.
- A desktop connected to a remote BigBrain may report the remote version and
  update availability, but must never mutate or restart that service.
- Keep update states explicit: checking, available, downloading, ready to
  restart, current, deferred, and failed. Preserve the last usable app surface
  when an update check fails.
