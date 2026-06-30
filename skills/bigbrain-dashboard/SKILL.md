---
name: bigbrain-dashboard
description: |
  Open the BigBrain browser dashboard app and verify it is running. Use when the
  user asks for the BigBrain dashboard, wants to open or launch the dashboard,
  or asks to view BigBrain locally.
---

# BigBrain: Dashboard

Use this skill to open the BigBrain dashboard as the local browser app. Default
to the browser app because it uses the installed BigBrain CLI and avoids desktop
app dependency setup. Use the Electron desktop app only when the user explicitly
asks for it.

## Contract

This skill guarantees:
- Start the local BigBrain browser dashboard with `bigbrain dashboard`
- Keep the dashboard command session alive so the server stays open
- Verify the app is actually serving a dashboard before reporting success
- Report the reachable local URL when it can be discovered

## Workflow

1. Start the browser dashboard:
   - `bigbrain dashboard`
   - pass `--brain-home <path>` or `--config <path>` only when the user asks for
     a specific brain or local context requires it
   - pass `--no-open` only when you need to verify the server without opening a
     browser window
2. Keep the command session running. Do not stop the launcher after the window
   opens, because the browser dashboard depends on that server process.
3. Verify the app:
   - use the URL printed by `bigbrain dashboard`
   - check it with `curl -I`
   - verify the candidate URL returns HTTP 200
4. If the command starts but the URL cannot be found, report that the dashboard
   process is running and say URL discovery was inconclusive.

## Guardrails

- Do not fall back to `npm run desktop:dev` unless the browser dashboard launch
  fails or the user explicitly asks for the desktop app.
- Do not edit dashboard source files just to open the app.
- Do not kill unrelated browser or dashboard processes.
- If the dashboard appears stale after recent source edits, rebuild the
  dashboard bundle with `npm run build:dashboard`, restart `bigbrain dashboard`,
  and verify the served bundle or local URL before claiming the new UI is live.

## Output

Report:
- command used
- whether the dashboard command is still running
- local URL if discovered
- verification result
