# Navigation

Document sidebar, header, route, menu, tab, deep-link, and redirect behavior.

## Secondary Dashboard Views

- Keep Graph and Explorer as the prominent header navigation.
- In the desktop app, place brain switching in the dashboard topline's left slot, inline with Graph and Explorer. Hosted browser dashboards remain single-brain and never enumerate other connected brains.
- Place operational views such as Analytics in the settings menu instead of the
  primary header tabs.
- Opening a secondary view should close the settings menu and preserve the
  existing dashboard shell.

## Codex Task Visibility And Ownership

- Tasks created by RSS or webhook ingestion are product-facing Codex tasks and
  must be created through the desktop app's native task-creation path so they
  appear as foreground tasks and remain openable by the user.
- A separate background `app-server --stdio` client may persist a task, but it
  also owns the active turn. Do not use that path for a task that the user is
  expected to open or continue while ingestion is running.
- The event-ingester must hand the compact ingestion prompt and its working
  directory to a desktop-owned bridge. The bridge owns native task creation,
  foreground presentation, and the subsequent turn.
- Persisting `ephemeral: false` is not sufficient evidence that a task is
  foreground-visible. Verify both sidebar visibility and that the desktop app
  can continue the task before treating the handoff as successful.
