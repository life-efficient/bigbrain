---
name: bigbrain-check-update
description: Safely update and verify a source-managed BigBrain checkout when the packaged desktop updater does not own the installation.
---

# BigBrain Check Update

Update a source-managed BigBrain installation without discarding local work, then verify every affected local runtime surface.

## Contract Checklist

- Route packaged desktop installations to the in-app updater instead of changing a source checkout.
- Leave remote and server-managed services untouched.
- Check the tracked upstream, or use `origin/main` when a local feature branch has no upstream.
- Preserve uncommitted files, untracked files, local commits, custom filing rules, and customized active skills or automations.
- Apply every relevant `Agent update actions` item from the landed changelog entries.
- Refresh safe repo-owned skills and automations in the active agent runtime.
- Verify the CLI, tests, selected brain, filing rules, and every source-managed local MCP service affected by the update.
- Report service health separately from Codex MCP registration.
- Never claim success from an available tag, completed pull, or running process alone.

## Workflow

1. Classify the installation owner:
   - Use the packaged desktop app's header control or **Check for Updates** menu action when the desktop owns the installation.
   - Continue with this skill only for a source checkout or when the desktop updater is unavailable and the user explicitly wants the source fallback.
   - Treat Docker, hosted, self-hosted, on-premises, and connected remote services as operator-managed. Report the matching release action without mutating or restarting them.
   - If ownership is ambiguous, inspect runtime metadata and the LaunchAgent executable, CLI path, and working directory before continuing.
   - Anti-patterns: running Git updates for a packaged app, treating loopback as proof of desktop ownership, restarting remote services, guessing ownership from a label alone
2. Resolve and record the source checkout:
   - Prefer the current BigBrain repo, then `BIGBRAIN_REPO`, then known workspace roots.
   - Record `git status --short --branch`, the current branch, current HEAD, and configured upstream.
   - If the branch has no upstream, use `origin/main` for comparison without changing branch tracking.
   - Stop if the target is not a BigBrain source checkout.
   - Anti-patterns: updating a markdown brain home, changing tracking solely for the check, hiding dirty state, switching branches without need
3. Fetch and compare safely:
   - Run `git fetch --prune --tags` for the selected remote.
   - Compare `HEAD` with the selected upstream and identify ahead, behind, or diverged state.
   - Report a verified no-op when no release is newer, then continue with runtime verification if the user asked to keep the installation healthy.
   - Stop on authentication failure or a diverged history that cannot be updated safely.
   - Anti-patterns: pulling before comparison, treating missing `@{u}` as a blocker when `origin/main` exists, claiming an update from tag presence alone
4. Apply a compatible source update:
   - Prefer `bigbrain update --apply --json` when the checkout meets its safety requirements.
   - Otherwise, when the current branch is behind its upstream and local work can be preserved, use the established `git pull --rebase --autostash` fallback.
   - Never use destructive reset, checkout, or cleanup commands.
   - Stop and report exact conflicts, unsigned-tag requirements, major-version approval requirements, or unsafe worktree state.
   - Anti-patterns: discarding local edits, forcing a major release, overwriting an untracked file, calling a blocked update successful
5. Read and apply release actions:
   - Compare the previous and final revisions of `CHANGELOG.md`.
   - Read every landed release's `Agent update actions` before installing dependencies or changing runtime state.
   - Use the Filing-Rule Update Policy below for schema or filing changes.
   - Report a missing changelog entry, but continue with generic verification when safe.
   - Anti-patterns: skipping changelog actions, applying actions from releases that did not land, rewriting customized filing rules wholesale
6. Refresh dependencies and the CLI only when needed:
   - Run `npm install` when package metadata changed or dependencies are unavailable.
   - Run `npm link`, then prove `bigbrain --version` and `bigbrain --help` work from the repo and from outside it.
   - Confirm the reported public release matches the updated package and runtime metadata.
   - Anti-patterns: reinstalling blindly, verifying only from the repo cwd, accepting a different globally linked checkout
7. Reconcile repo-owned skills:
   - Enumerate `skills/*/SKILL.md` and resolve the active Codex skills root.
   - Create or refresh symlinks that point to this repo.
   - Do not overwrite a copied active skill with local edits. Report it as manual follow-up.
   - Confirm every safe repo-owned skill resolves to the intended source file.
   - Anti-patterns: listing without installing, replacing a customized copy, leaving a broken symlink, reporting availability without path verification
8. Reconcile repo-owned automations:
   - Enumerate `automations/*/automation.toml`, read `automations/retired.json`, and resolve the active automation root.
   - Install or refresh safe templates, replacing `<brain-home>` and `<bigbrain-repo>` only in the active copy.
   - Preserve install-local `cwds`, timestamps, targets, and customized prompts.
   - Keep the deprecated `bigbrain-check-update` automation paused. Do not enable it for desktop-managed installations.
   - Never restore retired writers. Stop before enabling writes when duplicate IDs, multiple Granola writers, or active backup directories exist.
   - Anti-patterns: activating the deprecated daily updater, overwriting local automation edits, restoring a retired writer, leaving duplicate active writers
9. Verify the selected brain and templates:
   - Run `npm test`, `bigbrain health --json`, and `bigbrain schema`.
   - Repair a stale default-brain pointer only when it targets a deleted temporary fixture and the intended brain is known.
   - Review skill and automation template status and fix every safe BigBrain-owned mismatch before rerunning health.
   - Query MCP filing rules when the selected brain is MCP-backed.
   - Anti-patterns: treating first-pass health as final after repairs, confusing a stale fixture with user data, ignoring template mismatches
10. Restart and verify source-managed local services:
   - Discover LaunchAgents whose CLI path resolves inside the updated checkout.
   - Restart only those source-managed services after code changed.
   - Verify `/ready`, exact runtime release, MCP `initialize`, and `tools/list` on each configured port.
   - Do not restart a desktop-bundle, remote, container, unknown-owner, or newer independently managed service.
   - Run `codex mcp list` separately and report registration status independently from service health.
   - Anti-patterns: matching by label alone, downgrading a newer runtime, treating an occupied healthy port as failure, equating endpoint health with Codex registration
11. Report the outcome:
   - State whether this was a desktop handoff, verified no-op, applied source update, or blocked update.
   - Summarize user-facing release changes and applied runtime fixes.
   - Separate checkout, templates, selected brain, local service, and Codex registration results when any needs attention.
   - Anti-patterns: leading with command logs, reporting only commit hashes, hiding preserved local work, saying no action is needed when follow-up remains

## Filing-Rule Update Policy

When a landed release changes filing rules, update the selected brain's
`FILING.md` and relevant collection `FILING.md` files instead of only checking
compiled output.

- Replace old default wording only when the file still matches that default.
- Merge new bullets, sections, values, examples, or timeline rules into a
  customized file while preserving the user's language.
- Keep the user's rule when a new default conflicts with it, and report the
  operational difference only when it matters.
- Re-read the changed files, then run `bigbrain schema` and MCP
  `filing_rules` when available.

## Migration Path

- Packaged desktop installs use the client updater now. The app downloads the
  signed release, coordinates restart, reinstalls only desktop-owned local MCP
  services from its bundle, and verifies the app and services after relaunch.
- The bundled daily `bigbrain-check-update` automation is paused and should not
  be newly installed for desktop users.
- This skill remains a source-install compatibility fallback until deterministic
  CLI migrations can safely apply changelog actions, filing-rule changes, and
  customized skill or automation reconciliation.
- After those migrations exist for all supported source releases, remove the
  automation first, then remove this resolver entry and skill in a later release.
  Keep `bigbrain update --apply` and the headless updater as the source-install
  mechanism.

## Anti-Patterns

- Using this skill as a second updater for a packaged desktop installation.
- Inferring service ownership from hostname, port, or label alone.
- Reinstalling or downgrading a newer, source-managed, remote, or unknown-owner service.
- Discarding local source changes, local commits, customized skills, customized automations, or filing rules.
- Treating a successful download, Git pull, process start, or `/health` response as complete verification.
- Publishing secrets, credentials, private paths, or raw command logs in the final report.

## Output

Lead with one of these outcomes: desktop updater handoff, already current,
source update completed, or update blocked. Then include only the user-facing
release changes, applied safe fixes, verification outcomes, and actionable
follow-up. Include technical paths, ports, refs, or commands only when they
explain a blocker.
