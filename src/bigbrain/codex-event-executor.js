import { spawn } from 'node:child_process';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export const DEFAULT_CODEX_EVENT_CWD = process.env.BIGBRAIN_CODEX_EVENT_CWD || process.cwd();
export const DEFAULT_CODEX_TIMEOUT_MS = 60 * 60 * 1000;

function configuredCodexTimeout(env = process.env) {
  const value = Number(env?.BIGBRAIN_CODEX_TIMEOUT_MS);
  return Number.isFinite(value) && value > 0 ? value : DEFAULT_CODEX_TIMEOUT_MS;
}

export function resolveThreadTitle(event, listener) {
  const configuredTitle = cleanThreadTitle(listener?.codex_thread_title || listener?.chat_title || listener?.thread_title);
  if (configuredTitle) return configuredTitle;
  const payloadTitle = cleanThreadTitle(event?.payload?.title);
  if (payloadTitle) return payloadTitle;
  if (listener?.provider === 'granola' || event?.type === 'granola.meeting.completed') return 'Granola meeting ingestion';
  const source = cleanThreadTitle(listener?.display_name || event?.source?.display_name || listener?.provider || 'Inbound source');
  return source ? `${source} ingestion` : 'Inbound event ingestion';
}

function cleanThreadTitle(value) {
  return typeof value === 'string' && value.trim() ? value.trim().slice(0, 160) : null;
}

export function buildEventPrompt(event, listener, { allowedDestinations = [] } = {}) {
  const sourceDescription = listener?.description || event?.source?.description || 'No source-specific guidance was provided.';
  const isRssArticle = listener?.type === 'rss' || event?.type === 'rss.item';
  const isGranolaMeeting = listener?.provider === 'granola' || event?.type === 'granola.meeting.completed';
  const skill = listener?.skill || defaultSkillForEvent(event, listener);
  const payload = selectPromptPayload(event?.payload, listener, event);
  if (isGranolaMeeting) {
    return `Ingest the Granola meeting with ID ${payload?.granola_id || '(missing ID)'} using $${skill.replace(/^\$/, '')}.`;
  }
  if (isRssArticle) {
    return [
      'Run the BigBrain source-article workflow for this article.',
      `Use the $${skill.replace(/^\$/, '')} skill as the primary workflow.`,
      'First decide whether the article clears the digest-value gate. Filing is optional: choose ignored, source_only, source_and_update, or needs_review as appropriate. Do not create a raw artifact or Brain page unless it clears the gate, and briefly tell me what you decided and did when finished.',
      '',
      `Title: ${payload?.title || 'Untitled article'}`,
      `URL: ${payload?.link || payload?.url || 'No URL supplied'}`,
    ].join('\n');
  }
  const sourceDocument = promptSourceDocument(event?.metadata?.source_document);
  const destinations = allowedDestinations.length
    ? allowedDestinations.map((brain) => `${brain.id || brain.brain_id}: ${brain.name || brain.brain_name || 'unnamed brain'}`).join(', ')
    : (event?.allowed_brain_ids || []).join(', ');
  return [
    isRssArticle
      ? 'Ingest this new article into BigBrain as if the user had opened a normal Codex chat and asked you to ingest it.'
      : `${eventInstruction(event, listener)}.`,
    '',
    skill ? `Use the $${skill.replace(/^\$/, '')} skill as the primary workflow.` : 'Use the narrowest matching BigBrain ingest skill as the primary workflow.',
    'Use the available BigBrain tools and the normal Codex environment to complete the work directly.',
    'Read filing rules before writing, search for existing coverage, file by primary subject, update canonical pages when warranted, and read back your changes.',
    listener?.provider === 'granola'
      ? 'Use the Granola MCP to retrieve the complete note before filing. Use payload.granola_id as the authoritative provider note ID; use the title only as a cross-check when it is present. Try the provider ID first. If the Granola MCP rejects the note ID because it requires a UUID, list meetings in a narrow time window around payload.occurred_at, select only one unambiguous match, and use that meeting UUID with the detail tool. If there is no match or more than one plausible match, stop and report the ambiguity rather than guessing.'
      : null,
    'Complete the ingestion directly, then give a concise normal-language summary of what you did. Do not return a machine-readable schema or JSON.',
    '',
    'Source guidance:',
    sourceDescription,
    '',
    'Task constraints:',
    '- Decide whether this event contains useful knowledge before any write. Filing is optional; ignore it when it does not clear the digest-value gate.',
    destinations ? `- Use the normal Brain environment; the event scope is ${destinations}.` : null,
    '- Do not invent credentials, paths, facts, or source provenance.',
    '- Every Git-backed BigBrain MCP write must include a short, single-line commit_message describing what changed and why, plus provenance metadata with the correct source_type and source_label.',
    '- Use assistant_chat only for a user message sent through this assistant harness; use direct_edit for file or Git-provider changes made outside MCP; use unknown only when the source truly cannot be established.',
    '- Do not send messages or reply externally. Only perform source-side cleanup when the selected skill explicitly authorizes that exact cleanup.',
    '',
    `Source: ${listener?.display_name || event?.source?.display_name || 'Inbound source'}`,
    `Event type: ${event?.type || 'inbound.event'}`,
    event?.occurred_at ? `Occurred at: ${event.occurred_at}` : null,
    '',
    'Payload:',
    JSON.stringify(payload, null, 2),
    sourceDocument ? ['', 'Source retrieval status:', JSON.stringify(sourceDocument, null, 2)] : null,
  ].filter((line) => line !== null).join('\n');
}

function promptSourceDocument(value) {
  if (!value || typeof value !== 'object') return null;
  const { raw_body: _rawBody, text: _text, ...prompt } = value;
  return prompt;
}

export function selectPromptPayload(payload, listener = {}, event = {}) {
  const fields = Array.isArray(listener?.prompt_payload_fields) ? listener.prompt_payload_fields : [];
  const defaultOmit = listener?.type === 'rss' ? ['raw'] : [];
  const omit = [...new Set([...defaultOmit, ...(listener?.prompt_omit_fields || [])])];
  const selected = fields.length ? pickFields(payload, fields) : clonePromptValue(payload);
  for (const field of omit) deletePath(selected, field);
  return selected;
}

function pickFields(payload, fields) {
  const result = {};
  for (const field of fields) {
    const value = readPath(payload, field);
    if (value !== undefined) writePath(result, field, clonePromptValue(value));
  }
  return result;
}

function readPath(value, path) {
  return String(path || '').split('.').filter(Boolean).reduce((current, key) => current == null ? undefined : current[key], value);
}

function writePath(target, path, value) {
  const keys = String(path || '').split('.').filter(Boolean);
  if (!keys.length) return;
  let cursor = target;
  for (const key of keys.slice(0, -1)) cursor = cursor[key] ||= {};
  cursor[keys.at(-1)] = value;
}

function deletePath(target, path) {
  const keys = String(path || '').split('.').filter(Boolean);
  if (!keys.length || !target || typeof target !== 'object') return;
  let cursor = target;
  for (const key of keys.slice(0, -1)) {
    cursor = cursor[key];
    if (!cursor || typeof cursor !== 'object') return;
  }
  delete cursor[keys.at(-1)];
}

function clonePromptValue(value) {
  if (value === undefined) return null;
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map(clonePromptValue);
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, clonePromptValue(item)]));
}

function defaultSkillForEvent(event, listener) {
  if (listener?.provider === 'granola' || event?.type === 'granola.meeting.completed') return 'bigbrain-granola-ingest';
  if (listener?.provider === 'email' || event?.type?.startsWith('email.')) return 'bigbrain-email-ingest';
  if (listener?.type === 'rss' || event?.type === 'rss.item') return 'bigbrain-source-article-ingest';
  return 'bigbrain-ingest';
}

function eventInstruction(event, listener) {
  if (listener?.provider === 'granola' || event?.type === 'granola.meeting.completed') return 'Retrieve the completed Granola note by ID through the Granola MCP, then ingest the generated note into BigBrain';
  if (listener?.provider === 'email' || event?.type?.startsWith('email.')) return 'Ingest this email update into BigBrain';
  if (listener?.provider === 'calendar' || event?.type?.startsWith('calendar.')) return 'Ingest this calendar update into BigBrain';
  if (listener?.type === 'rss' || event?.type === 'rss.item') return 'Ingest this RSS item into BigBrain if it contains durable value';
  return 'Ingest this inbound update into BigBrain';
}

export class CodexCliExecutor {
  constructor({ command = process.env.BIGBRAIN_CODEX_COMMAND || 'codex', cwd = DEFAULT_CODEX_EVENT_CWD, execFileImpl = execFileAsync, timeoutMs = 300_000, env = process.env } = {}) {
    this.command = command;
    this.cwd = cwd;
    this.execFileImpl = execFileImpl;
    this.timeoutMs = timeoutMs;
    this.env = env;
  }

  async execute({ event, listener, allowedDestinations = [] } = {}) {
    const prompt = buildEventPrompt(event, listener, { allowedDestinations });
    const executionId = `cli-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    let stdout = '';
    let stderr = '';
    try {
      ({ stdout, stderr } = await this.execFileImpl(this.command, ['exec', '--json', '--skip-git-repo-check', prompt], {
        cwd: this.cwd,
        env: this.env,
        timeout: this.timeoutMs,
        maxBuffer: 20 * 1024 * 1024,
      }));
    } catch (error) {
      const failure = error instanceof Error ? error : new Error(String(error));
      failure.execution_id = executionId;
      failure.execution_meta = {
        mode: 'cli',
        exit_status: Number.isInteger(error.code) ? error.code : null,
        error_details: {
          code: error?.code || null,
          signal: error?.signal || null,
          stdout: String(error?.stdout || '').slice(-20_000),
          stderr: String(error?.stderr || '').slice(-20_000),
        },
      };
      throw failure;
    }
    const parsed = parseCodexJsonOutput(stdout);
    return {
      mode: 'cli',
      execution_id: executionId,
      thread_id: parsed?.thread_id || parsed?.threadId || parseCodexThreadId(stdout),
      exit_status: 0,
      outcome: parsed ? normalizeCodexOutcome(parsed, { defaultBrainId: resolveDefaultBrainId(event, allowedDestinations) }) : null,
      response_text: extractCodexResponseText(stdout),
      stdout: String(stdout || '').slice(-200_000),
      stderr: String(stderr || '').slice(-50_000),
    };
  }
}

export class CodexAppThreadExecutor {
  constructor({ command = process.env.BIGBRAIN_CODEX_COMMAND || 'codex', args = null, cwd = DEFAULT_CODEX_EVENT_CWD, spawnImpl = spawn, timeoutMs = configuredCodexTimeout(), env = process.env, clientFactory = null } = {}) {
    this.command = command;
    this.args = args;
    this.cwd = cwd;
    this.spawnImpl = spawnImpl;
    this.timeoutMs = timeoutMs;
    this.env = env;
    this.clientFactory = clientFactory;
  }

  async execute({ event, listener, allowedDestinations = [] } = {}) {
    const prompt = buildEventPrompt(event, listener, { allowedDestinations });
    const client = this.clientFactory
      ? await this.clientFactory({ command: this.command, args: this.args, cwd: this.cwd, spawnImpl: this.spawnImpl, env: this.env })
      : new AppServerJsonRpcClient({
        command: this.command,
        args: this.args || ['app-server', '--stdio'],
        cwd: this.cwd,
        spawnImpl: this.spawnImpl,
        timeoutMs: this.timeoutMs,
        env: this.env,
    });
    try {
      await client.request('initialize', {
        clientInfo: { name: 'bigbrain-inbound-events', version: '2.0.0' },
        capabilities: { experimentalApi: true },
      });
      await client.notify?.('initialized');
      const started = await client.request('thread/start', {
        cwd: this.cwd,
        threadSource: 'user',
        ephemeral: false,
        environments: [],
        ...(listener?.codex_model ? { model: listener.codex_model } : {}),
        developerInstructions: listener?.type === 'rss' || event?.type === 'rss.item'
          ? 'Use the normal Codex environment and available BigBrain tools. Treat this as a regular user task.'
          : 'This is an event-triggered BigBrain ingestion task. Follow the turn instructions, use the available BigBrain MCP and the named BigBrain ingest skill, read filing rules before writes, check existing coverage, and read back changes. Do not send external messages. Complete the work directly and summarize it normally.',
      });
      const threadId = started?.thread?.id || started?.id || started?.threadId;
      if (!threadId) throw new Error('Codex app-server did not return a thread ID.');
      try {
        await client.request('thread/name/set', { threadId, name: resolveThreadTitle(event, listener) });
      } catch (error) {
        client.notifications.push({ type: 'thread_name_warning', text: String(error?.message || error) });
      }
      const turn = await client.request('turn/start', {
        threadId,
        ...(listener?.codex_model ? { model: listener.codex_model } : {}),
        ...(listener?.codex_reasoning_effort ? { effort: listener.codex_reasoning_effort } : {}),
        input: [{ type: 'text', text: prompt }],
      });
      const turnId = turn?.turn?.id || turn?.id || null;
      const completion = typeof client.waitForNotification === 'function'
        ? await client.waitForNotification((message) => message?.method === 'turn/completed' && (!turnId || message.params?.turn?.id === turnId), { timeoutMs: this.timeoutMs })
        : null;
      if (typeof client.waitForNotification === 'function') {
        try {
          await client.waitForNotification((message) => Boolean(findOutcome(message)), { timeoutMs: 2_000 });
        } catch {
          // Some app-server versions include the final agent message in turn/completed.
        }
      }
      const completedTurn = completion?.params?.turn || completion?.turn || null;
      if (completedTurn?.status === 'failed' || completion?.method === 'turn/failed') {
        const failure = new Error(completedTurn?.error?.message || 'Codex app-server turn failed.');
        failure.execution_id = turnId;
        failure.thread_id = threadId;
        failure.execution_meta = { mode: 'app_thread', exit_status: 1, error_details: { error: completedTurn?.error || null } };
        throw failure;
      }
      const parsed = extractOutcomeFromAppServer(completion || turn, client.notifications);
      const responseText = extractCodexResponseText(completion || turn, client.notifications);
      return {
        mode: 'app_thread',
        execution_id: turnId || `turn-${Date.now()}`,
        thread_id: threadId,
        exit_status: 0,
        outcome: parsed ? normalizeCodexOutcome(parsed, { defaultBrainId: resolveDefaultBrainId(event, allowedDestinations) }) : null,
        response_text: responseText,
        notifications: client.notifications.slice(-100),
      };
    } finally {
      await client.close?.();
    }
  }
}

export class AppServerJsonRpcClient {
  constructor({ command, args, cwd, spawnImpl = spawn, timeoutMs = configuredCodexTimeout(), env = process.env } = {}) {
    this.command = command;
    this.args = args;
    this.cwd = cwd;
    this.spawnImpl = spawnImpl;
    this.timeoutMs = timeoutMs;
    this.env = env;
    this.nextId = 1;
    this.pending = new Map();
    this.notifications = [];
    this.waiters = [];
    this.process = null;
    this.buffer = '';
  }

  async start() {
    if (this.process) return;
    this.process = this.spawnImpl(this.command, this.args, { cwd: this.cwd, env: this.env, stdio: ['pipe', 'pipe', 'pipe'] });
    this.process.stdout?.on('data', (chunk) => this.handleData(chunk));
    this.process.stderr?.on('data', (chunk) => this.notifications.push({ type: 'stderr', text: String(chunk).slice(-10_000) }));
    this.process.on('error', (error) => this.rejectPending(error));
    this.process.on('exit', (code, signal) => {
      if (this.pending.size || this.waiters.length) {
        this.rejectPending(new Error(`Codex app-server exited before completing the request (${code ?? signal ?? 'unknown'}).`));
      }
    });
  }

  async request(method, params = {}) {
    await this.start();
    const id = this.nextId++;
    const message = JSON.stringify({ jsonrpc: '2.0', id, method, params });
    const promise = new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Timed out waiting for Codex app-server method ${method}.`));
      }, this.timeoutMs);
      timer.unref?.();
      this.pending.set(id, { resolve, reject, timer });
    });
    this.process.stdin.write(`${message}\n`);
    return promise;
  }

  async notify(method, params = {}) {
    await this.start();
    const message = { jsonrpc: '2.0', method };
    if (params && Object.keys(params).length) message.params = params;
    this.process.stdin.write(`${JSON.stringify(message)}\n`);
  }

  handleData(chunk) {
    this.buffer += String(chunk);
    const lines = this.buffer.split(/\r?\n/);
    this.buffer = lines.pop() || '';
    for (const line of lines) {
      if (!line.trim()) continue;
      let message;
      try { message = JSON.parse(line); } catch { continue; }
      if (message.id === undefined) {
        this.notifications.push(message);
        this.resolveWaiters(message);
        continue;
      }
      const pending = this.pending.get(message.id);
      if (!pending) continue;
      this.pending.delete(message.id);
      clearTimeout(pending.timer);
      if (message.error) pending.reject(new Error(message.error.message || `Codex app-server ${message.error.code || 'error'}`));
      else pending.resolve(message.result);
    }
  }

  rejectPending(error) {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.pending.clear();
    for (const waiter of this.waiters.splice(0)) {
      clearTimeout(waiter.timer);
      waiter.reject(error);
    }
  }

  waitForNotification(predicate, { timeoutMs = this.timeoutMs } = {}) {
    const existing = this.notifications.find((message) => predicate(message));
    if (existing) return Promise.resolve(existing);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.waiters = this.waiters.filter((waiter) => waiter.resolve !== resolve);
        reject(new Error('Timed out waiting for Codex app-server completion notification.'));
      }, timeoutMs);
      timer.unref?.();
      this.waiters.push({ predicate, resolve, reject, timer });
    });
  }

  resolveWaiters(message) {
    for (const waiter of this.waiters.splice(0)) {
      if (!waiter.predicate(message)) {
        this.waiters.push(waiter);
        continue;
      }
      clearTimeout(waiter.timer);
      waiter.resolve(message);
      break;
    }
  }

  async close() {
    if (!this.process) return;
    this.rejectPending(new Error('Codex app-server client closed.'));
    this.process.kill?.();
    this.process = null;
  }
}

export function normalizeCodexOutcome(value, { defaultBrainId = null } = {}) {
  if (!value || typeof value !== 'object') return { status: 'needs_review', reason: 'Codex returned no structured filing outcome.', destinations: [] };
  const status = ['filed', 'ignored', 'needs_review'].includes(value.status) ? value.status : 'needs_review';
  return {
    status,
    capture_mode: ['none', 'summary', 'full'].includes(value.capture_mode) ? value.capture_mode : 'summary',
    reason: String(value.reason || ''),
    destinations: Array.isArray(value.destinations) ? value.destinations.map((destination) => normalizeCodexDestination(destination, { defaultBrainId })) : [],
  };
}

function resolveDefaultBrainId(event, allowedDestinations) {
  if (allowedDestinations.length === 1) {
    const id = allowedDestinations[0]?.id || allowedDestinations[0]?.brain_id;
    if (id) return id;
  }
  const eventBrainIds = Array.isArray(event?.allowed_brain_ids) ? event.allowed_brain_ids.filter(Boolean) : [];
  return eventBrainIds.length === 1 ? eventBrainIds[0] : null;
}

function normalizeCodexDestination(destination, { defaultBrainId = null } = {}) {
  const parsedWrites = parseJsonText(destination?.writes_json || destination?.writes);
  const writes = Array.isArray(destination?.writes)
    ? destination.writes
    : Array.isArray(parsedWrites)
      ? parsedWrites
      : destination?.operation || destination?.tool
        ? [{
          tool: destination.operation || destination.tool,
          commit_message: destination.commit_message,
          arguments: Object.fromEntries(Object.entries(destination).filter(([key]) => !['brain_id', 'operation', 'tool', 'commit_message', 'writes', 'writes_json'].includes(key))),
        }]
        : [];
  return { ...destination, ...(destination?.brain_id || !defaultBrainId ? {} : { brain_id: defaultBrainId }), writes };
}

export function parseCodexJsonOutput(stdout) {
  const lines = String(stdout || '').split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    try {
      const value = JSON.parse(lines[index]);
      if (value?.status || value?.destinations) return value.result || value.outcome || value;
      if (value?.result && typeof value.result === 'object') return value.result;
      if (value?.outcome && typeof value.outcome === 'object') return value.outcome;
      const agentText = value?.item?.type === 'agent_message' ? value.item.text || value.item.content : null;
      if (typeof agentText === 'string') {
        const parsed = parseJsonText(agentText);
        if (parsed) return parsed;
      }
      if (typeof value?.text === 'string') {
        const parsed = parseJsonText(value.text);
        if (parsed) return parsed;
      }
    } catch {
      // Codex may emit progress lines around the final JSON result.
    }
  }
  return null;
}

export function parseCodexThreadId(stdout) {
  const lines = String(stdout || '').split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  for (const line of lines) {
    try {
      const value = JSON.parse(line);
      const threadId = value?.thread_id || value?.threadId || value?.thread?.id;
      if (threadId) return threadId;
    } catch {
      // Ignore non-JSON progress output.
    }
  }
  return null;
}

function parseJsonText(value) {
  const candidates = [String(value).trim(), String(value).trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '')];
  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate);
      if (parsed && typeof parsed === 'object') return parsed.result || parsed.outcome || parsed;
    } catch {
      // Agent messages may contain a short explanation around the JSON.
    }
  }
  return null;
}

function extractOutcomeFromAppServer(turn, notifications = []) {
  return [...notifications, turn].reverse().map(findOutcome).find(Boolean) || null;
}

function extractCodexResponseText(value, notifications = []) {
  const values = typeof value === 'string'
    ? String(value).split(/\r?\n/).map((line) => {
      try { return JSON.parse(line); } catch { return line; }
    })
    : [value];
  const text = [...notifications, ...values].reverse().map(findAgentMessageText).find(Boolean);
  if (text) return text.slice(-20_000);
  if (typeof value === 'string') return value.trim().slice(-20_000) || null;
  return null;
}

function findAgentMessageText(value, depth = 0) {
  if (depth > 10 || value === null || value === undefined) return null;
  if (Array.isArray(value)) {
    for (const item of [...value].reverse()) {
      const text = findAgentMessageText(item, depth + 1);
      if (text) return text;
    }
    return null;
  }
  if (typeof value !== 'object') return null;
  const type = String(value.type || '').toLowerCase();
  if (['agentmessage', 'agent_message', 'assistantmessage', 'assistant_message'].includes(type)) {
    const text = typeof value.text === 'string'
      ? value.text
      : Array.isArray(value.content) ? value.content.map((part) => part?.text || '').join('') : null;
    if (text?.trim()) return text.trim();
  }
  for (const key of ['item', 'content', 'messages', 'output', 'result', 'params', 'turn']) {
    const text = findAgentMessageText(value[key], depth + 1);
    if (text) return text;
  }
  return null;
}

function findOutcome(value, depth = 0) {
  if (depth > 8 || value === null || value === undefined) return null;
  if (typeof value === 'string') return parseJsonText(value);
  if (Array.isArray(value)) {
    for (const item of [...value].reverse()) {
      const parsed = findOutcome(item, depth + 1);
      if (parsed) return parsed;
    }
    return null;
  }
  if (typeof value !== 'object') return null;
  if (typeof value.status === 'string' && (value.destinations !== undefined || value.reason !== undefined)) return value.result || value.outcome || value;
  for (const key of ['outcome', 'result', 'output', 'text', 'item', 'content', 'params', 'turn']) {
    const parsed = findOutcome(value[key], depth + 1);
    if (parsed) return parsed;
  }
  return null;
}
