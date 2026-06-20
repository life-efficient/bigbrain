#!/usr/bin/env node

import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';

const args = parseArgs(process.argv.slice(2));

if (args.help || !args.file || !args.rawPath) {
  printUsage();
  process.exit(args.help ? 0 : 1);
}

const filePath = path.resolve(args.file);
const bytes = await fs.readFile(filePath);
const base64 = bytes.toString('base64');
const sha256 = crypto.createHash('sha256').update(bytes).digest('hex');
const mimeType = args.mimeType || inferMimeType(filePath);

const toolArguments = {
  raw_content_base64: base64,
  mime_type: mimeType,
};

if (args.withPage) {
  Object.assign(toolArguments, {
    raw_path: args.rawPath,
    page_path: requireArg(args.pagePath, '--page-path is required with --with-page'),
    title: requireArg(args.title, '--title is required with --with-page'),
    body: requireArg(args.body, '--body is required with --with-page'),
    timeline_entry: requireArg(args.timelineEntry, '--timeline-entry is required with --with-page'),
  });
  if (args.frontmatter) toolArguments.frontmatter = JSON.parse(args.frontmatter);
} else {
  toolArguments.path = args.rawPath;
}

const output = {
  tool: args.withPage ? 'create_raw_file_with_page' : 'create_raw_file',
  arguments: toolArguments,
  verification: {
    source_file: filePath,
    raw_path: args.rawPath,
    decoded_size_bytes: bytes.length,
    sha256,
  },
};

if (args.call) {
  const credential = readCodexMcpCredential(args.mcpName, args.keychainAccount);
  await initializeMcp(credential);
  const upload = await callMcpTool(credential, output.tool, output.arguments);
  const listed = await callMcpTool(credential, 'list_raw_files', {
    path: path.posix.dirname(args.rawPath),
    recursive: true,
    limit: 100,
    order_by: 'alphanumeric',
  });
  const readBack = await callMcpTool(credential, 'read_raw_file', { path: args.rawPath });
  const readBackBytes = Buffer.from(readBack.structuredContent.content_base64, 'base64');
  const readBackSha256 = crypto.createHash('sha256').update(readBackBytes).digest('hex');
  const verified = readBackBytes.length === bytes.length && readBackSha256 === sha256;

  process.stdout.write(`${JSON.stringify({
    uploaded: verified,
    tool: output.tool,
    raw_path: args.rawPath,
    upload: upload.structuredContent,
    listed: listed.structuredContent,
    verification: {
      ...output.verification,
      read_back_size_bytes: readBackBytes.length,
      read_back_sha256: readBackSha256,
      verified,
    },
  }, null, 2)}\n`);
} else {
  process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
}

function parseArgs(argv) {
  const parsed = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--help' || arg === '-h') parsed.help = true;
    else if (arg === '--with-page') parsed.withPage = true;
    else if (arg === '--call') parsed.call = true;
    else if (arg === '--mcp-name') parsed.mcpName = argv[++i];
    else if (arg === '--keychain-account') parsed.keychainAccount = argv[++i];
    else if (arg === '--file') parsed.file = argv[++i];
    else if (arg === '--raw-path') parsed.rawPath = argv[++i];
    else if (arg === '--mime-type') parsed.mimeType = argv[++i];
    else if (arg === '--page-path') parsed.pagePath = argv[++i];
    else if (arg === '--title') parsed.title = argv[++i];
    else if (arg === '--body') parsed.body = argv[++i];
    else if (arg === '--timeline-entry') parsed.timelineEntry = argv[++i];
    else if (arg === '--frontmatter-json') parsed.frontmatter = argv[++i];
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return parsed;
}

function readCodexMcpCredential(mcpName, keychainAccount) {
  const account = keychainAccount || findCodexMcpKeychainAccount(mcpName);
  if (!account) {
    throw new Error('Use --mcp-name <name> or --keychain-account <account> with --call.');
  }
  const raw = execFileSync('security', ['find-generic-password', '-a', account, '-w'], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
  const credential = JSON.parse(raw);
  const accessToken = credential?.token_response?.access_token;
  if (!credential.url || !accessToken) {
    throw new Error(`Codex MCP credential ${account} is missing url or access_token.`);
  }
  return { url: credential.url, accessToken };
}

function findCodexMcpKeychainAccount(mcpName) {
  if (!mcpName) return null;
  const dump = execFileSync('security', ['dump-keychain'], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const escapedName = escapeRegExp(`${mcpName}|`);
  const match = dump.match(new RegExp(`"acct"<blob>="(${escapedName}[^"]+)"[\\s\\S]{0,800}?"svce"<blob>="Codex MCP Credentials"`))
    || dump.match(new RegExp(`"svce"<blob>="Codex MCP Credentials"[\\s\\S]{0,800}?"acct"<blob>="(${escapedName}[^"]+)"`));
  if (!match) throw new Error(`No Codex MCP keychain credential found for ${mcpName}. Run: codex mcp login ${mcpName}`);
  return match[1];
}

async function initializeMcp(credential) {
  await postMcp(credential, {
    jsonrpc: '2.0',
    id: 1,
    method: 'initialize',
    params: {
      protocolVersion: '2025-03-26',
      capabilities: {},
      clientInfo: { name: 'bigbrain-raw-uploader', version: '0.1.0' },
    },
  });
}

async function callMcpTool(credential, name, toolArgs) {
  const payload = await postMcp(credential, {
    jsonrpc: '2.0',
    id: Date.now(),
    method: 'tools/call',
    params: { name, arguments: toolArgs },
  });
  if (payload.error) throw new Error(`${name} failed: ${payload.error.message || JSON.stringify(payload.error)}`);
  return payload.result;
}

async function postMcp(credential, body) {
  const response = await fetch(credential.url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
      authorization: `Bearer ${credential.accessToken}`,
    },
    body: JSON.stringify(body),
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`MCP HTTP ${response.status}: ${text}`);
  return parseMcpResponse(text);
}

function parseMcpResponse(text) {
  const trimmed = text.trim();
  if (trimmed.startsWith('{')) return JSON.parse(trimmed);
  const dataLines = trimmed
    .split(/\r?\n/)
    .filter((line) => line.startsWith('data:'))
    .map((line) => line.slice(5).trim())
    .filter(Boolean);
  if (!dataLines.length) throw new Error(`Unexpected MCP response: ${text.slice(0, 200)}`);
  return JSON.parse(dataLines.join('\n'));
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function requireArg(value, message) {
  if (!value) throw new Error(message);
  return value;
}

function inferMimeType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === '.pdf') return 'application/pdf';
  if (ext === '.pptx') return 'application/vnd.openxmlformats-officedocument.presentationml.presentation';
  if (ext === '.docx') return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
  if (ext === '.xlsx') return 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
  if (ext === '.png') return 'image/png';
  if (ext === '.jpg' || ext === '.jpeg') return 'image/jpeg';
  if (ext === '.md') return 'text/markdown';
  if (ext === '.txt') return 'text/plain';
  return 'application/octet-stream';
}

function printUsage() {
  process.stderr.write(`Usage:
  node scripts/prepare-raw-upload.mjs --file ./evidence-deck.pptx --raw-path sources/.raw/evidence-deck/evidence-deck.pptx

Options:
  --file <path>              Local file to encode.
  --raw-path <path>          Destination .raw path in the brain.
  --mime-type <mime>         Optional MIME type; inferred from extension when omitted.
  --with-page                Prepare arguments for create_raw_file_with_page.
  --page-path <path>         Page path for --with-page.
  --title <title>            Page title for --with-page.
  --body <markdown>          Page body for --with-page.
  --timeline-entry <text>    Timeline entry for --with-page.
  --frontmatter-json <json>  Optional page frontmatter object for --with-page.
  --call                     Submit the upload through an authenticated MCP client.
  --mcp-name <name>          Codex MCP server name for --call, e.g. icaire.
  --keychain-account <acct>  Explicit Codex MCP keychain account for --call.

Without --call, the helper only prints the generated MCP arguments. With --call,
it reads the Codex MCP credential from the macOS keychain, uploads through MCP,
then verifies with list_raw_files and read_raw_file.
`);
}
