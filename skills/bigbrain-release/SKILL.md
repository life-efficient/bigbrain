---
name: "BigBrain: Release"
version: 1.0.0
description: |
  Prepare, verify, tag, and publish a BigBrain semver release. Use when the user
  asks to make a BigBrain release, cut a version, update the changelog, tag a
  release, or publish release notes for friends' local agents.
triggers:
  - "make a BigBrain release"
  - "cut a BigBrain release"
  - "tag a release"
  - "publish BigBrain"
  - "prepare release notes"
tools:
  - shell
mutating: true
---

# BigBrain: Release

Use this skill to ship BigBrain releases with semver, changelog-driven agent
update actions, and verified tags.

## Contract

- Follow `docs/releases.md`.
- Do not release without a matching `CHANGELOG.md` entry.
- Every release entry must include `Agent update actions` for friends' agents.
- Preserve unrelated local edits; stage only release-owned files.
- Do not tag until tests pass and the intended release commit is on `main`.
- Push `main` and the version tag together after verification.

## Workflow

1. Inspect the repo state:
   - `git status --short --branch`
   - `git log --oneline --decorate --max-count=10`
2. Confirm the release version:
   - read `package.json`
   - read `CHANGELOG.md`
   - ensure the release entry exists and the version matches
3. Verify release notes:
   - `CHANGELOG.md` has `Added`, `Changed`, `Fixed`, or `Removed` sections as
     relevant
   - `CHANGELOG.md` has `Agent update actions`
   - agent actions mention schema, skills, automations, MCP, runtime, backup, or
     migration work when those areas changed
4. Update release metadata if needed:
   - bump `package.json`
   - bump `package-lock.json`
   - update `CHANGELOG.md`
   - update `docs/releases.md` only when the release process changes
5. Run verification:
   - `npm test`
   - any release-specific verification listed in `CHANGELOG.md`
6. Commit release metadata if there are unstaged release-owned edits:
   - stage only release files
   - commit with a release-oriented message
7. Create or verify the tag:
   - use `vX.Y.Z`
   - do not move an existing remote tag unless the user explicitly asks
8. Push:
   - `git push origin main --tags`
9. If GitHub CLI is authenticated, create a GitHub Release from the changelog
   entry:
   - use tag `vX.Y.Z`
   - title `BigBrain vX.Y.Z`
   - body from the matching `CHANGELOG.md` section
   - if `gh` is unavailable or unauthenticated, report the release URL/tag and
     the exact manual follow-up

## Guardrails

- Do not use `git reset --hard`, `git checkout --`, or destructive cleanup.
- Do not include unrelated local edits in the release commit.
- Do not skip tests because a change is "docs only" if package version,
  changelog, skills, release process, or install behavior changed.
- Do not tag `HEAD` if the changelog version and package version disagree.
- Do not publish a GitHub Release with missing `Agent update actions`.

## Output

Report:

- release version
- release commit
- tag pushed
- GitHub Release status
- tests run and result
- agent update actions summary
- any unrelated local edits left untouched
