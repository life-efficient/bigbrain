#!/usr/bin/env node

import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';

const host = process.env.BIGBRAIN_RELAY_HOST || '127.0.0.1';
const port = Number(process.env.BIGBRAIN_RELAY_PORT || 5580);
const queueDir = path.resolve(process.env.BIGBRAIN_RELAY_QUEUE_DIR || path.join(os.homedir(), '.config', 'bigbrain', 'relay-queue'));
const inboundSecret = process.env.BIGBRAIN_RELAY_INBOUND_SECRET || null;
const forwardUrl = process.env.BIGBRAIN_RELAY_FORWARD_URL || null;
const forwardSecret = process.env.BIGBRAIN_RELAY_FORWARD_SECRET || null;
const maxBodyBytes = Number(process.env.BIGBRAIN_RELAY_MAX_BODY_BYTES || 1_000_000);
const pollMs = Number(process.env.BIGBRAIN_RELAY_FORWARD_INTERVAL_MS || 5_000);
let forwardInProgress = null;

await fs.mkdir(queueDir, { recursive: true });

const server = http.createServer((request, response) => handle(request, response).catch((error) => send(response, error.statusCode || 500, { ok: false, error: error.message })));
server.listen(port, host, () => console.log(JSON.stringify({ ok: true, status: 'ready', host, port, queue_dir: queueDir })));
setInterval(() => forwardQueued().catch((error) => console.error(`Relay forwarding failed: ${error.message}`)), pollMs).unref?.();
await forwardQueued();

async function handle(request, response) {
  const url = new URL(request.url || '/', 'http://127.0.0.1');
  if (request.method === 'GET' && url.pathname === '/health') return send(response, 200, { ok: true, status: 'ready', queue_depth: await queueFiles().then((files) => files.length) });
  if (request.method === 'GET' && url.pathname === '/v1/queue') return send(response, 200, { ok: true, events: await queueFiles() });
  if (request.method !== 'POST' || url.pathname !== '/v1/events') return send(response, 404, { ok: false, error: 'Not found' });
  const body = await readBody(request);
  if (inboundSecret && !timingSafe(request.headers['x-bigbrain-signature'], signature(body, inboundSecret))) return send(response, 401, { ok: false, error: 'Invalid event signature.' });
  let event;
  try { event = JSON.parse(body); } catch { return send(response, 400, { ok: false, error: 'Event body must be JSON.' }); }
  const eventId = String(request.headers['x-event-id'] || request.headers['idempotency-key'] || event.event_id || event.id || hash(body));
  const filePath = path.join(queueDir, `${safeFileName(eventId)}.json`);
  const existing = await fs.stat(filePath).catch(() => null);
  if (existing) return send(response, 200, { ok: true, status: 'duplicate', event_id: eventId });
  await atomicWrite(filePath, {
    event_id: eventId,
    listener_id: request.headers['x-bigbrain-listener'] || null,
    subscription_id: request.headers['x-bigbrain-subscription'] || null,
    received_at: new Date().toISOString(),
    attempts: 0,
    event,
  });
  await forwardQueued();
  return send(response, 202, { ok: true, status: 'accepted', event_id: eventId });
}

async function forwardQueued() {
  if (forwardInProgress) return forwardInProgress;
  forwardInProgress = forwardQueuedInternal().finally(() => { forwardInProgress = null; });
  return forwardInProgress;
}

async function forwardQueuedInternal() {
  if (!forwardUrl) return;
  for (const filePath of await queueFilePaths()) {
    const entry = JSON.parse(await fs.readFile(filePath, 'utf8').catch(() => 'null') || 'null');
    if (!entry) continue;
    const body = JSON.stringify(entry.event);
    try {
      const response = await fetch(forwardUrl, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-event-id': entry.event_id,
          'x-bigbrain-listener': entry.listener_id || '',
          'x-bigbrain-subscription': entry.subscription_id || '',
          'x-bigbrain-signature': forwardSecret ? signature(body, forwardSecret) : '',
        },
        body,
      });
      if (response.ok) await fs.rm(filePath, { force: true });
      else await updateAttempt(filePath, entry, `forward HTTP ${response.status}`);
    } catch (error) {
      await updateAttempt(filePath, entry, error.message);
    }
  }
}

async function updateAttempt(filePath, entry, error) {
  await atomicWrite(filePath, { ...entry, attempts: Number(entry.attempts || 0) + 1, last_error: String(error), last_attempt_at: new Date().toISOString() });
}

async function queueFiles() {
  const entries = [];
  for (const filePath of await queueFilePaths()) {
    const entry = JSON.parse(await fs.readFile(filePath, 'utf8').catch(() => 'null') || 'null');
    if (entry) entries.push({ event_id: entry.event_id, received_at: entry.received_at, attempts: entry.attempts || 0, last_error: entry.last_error || null });
  }
  return entries.sort((left, right) => String(left.received_at).localeCompare(String(right.received_at)));
}

async function queueFilePaths() {
  return (await fs.readdir(queueDir)).filter((name) => name.endsWith('.json')).sort().map((name) => path.join(queueDir, name));
}

async function readBody(request) {
  let total = 0;
  const chunks = [];
  for await (const chunk of request) {
    total += chunk.length;
    if (total > maxBodyBytes) { const error = new Error(`Request body is too large: ${total} bytes.`); error.statusCode = 413; throw error; }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString('utf8');
}

async function atomicWrite(filePath, value) {
  const temporary = `${filePath}.tmp-${process.pid}-${crypto.randomUUID()}`;
  await fs.writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
  await fs.rename(temporary, filePath);
}

function signature(body, secret) { return `sha256=${crypto.createHmac('sha256', String(secret)).update(String(body)).digest('hex')}`; }
function timingSafe(actual, expected) { const left = Buffer.from(String(actual || '')); const right = Buffer.from(String(expected || '')); return left.length === right.length && crypto.timingSafeEqual(left, right); }
function hash(value) { return crypto.createHash('sha256').update(String(value)).digest('hex'); }
function safeFileName(value) { return hash(value).slice(0, 48); }
function send(response, status, value) { response.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }); response.end(JSON.stringify(value)); }
