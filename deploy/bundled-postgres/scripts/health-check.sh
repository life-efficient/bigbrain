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
  node ./bin/bigbrain.js --config "${BIGBRAIN_CONFIG:-/config/bigbrain.config.json}" health --json

compose --env-file .env exec app \
  node -e "fetch('http://127.0.0.1:' + (process.env.PORT || 55560) + '/health').then(async r => { console.log(await r.text()); process.exit(r.ok ? 0 : 1); }).catch(error => { console.error(error.message); process.exit(1); })"
