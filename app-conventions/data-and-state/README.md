# Data And State

Document state ownership, persistence, imports, derived values, supported admin
configuration, and app data assumptions.

## Initial State And Loading

- Separate shell-ready state from data-ready state.
- Keep route chrome renderable before the first successful data fetch.
- Use static seed/baseline content for public surfaces when the content is
  mostly fixed and live data is only hydrating details.
- Use explicit empty states only after the relevant request resolves; before
  that, use skeletons in the affected data region.
- Treat static labels and loaded values independently. A pending count or metric
  should not force its surrounding header, label, action area, or explanatory
  copy into a skeleton state.

## Operational Analytics

- Load analytics only when the user opens the secondary Analytics view.
- Show aggregate MCP audit counts and bounded event metadata; never expose page
  bodies, prompts, search queries, headers, credentials, or audit detail payloads.
- State the active retention period in the view so totals are not mistaken for
  lifetime usage.

## Brain Routing Profiles

- Treat root `BRAIN.md` as version-controlled configuration, not an indexed
  knowledge page. Exclude it even when a legacy brain has custom include or
  exclude globs.
- Missing, invalid, draft, or unapproved profiles fail closed to review and can
  never authorize automatic ingestion.
- Keep authored routing policy separate from computed capabilities such as
  current authentication, writability, health, and available operations.
- Send `Cache-Control: no-store` with authenticated profile API responses.

## Application Updates

- Treat application binaries, local service runtimes, and brain data as
  separate state. Updating BigBrain must not rewrite markdown brain content.
- Persist the selected update channel and last successful check outside the
  brain home. Never store release credentials or update tokens in a brain.
- Version runtime and storage contracts independently. Refuse readiness when a
  database is newer than the running binary supports.
- Stage updates before activation and retain the previous working runtime until
  the new runtime passes readiness and MCP handshake checks.
- Persist an expected desktop target release before restart and clear it only
  after the relaunched app and every desktop-owned local service are verified.
- Store explicit service ownership in the desktop registry and service runtime
  metadata. Labels, ports, and loopback addresses do not establish ownership.
- Never replace a newer local service with an older app bundle. Source-managed,
  remote, server-managed, and unknown-owner services are read-only to the
  desktop updater.

## Inbound Codex Task Ownership

- The desktop app owns the lifecycle of user-visible tasks created from RSS and
  webhook events. The event-ingester owns event receipt and prompt preparation,
  then hands off to the desktop task creator.
- The selected implementation is a desktop-native foreground task handoff. It
  is not currently equivalent to spawning an independent app-server stdio
  client: that client can create a durable task, but it retains active-turn
  ownership and can produce the "open in another app" lock.
- An enqueue-only handoff is acceptable only once the desktop side durably
  consumes the queued prompt and proves task creation. A task is not complete
  merely because a queue entry was written.
- A shared app-server daemon or explicit ownership transfer remains an
  alternative, but requires a supported protocol for releasing active-turn
  ownership and must not be inferred from `ephemeral: false` or
  `threadSource: user`.
- The event ledger is intentionally not part of this ownership fix. Revisit it
  later only if durable retries, duplicate prevention, crash recovery, audit
  history, or provider delivery reconciliation becomes necessary.
