# Shared Substack ledger

Use one operational SQLite ledger across RSS, Gmail, interactive ingestion, and daily reconciliation. Generic RSS uses `rss/ledger` (`rss_ledger` alias) against this same store; Substack keeps the adapter protocol below. RSS configuration owns each registered feed's view of verified low/high watermarks, derived from these shared article records rather than a second completion store. It is metadata only. Canonical sources and pages still belong in the owning Brain and are written and read back through that Brain's MCP.

## MCP tools and storage

Prefer the owning Brain's `substack/ledger` tool (`substack_ledger` alias). Pass the operation and its JSON input directly, with no scratch file:

```json
{"operation":"status","input":{"outstandingOnly":true}}
```

Call `substack/workflow` (`substack_workflow` alias) with `{}` to read the fixed workflow bundle and required references through MCP. Its `documents` array contains each document's `name` and `content`. This supports RSS tasks that have MCP and browser tools but no shell or filesystem tool. Use targeted tool discovery for slash/underscore aliases when necessary.

The ledger tool owns the server's shared store and rejects caller-specified database paths. Completion verification must identify the active owning Brain. Do not create a per-automation ledger. A missing tool or inaccessible store is an incomplete setup, not permission to invent a memory-only cursor. Stop before article retrieval or writes if targeted discovery cannot expose the required tools and no direct supported fallback exists.

Never use TextEdit, Finder, Terminal UI, another desktop editor, or browser `file://` navigation to read workflow files, configuration, scratch files, or the database. A computer-use tool does not grant file-reading or command execution capability. Do not open local files just to discover a missing tool.

## Optional command fallback

Only when an actual shell execution tool is callable, the installed `bigbrain-substack-ledger` command can use the same shared store. For Harry's local deployment, its explicit fallback is:

```text
node /Users/hq/projects/bigbrain/bin/bigbrain-substack-ledger.js <command> --input-file <JSON file>
```

The default store is `~/.config/bigbrain/substack-ledger.sqlite`. Do not choose a per-automation database or pass `--db` in a production run. `--db` is for isolated tests. `status` is read-only and safe before a database exists. Follow `nextOffset` with `{ "offset": <nextOffset> }` plus the original filters until all relevant records are read; the default page contains at most 500 posts.

Write exact JSON using a structured file writer or safe quoting, then pass its path. Never interpolate URLs, prose, tokens, or evidence into shell code. Scratch files contain metadata only and should not enter Brain collections. Do not expose lease tokens or provider IDs to the user.

## Operations

For MCP, the table's Command is `operation`, and JSON input is `input`. The CLI uses the same operation names and fields.

| Command | JSON input | Meaning |
| --- | --- | --- |
| `status` | `{ "publicationUrl": "https://publisher.example/" }`, `{ "url": "https://publisher.example/p/post" }`, `{ "outstandingOnly": true }`, or `{}` | Read publication records, per-post outcomes, verification, watermarks, and discovery checkpoints. |
| `publication-upsert` | `{ "publicationUrl": "https://publisher.example/", "feedUrl": "https://publisher.example/feed", "title": "Publisher", "aliases": [], "rssRegistrationId": "verified-listener-id" }` | Bind a publication and observed aliases; only record registration after registry read-back. |
| `discover` | `{ "publicationUrl": "https://publisher.example/", "url": "https://publisher.example/p/post", "publishedAt": "2026-09-14T08:00:00Z", "title": "Post title", "channel": "rss" }` | Record observed identity and transport without declaring completion. Use the actual discovery channel. |
| `claim` | `{ "url": "https://publisher.example/p/post", "owner": "unique-run-worker", "leaseSeconds": 3600 }` | Atomically lease one unresolved post. Respect terminal/already-claimed responses. |
| `renew` | `{ "url": "https://publisher.example/p/post", "leaseToken": "returned-token", "leaseSeconds": 3600 }` | Extend your own unexpired lease before long retrieval or verification; never claim after expiry without rechecking shared state. |
| `complete` | `{ "url": "https://publisher.example/p/post", "leaseToken": "returned-token", "outcome": "needs_review", "reason": "Full article remains unavailable in authorized session" }` | Save the outcome for this live claim. Retained outcomes also require verification below. |
| `release` | `{ "url": "https://publisher.example/p/post", "leaseToken": "returned-token", "reason": "Transient retrieval failure" }` | Release recoverable work without declaring it complete. |
| `retry` | `{ "url": "https://publisher.example/p/post", "reason": "New full-text access is available" }` | Reopen when there is evidence to revisit an outcome. Do not reset every ignored post daily. |
| `scan-checkpoint` | `{ "publicationUrl": "https://publisher.example/", "channel": "browser", "through": "2026-09-14T08:00:00Z", "oldestSeenAt": "2026-09-07T08:00:00Z", "newestSeenAt": "2026-09-14T08:00:00Z" }` | Record only the range actually inspected. This is discovery coverage, never ingestion proof. |

`claim` returns `claimed: true` plus `leaseToken` only when this worker acquired the lease. A false result requires inspecting `post.outcome` and `post.verification`; a live competing claim stays deferred. Status records use `filed_high_watermark` and `filed_low_watermark` on publications, and `publication_url`, `published_at`, `lease_owner`, `lease_expires_at`, and `verification` on posts. Use the tool's returned schema and structured fields; when the actual CLI is available its `--help` also documents the protocol. A successful tool response or zero exit code alone does not prove a claim was granted. Keep all workers on the same deployed version and database.

## Verified retained completion

`source_only`, `source_and_update`, and a migrated `verified_noop` require a live claim plus:

```json
{
  "url": "https://publisher.example/p/post",
  "leaseToken": "returned-token",
  "outcome": "source_and_update",
  "reason": "Matches the named source-guidance clause",
  "verification": {
    "readBack": true,
    "verifiedAt": "2026-09-14T09:00:00Z",
    "brainId": "live-owning-brain-id",
    "paths": ["collection/post.md", "collection/.raw/post.html", "organizations/subject.md"],
    "evidence": "Same-Brain MCP read-back verified full source, sidecar, canonical entity coverage, links, and provenance."
  }
}
```

Use real paths and evidence from this run. A historic prose log is not verification. When migrating an exact existing post, directly verify its source/artifact and entity coverage first, claim it, then record `verified_noop` with that evidence. Do not re-fetch an already terminal shared record simply to establish the same outcome again. If its stored verification is incomplete or invalid, reopen with a reason and verify the missing state.

`ignored` requires the actual relevance rationale and a verification envelope with `readBack: true`, `verifiedAt`, `brainId`, `paths: []`, and nonempty `evidence` describing the canonical identity and relevance review. Here `readBack` attests that review, not a content mutation. It creates no content and does not move retained watermarks. `needs_review` leaves an explicit hole and no watermark change. The low watermark is the earliest retained verified post and the high watermark is the latest. They expand over verified retained posts; they do not claim contiguous coverage. Always combine them with per-post records and unresolved holes.

## Recovery and cross-channel ordering

1. Record discovery and read the shared post record.
2. Reuse a terminal outcome adequately verified for the same owning Brain without an article fetch. Return a verified no-op to the delivery caller while preserving the stored outcome.
3. If unresolved, claim. A live competing lease is deferred, never a terminal result. Another worker's token is not reusable.
4. On failure, record `needs_review` or release with the concrete reason; do not delete the record.
5. Complete only after required same-Brain reads, then read shared status back.
6. Allow the Gmail caller to advance only after the delegated terminal result. RSS discovery/queue success remains distinct from post completion.

The daily scan retries holes across the high watermark and carries bounded traversal forward. A finite RSS result or an inbox page cannot establish full historical completeness. Store navigation hints separately if the current checkpoint schema lacks opaque pagination fields; those hints never authorize skipping unresolved posts.
