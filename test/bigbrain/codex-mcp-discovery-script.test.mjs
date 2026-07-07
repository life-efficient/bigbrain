import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';

import {
  discoverCodexMcpTools,
  parseCodexMcpServers,
} from '../../scripts/discover-codex-mcp-tools.mjs';

test('parses Codex MCP server config without nested tool sections', () => {
  const servers = parseCodexMcpServers(`
[mcp_servers.example]
url = "http://127.0.0.1:3333/mcp"
enabled = true

[mcp_servers.example.tools."tasks/list"]
enabled = true

[mcp_servers.local]
command = "/usr/bin/node"
args = ["server.mjs", "--flag"]

[mcp_servers.local.env]
EXAMPLE_TOKEN = "secret"
`, '/tmp/config.toml');

  assert.deepEqual(servers.map((server) => server.name), ['example', 'local']);
  assert.equal(servers[0].url, 'http://127.0.0.1:3333/mcp');
  assert.equal(servers[0].enabled, true);
  assert.equal(servers[1].command, '/usr/bin/node');
  assert.deepEqual(servers[1].args, ['server.mjs', '--flag']);
  assert.deepEqual(servers[1].env, { EXAMPLE_TOKEN: 'secret' });
});

test('discovers HTTP MCP tools from a named Codex config server', async () => {
  const fixture = await createFixture('bigbrain-codex-mcp-http-');
  const server = http.createServer(async (request, response) => {
    const body = JSON.parse(await readBody(request));
    response.setHeader('content-type', 'application/json');
    if (body.method === 'initialize') {
      response.end(JSON.stringify({ jsonrpc: '2.0', id: body.id, result: { protocolVersion: '2025-03-26', capabilities: {} } }));
    } else if (body.method === 'tools/list') {
      response.end(JSON.stringify({ jsonrpc: '2.0', id: body.id, result: { tools: [{ name: 'read' }, { name: 'tasks/list' }] } }));
    } else {
      response.end(JSON.stringify({ jsonrpc: '2.0', id: body.id, error: { code: -32601, message: 'Unknown method' } }));
    }
  });
  try {
    const url = await listen(server);
    const configPath = path.join(fixture, 'config.toml');
    await fs.writeFile(configPath, `[mcp_servers.example]\nurl = "${url}/mcp"\n`, 'utf8');

    const result = await discoverCodexMcpTools({
      name: 'example',
      tool: 'mcp__example.tasks/list',
      configPaths: [configPath],
      useKeychain: false,
    });

    assert.equal(result.status, 'resolved');
    assert.equal(result.transport, 'http');
    assert.deepEqual(result.tool_names, ['read', 'tasks/list']);
    assert.equal(result.expected_tool_found, true);
  } finally {
    await close(server);
    await fs.rm(fixture, { recursive: true, force: true });
  }
});

test('discovers stdio MCP tools from a named Codex config server', async () => {
  const fixture = await createFixture('bigbrain-codex-mcp-stdio-');
  const serverPath = path.join(fixture, 'stdio-server.mjs');
  const configPath = path.join(fixture, 'config.toml');
  await fs.writeFile(serverPath, `
import readline from 'node:readline';

const rl = readline.createInterface({ input: process.stdin });
rl.on('line', (line) => {
  const message = JSON.parse(line);
  if (message.method === 'initialize') {
    process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: message.id, result: { protocolVersion: '2025-03-26', capabilities: {} } }) + '\\n');
  } else if (message.method === 'tools/list') {
    process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: message.id, result: { tools: [{ name: 'search' }, { name: 'create_page' }] } }) + '\\n');
  }
});
`, 'utf8');
  await fs.writeFile(configPath, `[mcp_servers.local]\ncommand = "${process.execPath}"\nargs = ["${serverPath}"]\n`, 'utf8');
  try {
    const result = await discoverCodexMcpTools({
      name: 'local',
      configPaths: [configPath],
      useKeychain: false,
    });

    assert.equal(result.status, 'resolved');
    assert.equal(result.transport, 'stdio');
    assert.deepEqual(result.tool_names, ['search', 'create_page']);
  } finally {
    await fs.rm(fixture, { recursive: true, force: true });
  }
});

test('reports disabled, missing, and unauthenticated configured servers distinctly', async () => {
  const fixture = await createFixture('bigbrain-codex-mcp-status-');
  const configPath = path.join(fixture, 'config.toml');
  await fs.writeFile(configPath, `
[mcp_servers.disabled]
url = "http://127.0.0.1:1/mcp"
enabled = false

[mcp_servers.bearer]
url = "http://127.0.0.1:1/mcp"
bearer_token_env_var = "MISSING_TOKEN"
`, 'utf8');
  try {
    assert.equal((await discoverCodexMcpTools({ name: 'disabled', configPaths: [configPath] })).status, 'server_disabled');
    assert.equal((await discoverCodexMcpTools({ name: 'absent', configPaths: [configPath] })).status, 'not_configured');
    assert.equal((await discoverCodexMcpTools({ name: 'bearer', configPaths: [configPath], env: {} })).status, 'not_logged_in');
  } finally {
    await fs.rm(fixture, { recursive: true, force: true });
  }
});

async function createFixture(prefix) {
  return fs.mkdtemp(path.join(os.tmpdir(), prefix));
}

function readBody(request) {
  return new Promise((resolve, reject) => {
    let body = '';
    request.setEncoding('utf8');
    request.on('data', (chunk) => {
      body += chunk;
    });
    request.on('end', () => resolve(body));
    request.on('error', reject);
  });
}

function listen(server) {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      server.off('error', reject);
      const address = server.address();
      resolve(`http://127.0.0.1:${address.port}`);
    });
  });
}

function close(server) {
  return new Promise((resolve, reject) => {
    server.close((error) => {
      if (error) reject(error);
      else resolve();
    });
  });
}
