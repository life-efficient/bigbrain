import test from 'node:test';
import assert from 'node:assert/strict';

import { CodexAppThreadExecutor, CodexCliExecutor, buildEventPrompt, parseCodexJsonOutput, parseCodexThreadId, selectPromptPayload } from '../../src/bigbrain/codex-event-executor.js';

const event = {
  event_id: 'event-1',
  listener_id: 'calendar',
  type: 'webhook.event',
  payload: { title: 'Planning meeting' },
  allowed_brain_ids: ['personal'],
  source: { display_name: 'Calendar', icon: 'Calendar', endpoint: 'https://calendar.test' },
};

test('Codex prompt gives a direct ingest instruction and names the workflow skill', () => {
  const prompt = buildEventPrompt(event, { description: 'File meaningful meetings.', display_name: 'Calendar', provider: 'calendar', skill: 'bigbrain-meeting-ingest' }, { allowedDestinations: [{ id: 'personal', name: 'Personal' }] });
  assert.match(prompt, /Ingest this calendar update into BigBrain/);
  assert.match(prompt, /Use the \$bigbrain-meeting-ingest skill/);
  assert.match(prompt, /Use the associated BigBrain MCP/);
  assert.match(prompt, /personal: Personal/);
  assert.match(prompt, /Do not invent Brain IDs/);
  assert.doesNotMatch(prompt, /Return JSON only/);
  assert.match(prompt, /"title": "Planning meeting"/);
  assert.doesNotMatch(prompt, /event-1/);
  assert.doesNotMatch(prompt, /Inbound source material/);
});

test('prompt payload can be narrowed to configured fields and omits RSS raw XML by default', () => {
  const rssPayload = { title: 'Release', link: 'https://example.test/release', description: 'Useful', raw: '<item>unnecessary</item>' };
  assert.deepEqual(selectPromptPayload(rssPayload, { type: 'rss' }), { title: 'Release', link: 'https://example.test/release', description: 'Useful' });
  assert.deepEqual(selectPromptPayload({ title: 'Meeting', data: { summary: 'Useful', secret: 'omit' }, noise: true }, {
    prompt_payload_fields: ['title', 'data.summary'],
  }), { title: 'Meeting', data: { summary: 'Useful' } });
});

test('RSS article prompt uses the source-article skill and preserves source bytes through the broker placeholder', () => {
  const prompt = buildEventPrompt({
    event_id: 'rss-1',
    listener_id: 'openai-news',
    type: 'rss.item',
    payload: { title: 'Article', link: 'https://example.test/article', description: 'Feed blurb', raw: '<item />' },
    metadata: {
      source_document: {
        status: 'fetched',
        url: 'https://example.test/article',
        content_type: 'text/html',
        text: 'Original article text',
        raw_body: '<html>Original article text</html>',
      },
    },
    allowed_brain_ids: ['personal'],
  }, { type: 'rss', display_name: 'OpenAI News' }, { allowedDestinations: [{ id: 'personal', name: 'Personal' }] });
  assert.match(prompt, /Use the \$bigbrain-source-article-ingest skill/);
  assert.match(prompt, /raw_content_source set to event\.source_document\.raw_body/);
  assert.match(prompt, /Original article text/);
  assert.doesNotMatch(prompt, /<html>Original article text<\/html>/);
});

test('CLI executor captures structured outcome and stderr-safe output', async () => {
  const executor = new CodexCliExecutor({ command: 'codex-test', execFileImpl: async (command, args) => {
    assert.equal(command, 'codex-test');
    assert.equal(args[0], 'exec');
    return { stdout: `progress\n${JSON.stringify({ status: 'ignored', reason: 'not useful', destinations: [] })}\n`, stderr: 'diagnostic' };
  } });
  const result = await executor.execute({ event, listener: { description: 'Calendar' } });
  assert.equal(result.mode, 'cli');
  assert.equal(result.outcome.status, 'ignored');
  assert.equal(result.stderr, 'diagnostic');
});

test('CLI executor preserves retryable exit metadata when Codex fails', async () => {
  const executor = new CodexCliExecutor({ execFileImpl: async () => {
    const error = new Error('API key missing');
    error.code = 2;
    error.stderr = 'missing credential';
    throw error;
  } });
  await assert.rejects(
    () => executor.execute({ event, listener: { description: 'Calendar' } }),
    (error) => error.execution_meta.mode === 'cli' && error.execution_meta.exit_status === 2 && error.execution_meta.error_details.stderr === 'missing credential',
  );
});

test('app-thread executor uses the supported app-server thread and turn methods', async () => {
  const calls = [];
  const executor = new CodexAppThreadExecutor({ clientFactory: async () => ({
    notifications: [],
    request: async (method, params) => {
      calls.push({ method, params });
      if (method === 'thread/start') return { thread: { id: 'thread-1' } };
      return { id: 'turn-1', outcome: { status: 'ignored', reason: 'not useful', destinations: [] } };
    },
    notify: async (method) => calls.push({ method }),
    close: async () => {},
  }) });
  const result = await executor.execute({ event, listener: { description: 'Calendar' } });
  assert.equal(result.thread_id, 'thread-1');
  assert.equal(result.execution_id, 'turn-1');
  assert.equal(result.outcome.status, 'ignored');
  assert.deepEqual(calls.map((call) => call.method), ['initialize', 'initialized', 'thread/start', 'turn/start']);
  assert.deepEqual(calls.find((call) => call.method === 'initialize').params.capabilities, { experimentalApi: true });
  assert.deepEqual(calls.find((call) => call.method === 'thread/start').params.environments, []);
  assert.match(calls.find((call) => call.method === 'thread/start').params.developerInstructions, /available BigBrain MCP/);
  assert.equal(calls.find((call) => call.method === 'turn/start').params.outputSchema, undefined);
});

test('app-thread executor accepts a normal-language completion without a structured outcome', async () => {
  const notifications = [
    { method: 'item/completed', params: { item: { type: 'agentMessage', text: 'Ingested the meeting and updated the existing project page.' } } },
    { method: 'turn/completed', params: { turn: { id: 'turn-3', status: 'completed' } } },
  ];
  const executor = new CodexAppThreadExecutor({ clientFactory: async () => ({
    notifications,
    request: async (method) => method === 'thread/start' ? { thread: { id: 'thread-3' } } : { turn: { id: 'turn-3', status: 'inProgress' } },
    waitForNotification: async () => notifications[1],
    close: async () => {},
  }) });
  const result = await executor.execute({ event, listener: { description: 'Calendar' } });
  assert.equal(result.outcome, null);
  assert.equal(result.response_text, 'Ingested the meeting and updated the existing project page.');
});

test('app-thread executor waits for completion and extracts the agent message outcome', async () => {
  const notifications = [
    { method: 'item/completed', params: { item: { type: 'agentMessage', text: '{"status":"filed","reason":"useful","destinations":[]}' } } },
    { method: 'turn/completed', params: { turn: { id: 'turn-2', status: 'completed' } } },
  ];
  const executor = new CodexAppThreadExecutor({ clientFactory: async () => ({
    notifications,
    request: async (method) => method === 'thread/start' ? { thread: { id: 'thread-2' } } : { turn: { id: 'turn-2', status: 'inProgress' } },
    waitForNotification: async () => notifications[1],
    close: async () => {},
  }) });
  const result = await executor.execute({ event, listener: { description: 'Calendar' } });
  assert.equal(result.thread_id, 'thread-2');
  assert.equal(result.execution_id, 'turn-2');
  assert.equal(result.outcome.status, 'filed');
});

test('CLI JSON parsing tolerates progress lines', () => {
  assert.deepEqual(parseCodexJsonOutput(`{"type":"thread.started","thread_id":"thread-1"}\n{"type":"item.completed","item":{"type":"agent_message","text":"{\\"status\\":\\"filed\\",\\"reason\\":\\"ok\\",\\"destinations\\":[]}"}}\n{"type":"turn.completed"}`), { status: 'filed', reason: 'ok', destinations: [] });
  assert.equal(parseCodexThreadId(`{"type":"thread.started","thread_id":"thread-1"}`), 'thread-1');
});
