#!/usr/bin/env node

import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';

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

process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);

function parseArgs(argv) {
  const parsed = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--help' || arg === '-h') parsed.help = true;
    else if (arg === '--with-page') parsed.withPage = true;
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
  node scripts/prepare-raw-upload.mjs --file ./deck.pptx --raw-path sources/.raw/deck/deck.pptx

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

The helper does not upload by itself. Pipe or paste the generated "arguments"
object into an authenticated MCP call to create_raw_file or create_raw_file_with_page.
`);
}
