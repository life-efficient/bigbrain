import { spawn } from 'node:child_process';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export const DEFAULT_CODEX_EVENT_CWD = process.env.BIGBRAIN_CODEX_EVENT_CWD || process.cwd();

export function buildEventPrompt(event, listener, { allowedDestinations = [] } = {}) {
  const sourceDescription = listener?.description || event?.source?.description || 'No source-specific guidance was provided.';
  const destinations = allowedDestinations.length
    ? allowedDestinations.map((brain) => `${brain.id || brain.brain_id}: ${brain.name || brain.brain_name || 'unnamed brain'}`).join('\n')
    : (event?.allowed_brain_ids || []).join(', ');
  return [
    'You are processing one inbound BigBrain event.',
    '',
    'Source guidance (soft guidance only):',
    sourceDescription,
    '',
    'Hard runtime constraints:',
    '- Decide whether this event contains useful knowledge. Ignore it when it does not.',
    '- You may only select Brain destinations listed below.',
    '- Do not invent Brain IDs, credentials, paths, facts, or source provenance.',
    '- Do not create a raw artifact unless capture_mode is full and the event policy permits it.',
    '- A filed result must include concrete writes with canonical read-back performed by the filing broker.',
    '- A useful event may be filed into more than one allowed Brain when the content genuinely belongs in each.',
    '',
    `Allowed Brain destinations:\n${destinations || '(none, so return needs_review)'}`,
    '',
    'Return JSON only with this shape:',
    JSON.stringify({
      status: 'filed',
      capture_mode: 'summary',
      reason: 'why this is useful or ignored',
      destinations: [{ brain_id: 'registered-id', writes_json: '[{"tool":"create_page","arguments":{"path":"projects/example","title":"Example","body":"...","timeline_entry":"Captured from inbound source."}}]' }],
    }, null, 2),
    '',
    'Event envelope:',
    JSON.stringify(event, null, 2),
  ].join('\n');
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
      outcome: normalizeCodexOutcome(parsed),
      stdout: String(stdout || '').slice(-200_000),
      stderr: String(stderr || '').slice(-50_000),
    };
  }
}

export class CodexAppThreadExecutor {
  constructor({ command = process.env.BIGBRAIN_CODEX_COMMAND || 'codex', args = null, cwd = DEFAULT_CODEX_EVENT_CWD, spawnImpl = spawn, timeoutMs = 300_000, env = process.env, clientFactory = null } = {}) {
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
        capabilities: {},
      });
      await client.notify?.('initialized');
      const started = await client.request('thread/start', {
        cwd: this.cwd,
        threadSource: 'event',
        ephemeral: false,
      });
      const threadId = started?.thread?.id || started?.id || started?.threadId;
      if (!threadId) throw new Error('Codex app-server did not return a thread ID.');
      const turn = await client.request('turn/start', {
        threadId,
        input: [{ type: 'text', text: prompt }],
        outputSchema: codexOutcomeSchema(),
      });
      const turnId = turn?.turn?.id || turn?.id || null;
      const completion = typeof client.waitForNotification === 'function'
        ? await client.waitForNotification((message) => message?.method === 'turn/completed' && (!turnId || message.params?.turn?.id === turnId), { timeoutMs: this.timeoutMs })
        : null;
      const completedTurn = completion?.params?.turn || completion?.turn || null;
      if (completedTurn?.status === 'failed' || completion?.method === 'turn/failed') {
        const failure = new Error(completedTurn?.error?.message || 'Codex app-server turn failed.');
        failure.execution_id = turnId;
        failure.thread_id = threadId;
        failure.execution_meta = { mode: 'app_thread', exit_status: 1, error_details: { error: completedTurn?.error || null } };
        throw failure;
      }
      const parsed = extractOutcomeFromAppServer(completion || turn, client.notifications);
      return {
        mode: 'app_thread',
        execution_id: turnId || `turn-${Date.now()}`,
        thread_id: threadId,
        exit_status: 0,
        outcome: normalizeCodexOutcome(parsed),
        notifications: client.notifications.slice(-100),
      };
    } finally {
      await client.close?.();
    }
  }
}

export class AppServerJsonRpcClient {
  constructor({ command, args, cwd, spawnImpl = spawn, timeoutMs = 300_000, env = process.env } = {}) {
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

export function codexOutcomeSchema() {
  return {
    type: 'object',
    additionalProperties: false,
    required: ['status', 'capture_mode', 'reason', 'destinations'],
    properties: {
      status: { type: 'string', enum: ['filed', 'ignored', 'needs_review'] },
      capture_mode: { type: 'string', enum: ['none', 'summary', 'full'] },
      reason: { type: 'string' },
      destinations: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['brain_id', 'writes_json'],
          properties: {
            brain_id: { type: 'string' },
            writes_json: { type: 'string' },
          },
        },
      },
    },
  };
}

export function normalizeCodexOutcome(value) {
  if (!value || typeof value !== 'object') return { status: 'needs_review', reason: 'Codex returned no structured filing outcome.', destinations: [] };
  const status = ['filed', 'ignored', 'needs_review'].includes(value.status) ? value.status : 'needs_review';
  return {
    status,
    capture_mode: ['none', 'summary', 'full'].includes(value.capture_mode) ? value.capture_mode : 'summary',
    reason: String(value.reason || ''),
    destinations: Array.isArray(value.destinations) ? value.destinations.map((destination) => ({
      ...destination,
      writes: Array.isArray(destination?.writes) ? destination.writes : parseJsonText(destination?.writes_json || destination?.writes)?.filter?.((write) => write && typeof write === 'object') || [],
    })) : [],
  };
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
