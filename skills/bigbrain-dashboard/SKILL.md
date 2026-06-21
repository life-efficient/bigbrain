---
name: bigbrain-dashboard
description: |
  Open the BigBrain desktop dashboard app and verify it is running. Use when the
  user asks for the BigBrain dashboard, wants to open or launch the dashboard,
  asks for the desktop app, or asks to view BigBrain locally.
---

# BigBrain: Dashboard

Use this skill to open the BigBrain dashboard as the Mac desktop app. Default to
the desktop app, not the browser-only dashboard, unless the user explicitly asks
for a browser/server version.

## Contract

This skill guarantees:
- Launch the BigBrain desktop app from the local BigBrain source repo
- Keep the launcher process alive so the Electron app stays open
- Verify the app is actually serving a dashboard before reporting success
- Report the reachable local URL when it can be discovered

## Workflow

1. Resolve the BigBrain source repo:
   - use the current working directory if it is the BigBrain repo
   - otherwise use `~/projects/bigbrain` when it exists
   - otherwise ask the user for the repo path
2. Start the desktop app from the BigBrain repo:
   - `npm run desktop:dev`
3. Keep the command session running. Do not stop the launcher after the window
   opens, because the Electron app depends on that process.
4. Verify the app:
   - if the launcher prints a URL, check it with `curl -I`
   - otherwise inspect local listeners and look for the Electron dashboard
     server; the usual local dashboard URL is `http://127.0.0.1:3474`
   - verify the candidate URL returns HTTP 200
5. If the app launches but the URL cannot be found, report that the desktop
   window was opened and say URL discovery was inconclusive.

## Guardrails

- Do not fall back to `bigbrain dashboard` unless the desktop app launch fails
  or the user explicitly asks for a browser/server dashboard.
- Do not edit dashboard source files just to open the app.
- Do not kill unrelated Electron apps.
- If the dashboard appears stale after recent source edits, rebuild the
  dashboard bundle with `npm run build:dashboard`, restart the desktop app, and
  verify the served bundle or local URL before claiming the new UI is live.

## Output

Report:
- repo path used
- whether the desktop app launch command is still running
- local URL if discovered
- verification result
