import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { initializeBrainHome, loadConfig } from '../../src/bigbrain/config.js';
import { startMcpServer } from '../../src/bigbrain/mcp-server.js';
import { readBrainPage } from '../../src/bigbrain/page-ops.js';
import { openDatabase } from '../../src/bigbrain/db.js';
import { upsertMember } from '../../src/bigbrain/members.js';
import { parseTimeline } from '../../src/bigbrain/timeline.js';
import { upsertCustomRole } from '../../src/bigbrain/roles.js';

const names = {
  introductions: 'overlays/deals/introductions',
  details: 'overlays/deals/update_details',
  stage: 'overlays/deals/update_stage',
  introductionStage: 'overlays/deals/introductions/update_stage',
  status: 'overlays/deals/update_status',
  arrangement: 'overlays/deals/introductions/update_arrangement',
  asks: 'overlays/deals/update_asks',
  export: 'overlays/deals/export',
};
const alias = name => name.replaceAll('/', '_');
const metadata = () => ({ commit_message: 'Exercise deal MCP mutation', provenance: {
  event_id: `test:deal-mcp:${crypto.randomUUID()}`, source_type: 'assistant_chat',
  source_label: 'Deals MCP test', source_message: 'Explicit fixture update for endpoint verification.',
} });

async function fixture(run, { hosted = false } = {}) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'bigbrain-deals-mcp-features-'));
  let server;
  try {
    const init = await initializeBrainHome(path.join(root, 'brain'), { env: { ...process.env,
      BIGBRAIN_POINTER_PATH: path.join(root, 'pointer'), BIGBRAIN_STATE_ROOT: path.join(root, 'state') } });
    const config = await loadConfig({ configPath: init.configPath });
    const write = async (slug, fields, body = 'PRIVATE_BODY_CANARY') => {
      const file = path.join(config.brainDir, `${slug}.md`);
      await fs.mkdir(path.dirname(file), { recursive: true });
      await fs.writeFile(file, `---\n${Object.entries(fields).map(([key, value]) => `${key}: ${JSON.stringify(value)}`).join('\n')}\n---\n# ${fields.title}\n\n${body}\n\n---\n\n## Timeline\n\n`);
    };
    const deal = { title: 'PRIVATE_TITLE_CANARY', summary: 'PRIVATE_SUMMARY_CANARY', deal_involvement: 'active',
      deal_status: 'active', deal_stage: 'qualifying', stage_as_of: '2026-10-20',
      anonymised_title: 'Anonymous compute project', anonymised_description: 'A regional compute deployment.',
      anonymised_asks: ['Seeking compute buyers.'], custom_field: 'Preserve this field' };
    await write('deals/sample', deal);
    await write('deals/other', { ...deal, title: 'Other internal deal', anonymised_title: 'UNSELECTED_ANONYMOUS_CANARY' });
    await write('deals/archived', { ...deal, title: 'Archived deal', deal_status: 'archived' });
    await write('deals/unenrolled', { title: 'Unenrolled parent' });
    await write('deal_introductions/sample', { title: 'Introduction', summary: 'Internal route', deal: 'deals/sample',
      parties: ['organizations/a', 'organizations/b'], purpose: 'Supply compute', stage: 'discussing',
      stage_as_of: '2026-10-20', introduction_status: 'active', arrangement_status: 'none' });
    await write('deal_introductions/unenrolled-parent', { title: 'Other introduction', deal: 'deals/unenrolled',
      parties: ['organizations/a', 'organizations/b'], purpose: 'Connect customers', stage: 'proposed',
      stage_as_of: '2026-10-20', introduction_status: 'active', arrangement_status: 'establishing' });
    for (const slug of ['a', 'b']) await write(`organizations/${slug}`, { title: `Organization ${slug}` });
    let authConfig;
    if (hosted) {
      const tokenStorePath = path.join(root, 'tokens.json');
      const tokens = [['reader', 'brain:read'], ['writer', 'brain:read brain:write']].map(([user, scope]) => ({
        token_hash: crypto.createHash('sha256').update(`bbmcp_${user}`).digest('hex'), email: `${user}@example.com`,
        name: user, provider: 'google', created_at: new Date().toISOString(), last_used_at: null, revoked_at: null, scope,
      }));
      await fs.writeFile(tokenStorePath, JSON.stringify({ tokens, states: [], clients: [], codes: [] }));
      const db = await openDatabase(config);
      try {
        await upsertCustomRole(db, { key: 'deal-editor', name: 'Deal Editor', permissions: { read: true, page_edit: true }, page_edit_paths: ['deals'] });
        await upsertMember(db, { email: 'writer@example.com', name: 'Writer', person_slug: 'people/writer', role: 'deal-editor', status: 'active' });
        await upsertMember(db, { email: 'reader@example.com', name: 'Reader', person_slug: 'people/reader', role: 'viewer', status: 'active' });
      } finally { await db.close?.(); }
      authConfig = { mode: 'oauth_allowlist', authToken: null, publicUrl: 'https://brain.example.test', provider: 'google',
        googleClientId: 'client-id', googleClientSecret: 'client-secret', allowedEmails: ['reader@example.com', 'writer@example.com'],
        allowedDomains: [], tokenStorePath, allowSharedToken: false, serviceName: 'Brain', appName: 'Brain' };
    }
    server = await startMcpServer({ config, host: '127.0.0.1', port: 0, syncIntervalMs: 0,
      gitBackupEnabled: false, ...(hosted ? { authConfig } : { authToken: 'secret' }) });
    const rpc = async (method, params, token = 'secret') => {
      const response = await fetch(server.url, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) });
      assert.equal(response.status, 200); return response.json();
    };
    const call = (name, args = {}, token) => rpc('tools/call', { name, arguments: args }, token);
    const mutate = (name, args = {}, token) => call(name, { ...args, ...metadata() }, token);
    const read = slug => readBrainPage({ config, pagePath: slug });
    await run({ config, rpc, call, mutate, read });
  } finally { await server?.close(); await fs.rm(root, { recursive: true, force: true }); }
}

function content(response) {
  assert.equal(response.error, undefined, response.error?.message);
  assert.notEqual(response.result?.isError, true, JSON.stringify(response.result));
  return response.result.structuredContent;
}
function error(response, pattern) {
  assert.ok(response.error || response.result?.isError, 'Expected an MCP failure');
  if (pattern) assert.match(JSON.stringify(response.error || response.result), pattern);
}

test('new Deals MCP tools advertise both names and introduction reads paginate independently of deal enrollment', async () => fixture(async ({ rpc, call }) => {
  const listed = (await rpc('tools/list', {})).result.tools;
  for (const name of Object.values(names)) {
    const canonical = listed.find(tool => tool.name === name);
    const compatible = listed.find(tool => tool.name === alias(name));
    assert.ok(canonical, name); assert.ok(compatible, alias(name));
    assert.deepEqual(canonical.inputSchema, compatible.inputSchema);
  }
  const full = content(await call(names.introductions));
  assert.equal(full.total, 2);
  assert.deepEqual(content(await call(alias(names.introductions))), full);
  const first = content(await call(names.introductions, { limit: 1 }));
  assert.equal(first.next_cursor, 1);
  const next = content(await call(alias(names.introductions), { cursor: first.next_cursor, limit: 1 }));
  assert.equal(next.next_cursor, null);
  assert.equal(next.records[0].parent_deal.page_slug, 'deals/unenrolled');
  assert.equal(first.records[0].edit_values.arrangement_status, 'none');
  error(await call(names.introductions, { limit: 101 }), /limit/);
}));

test('MCP detail and anonymised-ask edits persist, reject stale snapshots, and preserve unrelated page content', async () => fixture(async ({ call, mutate, read }) => {
  const record = content(await call('overlays/deals')).records.find(record => record.page_slug === 'deals/sample');
  const before = await read(record.page_slug);
  const values = { ...record.edit_values, title: 'Renamed internal project', summary: 'Updated internal summary',
    anonymised_title: 'Updated anonymous title', anonymised_description: 'Updated anonymous description', anonymised_asks: ['Seeking delivery partners.'], anonymised_stage_comment: 'The developer is confirming the power allocation.' };
  const input = { page_slug: record.page_slug, values, expected_values: record.edit_values, expected_deal_stage: record.deal_stage, expected_stage_as_of: record.stage_as_of };
  error(await call(names.details, input), /commit_message|provenance/);
  const editMetadata = metadata();
  const saved = content(await call(names.details, { ...input, ...editMetadata })).record;
  assert.equal(saved.title, values.title);
  const after = await read(record.page_slug);
  assert.equal(after.title, values.title);
  const editEvent = parseTimeline(after.markdown).entries.find(entry => entry.provenance?.event_id === editMetadata.provenance.event_id);
  assert.ok(editEvent, 'Supplied MCP event identity must be retained');
  assert.equal(editEvent.provenance.source_type, 'assistant_chat');
  assert.equal(editEvent.provenance.source_label, 'Deals MCP test');
  assert.match(after.markdown, /# Renamed internal project/);
  assert.match(after.body, /PRIVATE_BODY_CANARY/);
  assert.equal(after.frontmatter.custom_field, before.frontmatter.custom_field);
  assert.equal(after.frontmatter.stage_as_of, before.frontmatter.stage_as_of);
  assert.deepEqual(after.frontmatter.anonymised_asks, values.anonymised_asks);
  assert.equal(after.frontmatter.anonymised_stage_comment, values.anonymised_stage_comment);
  error(await mutate(alias(names.details), { ...input, values: { ...values, title: 'Stale overwrite' } }), /changed elsewhere/);
  assert.equal((await read(record.page_slug)).title, values.title);
  const askInput = { page_slug: record.page_slug, anonymised_asks: ['Seeking regional customers.'], expected_anonymised_asks: values.anonymised_asks,
    expected_anonymised_title: values.anonymised_title, expected_anonymised_description: values.anonymised_description };
  const asks = content(await mutate(alias(names.asks), askInput));
  assert.deepEqual(asks.record.anonymised_asks, askInput.anonymised_asks);
  error(await mutate(names.asks, askInput), /changed|refresh/i);
  const refreshed = content(await call('overlays_deals')).records.find(record => record.page_slug === 'deals/sample');
  assert.deepEqual(refreshed.edit_values.anonymised_asks, askInput.anonymised_asks);
  const intro = content(await call(names.introductions)).records.find(record => record.page_slug === 'deal_introductions/sample');
  const introValues = { ...intro.edit_values, title: 'Updated introduction', purpose: 'Supply managed compute', arrangement_status: 'establishing' };
  const introSaved = content(await mutate(alias(names.details), { page_slug: intro.page_slug, values: introValues, expected_values: intro.edit_values })).record;
  assert.deepEqual(introSaved.edit_values, introValues);
  const introAfter = await read(intro.page_slug);
  assert.equal(introAfter.frontmatter.deal, 'deals/sample');
  assert.equal(introAfter.frontmatter.stage, 'discussing');
  assert.equal(introAfter.frontmatter.stage_as_of, '2026-10-20');
  assert.match(introAfter.body, /PRIVATE_BODY_CANARY/);
}));

test('MCP stage, arrangement and archive controls preserve independent state and reject conflicting writes', async () => fixture(async ({ call, mutate, read }) => {
  const record = content(await call('overlays/deals')).records.find(record => record.page_slug === 'deals/sample');
  const stageInput = { page_slug: record.page_slug, deal_stage: 'preparing', expected_deal_stage: record.deal_stage,
    expected_deal_status: record.deal_status, expected_stage_as_of: record.stage_as_of };
  const moved = content(await mutate(names.stage, stageInput)).record;
  assert.equal(moved.deal_stage, 'preparing');
  error(await mutate(alias(names.stage), { ...stageInput, deal_stage: 'negotiating' }), /changed elsewhere/);
  const archived = content(await mutate(alias(names.status), { page_slug: record.page_slug, status: 'archived', expected_status: 'active',
    expected_stage: moved.deal_stage, expected_stage_as_of: moved.stage_as_of })).record;
  assert.equal(archived.deal_status, 'archived');
  assert.equal(archived.deal_stage, moved.deal_stage); assert.equal(archived.stage_as_of, moved.stage_as_of);
  error(await mutate(names.stage, { ...stageInput, expected_deal_stage: moved.deal_stage, expected_stage_as_of: moved.stage_as_of, deal_stage: 'negotiating' }), /archived|status changed/);
  const intro = content(await call(names.introductions)).records.find(record => record.page_slug === 'deal_introductions/sample');
  assert.equal(intro.introduction_status, 'active', 'Parent archive must not cascade');
  const arranged = content(await mutate(alias(names.arrangement), { page_slug: intro.page_slug, arrangement_status: 'agreed', expected_arrangement_status: 'none' })).record;
  assert.equal(arranged.arrangement_status, 'agreed');
  assert.equal(arranged.stage_as_of, intro.stage_as_of); assert.equal(arranged.stage, intro.stage);
  error(await mutate(names.arrangement, { page_slug: intro.page_slug, arrangement_status: 'establishing', expected_arrangement_status: 'none' }), /changed elsewhere/);
  const introMoved = content(await mutate(alias(names.introductionStage), { page_slug: intro.page_slug, stage: 'negotiating',
    expected_stage: intro.stage, expected_introduction_status: intro.introduction_status, expected_stage_as_of: intro.stage_as_of })).record;
  assert.equal(introMoved.stage, 'negotiating');
  const introPage = await read(intro.page_slug);
  assert.equal(introPage.frontmatter.arrangement_status, 'agreed');
  assert.equal(introPage.frontmatter.deal, 'deals/sample');
  assert.match(introPage.body, /PRIVATE_BODY_CANARY/);
}));

test('MCP exports contain only anonymised selected fields, return real PDFs, and never broaden invalid selections', async () => fixture(async ({ call }) => {
  const selected = content(await call(names.export, { page_slugs: ['deals/sample'] }));
  assert.equal(selected.total, 1);
  assert.deepEqual(selected.records, [{ title: 'Anonymous compute project', description: 'A regional compute deployment.', asks: ['Seeking compute buyers.'], stage: 'qualifying', stage_label: 'Qualifying', stage_comment: '' }]);
  assert.doesNotMatch(JSON.stringify(selected), /PRIVATE_|UNSELECTED_|deals\//);
  const complete = content(await call(alias(names.export), {}));
  assert.equal(complete.total, 2, 'Archived deals must be excluded');
  const pdf = await call(alias(names.export), { page_slugs: ['deals/sample'], format: 'pdf' });
  assert.equal(pdf.error, undefined, pdf.error?.message);
  const resource = pdf.result.content.find(item => item.type === 'resource').resource;
  assert.equal(resource.mimeType, 'application/pdf');
  const bytes = Buffer.from(resource.blob, 'base64');
  assert.equal(bytes.subarray(0, 5).toString(), '%PDF-');
  assert.match(bytes.toString('latin1'), /%%EOF/);
  assert.doesNotMatch(JSON.stringify(pdf.result), /PRIVATE_|UNSELECTED_|deals\/sample/);
  for (const page_slugs of [[], ['deals/missing'], ['deals/archived'], ['deal_introductions/sample'], ['deals/../sample'], ['deals/sample', 'deals/missing']]) {
    error(await call(names.export, { page_slugs }), /select|available|valid/i);
  }
  error(await call(names.export, { format: 'html' }), /format/);
}));

test('hosted MCP enforces read-only scopes and deal editor path boundaries on both aliases', async () => fixture(async ({ rpc, call, mutate, read }) => {
  const listed = (await rpc('tools/list', {}, 'bbmcp_reader')).result.tools;
  for (const name of [names.introductions, names.export]) {
    assert.ok(listed.some(tool => tool.name === name)); assert.ok(listed.some(tool => tool.name === alias(name)));
  }
  for (const name of [names.details, names.stage, names.introductionStage, names.status, names.arrangement, names.asks]) {
    assert.ok(!listed.some(tool => tool.name === name), name);
    assert.ok(!listed.some(tool => tool.name === alias(name)), alias(name));
    for (const toolName of [name, alias(name)]) {
      const denied = await mutate(toolName, { page_slug: 'deals/sample' }, 'bbmcp_reader');
      assert.equal(denied.error?.code, -32003, JSON.stringify(denied));
    }
  }
  const intro = content(await call(names.introductions, {}, 'bbmcp_writer')).records.find(record => record.page_slug === 'deal_introductions/sample');
  for (const name of [names.details, alias(names.details)]) {
    const denied = await mutate(name, { page_slug: intro.page_slug, values: { ...intro.edit_values, title: 'Forbidden change' }, expected_values: intro.edit_values }, 'bbmcp_writer');
    assert.equal(denied.error?.code, -32003); assert.match(denied.error.message, /deal-editor.*deal_introductions\/sample/);
  }
  for (const name of [names.stage, names.introductionStage, names.status, names.arrangement, names.asks]) {
    for (const toolName of [name, alias(name)]) {
      const denied = await mutate(toolName, { page_slug: intro.page_slug }, 'bbmcp_writer');
      assert.equal(denied.error?.code, -32003, toolName);
      assert.match(denied.error.message, /deal-editor.*deal_introductions\/sample/);
    }
  }
  assert.equal((await read(intro.page_slug)).title, intro.title);
  const deal = content(await call('overlays/deals', {}, 'bbmcp_writer')).records.find(record => record.page_slug === 'deals/sample');
  const saved = content(await mutate(names.details, { page_slug: deal.page_slug, values: { ...deal.edit_values, summary: 'Authorized scoped edit' }, expected_values: deal.edit_values }, 'bbmcp_writer'));
  assert.equal(saved.record.edit_values.summary, 'Authorized scoped edit');
  assert.equal((await read(deal.page_slug)).summary, 'Authorized scoped edit');
}, { hosted: true }));
