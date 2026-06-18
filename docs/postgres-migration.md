# BigBrain Postgres Migration

BigBrain supports two storage backends:

- `sqlite`: default local backend under `.bigbrain-state/bigbrain.sqlite`
- `postgres`: server backend using standard Postgres plus `pgvector`

The Postgres backend is intentionally provider-neutral. Railway Postgres,
local Docker Postgres, self-hosted Postgres, and Supabase Postgres all use the
same `DATABASE_URL` contract.

## Configure Postgres

Set these fields in the brain config:

```json
{
  "storage_backend": "postgres",
  "database_url_env": "DATABASE_URL"
}
```

Then set:

```sh
DATABASE_URL=postgres://...
```

The database user must be able to create the `vector` extension and create
tables. BigBrain initializes its schema on first connection.

Verify the database:

```sh
bigbrain --config /path/to/config.json db doctor
```

## SQLite To Postgres

For an existing local brain:

1. Keep the config on `storage_backend: "sqlite"`.
2. Add `"database_url_env": "DATABASE_URL"` to the config.
3. Set `DATABASE_URL` to the target Postgres database.
4. Run:

```sh
bigbrain --config /path/to/config.json db migrate sqlite-to-postgres
```

5. Change the config to `"storage_backend": "postgres"`.
6. Verify:

```sh
bigbrain --config /path/to/config.json db doctor
bigbrain --config /path/to/config.json sync --json
```

The migration copies pages, links, sources, embeddings, and health findings.
Markdown remains canonical; the database is runtime/index state.

## Bundled Postgres To Supabase

Supabase migration is standard Postgres migration. BigBrain does not require
Supabase-specific APIs.

1. Stop writes to the BigBrain MCP server.
2. Dump the bundled/server Postgres database:

```sh
pg_dump "$DATABASE_URL" --format=custom --file=bigbrain.dump
```

3. Restore into Supabase Postgres:

```sh
pg_restore --clean --if-exists --no-owner --dbname "$SUPABASE_DATABASE_URL" bigbrain.dump
```

4. Set production `DATABASE_URL` to the Supabase connection string.
5. Run:

```sh
bigbrain --config /path/to/config.json db doctor
bigbrain --config /path/to/config.json sync --json
```

6. Confirm page, link, embedding, and OAuth token counts match expectations.

If the restore target does not already have `pgvector`, enable the `vector`
extension before running `db doctor`.
