# Bundled App + Local Postgres Template

This template runs BigBrain as a disposable app container backed by a local
Postgres database with `pgvector`. Markdown remains mounted from the brain repo;
Postgres stores runtime/index state such as embeddings, health findings, and
OAuth records.

## Files

- `Dockerfile`: production BigBrain app image.
- `docker-compose.yml`: app plus `pgvector/pgvector:pg16` with a persistent
  database volume.
- `bigbrain.config.json`: Postgres-backed config mounted into the app.
- `.env.example`: copy to `.env` and edit local values.
- `scripts/db-doctor.sh`: verifies the configured database and `pgvector`.
- `scripts/health-check.sh`: runs `bigbrain health --json` and checks `/health`.
- `scripts/sync.sh`: runs `bigbrain sync --json` against the mounted brain.

## Run

Released deployments use the published image selected by `BIGBRAIN_IMAGE`.
Pin an immutable digest in production, for example:

```sh
BIGBRAIN_IMAGE=ghcr.io/life-efficient/bigbrain@sha256:... docker compose --env-file .env pull app
BIGBRAIN_IMAGE=ghcr.io/life-efficient/bigbrain@sha256:... docker compose --env-file .env up -d app
```

The local `build:` definition remains available for development with
`docker compose --env-file .env up --build`.

From this directory:

```sh
cp .env.example .env
mkdir -p brain/tasks
docker compose --env-file .env up --build -d postgres
./scripts/db-doctor.sh
docker compose --env-file .env up --build -d app
./scripts/health-check.sh
./scripts/sync.sh
```

If your Docker install uses the older `docker-compose` command, use that in the
manual `up` commands. The helper scripts detect either command.

For a real brain, set `BIGBRAIN_MARKDOWN_REPO=/absolute/path/to/brain` in
`.env`. Task records should live as individual markdown pages under `tasks/`
with `type: task`, `status`, `readiness`, `execution_mode`, `priority`,
active-member `assignees`, `source`, and optional `due` frontmatter. The
template config expects the brain root to
be `/brain` inside the container.

The MCP service listens on `BIGBRAIN_SERVICE_PORT` and exposes:

- `/health` for container and service health checks.
- `/connect` for OAuth-backed MCP setup when auth is configured.

## Required Secrets

Set `OPENAI_API_KEY` before running `sync` if you want embeddings to be created.
Set the OAuth environment variables from `.env.example` before exposing the app
to other users.

## Database Verification

`scripts/db-doctor.sh` runs:

```sh
bigbrain --config /config/bigbrain.config.json db doctor
```

It should report `Database ok (postgres)`. A warning about `pgvector` means the
target database does not have the `vector` extension enabled or the configured
user cannot create it.
