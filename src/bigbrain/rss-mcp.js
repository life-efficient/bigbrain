import fs from 'node:fs/promises';
import { z } from 'zod';
import { openRssLedger } from './rss-ledger.js';

const text = z.string().trim().min(1).max(20000);
const url = z.string().url().max(4096);
const instant = z.string().datetime({ offset: true });
const lease = { url, leaseToken: text };
const duration = z.number().int().min(1).max(86400).optional();
const inputs = {
  status: z.strictObject({ feedId: text.optional(), url: url.optional(), outstandingOnly: z.boolean().optional(), limit: z.number().int().min(1).max(5000).optional(), offset: z.number().int().min(0).optional() }),
  'feed-upsert': z.strictObject({ feedId: text, feedUrl: url, title: text, provider: text.optional() }),
  discover: z.strictObject({ feedId: text, url, publishedAt: instant, title: text, channel: text }),
  claim: z.strictObject({ url, owner: text, leaseSeconds: duration }),
  renew: z.strictObject({ ...lease, leaseSeconds: duration }),
  complete: z.strictObject({ ...lease, outcome: z.enum(['source_only', 'source_partial', 'source_and_update', 'verified_noop', 'ignored', 'needs_review']), reason: text.optional(), verification: z.strictObject({ readBack: z.literal(true), verifiedAt: instant, brainId: text, paths: z.array(text).max(1000), evidence: text }).optional() }),
  release: z.strictObject({ ...lease, reason: text }),
  retry: z.strictObject({ url, reason: text }),
};
const request = z.strictObject({ operation: z.enum(Object.keys(inputs)), input: z.record(z.string(), z.unknown()) });

export function rssLedgerInputSchema() {
  return {
    type: 'object', additionalProperties: false,
    properties: {
      operation: { type: 'string', enum: Object.keys(inputs) },
      input: { anyOf: Object.values(inputs).map(schema => {
        const { $schema, ...definition } = z.toJSONSchema(schema);
        return definition;
      }), description: 'Operation-specific fields use the shared ledger camelCase contract. No file paths or database overrides.' },
    },
    required: ['operation', 'input'],
  };
}

export function callRssLedger(config, args) {
  const { operation, input: raw } = request.parse(args);
  const input = inputs[operation].parse(raw);
  if (input.verification) {
    if (!config.brainId || input.verification.brainId !== config.brainId) throw new Error('verification.brainId must match this owning Brain.');
    for (const value of input.verification.paths) {
      if (value.startsWith('/') || value.includes('\\') || value.split('/').includes('..') || /^[a-z][a-z0-9+.-]*:/i.test(value)) throw new Error('verification.paths must be relative paths within the owning Brain.');
    }
  }
  // Use only the server-owned default ledger. Tool callers cannot choose files.
  const ledger = openRssLedger({ readOnly: operation === 'status' });
  if (!ledger) return { ok: true, operation, exists: false, feeds: [], posts: [], total: 0, nextOffset: null };
  try {
    const method = { 'feed-upsert': 'feedUpsert' }[operation] || operation;
    return { ok: true, operation, ...ledger[method](input) };
  } finally { ledger.close(); }
}

const WORKFLOW_DOCUMENTS = Object.freeze([
  'bigbrain-source-article-ingest/SKILL.md',
  'bigbrain-source-article-ingest/references/rss-ledger.md',
  'bigbrain-source-article-ingest/references/relevance-gate.md',
  'bigbrain-ingest/references/ingestion-completeness.md',
  'bigbrain-page/SKILL.md',
]);

export async function rssWorkflow(args) {
  z.strictObject({}).parse(args);
  return {
    instruction: 'Use rss/ledger for operational state and owning-Brain MCP tools for content. Never open TextEdit, Finder, Terminal UI, or another desktop application to read skills or the ledger. If these tools are unavailable, report the missing capability and stop without changing ingestion state.',
    documents: await Promise.all(WORKFLOW_DOCUMENTS.map(async name => ({ name, content: await fs.readFile(new URL(`../../skills/${name}`, import.meta.url), 'utf8') }))),
  };
}
