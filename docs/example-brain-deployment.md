# Example Brain BigBrain Deployment

Example Brain should run as a bundled brain server:

- Example Brain markdown repo remains canonical content.
- BigBrain MCP/API service runs as the app process.
- Postgres with `pgvector` persists embeddings, OAuth state, sync/index state,
  health findings, and audit/runtime data.
- Supabase is optional later, not required for v1.

## Railway Shape

Use one Railway project with two services:

- app service: the Example Brain BigBrain server
- database service: Railway Postgres with persistent storage

App environment:

```text
BIGBRAIN_HOME=/app/Example Brain/cortex
BIGBRAIN_MCP_AUTH_MODE=oauth_allowlist
BIGBRAIN_MCP_PUBLIC_URL=https://your-service.example.com
BIGBRAIN_MCP_SERVICE_NAME=Example Brain Cortex
BIGBRAIN_MCP_ALLOWED_EMAILS=alice@example.com,bob@example.com
BIGBRAIN_MCP_GOOGLE_CLIENT_ID=...
BIGBRAIN_MCP_GOOGLE_CLIENT_SECRET=...
OPENAI_API_KEY=...
DATABASE_URL=postgres://...
```

The BigBrain config for the hosted Example Brain brain should include:

```json
{
  "storage_backend": "postgres",
  "database_url_env": "DATABASE_URL"
}
```

Do not rely on app-container files for embeddings or OAuth tokens. With
`storage_backend: "postgres"`, BigBrain stores OAuth clients, states, codes,
token hashes, sync run history, and MCP audit log entries in Postgres.

## Local Network Shape

Use the checked-in template at
[`deploy/bundled-postgres`](../deploy/bundled-postgres) for a runnable Docker
Compose setup with Postgres, app health checks, `db doctor`, `health`, and
`sync` scripts. The shape is:

```yaml
services:
  app:
    build: .
    environment:
      BIGBRAIN_HOME: /brain/cortex
      BIGBRAIN_MCP_AUTH_MODE: oauth_allowlist
      BIGBRAIN_MCP_PUBLIC_URL: http://example-brain.local:3333
      DATABASE_URL: postgres://bigbrain:bigbrain@postgres:5432/bigbrain
    volumes:
      - ./Example Brain:/brain
    depends_on:
      - postgres
    ports:
      - "3333:3333"

  postgres:
    image: pgvector/pgvector:pg16
    environment:
      POSTGRES_DB: bigbrain
      POSTGRES_USER: bigbrain
      POSTGRES_PASSWORD: bigbrain
    volumes:
      - postgres-data:/var/lib/postgresql/data

volumes:
  postgres-data:
```

The exact app image can vary by deployment repo. The important invariant is
that the app is disposable and Postgres has a persistent volume.

## Startup Flow

1. Clone or mount the Example Brain markdown repo.
2. Ensure the BigBrain config points at the Example Brain `cortex` directory and uses
   `storage_backend: "postgres"`.
3. Start Postgres.
4. Start BigBrain MCP or the dashboard:

```sh
bigbrain --config /path/to/config.json mcp --host 0.0.0.0 --port "$PORT"
```

```sh
bigbrain --config /path/to/config.json dashboard --host 0.0.0.0 --port "$PORT"
```

Use one process per public service unless the deployment wrapper fronts both on
separate ports.

5. Run `bigbrain db doctor` and `bigbrain sync --json`.
6. Send teammates to `/connect` for OAuth-backed MCP connection, or to `/` for
   the OAuth-backed dashboard.

## Migration Later

If Example Brain later needs managed Supabase, dump the bundled Postgres database and
restore it into Supabase Postgres as described in
[`postgres-migration.md`](./postgres-migration.md). Then change only the
`DATABASE_URL` value and verify with `db doctor` plus `sync --json`.
