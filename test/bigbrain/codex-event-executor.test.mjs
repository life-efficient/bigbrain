import test from 'node:test';
import assert from 'node:assert/strict';

import { AppServerJsonRpcClient, DEFAULT_CODEX_APP_SERVER_ARGS, CodexAppThreadExecutor, CodexCliExecutor, buildBackgroundCodexEnv, buildEventPrompt, isSubstackRssEvent, normalizeCodexOutcome, parseCodexJsonOutput, parseCodexThreadId, resolveThreadTitle, selectPromptPayload } from '../../src/bigbrain/codex-event-executor.js';

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
  assert.match(prompt, /Use the available BigBrain tools/);
  assert.match(prompt, /personal: Personal/);
  assert.match(prompt, /Do not invent credentials/);
  assert.match(prompt, /Keep timeline text concise and subject-first/);
  assert.match(prompt, /not the current user by name/);
  assert.match(prompt, /Keep source wording in provenance\.source_message/);
  assert.doesNotMatch(prompt, /Return JSON only/);
  assert.match(prompt, /"title": "Planning meeting"/);
  assert.doesNotMatch(prompt, /event-1/);
  assert.doesNotMatch(prompt, /Inbound source material/);
});

test('Granola event prompt preserves the webhook ID and matching context for UUID-only detail tools', () => {
  const prompt = buildEventPrompt({
    event_id: 'granola:not_123:note.generated',
    type: 'granola.meeting.completed',
    occurred_at: '2026-09-20T08:15:00Z',
    payload: { event_type: 'note.generated', granola_id: 'not_123', title: 'Planning', note_url: 'https://notes.granola.ai/note/abc', summary: 'Private details' },
  }, { provider: 'granola', skill: 'bigbrain-granola-ingest', prompt_payload_fields: ['event_type', 'granola_id'] });
  assert.match(prompt, /Ingest the Granola meeting with ID not_123 using \$bigbrain-granola-ingest/);
  assert.match(prompt, /source item key for the routing ledger/);
  assert.match(prompt, /Completion time alone does not prove identity/);
  assert.match(prompt, /2026-09-20T08:15:00Z/);
  assert.match(prompt, /Planning/);
  assert.match(prompt, /https:\/\/notes\.granola\.ai\/note\/abc/);
  assert.doesNotMatch(prompt, /Private details/);
});

test('prompt payload can be narrowed to configured fields and omits RSS raw XML by default', () => {
  const rssPayload = { title: 'Release', link: 'https://example.test/release', description: 'Useful', raw: '<item>unnecessary</item>' };
  assert.deepEqual(selectPromptPayload(rssPayload, { type: 'rss' }), { title: 'Release', link: 'https://example.test/release', description: 'Useful' });
  assert.deepEqual(selectPromptPayload({ title: 'Meeting', data: { summary: 'Useful', secret: 'omit' }, noise: true }, {
    prompt_payload_fields: ['title', 'data.summary'],
  }), { title: 'Meeting', data: { summary: 'Useful' } });
});

test('RSS article prompt is a concise skill handoff', () => {
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
  }, { type: 'rss', display_name: 'OpenAI News', guidance: 'Prioritize substantive model and policy updates; ignore routine promotion.' }, { allowedDestinations: [{ id: 'personal', name: 'Personal' }] });
  assert.match(prompt, /Ingest this article using \$bigbrain-source-article-ingest/);
  assert.match(prompt, /Prioritize substantive model and policy updates; ignore routine promotion/);
  assert.match(prompt, /Article: Article\nhttps:\/\/example\.test\/article/);
  assert.doesNotMatch(prompt, /Original article text|rss\/ledger|Source identity/);
});

test('Substack RSS uses the same concise article handoff', () => {
  const item = { event_id: 'rss-post-1', delivery_id: 'delivery-1', listener_id: 'publication-1', type: 'rss.item', allowed_brain_ids: ['personal'], payload: { title: 'Post', link: 'https://newsletter.example.test/p/post', published_at: '2026-09-14T10:00:00Z', guid: 'item-guid', raw: '<item>private payload</item>' } };
  const prompt = buildEventPrompt(item, { type: 'rss', skill: 'bigbrain-substack-ingest', url: 'https://newsletter.example.test/feed', prompt_payload_fields: ['title'], guidance: 'Only relevant infrastructure analysis.' }, { allowedDestinations: [{ id: 'personal', name: 'Personal Brain' }] });
  assert.match(prompt, /Ingest this article using \$bigbrain-substack-ingest/);
  assert.match(prompt, /Only relevant infrastructure analysis\./);
  assert.match(prompt, /Article: Post\nhttps:\/\/newsletter\.example\.test\/p\/post/);
  assert.doesNotMatch(prompt, /private payload|delivery-1|rss-post-1|allowed_brain_ids/);
});

test('Substack detection supports explicit custom domains and exact hosted domain suffix', () => {
  assert.equal(isSubstackRssEvent({ type: 'rss.item', payload: { link: 'https://publication.substack.com/p/post' } }, {}), true);
  assert.equal(isSubstackRssEvent({ type: 'rss.item', payload: { link: 'https://substack.com.attacker.test/p/post' } }, {}), false);
  assert.equal(isSubstackRssEvent({ type: 'rss.item', payload: { link: 'https://publisher.test/p/post' } }, { skill: '$bigbrain-substack-ingest' }), true);
  assert.equal(isSubstackRssEvent({ type: 'webhook.event' }, { skill: 'bigbrain-substack-ingest' }), false);
});

test('RSS tasks use concise instructions at both prompt layers', async () => {
  const cases = [
    { event: { type: 'rss.item', payload: { link: 'https://publisher.test/article' } }, listener: {} },
    { event: { payload: { link: 'https://publisher.test/article' } }, listener: { type: 'rss' } },
    { event: { type: 'rss.item', payload: { link: 'https://publisher.substack.com/p/post' } }, listener: {} },
    { event: { type: 'rss.item', payload: { link: 'https://newsletter.test/p/post' } }, listener: { skill: 'bigbrain-substack-ingest' } },
  ];
  for (const input of cases) {
    const calls = [];
    const executor = new CodexAppThreadExecutor({ clientFactory: async () => ({
      notifications: [],
      request: async (method, params) => {
        calls.push({ method, params });
        return method === 'thread/start' ? { thread: { id: 'rss-thread' } } : { id: 'rss-turn' };
      },
      close: async () => {},
    }) });
    await executor.execute(input);
    const instructions = calls.find(call => call.method === 'thread/start').params.developerInstructions;
    const prompt = calls.find(call => call.method === 'turn/start').params.input[0].text;
    assert.match(instructions, /Use the configured (RSS|Substack) ingestion skill/);
    assert.match(prompt, /Ingest this article using/);
    assert.doesNotMatch(`${instructions}\n${prompt}`, /any available documented browser|atomic claim|needs_review|source_only|structured output schema/);
    assert.equal(calls.find(call => call.method === 'turn/start').params.outputSchema, undefined);
  }
  assert.doesNotMatch(buildEventPrompt(event, { provider: 'calendar' }), /RSS-triggered ingestion|iab browser/);
});

test('RSS outcomes accept the direct operation form emitted by the source-article skill', () => {
  const outcome = normalizeCodexOutcome({ status: 'filed', capture_mode: 'full', reason: 'useful', destinations: [{
    operation: 'create_raw_file_with_page',
    raw_path: 'concepts/.raw/article.html',
    page_path: 'concepts/.raw/article.md',
    raw_content_source: 'event.source_document.raw_body',
    commit_message: 'Capture article source',
  }] }, { defaultBrainId: 'personal' });
  assert.equal(outcome.destinations[0].brain_id, 'personal');
  assert.deepEqual(outcome.destinations[0].writes, [{
    tool: 'create_raw_file_with_page',
    commit_message: 'Capture article source',
    arguments: {
      raw_path: 'concepts/.raw/article.html',
      page_path: 'concepts/.raw/article.md',
      raw_content_source: 'event.source_document.raw_body',
    },
  }]);
});

test('CLI executor captures structured outcome and stderr-safe output', async () => {
  const executor = new CodexCliExecutor({ command: 'codex-test', execFileImpl: async (command, args) => {
    assert.equal(command, 'codex-test');
    assert.equal(args[0], 'exec');
    return { stdout: `progress\n${JSON.stringify({ status: 'ignored', reason: 'not useful', destinations: [] })}\n`, stderr: 'diagnostic' };
  } });
  const result = await executor.execute({ event, listener: { description: 'Calendar', codex_model: 'gpt-5.6-luna', codex_reasoning_effort: 'xhigh' } });
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
  const result = await executor.execute({ event, listener: { description: 'Calendar', codex_model: 'gpt-5.6-luna', codex_reasoning_effort: 'xhigh' } });
  assert.equal(result.thread_id, 'thread-1');
  assert.equal(result.execution_id, 'turn-1');
  assert.equal(result.outcome.status, 'ignored');
  assert.deepEqual(calls.map((call) => call.method), ['initialize', 'initialized', 'thread/start', 'thread/name/set', 'turn/start']);
  assert.deepEqual(calls.find((call) => call.method === 'initialize').params.capabilities, { experimentalApi: true });
  assert.equal(calls.find((call) => call.method === 'thread/start').params.environments, undefined);
  assert.equal(calls.find((call) => call.method === 'thread/start').params.sandbox, 'workspace-write');
  assert.equal(calls.find((call) => call.method === 'thread/start').params.ephemeral, false);
  assert.equal(calls.find((call) => call.method === 'thread/start').params.model, 'gpt-5.6-luna');
  assert.equal(calls.find((call) => call.method === 'thread/name/set').params.name, 'Planning meeting');
  assert.match(calls.find((call) => call.method === 'thread/start').params.developerInstructions, /Do not use native computer-use actions/);
  assert.match(calls.find((call) => call.method === 'thread/start').params.developerInstructions, /use the terminal/);
  assert.match(calls.find((call) => call.method === 'thread/start').params.developerInstructions, /available BigBrain MCP/);
  assert.equal(calls.find((call) => call.method === 'turn/start').params.model, 'gpt-5.6-luna');
  assert.equal(calls.find((call) => call.method === 'turn/start').params.effort, 'xhigh');
  assert.equal(calls.find((call) => call.method === 'turn/start').params.outputSchema, undefined);
});

test('Substack app tasks receive concise skill instructions at developer priority', async () => {
  const calls = [];
  const executor = new CodexAppThreadExecutor({ clientFactory: async () => ({
    notifications: [],
    request: async (method, params) => {
      calls.push({ method, params });
      return method === 'thread/start' ? { thread: { id: 'substack-thread' } } : { id: 'substack-turn' };
    },
    close: async () => {},
  }) });
  await executor.execute({ event: { type: 'rss.item', payload: { link: 'https://publisher.substack.com/p/post' } }, listener: { type: 'rss', provider: 'substack' } });
  const start = calls.find(call => call.method === 'thread/start').params;
  assert.equal(start.environments, undefined);
  assert.equal(start.sandbox, 'workspace-write');
  assert.match(start.developerInstructions, /Use the configured Substack ingestion skill and complete the linked article task directly/);
  assert.match(start.developerInstructions, /Do not use native computer-use actions/);
  assert.match(calls.find(call => call.method === 'turn/start').params.input[0].text, /Ingest this article using/);
});

test('Granola app tasks can write the machine routing ledger inside the workspace sandbox', async () => {
  const calls = [];
  const executor = new CodexAppThreadExecutor({
    env: { HOME: '/example/home', BIGBRAIN_ROUTING_LEDGER_PATH: '/machine/state/routing-ledger.sqlite' },
    clientFactory: async () => ({
      notifications: [],
      request: async (method, params) => {
        calls.push({ method, params });
        return method === 'thread/start' ? { thread: { id: 'granola-thread' } } : { id: 'granola-turn' };
      },
      close: async () => {},
    }),
  });
  await executor.execute({ event: { type: 'granola.meeting.completed', payload: { granola_id: 'note-id' } }, listener: { provider: 'granola' } });
  const start = calls.find((call) => call.method === 'thread/start').params;
  assert.equal(start.sandbox, 'workspace-write');
  assert.deepEqual(start.config, { sandbox_workspace_write: { writable_roots: ['/machine/state'] } });
});

test('thread title prioritizes configured title, then payload title, then safe fallback', () => {
  assert.equal(resolveThreadTitle({ type: 'granola.meeting.completed', payload: { title: 'Board meeting' } }, { provider: 'granola', codex_thread_title: 'Configured fallback' }), 'Configured fallback');
  assert.equal(resolveThreadTitle({ type: 'granola.meeting.completed', payload: { title: 'Board meeting' } }, { provider: 'granola' }), 'Board meeting');
  assert.equal(resolveThreadTitle({ type: 'granola.meeting.completed', payload: { title: '' } }, { provider: 'granola' }), 'Granola meeting ingestion');
  assert.equal(resolveThreadTitle({ type: 'webhook.event', payload: {} }, { display_name: 'Calendar' }), 'Calendar ingestion');
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

test('RSS prompts contain the article link and listener guidance', () => {
  const prompt = buildEventPrompt({ event_id: 'event-42', delivery_id: 'delivery-42', listener_id: 'query-feed', type: 'rss.item', allowed_brain_ids: ['personal'], payload: { title: 'Article', link: 'https://publisher.test/?article=42', published_at: '2026-09-14T10:00:00Z', guid: 'item-42' } }, { type: 'rss', url: 'https://feedhost.test/rss', prompt_payload_fields: ['title'] }, { allowedDestinations: [{ id: 'personal', name: 'Personal Brain' }] });
  assert.match(prompt, /Ingest this article using \$bigbrain-source-article-ingest/);
  assert.match(prompt, /https:\/\/publisher\.test\/\?article=42/);
  assert.doesNotMatch(prompt, /rss\/workflow|rss\/ledger|event-42|delivery-42/);
});

test('generic RSS app tasks receive concise instructions at developer priority', async () => {
  const calls = [];
  const executor = new CodexAppThreadExecutor({ clientFactory: async () => ({ notifications: [], request: async (method, args) => { calls.push({ method, args }); return method === 'thread/start' ? { thread: { id: 'rss-thread' } } : { id: 'rss-turn' }; }, notify: async () => {}, close: async () => {} }) });
  await executor.execute({ event: { type: 'rss.item', payload: { link: 'https://publisher.test/article' } }, listener: { type: 'rss' } });
  const instructions = calls.find(call => call.method === 'thread/start').args.developerInstructions;
  assert.match(instructions, /Use the configured RSS ingestion skill and complete the linked article task directly/);
  assert.match(instructions, /Do not use native computer-use actions/);
});

test('background app-server defaults retain browser REPL access but disable native computer use', () => {
  assert.deepEqual(DEFAULT_CODEX_APP_SERVER_ARGS, [
    'app-server',
    '--stdio',
    '--config', 'notify=[]',
    '--config', 'sandbox_mode="workspace-write"',
    '--config', 'approval_policy="on-request"',
    '--config', 'mcp_servers.personal_brain.enabled_tools=["about","me","filing_rules","search","read","list","read_raw_file","list_raw_files","pages/query","create_raw_file_with_page","capture_article","create_page","create_raw_file","update_page","rss/workflow","rss_workflow","rss/ledger","rss_ledger","substack/workflow","substack_workflow","substack/ledger","substack_ledger","events/listeners","events/subscriptions","events/inbox","domains/list","domains_list","events/provenance"]',
    '--config', 'mcp_servers.node_repl.env.CUA_REPL_ENABLED_SURFACES="browser"',
    '--config', 'mcp_servers.node_repl.env.NODE_REPL_TRUSTED_SERVICES=\'{"browser":"@oai/browser-desktop/service"}\'',
    '--config', 'mcp_servers.node_repl.env.SKY_CUA_SERVICE_PATH=""',
    '--config', 'mcp_servers.node_repl.env.BROWSER_USE_TINYSKY_ENABLED="0"',
    '--config', 'mcp_servers.computer-use.enabled=false',
    '--config', 'mcp_servers.cua_repl.command="/usr/bin/true"',
    '--config', 'mcp_servers.cua_repl.args=[]',
    '--config', 'mcp_servers.cua_repl.enabled=false',
    '--config', 'plugins."computer-use@openai-bundled".enabled=false',
    '--config', 'plugins."unified-computer-use@openai-bundled".enabled=false',
    '--config', 'mcp_servers.personal_brain.tools."rss/workflow".approval_mode="auto"',
    '--config', 'mcp_servers.personal_brain.tools.rss_workflow.approval_mode="auto"',
    '--config', 'mcp_servers.personal_brain.tools."rss/ledger".approval_mode="auto"',
    '--config', 'mcp_servers.personal_brain.tools.rss_ledger.approval_mode="auto"',
    '--config', 'mcp_servers.personal_brain.tools."substack/workflow".approval_mode="auto"',
    '--config', 'mcp_servers.personal_brain.tools.substack_workflow.approval_mode="auto"',
    '--config', 'mcp_servers.personal_brain.tools."substack/ledger".approval_mode="auto"',
    '--config', 'mcp_servers.personal_brain.tools.substack_ledger.approval_mode="auto"',
    '--config', 'mcp_servers.personal_brain.tools."events/listeners".approval_mode="auto"',
    '--config', 'mcp_servers.personal_brain.tools."events/subscriptions".approval_mode="auto"',
    '--config', 'mcp_servers.personal_brain.tools."events/inbox".approval_mode="auto"',
    '--config', 'mcp_servers.personal_brain.tools."domains/list".approval_mode="auto"',
    '--config', 'mcp_servers.personal_brain.tools.capture_article.approval_mode="auto"',
    '--config', 'mcp_servers.personal_brain.tools.create_raw_file_with_page.approval_mode="auto"',
    '--config', 'mcp_servers.personal_brain.tools.create_page.approval_mode="auto"',
    '--config', 'mcp_servers.personal_brain.tools.create_raw_file.approval_mode="auto"',
    '--config', 'mcp_servers.personal_brain.tools."events/provenance".approval_mode="auto"',
  ]);
});

test('background executor environment removes inherited native computer-use surfaces', () => {
  const env = buildBackgroundCodexEnv({
    CUA_REPL_ENABLED_SURFACES: 'browser,computer',
    BROWSER_USE_TINYSKY_ENABLED: '1',
    NODE_REPL_JS_BANNER: 'await import("@oai/cua/tinyskyAlt")',
    NODE_REPL_TOOL_OVERRIDES: '{"tools":{"js":{}}}',
    NODE_REPL_UNTRUSTED_ENV_ALLOWLIST: 'CUA_REPL_ENABLED_SURFACES',
    NODE_REPL_INSTRUCTIONS_USE_CASE_COMPUTER_USE: 'Control desktop apps',
    NODE_REPL_TRUSTED_SERVICES: '{"browser":"x","sky":"y"}',
    SKY_CUA_SERVICE_PATH: '/tmp/Codex Computer Use.app',
  });
  assert.equal(env.CUA_REPL_ENABLED_SURFACES, 'browser');
  assert.equal(env.BROWSER_USE_TINYSKY_ENABLED, '0');
  assert.equal(env.NODE_REPL_INSTRUCTIONS_USE_CASE_COMPUTER_USE, '');
  assert.equal(env.NODE_REPL_TRUSTED_SERVICES, '{"browser":"@oai/browser-desktop/service"}');
  assert.equal(env.SKY_CUA_SERVICE_PATH, '');
  for (const key of ['NODE_REPL_JS_BANNER', 'NODE_REPL_TOOL_OVERRIDES', 'NODE_REPL_UNTRUSTED_ENV_ALLOWLIST']) assert.equal(env[key], undefined);
});

test('background app-server auto-approves only source and Brain MCP approval requests', () => {
  const writes = [];
  const client = new AppServerJsonRpcClient({ autoApprovedMcpServers: new Set(['personal_brain', 'granola']) });
  client.process = { stdin: { write: (value) => writes.push(value) } };
  const approvalMessage = JSON.stringify({
    method: 'mcpServer/elicitation/request',
    id: 7,
    params: { serverName: 'personal_brain', _meta: { codex_approval_kind: 'mcp_tool_call' } },
  });
  client.handleData(`${approvalMessage}\n`);
  assert.deepEqual(JSON.parse(writes[0]), { jsonrpc: '2.0', id: 7, result: { action: 'accept' } });
  assert.equal(client.respondToBackgroundMcpApproval({
    method: 'mcpServer/elicitation/request',
    id: 8,
    params: { serverName: 'whatsapp', _meta: { codex_approval_kind: 'mcp_tool_call' } },
  }), false);
  assert.equal(client.respondToBackgroundMcpApproval({
    method: 'mcpServer/elicitation/request',
    id: 9,
    params: { serverName: 'personal_brain', _meta: { codex_approval_kind: 'other' } },
  }), false);
  assert.equal(writes.length, 1);
});

test('app-thread executor closes an active client when the executor is shut down', async () => {
  let closeCalls = 0;
  let release;
  const waiting = new Promise((resolve) => { release = resolve; });
  const executor = new CodexAppThreadExecutor({ clientFactory: async () => ({
    notifications: [],
    request: async (method) => method === 'initialize' ? {} : method === 'thread/start' ? { thread: { id: 'thread-shutdown' } } : method === 'turn/start' ? waiting : {},
    close: async () => { closeCalls += 1; release(); },
  }) });
  const running = executor.execute({ event, listener: { description: 'Calendar' } });
  await new Promise((resolve) => setImmediate(resolve));
  await executor.close();
  await running;
  assert.ok(closeCalls >= 1);
});
