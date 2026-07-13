# Bounded MCP audit logging

MCP audit records are a separate security and accountability stream, not general
application logs. They answer who invoked which meaningful MCP operation, when,
and against which bounded resource identifiers. They must
not preserve page bodies, raw file contents, prompts, search queries, credentials,
authorization headers, cookies, or full request payloads.

## Events

Record these meaningful tool boundaries without adding interpretive categories:

| Tool boundary | Examples |
| --- | --- |
| Content changes | task/page/raw-file creation, updates, renames, and deletion |
| Visibility or policy changes | visibility publishing and future member/policy administration |
| Maintenance | sync and Git backup |
| Security failures | authentication failure and tool-scope denial |

Successful read, list, search, and query calls are excluded. A failed read may be
recorded only when it is a security denial; ordinary not-found and validation
errors should remain application diagnostics unless they affect a meaningful
write.

## Event contract

The current compatibility record uses `actor_email`, `action`, `created_at`, and
`details_json`. The bounded details contract is:

```json
{
  "arguments": { "path": "people/example", "body": { "redacted": true, "length": 123 } },
  "error": "present only when the invocation failed"
}
```

The structured schema adds opaque `event_id` and server-generated `request_id`,
actor type and bounded actor ID, resource type and identifier, outcome and error
code, auth mode, and service/brain identity. SQLite and Postgres initialization
upgrade compatibility tables additively, and SQLite-to-Postgres migration
preserves the structured fields when present. Do not store access tokens, client
secrets, IP addresses, user agents, or payload hashes by default. Add those only
after an explicit privacy and abuse investigation requirement.

## Redaction

- Preserve only known operational identifiers such as paths, slugs, status,
  visibility, priority, readiness, execution mode, and assignee.
- Replace content strings with `{ "redacted": true, "length": n }`.
- Replace values under secret-like keys regardless of nesting.
- Represent frontmatter by sorted key names, not values.
- Bound retained strings to 240 characters and arrays to 20 items.
- Treat new argument fields as content by default until explicitly allowlisted.

## Retention and access

Retention defaults to 90 days for Postgres-hosted brains and 30 days for local
SQLite brains. It is configurable with `mcp_audit_retention_days` or
`BIGBRAIN_MCP_AUDIT_RETENTION_DAYS`; audited operations delete strictly older
records in bounded batches. The cursor-paginated `audit/list` and `audit/export`
MCP tools require `brain:admin` and themselves produce an administrative audit
event. Exports are bounded NDJSON pages of already-sanitized records. Database
operators remain able to access the table through normal backup
and incident procedures. Audit records should not be copied into brain markdown,
search indexes, analytics, or ordinary application logs.

## Incremental delivery

1. Select meaningful tool boundaries, omit successful reads, recursively redact
   arguments, and capture authentication and scope denials.
2. Add request/event correlation and structured actor/resource/outcome fields,
   with SQLite and Postgres migration coverage.
3. Add configurable retention cleanup plus admin-only paginated access/export.
4. Add operational metrics based on tool/action counts, never payload content.

Increments 1-3 are implemented. Operational metrics remain future work.

Verification should cover SQLite and Postgres persistence, every policy layer,
successful calls and failures, authentication and scope denials, nested secret
redaction, absence of read/query payloads, retention boundaries, admin access,
and migration compatibility.
