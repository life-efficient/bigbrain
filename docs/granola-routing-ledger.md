# Granola routing ledger helper

Scheduled Granola routing uses the repo-owned `bigbrain-granola-ledger` helper.
It is a narrow JSON interface over the machine-global routing-ledger library.
The removed `bigbrain granola cursor` and low-level `bigbrain granola routes`
write commands are not part of this workflow.

Run a writable schema and integrity preflight before discovery:

```bash
bigbrain-granola-ledger preflight --source granola
```

Check duplicate state by stable source item ID, then record one routing decision
only when no route exists:

```bash
bigbrain-granola-ledger inspect --source granola --item ID
bigbrain-granola-ledger record --source granola --item ID \
  --decision auto --brain BRAIN_ID --policy-revision REVISION \
  --confidence deterministic
```

Atomically claim one approved route before any destination write. A response
with `claimed: false` permits no worker and no write:

```bash
bigbrain-granola-ledger claim --source granola --item ID \
  --duration-ms 1800000
```

Keep the returned lease token private. Renew it while work continues. After all
destination writes and same-Brain read-back succeed, verify the route with a
non-sensitive reference. Mark a terminal failure instead when required:

```bash
bigbrain-granola-ledger renew --source granola --item ID \
  --lease-token TOKEN --duration-ms 1800000
bigbrain-granola-ledger verify --source granola --item ID \
  --lease-token TOKEN --verification-ref REF
bigbrain-granola-ledger fail --source granola --item ID \
  --lease-token TOKEN --error-code CODE
```

An explicit user-requested retry can reset a failed route for another isolated
attempt. It preserves the route history, does not create a second route, and
does not verify or advance the source cursor. Claim the route again before any
destination write:

```bash
bigbrain-granola-ledger retry --source granola --item ID [--actor ACTOR_ID]
bigbrain-granola-ledger claim --source granola --item ID \
  --duration-ms 1800000
```

Advance the monotonic source cursor only after the corresponding route is
verified and destination provenance has been read back:

```bash
bigbrain-granola-ledger advance --source granola --item ID \
  --meeting-timestamp ISO
```

The ledger stores opaque routing metadata only. Never pass credentials,
meeting titles, participant details, summaries, transcripts, prompts, or other
private content to this helper. Do not include lease tokens or stable source IDs
in user-facing reports.
