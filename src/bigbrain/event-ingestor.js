import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';

const STATE_VERSION = 1;
const DEFAULT_MAX_BODY_BYTES = 1_000_000;
const DEFAULT_POLL_INTERVAL_MS = 300_000;
const MAX_SEEN_ITEMS = 2_000;
const MAX_RECEIVED_EVENTS = 2_000;

export const DEFAULT_EVENT_INGESTOR_PORT = 55561;

export function parseRssFeed(xml) {
  const channel = firstTag(xml, 'channel');
  if (!channel) throw new Error('RSS document has no channel.');
  const items = allTags(channel, 'item').map((raw) => ({
    raw,
    title: firstTagText(raw, 'title'),
    description: firstTagText(raw, 'description'),
    link: firstTagText(raw, 'link'),
    guid: firstTagText(raw, 'guid'),
    pubDate: firstTagText(raw, 'pubDate'),
    category: firstTagText(raw, 'category'),
  })).filter((item) => item.title && (item.link || item.guid));

  return {
    title: firstTagText(channel, 'title'),
    description: firstTagText(channel, 'description'),
    link: firstTagText(channel, 'link'),
    lastBuildDate: firstTagText(channel, 'lastBuildDate'),
    items,
  };
}

export function normalizeRssItem(item) {
  const title = cleanText(item?.title);
  const link = cleanText(item?.link);
  const guid = cleanText(item?.guid) || link;
  const pubDate = cleanText(item?.pubDate);
  const publishedAt = pubDate && !Number.isNaN(Date.parse(pubDate))
    ? new Date(pubDate).toISOString()
    : null;
  return {
    title,
    description: cleanText(item?.description),
    link,
    guid,
    pubDate,
    publishedAt,
    category: cleanText(item?.category),
    raw: String(item?.raw || '').trim(),
  };
}

export function stableRssItemKey(sourceId, item) {
  const normalized = normalizeRssItem(item);
  return `${sourceId}:${normalized.guid || normalized.link || hash(`${normalized.title}\n${normalized.pubDate}`)}`;
}

export function itemDate(item, now = new Date()) {
  const normalized = normalizeRssItem(item);
  if (normalized.publishedAt) return normalized.publishedAt.slice(0, 10);
  return now.toISOString().slice(0, 10);
}

export function slugify(value, fallback = 'item') {
  const slug = String(value || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 90);
  return slug || fallback;
}

export function rssRawPath(source, item, now = new Date()) {
  const normalized = normalizeRssItem(item);
  const prefix = slugify(source.raw_prefix || source.id, source.id);
  const title = slugify(normalized.title, 'untitled');
  const suffix = hash(normalized.guid || normalized.link || normalized.title).slice(0, 10);
  return `${source.raw_collection}/.raw/${prefix}-${itemDate(normalized, now)}-${title}-${suffix}.xml`;
}

export function sidecarPathForRaw(rawPath) {
  return rawPath.replace(/\.xml$/i, '.md');
}

export function sourceNoteBody({ source, item, rawPath, retrievedAt, canonicalPage }) {
  const normalized = normalizeRssItem(item);
  const sidecarPath = sidecarPathForRaw(rawPath);
  const published = normalized.publishedAt || normalized.pubDate || 'Unknown';
  const summary = normalized.description || 'No description was included in the RSS item.';
  return [
    '# Source Note',
    '',
    `- Publisher: ${source.publisher || 'Unknown'}`,
    `- Title: ${normalized.title}`,
    `- Published: ${published}`,
    `- Retrieved: ${retrievedAt}`,
    `- Source feed: ${source.url}`,
    `- Article: ${normalized.link || normalized.guid}`,
    `- RSS identifier: ${normalized.guid || normalized.link}`,
    `- Category: ${normalized.category || 'Uncategorised'}`,
    `- Summary: ${summary}`,
    `- Canonical context: [${canonicalPage}](../${path.posix.basename(canonicalPage)}.md)`,
    `- Raw feed item: [${rawPath}](./${path.posix.basename(rawPath)})`,
    `- Indexed sidecar: [${sidecarPath}](./${path.posix.basename(sidecarPath)})`,
    '',
    `This is a source-preserving RSS capture. The summary above is attributed to ${source.publisher || 'the publisher'} and is not independently verified.`,
  ].join('\n');
}

export function upsertRssItemInPageBody(body, { source, item, rawPath, retrievedAt, now = new Date() }) {
  const normalized = normalizeRssItem(item);
  const key = stableRssItemKey(source.id, normalized);
  const marker = `<!-- rss-item:${hash(key)} -->`;
  const entry = [
    marker,
    `- [${escapeMarkdown(normalized.title)}](${normalized.link || normalized.guid}) (${itemDate(normalized, now)})${normalized.category ? ` **${escapeMarkdown(normalized.category)}**` : ''}: ${normalized.description || 'No description was included in the RSS item.'} [Source: [OpenAI News RSS](${source.url}), retrieved ${retrievedAt}; raw sidecar: [.raw/${path.posix.basename(sidecarPathForRaw(rawPath))}](.raw/${path.posix.basename(sidecarPathForRaw(rawPath))})]`,
  ].join('\n');
  const current = String(body || '').trimEnd();
  if (current.includes(marker)) return { body: current, changed: false, key };

  const lines = current.split('\n');
  const headingIndex = lines.findIndex((line) => /^## OpenAI News Feed\s*$/.test(line.trim()));
  if (headingIndex === -1) {
    return {
      body: `${current}\n\n## OpenAI News Feed\n\n${entry}`,
      changed: true,
      key,
    };
  }

  let insertionIndex = headingIndex + 1;
  while (insertionIndex < lines.length && lines[insertionIndex].trim() === '') insertionIndex += 1;
  lines.splice(insertionIndex, 0, entry, '');
  return { body: lines.join('\n').trimEnd(), changed: true, key };
}

export function createEmptyEventState() {
  return {
    version: STATE_VERSION,
    sources: {},
    received_events: {},
  };
}

export function normalizeEventState(value) {
  const state = value && typeof value === 'object' ? value : createEmptyEventState();
  return {
    version: STATE_VERSION,
    sources: state.sources && typeof state.sources === 'object' ? state.sources : {},
    received_events: state.received_events && typeof state.received_events === 'object' ? state.received_events : {},
  };
}

export function validateEventEnvelope(event) {
  if (!event || typeof event !== 'object' || Array.isArray(event)) throw new Error('Event must be a JSON object.');
  for (const key of ['id', 'source', 'type']) {
    if (typeof event[key] !== 'string' || !event[key].trim()) throw new Error(`Event requires a non-empty ${key}.`);
  }
  if (event.payload === undefined) throw new Error('Event requires a payload.');
  return {
    id: event.id.trim(),
    source: event.source.trim(),
    type: event.type.trim(),
    occurred_at: typeof event.occurred_at === 'string' ? event.occurred_at : null,
    payload: event.payload,
  };
}

export function hmacSignature(body, secret) {
  return `sha256=${crypto.createHmac('sha256', secret).update(body).digest('hex')}`;
}

export function timingSafeSignatureMatches(actual, expected) {
  const actualBuffer = Buffer.from(String(actual || ''));
  const expectedBuffer = Buffer.from(String(expected || ''));
  return actualBuffer.length === expectedBuffer.length
    && crypto.timingSafeEqual(actualBuffer, expectedBuffer);
}

export class McpHttpClient {
  constructor({ url, fetchImpl = globalThis.fetch }) {
    if (!url) throw new Error('MCP URL is required.');
    if (typeof fetchImpl !== 'function') throw new Error('Fetch is unavailable.');
    this.url = url;
    this.fetchImpl = fetchImpl;
    this.nextId = 1;
    this.initialized = false;
  }

  async request(method, params = {}) {
    const id = this.nextId++;
    const response = await this.fetchImpl(this.url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id, method, params }),
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok) throw new Error(`MCP HTTP ${response.status}: ${JSON.stringify(payload)}`);
    if (payload?.error) throw new Error(`MCP ${payload.error.code || 'error'}: ${payload.error.message || 'Unknown MCP error'}`);
    if (!payload?.result) throw new Error('MCP response did not contain a result.');
    return payload.result;
  }

  async initialize() {
    if (!this.initialized) {
      await this.request('initialize', {
        protocolVersion: '2025-03-26',
        capabilities: {},
        clientInfo: { name: 'bigbrain-event-ingestor', version: '0.1.0' },
      });
      this.initialized = true;
    }
  }

  async callTool(name, args = {}) {
    await this.initialize();
    const result = await this.request('tools/call', { name, arguments: args });
    if (result.isError) throw new Error(`MCP tool ${name} failed.`);
    if (result.structuredContent !== undefined) return result.structuredContent;
    const text = result.content?.find((entry) => entry.type === 'text')?.text;
    if (text === undefined) return result;
    try {
      return JSON.parse(text);
    } catch {
      return text;
    }
  }
}

export class EventIngestor {
  constructor({ config, fetchImpl = globalThis.fetch, now = () => new Date(), logger = console }) {
    this.config = normalizeConfig(config);
    this.fetchImpl = fetchImpl;
    this.now = now;
    this.logger = logger;
    this.state = createEmptyEventState();
    this.statePath = this.config.state_path;
    this.mcp = new McpHttpClient({ url: this.config.brain.mcp_url, fetchImpl });
    this.server = null;
    this.timer = null;
    this.polling = false;
  }

  async load() {
    try {
      this.state = normalizeEventState(JSON.parse(await fs.readFile(this.statePath, 'utf8')));
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
      this.state = createEmptyEventState();
    }
    await fs.mkdir(path.dirname(this.statePath), { recursive: true });
  }

  async save() {
    await fs.mkdir(path.dirname(this.statePath), { recursive: true });
    const temporary = `${this.statePath}.tmp-${process.pid}`;
    await fs.writeFile(temporary, `${JSON.stringify(this.state, null, 2)}\n`, 'utf8');
    await fs.rename(temporary, this.statePath);
  }

  async prepare() {
    await this.load();
    await this.mcp.callTool('filing_rules', {});
  }

  async pollAll() {
    if (this.polling) return { skipped: true, reason: 'poll already running' };
    this.polling = true;
    const report = { sources: [], ingested: 0, duplicates: 0, errors: [] };
    try {
      for (const source of this.config.sources) {
        if (source.type !== 'rss') {
          report.sources.push({ id: source.id, status: 'no_adapter', type: source.type });
          continue;
        }
        try {
          const result = await this.pollRssSource(source);
          report.sources.push(result);
          report.ingested += result.ingested || 0;
          report.duplicates += result.duplicates || 0;
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          report.errors.push({ id: source.id, message });
          report.sources.push({ id: source.id, status: 'error', message });
          this.logger.error?.(`BigBrain event ingestor source ${source.id} failed: ${message}`);
        }
      }
      return report;
    } finally {
      this.polling = false;
    }
  }

  async pollRssSource(source) {
    const sourceState = this.state.sources[source.id] || {};
    const headers = { 'user-agent': this.config.user_agent };
    if (sourceState.etag) headers['if-none-match'] = sourceState.etag;
    if (sourceState.last_modified) headers['if-modified-since'] = sourceState.last_modified;
    const response = await this.fetchImpl(source.url, { headers });
    const polledAt = this.now().toISOString();
    const nextState = {
      ...sourceState,
      last_poll_at: polledAt,
      etag: response.headers?.get?.('etag') || sourceState.etag || null,
      last_modified: response.headers?.get?.('last-modified') || sourceState.last_modified || null,
    };
    if (response.status === 304) {
      nextState.last_success_at = polledAt;
      nextState.last_error = null;
      this.state.sources[source.id] = nextState;
      await this.save();
      return { id: source.id, status: 'not_modified', ingested: 0, duplicates: 0 };
    }
    if (!response.ok) throw new Error(`Feed returned HTTP ${response.status}.`);
    const xml = await response.text();
    const feed = parseRssFeed(xml);
    const items = feed.items
      .map(normalizeRssItem)
      .sort((a, b) => Date.parse(b.publishedAt || '') - Date.parse(a.publishedAt || ''));
    const firstPoll = !sourceState.initialized_at;
    const bootstrap = source.bootstrap || this.config.bootstrap;
    const candidates = firstPoll
      ? (bootstrap === 'all' ? items : bootstrap === 'latest' ? items.slice(0, 1) : [])
      : items;
    let ingested = 0;
    let duplicates = 0;
    const seen = { ...(sourceState.seen || {}) };
    for (const item of candidates) {
      const key = stableRssItemKey(source.id, item);
      if (seen[key]) {
        duplicates += 1;
        continue;
      }
      const result = await this.ingestRssItem(source, item, xml);
      if (result.status === 'already_present') duplicates += 1;
      else ingested += 1;
      nextState.last_item_status = result.status;
      nextState.last_item_key = key;
      if (result.status === 'ingested') nextState.last_ingested_at = this.now().toISOString();
      seen[key] = this.now().toISOString();
      nextState.seen = trimMap(seen, MAX_SEEN_ITEMS);
      this.state.sources[source.id] = nextState;
      await this.save();
    }
    if (firstPoll) {
      for (const item of items) {
        const key = stableRssItemKey(source.id, item);
        if (!seen[key]) seen[key] = this.now().toISOString();
      }
    }
    nextState.seen = trimMap(seen, MAX_SEEN_ITEMS);
    nextState.initialized_at = sourceState.initialized_at || polledAt;
    nextState.last_success_at = polledAt;
    nextState.last_error = null;
    nextState.item_count = items.length;
    this.state.sources[source.id] = nextState;
    await this.save();
    return { id: source.id, status: 'ok', feed_title: feed.title, item_count: items.length, ingested, duplicates };
  }

  async ingestRssItem(source, item, feedXml) {
    const normalized = normalizeRssItem(item);
    const retrievedAt = this.now().toISOString();
    const rawPath = rssRawPath(source, normalized, this.now());
    const sidecarPath = sidecarPathForRaw(rawPath);
    const key = stableRssItemKey(source.id, normalized);
    const existing = await this.mcp.callTool('search', {
      query: `${normalized.guid || normalized.link} ${source.url}`,
      limit: 5,
      mode: 'conservative',
    });
    const searchRows = [existing?.fused, existing?.lexical, existing?.semantic, existing?.results]
      .flatMap((rows) => Array.isArray(rows) ? rows : []);
    if (searchRows.some((row) => JSON.stringify(row).includes(normalized.guid || normalized.link))) {
      return { status: 'already_present', key };
    }

    await this.mcp.callTool('create_raw_file_with_page', {
      raw_path: rawPath,
      page_path: sidecarPath,
      raw_content_text: normalized.raw || feedXml,
      mime_type: 'application/rss+xml',
      title: normalized.title,
      body: sourceNoteBody({ source, item: normalized, rawPath, retrievedAt, canonicalPage: source.target_page }),
      timeline_entry: `Captured from ${source.url} with RSS identifier ${normalized.guid || normalized.link}.`,
      frontmatter: {
        source_kind: 'rss',
        source_type: 'web',
        source_url: normalized.link || normalized.guid,
        feed_url: source.url,
        publisher: source.publisher || null,
        published: normalized.publishedAt || normalized.pubDate || null,
        retrieved: retrievedAt,
        rss_id: normalized.guid || normalized.link,
        canonical_page: source.target_page,
        tags: ['rss', source.id],
      },
    });
    await this.mcp.callTool('read', { path: sidecarPath });
    await this.mcp.callTool('read_raw_file', { path: rawPath });

    const canonical = await this.mcp.callTool('read', { path: source.target_page });
    const updated = upsertRssItemInPageBody(canonical.body, { source, item: normalized, rawPath, retrievedAt, now: this.now() });
    if (!updated.changed) return { status: 'already_present', key };
    await this.mcp.callTool('update_page', {
      path: source.target_page,
      body: updated.body,
      timeline_entry: `Added OpenAI News RSS item: ${normalized.title} (${normalized.link || normalized.guid}).`,
    });
    const readback = await this.mcp.callTool('read', { path: source.target_page });
    if (!String(readback.body || '').includes(updated.key ? normalized.link || normalized.guid : normalized.title)) {
      throw new Error(`Canonical read-back did not contain ${normalized.title}.`);
    }
    return { status: 'ingested', key, rawPath, sidecarPath };
  }

  async handleExternalEvent(event) {
    const envelope = validateEventEnvelope(event);
    const existing = this.state.received_events[envelope.id];
    if (existing) return { status: 'duplicate', id: envelope.id, previous: existing.status };

    const source = this.config.sources.find((candidate) => candidate.id === envelope.source);
    let status = 'accepted_no_adapter';
    let result = null;
    if (source?.type === 'rss' && envelope.type === 'rss.item') {
      result = await this.ingestRssItem(source, envelope.payload, envelope.payload?.raw || '');
      status = result.status;
    }
    this.state.received_events[envelope.id] = {
      source: envelope.source,
      type: envelope.type,
      received_at: this.now().toISOString(),
      status,
      payload_sha256: hash(JSON.stringify(envelope.payload)),
    };
    this.state.received_events = trimMap(this.state.received_events, MAX_RECEIVED_EVENTS);
    await this.save();
    return { status, id: envelope.id, result };
  }

  async start({ once = false } = {}) {
    await this.prepare();
    const initialDelay = Math.max(0, Number(this.config.initial_delay_ms || 0));
    if (initialDelay) await new Promise((resolve) => setTimeout(resolve, initialDelay));
    const firstReport = await this.pollAll();
    if (once) return { firstReport, close: async () => {} };

    const pollInterval = Math.max(10_000, Number(this.config.poll_interval_ms || DEFAULT_POLL_INTERVAL_MS));
    this.timer = setInterval(() => {
      this.pollAll().catch((error) => this.logger.error?.(`BigBrain event ingestor poll failed: ${error.message}`));
    }, pollInterval);
    this.timer.unref?.();
    this.server = http.createServer((request, response) => {
      this.handleHttpRequest(request, response).catch((error) => {
        this.sendJson(response, 500, { ok: false, error: error instanceof Error ? error.message : String(error) });
      });
    });
    await new Promise((resolve, reject) => {
      this.server.once('error', reject);
      this.server.listen(this.config.server.port, this.config.server.host, resolve);
    });
    return { firstReport, close: () => this.close() };
  }

  async close() {
    if (this.timer) clearInterval(this.timer);
    if (!this.server) return;
    await new Promise((resolve, reject) => this.server.close((error) => error ? reject(error) : resolve()));
    this.server = null;
  }

  async handleHttpRequest(request, response) {
    const requestUrl = new URL(request.url || '/', 'http://127.0.0.1');
    if (request.method === 'GET' && requestUrl.pathname === '/health') {
      return this.sendJson(response, 200, {
        ok: true,
        status: 'ready',
        brain_mcp_url: this.config.brain.mcp_url,
        sources: Object.fromEntries(this.config.sources.map((source) => [source.id, {
          type: source.type,
          state: summarizeSourceState(this.state.sources[source.id]),
        }])),
      });
    }
    if (request.method !== 'POST' || requestUrl.pathname !== '/events') return this.sendJson(response, 404, { ok: false, error: 'Not found' });
    const body = await readRequestBody(request, this.config.max_body_bytes);
    this.assertRequestSignature(request, body);
    const result = await this.handleExternalEvent(JSON.parse(body));
    return this.sendJson(response, result.status === 'duplicate' ? 200 : 202, { ok: true, ...result });
  }

  assertRequestSignature(request, body) {
    const secret = this.config.event_secret;
    if (!secret) {
      if (this.config.server.host !== '127.0.0.1' && this.config.server.host !== '::1' && this.config.server.host !== 'localhost') {
        throw new Error('Event secret is required when the server is not loopback-only.');
      }
      return;
    }
    const expected = hmacSignature(body, secret);
    const actual = request.headers['x-bigbrain-signature'];
    if (!timingSafeSignatureMatches(actual, expected)) throw new Error('Invalid event signature.');
  }

  sendJson(response, statusCode, value) {
    response.writeHead(statusCode, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
    response.end(JSON.stringify(value));
  }
}

export function normalizeConfig(config) {
  const input = config && typeof config === 'object' ? config : {};
  const server = input.server || {};
  const brain = input.brain || {};
  const sources = Array.isArray(input.sources) ? input.sources : [];
  if (!brain.mcp_url) throw new Error('Config requires brain.mcp_url.');
  if (!sources.length) throw new Error('Config requires at least one source.');
  for (const source of sources) {
    if (!source.id || !source.type || !source.url && source.type === 'rss') throw new Error('Each source requires id, type, and URL when it is RSS.');
    if (source.type === 'rss' && (!source.target_page || !source.raw_collection)) throw new Error(`RSS source ${source.id} requires target_page and raw_collection.`);
  }
  return {
    version: 1,
    brain: { mcp_url: brain.mcp_url, target_page: brain.target_page || null },
    server: { host: server.host || '127.0.0.1', port: Number(server.port || DEFAULT_EVENT_INGESTOR_PORT) },
    state_path: input.state_path || path.join(process.cwd(), '.bigbrain-state', 'event-ingestor-state.json'),
    event_secret: input.event_secret || null,
    user_agent: input.user_agent || 'BigBrain Event Ingestor/0.1 (+https://github.com/life-efficient/bigbrain)',
    poll_interval_ms: Number(input.poll_interval_ms || DEFAULT_POLL_INTERVAL_MS),
    initial_delay_ms: Number(input.initial_delay_ms || 0),
    max_body_bytes: Number(input.max_body_bytes || DEFAULT_MAX_BODY_BYTES),
    bootstrap: input.bootstrap || 'latest',
    sources: sources.map((source) => ({
      ...source,
      publisher: source.publisher || null,
      bootstrap: source.bootstrap || null,
      raw_prefix: source.raw_prefix || source.id,
    })),
  };
}

async function readRequestBody(request, maxBytes) {
  let total = 0;
  const chunks = [];
  for await (const chunk of request) {
    total += chunk.length;
    if (total > maxBytes) throw new Error('Request body is too large.');
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString('utf8');
}

function firstTag(xml, name) {
  const pattern = new RegExp(`<(?:(?:[a-z0-9_-]+):)?${name}\\b[^>]*>([\\s\\S]*?)<\\/(?:(?:[a-z0-9_-]+):)?${name}>`, 'i');
  return xml.match(pattern)?.[1] || '';
}

function allTags(xml, name) {
  const pattern = new RegExp(`<(?:(?:[a-z0-9_-]+):)?${name}\\b[^>]*>[\\s\\S]*?<\\/(?:(?:[a-z0-9_-]+):)?${name}>`, 'gi');
  return Array.from(xml.matchAll(pattern), (match) => match[0]);
}

function firstTagText(xml, name) {
  return cleanText(firstTag(xml, name));
}

function cleanText(value) {
  return decodeXml(String(value || '')
    .replace(/^<!\[CDATA\[/, '')
    .replace(/\]\]>$/, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim());
}

function decodeXml(value) {
  return value
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(Number.parseInt(hex, 16)))
    .replace(/&#([0-9]+);/g, (_, decimal) => String.fromCodePoint(Number(decimal)))
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
}

function escapeMarkdown(value) {
  return String(value || '').replace(/[\\[\]]/g, '\\$&');
}

function hash(value) {
  return crypto.createHash('sha256').update(String(value || '')).digest('hex');
}

function trimMap(value, limit) {
  const entries = Object.entries(value || {}).sort(([, a], [, b]) => String(a).localeCompare(String(b)));
  return Object.fromEntries(entries.slice(-limit));
}

function summarizeSourceState(state) {
  if (!state) return null;
  return {
    initialized_at: state.initialized_at || null,
    last_poll_at: state.last_poll_at || null,
    last_success_at: state.last_success_at || null,
    last_error: state.last_error || null,
    item_count: state.item_count || 0,
    seen_count: Object.keys(state.seen || {}).length,
    last_item_status: state.last_item_status || null,
    last_item_key: state.last_item_key || null,
    last_ingested_at: state.last_ingested_at || null,
  };
}
