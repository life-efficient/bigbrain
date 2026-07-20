---
name: "BigBrain: Setup"
version: 1.0.0
description: |
  Set up a BigBrain brain home, verify the runtime works, and optionally migrate
  or import an existing markdown corpus. Connect an existing BigBrain to Codex
  with OAuth by default or an explicit single-operator token fallback. Use when
  the user wants to initialize BigBrain, point it at a brain home, configure
  GitHub backup, connect to an existing BigBrain, or prove search and health
  work end to end.
triggers:
  - "set up BigBrain"
  - "initialize BigBrain"
  - "configure BigBrain"
  - "create a brain home"
  - "migrate into BigBrain"
  - "connect to an existing BigBrain"
tools:
  - shell
mutating: true
---

# BigBrain: Setup

Use this skill to bring a BigBrain brain home online cleanly. It should leave
the user with a working runtime, a verified index path, and a clear next step.

## Contract

This skill guarantees:
- Initialize or target the intended brain home explicitly
- Verify configuration, state, and SQLite runtime paths actually work
- Present exactly two primary setup paths: **Run BigBrain on this device** and
  **Connect to an existing BigBrain**
- Install and start the always-on loopback MCP service for on-device macOS
  setups
- Ask whether the user wants GitHub backup and strongly recommend it for brains
  running on the device
- Configure GitHub backup through GitHub MCP when the user accepts
- Prove search and health work against real content
- Keep migration additive rather than destructive
- Stop with a clear blocker if the environment cannot complete setup safely
- Connect existing BigBrain services through BigBrain's client bootstrap
  instead of project-specific secret loaders

## Workflow

1. Ask the user to choose exactly one primary setup path:
   - **Run BigBrain on this device**
   - **Connect to an existing BigBrain**
   - do not present hosted, self-hosted, on-premises, or Docker as additional
     product modes
   - if the user wants to deploy a service, route them to the advanced
     deployment flow; Docker is the canonical server package, while
     hosted-by-us, self-hosted, and on-premises are deployment variants
   - treat private or shared access as a separate choice from deployment and
     client connection
   - for **Connect to an existing BigBrain**, skip the on-device installation
     steps and continue at step 12
2. For **Run BigBrain on this device**, ask whether the user wants to back up
   the brain to GitHub:
   - default to yes
   - include this exact warning in the question: `STRONGLY RECOMMENDED: everything in your brain could be lost if you delete the folder or lose access to your device`
   - if the user declines, mention the risk once in the final summary
3. Resolve the target brain home:
   - use `--brain-home` when the target is explicit
   - otherwise explain the default-pointer behavior before relying on it
4. Initialize a new brain home when needed:
   - `bigbrain init /path/to/brain-home`
5. If GitHub backup was accepted:
   - verify or add GitHub MCP in Codex using `~/.codex/config.toml`
   - use the official remote GitHub MCP endpoint `https://api.githubcopilot.com/mcp/`
   - run `codex mcp list`
   - if required, run `codex mcp login github`
   - if the user has no GitHub account, stop and ask them to create one at `https://github.com/signup`
   - verify the GitHub MCP tools are callable in a fresh session with a harmless read
   - create a private GitHub repository through GitHub MCP, or use the repository the user names
   - initialize git in the brain home if needed, add the GitHub remote, commit, and push the current brain contents
6. Verify the runtime immediately:
   - `bigbrain health --json`
   - `bigbrain recent --json`
7. If the user has an existing markdown brain to bring over:
   - run `bigbrain migrate /path/to/existing/brain --brain-home /path/to/brain-home` when migration is the right path
   - keep the source corpus untouched
8. Rebuild the index:
   - `bigbrain sync --json`
9. For **Run BigBrain on this device** on macOS, install and start the
   always-on loopback MCP service:
   - `node /path/to/bigbrain/scripts/install-local-mcp-service.mjs --repo-root /path/to/bigbrain --brain-home /path/to/brain-home`
   - verify `http://127.0.0.1:3333/health`
   - verify an MCP `initialize` plus `tools/list` smoke test
10. Prove retrieval works on real content:
   - `bigbrain search "<known term>" --json`
   - `bigbrain get <known-slug>` when a canonical page is expected
11. Explain the next operational step:
   - use `Understand BigBrain` for filing guidance
   - use `BigBrain: Ingest` for new material
   - use `BigBrain: Maintain` for cleanup
12. For **Connect to an existing BigBrain** with Codex:
   - run `bigbrain connect codex <service-url> --name <connection-name>`
   - keep OAuth as the default for services that require authentication
   - use `--auth token --token-stdin` only for an explicitly trusted
     single-operator deployment
   - never pass a token as a command-line argument or print it
   - verify the reported Codex registration and follow the exact restart or
     login instruction before claiming the connection is available

## Guardrails

- Do not guess the brain home when the user named one explicitly
- Do not mutate or delete the source corpus during migration
- Do not claim setup succeeded until `health` and `sync` both work
- Do not claim GitHub backup is complete until the brain has a GitHub remote
  and an initial push has succeeded
- Prefer a small proof query over a vague “it looks fine”
- Surface state-root or permissions blockers directly instead of hand-waving them away
- Do not bind the on-device unauthenticated MCP service to anything except
  `127.0.0.1`
- Do not generalize a workbench-specific token file, environment variable, or
  launch agent; service connections must be isolated per Codex registration

## Output

Report:
- target brain home
- whether initialization was needed
- whether migration was run
- GitHub backup status, including repository URL or the explicit no-backup risk
- health result
- sync result
- on-device MCP service status and endpoint
- one proof that retrieval worked
