---
name: "BigBrain: Setup"
version: 1.0.0
description: |
  Set up a BigBrain brain home, verify the runtime works, and optionally migrate
  or import an existing markdown corpus. Use when the user wants to initialize
  BigBrain, point it at a brain home, or prove search and health work end to end.
triggers:
  - "set up BigBrain"
  - "initialize BigBrain"
  - "configure BigBrain"
  - "create a brain home"
  - "migrate into BigBrain"
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
- Install and start the local always-on MCP service for local macOS setups
- Prove search and health work against real content
- Keep migration additive rather than destructive
- Stop with a clear blocker if the environment cannot complete setup safely

## Workflow

1. Resolve the target brain home:
   - use `--brain-home` when the target is explicit
   - otherwise explain the default-pointer behavior before relying on it
2. Initialize a new brain home when needed:
   - `bigbrain init /path/to/brain-home`
3. Verify the runtime immediately:
   - `bigbrain health --json`
   - `bigbrain recent --json`
4. If the user has an existing markdown brain to bring over:
   - run `bigbrain migrate /path/to/existing/brain --brain-home /path/to/brain-home` when migration is the right path
   - keep the source corpus untouched
5. Rebuild the index:
   - `bigbrain sync --json`
6. For local macOS setup, install and start the always-on MCP service:
   - `node /path/to/bigbrain/scripts/install-local-mcp-service.mjs --repo-root /path/to/bigbrain --brain-home /path/to/brain-home`
   - verify `http://127.0.0.1:3333/health`
   - verify an MCP `initialize` plus `tools/list` smoke test
7. Prove retrieval works on real content:
   - `bigbrain search "<known term>" --json`
   - `bigbrain get <known-slug>` when a canonical page is expected
8. Explain the next operational step:
   - use `Understand BigBrain` for filing guidance
   - use `BigBrain: Ingest` for new material
   - use `BigBrain: Maintain` for cleanup

## Guardrails

- Do not guess the brain home when the user named one explicitly
- Do not mutate or delete the source corpus during migration
- Do not claim setup succeeded until `health` and `sync` both work
- Prefer a small proof query over a vague “it looks fine”
- Surface state-root or permissions blockers directly instead of hand-waving them away
- Do not bind the local unauthenticated MCP service to anything except
  `127.0.0.1`

## Output

Report:
- target brain home
- whether initialization was needed
- whether migration was run
- health result
- sync result
- local MCP service status and endpoint
- one proof that retrieval worked
