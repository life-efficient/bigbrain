# Deployment And Updates

BigBrain uses one semantic-versioned release train with separate delivery
mechanisms for desktop, device-managed MCP, and server-managed MCP.

## Ownership

- The desktop owns its application bundle and local MCP services that it
  installed. It does not own connected remote services.
- A headless device-managed MCP is updated by a separate scheduled supervisor,
  never by overwriting the running process in place.
- Server-managed MCP deployments are promoted by the operator or deployment
  platform using immutable container digests. Containers do not self-update.

## Channels And Approval

- Stable is the default channel; beta is opt-in.
- Compatible patch releases may download automatically and activate during an
  idle maintenance window.
- Minor releases may activate automatically only when their manifest declares
  backward compatibility and rollback safety.
- Major releases or destructive migrations require explicit operator approval.

## Activation And Rollback

- Verify checksums and signatures before activation.
- Do not interrupt active sync, writes, migrations, or backups.
- Back up SQLite or snapshot Postgres before a storage migration.
- Activate a staged runtime, restart gracefully, then require readiness and an
  MCP initialize/tools-list smoke test.
- Roll code back automatically when post-update verification fails. Database
  rollback requires a verified snapshot when a migration is not backward
  compatible.
