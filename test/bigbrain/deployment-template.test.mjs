import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';

const repoRoot = path.resolve(import.meta.dirname, '..', '..');
const templateDir = path.join(repoRoot, 'deploy', 'bundled-postgres');

test('bundled postgres deployment template is runnable and verifies expected checks', async () => {
  const [
    compose,
    dockerfile,
    config,
    envExample,
    dbDoctorScript,
    healthCheckScript,
    syncScript,
  ] = await Promise.all([
    readTemplate('docker-compose.yml'),
    readTemplate('Dockerfile'),
    readTemplate('bigbrain.config.json'),
    readTemplate('.env.example'),
    readTemplate('scripts/db-doctor.sh'),
    readTemplate('scripts/health-check.sh'),
    readTemplate('scripts/sync.sh'),
  ]);

  assert.match(compose, /pgvector\/pgvector:pg16/);
  assert.match(compose, /ghcr\.io\/life-efficient\/bigbrain:latest/);
  assert.match(compose, /postgres-data:\/var\/lib\/postgresql\/data/);
  assert.match(compose, /condition: service_healthy/);
  assert.match(compose, /\/ready/);
  assert.match(dockerfile, /HEALTHCHECK/);
  assert.match(dockerfile, /\/ready/);
  assert.match(dockerfile, /ARG BIGBRAIN_BUILD_COMMIT/);
  assert.match(dockerfile, /bigbrain\.js --config/);
  assert.match(config, /"storage_backend": "postgres"/);
  assert.match(config, /"database_url_env": "DATABASE_URL"/);
  assert.match(envExample, /DATABASE_URL=postgres:\/\/bigbrain:bigbrain@postgres:5432\/bigbrain/);
  assert.match(dbDoctorScript, /db doctor/);
  assert.match(healthCheckScript, /health --json/);
  assert.match(healthCheckScript, /\/health/);
  assert.match(syncScript, /sync --json/);
});

async function readTemplate(relativePath) {
  return fs.readFile(path.join(templateDir, relativePath), 'utf8');
}
