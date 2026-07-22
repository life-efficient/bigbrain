# BigBrain Releases

BigBrain uses semantic versioning: `MAJOR.MINOR.PATCH`.

- `MAJOR`: incompatible brain schema, runtime storage, MCP contract, or install
  workflow changes that require deliberate migration.
- `MINOR`: new commands, MCP tools, skills, automations, dashboard features, or
  backward-compatible schema additions that agents should install or verify.
- `PATCH`: bug fixes, wording fixes, and compatible maintenance changes.

Every release must update:

- `package.json`
- `package-lock.json`
- `CHANGELOG.md`

One release tag publishes the matching desktop and server artifacts:

- a signed and notarized universal macOS DMG and ZIP
- Electron update metadata (`latest-mac.yml` and blockmaps)
- a multi-architecture server image at
  `ghcr.io/life-efficient/bigbrain:<version>` plus its immutable digest

The macOS release job requires the protected `MACOS_CERTIFICATE_P12`,
`MACOS_CERTIFICATE_PASSWORD`, `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, and
`APPLE_TEAM_ID` repository secrets. Do not publish an unsigned artifact to the
stable desktop update feed.

## Changelog Contract

Each release entry must include `Agent update actions`. That section is the
handoff for friends' agents and should say exactly what to do after pulling.

Mention actions when a release includes:

- schema or filing-rules changes
- new, renamed, or removed skills
- new, changed, or removed automation templates
- CLI command changes
- MCP tool or scope changes
- runtime state, database, or deployment changes
- required setup checks such as GitHub backup

Actions should be concrete commands or checks, for example:

```bash
npm install
npm link
bigbrain schema
bigbrain sync --json
bigbrain health --json
```

If a change needs judgment rather than a command, state what the agent should
ask the user.

## Release Checklist

1. Choose the next version according to semver.
2. Update `package.json` and `package-lock.json`.
3. Update `CHANGELOG.md` with:
   - added, changed, fixed, removed sections as relevant
   - `Agent update actions`
   - verification performed
4. Run `npm test`.
5. Commit with a release-oriented message.
6. Tag the release after the commit is on `main`:

   ```bash
   git tag vX.Y.Z
   git push origin main --tags
   ```

7. If a GitHub Release is created, copy the matching changelog entry.
8. Confirm the GitHub Release contains `latest-mac.yml`, ZIP/DMG blockmaps, and
   signed desktop packages.
9. Confirm the matching GHCR image exists for both `linux/amd64` and
   `linux/arm64`, then record the production digest before promotion.

## Update Policy

- The desktop checks automatically and keeps a manual **Check for Updates**
  action. It updates only itself and desktop-managed local MCP services.
- Headless source installs use `bigbrain update --apply` through the scheduled
  updater. Dirty, detached, diverged, and major-version updates stop safely.
- Server deployments pull a tagged image, pin its digest, and are promoted by
  deployment automation or an operator. Running containers never self-update.
- Keep database and markdown backups separate from application artifacts.

Do not tag a release if required tests or agent update actions are unknown.
