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

`package.json` remains the canonical source version for the monorepo during the
release split. Runtime metadata exposes the connected MCP runtime version and
contract separately from the desktop client version. Skill frontmatter
versions and automation `version = 1` values describe their own schema or
workflow format; they are not independent BigBrain product versions.

Release verification must prove that the package lock and source tag match the
declared source version, and that each desktop or MCP artifact reports its own
declared version in runtime metadata, dashboard health, and bundled template
manifest checks.

Desktop and MCP runtime artifacts are separate release targets. They may be
published from the same source tag while the independent version and
compatibility contract is being rolled out, but the desktop must never assume
that its own release version is the MCP version. The desktop uses the MCP
runtime metadata and compatibility range returned by the connected instance.

The desktop release publishes:

- when Apple credentials are configured, a signed and notarized universal
  macOS DMG and ZIP plus Electron update metadata (`latest-mac.yml` and
  blockmaps)
- otherwise, explicitly named `-unsigned` DMG and ZIP manual downloads with a
  Gatekeeper warning and no automatic-update metadata

The MCP runtime release publishes a multi-architecture server image at
`ghcr.io/life-efficient/bigbrain:<version>` plus its immutable digest. Local
MCP bundles use the same runtime contract and can be restarted independently of
the desktop client.

The MCP runtime package includes the release manifest plus the bundled skill
and automation templates from its release. The desktop package includes the
client assets and the compatibility contract it supports. Active Codex copies
remain machine-local and are compared by health checks instead of being
overwritten silently.

Build the standalone local or server MCP runtime bundle with:

```bash
npm run mcp:bundle
```

This writes `dist/mcp/bigbrain-mcp-<version>.tar.gz` and its SHA-256 checksum.
The `release-mcp.yml` workflow publishes that bundle and the server image
independently of the macOS desktop workflow. Both workflows currently use the
same source release tag while component versioning is being rolled out.

The macOS release job requires the protected `MACOS_CERTIFICATE_P12`,
`MACOS_CERTIFICATE_PASSWORD`, `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, and
`APPLE_TEAM_ID` repository secrets. Unsigned artifacts may be offered only as
clearly labelled manual downloads; never publish them to the stable desktop
update feed.

## Changelog Contract

Each release entry must include `Agent update actions`. That section is the
handoff for friends' agents and should say exactly what to do after pulling.

Mention actions when a release includes:

- schema or filing-rules changes
- machine-catalog or desktop registry migrations
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

The canonical connected-brain catalog is `~/.config/bigbrain/brains.json`.
Desktop and CLI code must use that file. A legacy desktop
`~/Library/Application Support/BigBrain/registry.json` may be imported once
and retained as `registry.json.legacy` for recovery, but it is not an active
source of brain identity or connection data.

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
8. For a signed release, confirm the GitHub Release contains `latest-mac.yml`,
   ZIP/DMG blockmaps, and signed desktop packages. For an unsigned release,
   confirm the assets are named `-unsigned`, include `UNSIGNED-MACOS.txt`, and
   contain no `latest-mac.yml` or blockmaps.
9. Confirm the matching GHCR image exists for both `linux/amd64` and
   `linux/arm64`, then record the production digest before promotion.
10. Confirm a manually dispatched workflow did not publish mutable server image
    tags without a matching release tag.

## Update Policy

- Signed desktop releases are eligible for automatic updates and keep a manual
  **Check for Updates** action. Unsigned releases are manual downloads only and
  must never include automatic-update metadata.
- The desktop checks shortly after launch and then about once every 24 hours.
  Downloaded releases activate only through the coordinated restart path. The
  app verifies its target release and every desktop-owned local MCP before it
  reports the update complete.
- A desktop may repair an older or unavailable `desktop-bundle` service from its
  own bundle. It never downgrades a newer service and never mutates a
  source-checkout, server-managed, remote, or unknown-owner service.
- Headless source installs use `bigbrain update --apply` through the scheduled
  updater. Dirty, detached, diverged, and major-version updates stop safely.
- Server deployments pull a tagged image, pin its digest, and are promoted by
  deployment automation or an operator. Running containers never self-update.
- Keep database and markdown backups separate from application artifacts.

## Manual Skill Migration

The packaged client updater is the default path for desktop installations. The
`bigbrain-check-update` skill is temporarily retained only as a source-install
compatibility fallback because it still applies release-specific filing-rule,
skill, and automation actions that are not yet fully deterministic in the CLI.

Migration happens in three release steps:

1. Keep the compatibility skill, pause the daily Codex update automation, and
   route packaged installs to the client updater.
2. Move safe template reconciliation and versioned changelog migrations into
   deterministic CLI code. Preserve customized active copies and user filing
   rules.
3. Remove the automation and resolver entry in a later release, then remove the
   skill when supported source upgrades no longer depend on agent judgment.

`bigbrain update --apply` and the headless updater remain the supported
source-install fallback. Server and container releases remain operator-managed.

Do not tag a release if required tests or agent update actions are unknown.
