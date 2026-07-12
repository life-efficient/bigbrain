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

The next schema migration should add opaque `event_id` and `request_id`, actor
type and stable actor/member ID, resource type and identifier, error code when
applicable, auth mode, and service/brain identity as columns or consistently indexed
fields. Do not store access tokens, client secrets, IP addresses, user agents,
or payload hashes by default. Add those only after an explicit privacy and abuse
investigation requirement.

## Redaction

- Preserve only known operational identifiers such as paths, slugs, status,
  visibility, priority, readiness, execution mode, and assignee.
- Replace content strings with `{ "redacted": true, "length": n }`.
- Replace values under secret-like keys regardless of nesting.
- Represent frontmatter by sorted key names, not values.
- Bound retained strings to 240 characters and arrays to 20 items.
- Treat new argument fields as content by default until explicitly allowlisted.

## Retention and access

Choose retention before exposing audit reads. Recommended defaults are 90 days
for hosted brains and 30 days for local brains, configurable per deployment,
with periodic deletion in bounded batches. Audit reads and exports should require
`brain:admin`, be paginated, and themselves produce an administrative audit
event. Database operators remain able to access the table through normal backup
and incident procedures. Audit records should not be copied into brain markdown,
search indexes, analytics, or ordinary application logs.

## Incremental delivery

1. Select meaningful tool boundaries, omit successful reads, recursively redact
   arguments, and capture authentication and scope denials.
2. Add request/event correlation and structured actor/resource/outcome fields,
   with SQLite and Postgres migration coverage.
3. Add configurable retention cleanup plus admin-only paginated access/export.
4. Add operational metrics based on tool/action counts, never payload content.

Verification should cover SQLite and Postgres persistence, every policy layer,
successful calls and failures, authentication and scope denials, nested secret
redaction, absence of read/query payloads, retention boundaries, admin access,
and migration compatibility.
