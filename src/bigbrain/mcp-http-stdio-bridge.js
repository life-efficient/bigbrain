import fs from 'node:fs/promises';
import readline from 'node:readline';

const JSON_CONTENT_TYPE = 'application/json';
const SSE_CONTENT_TYPE = 'text/event-stream';

export async function readProtectedBearerToken(tokenPath, dependencies = {}) {
  const fileSystem = dependencies.fs || fs;
  const platform = dependencies.platform || process.platform;
  const currentUid = dependencies.uid ?? (typeof process.getuid === 'function' ? process.getuid() : null);
  const stat = await fileSystem.stat(tokenPath);
  if (!stat.isFile()) throw new Error('The MCP token path must identify a regular file.');
  if (platform !== 'win32' && (stat.mode & 0o077) !== 0) {
    throw new Error('The MCP token file must not be accessible by group or other users.');
  }
  if (platform !== 'win32' && currentUid !== null && stat.uid !== currentUid) {
    throw new Error('The MCP token file must be owned by the current user.');
  }
  const token = String(await fileSystem.readFile(tokenPath, 'utf8')).trim();
  if (!token) throw new Error('The MCP token file is empty.');
  if (/\r|\n/.test(token)) throw new Error('The MCP token file must contain exactly one token.');
  return token;
}

export class StdioHttpMcpBridge {
  constructor({ endpoint, tokenPath, input = process.stdin, output = process.stdout, fetchImpl = globalThis.fetch, tokenReader = readProtectedBearerToken }) {
    const url = new URL(endpoint);
    if (!['https:', 'http:'].includes(url.protocol)) throw new Error('The MCP endpoint must use HTTP or HTTPS.');
    if (url.protocol === 'http:' && !['localhost', '127.0.0.1', '::1'].includes(url.hostname)) {
      throw new Error('Remote MCP endpoints must use HTTPS.');
    }
    if (!tokenPath) throw new Error('An MCP token file is required.');
    if (typeof fetchImpl !== 'function') throw new Error('A Fetch implementation is required.');
    this.endpoint = url.toString();
    this.tokenPath = tokenPath;
    this.input = input;
    this.output = output;
    this.fetchImpl = fetchImpl;
    this.tokenReader = tokenReader;
    this.sessionId = null;
    this.protocolVersion = null;
    this.getController = null;
    this.getTask = null;
    this.closed = false;
    this.writeChain = Promise.resolve();
  }

  async run() {
    const lines = readline.createInterface({ input: this.input, crlfDelay: Infinity, terminal: false });
    for await (const line of lines) {
      if (!line.trim()) continue;
      let message;
      try {
        message = JSON.parse(line);
      } catch {
        await this.write({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } });
        continue;
      }
      if (message?.method === 'initialize') this.protocolVersion = message.params?.protocolVersion || null;
      await this.forward(message).catch(async (error) => {
        if (Object.hasOwn(message || {}, 'id')) {
          await this.write({ jsonrpc: '2.0', id: message.id, error: { code: -32000, message: safeErrorMessage(error) } });
        }
      });
    }
    await this.close();
  }

  async forward(message) {
    const response = await this.request('POST', JSON.stringify(message));
    this.captureSession(response);
    if (!response.ok) throw new Error(`Remote MCP request failed with HTTP ${response.status}.`);
    if (response.status === 202 || response.status === 204) return;
    await this.consumeResponse(response);
  }

  async request(method, body, signal) {
    // Read for every request so rotating the protected file takes effect without
    // restarting Codex or this bridge process.
    const token = await this.tokenReader(this.tokenPath);
    const headers = {
      accept: `${JSON_CONTENT_TYPE}, ${SSE_CONTENT_TYPE}`,
      authorization: `Bearer ${token}`,
    };
    if (body !== undefined) headers['content-type'] = JSON_CONTENT_TYPE;
    if (this.sessionId) headers['mcp-session-id'] = this.sessionId;
    if (this.protocolVersion) headers['mcp-protocol-version'] = this.protocolVersion;
    return this.fetchImpl(this.endpoint, { method, headers, body, signal });
  }

  captureSession(response) {
    const sessionId = response.headers.get('mcp-session-id');
    if (!sessionId || sessionId === this.sessionId) return;
    this.sessionId = sessionId;
    this.startServerEvents();
  }

  startServerEvents() {
    if (this.getTask || this.closed) return;
    this.getController = new AbortController();
    this.getTask = this.request('GET', undefined, this.getController.signal)
      .then(async (response) => {
        if (response.status === 405) return;
        if (!response.ok) throw new Error(`Remote MCP event stream failed with HTTP ${response.status}.`);
        await this.consumeResponse(response);
      })
      .catch((error) => {
        if (error?.name !== 'AbortError' && !this.closed) return null;
        return null;
      });
  }

  async consumeResponse(response) {
    const contentType = response.headers.get('content-type') || '';
    if (contentType.includes(SSE_CONTENT_TYPE)) {
      for await (const message of parseSseJson(response.body)) await this.write(message);
      return;
    }
    if (!contentType.includes(JSON_CONTENT_TYPE)) throw new Error('Remote MCP returned an unsupported content type.');
    const payload = await response.json();
    if (Array.isArray(payload)) {
      for (const message of payload) await this.write(message);
    } else {
      await this.write(payload);
    }
  }

  write(message) {
    this.writeChain = this.writeChain.then(() => new Promise((resolve, reject) => {
      const line = `${JSON.stringify(message)}\n`;
      this.output.write(line, (error) => error ? reject(error) : resolve());
    }));
    return this.writeChain;
  }

  async close() {
    if (this.closed) return;
    this.closed = true;
    this.getController?.abort();
    await this.getTask?.catch(() => null);
    if (this.sessionId) {
      await this.request('DELETE').catch(() => null);
    }
    await this.writeChain;
  }
}

export async function* parseSseJson(body) {
  if (!body) return;
  const decoder = new TextDecoder();
  let buffer = '';
  let data = [];
  for await (const chunk of body) {
    buffer += typeof chunk === 'string' ? chunk : decoder.decode(chunk, { stream: true });
    let newline;
    while ((newline = buffer.indexOf('\n')) !== -1) {
      let line = buffer.slice(0, newline);
      buffer = buffer.slice(newline + 1);
      if (line.endsWith('\r')) line = line.slice(0, -1);
      if (line === '') {
        if (data.length) yield parseSseData(data);
        data = [];
      } else if (line.startsWith('data:')) {
        data.push(line.slice(5).replace(/^ /, ''));
      }
    }
  }
  buffer += decoder.decode();
  if (buffer.startsWith('data:')) data.push(buffer.slice(5).replace(/^ /, '').replace(/\r$/, ''));
  if (data.length) yield parseSseData(data);
}

function parseSseData(lines) {
  try {
    return JSON.parse(lines.join('\n'));
  } catch {
    throw new Error('Remote MCP returned an invalid event payload.');
  }
}

function safeErrorMessage(error) {
  const message = String(error?.message || 'Remote MCP request failed.');
  if (/token|authorization|bearer/i.test(message)) return 'MCP authentication failed.';
  return message;
}
