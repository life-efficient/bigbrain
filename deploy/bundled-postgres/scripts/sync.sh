#!/usr/bin/env sh
set -eu

compose() {
  if docker compose version >/dev/null 2>&1; then
    docker compose "$@"
  else
    docker-compose "$@"
  fi
}

compose --env-file .env run --rm app \
  node ./bin/bigbrain.js --config "${BIGBRAIN_CONFIG:-/config/bigbrain.config.json}" sync --json
