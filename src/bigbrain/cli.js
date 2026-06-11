import fs from 'node:fs/promises';
import path from 'node:path';

import { initializeBrainHome, loadConfig, loadState, persistState, resolveBrainHome } from './config.js';
import { openDatabase, getBacklinks, getOutgoingLinks, listPages } from './db.js';
import { startDashboard } from './dashboard.js';
import { runHealthCheck } from './health.js';
import { fullPathFromSlug } from './markdown.js';
import { migrateBrain } from './migrate.js';
import { listRecentFiles } from './recent.js';
import { renderSchemaMarkdown, recommendFolderForInput, schemaDescription } from './schema.js';
import { queryBrain, searchBrain } from './search.js';
import { syncBrain } from './sync.js';
import { runTaskRefresh } from './task-refresh.js';
import { resolveWindow } from './time.js';

export async function runCli(argv) {
  const { command, args, global } = parseGlobalArgs(argv);
  switch (command) {
    case 'init': return handleInit(args, global);
    case 'recent': return handleRecent(args, global);
    case 'sync': return handleSync(global);
    case 'list': return handleList(args, global);
    case 'get': return handleGet(args, global);
    case 'put': return handlePut(args, global);
    case 'search': return handleSearch(args, global);
    case 'query': return handleQuery(args, global);
    case 'links': return handleLinks(args, global);
    case 'backlinks': return handleBacklinks(args, global);
    case 'health': return handleHealth(global);
    case 'migrate': return handleMigrate(args, global);
    case 'schema': return handleSchema(global);
    case 'file': return handleFile(args, global);
    case 'refresh-tasks': return handleRefreshTasks(global);
    case 'dashboard': return handleDashboard(args, global);
    case '--help':
    case '-h':
    case undefined:
      printHelp();
      return;
    default:
      throw new Error(`Unknown command: ${command}`);
  }
}

async function handleInit(args, global) {
  const brainHome = args[0] ? path.resolve(args[0]) : global.brainHome || path.resolve(process.cwd(), 'bigbrain-home');
  const result = await initializeBrainHome(brainHome);
  output(global, result, `Initialized bigbrain home at ${result.brainHome}\nConfig: ${result.configPath}`);
}

async function handleRecent(args, global) {
  const config = await loadRuntimeConfig(global);
  const state = await loadState({ brainHome: config.brainHome }, { allowMissing: true });
  const window = resolveWindow({
    since: argValue(args, '--since'),
    until: argValue(args, '--until'),
    stateLastCheckedAt: state.lastCheckedAt,
    fallbackDuration: config.lookbackFallback,
  });
  const report = await listRecentFiles(config, window);
  output(global, report, renderRecentText(report));
}

async function handleSync(global) {
  const config = await loadRuntimeConfig(global);
  const result = await syncBrain({ config });
  await persistState(config.statePath, {
    last_checked_at: new Date().toISOString(),
    last_run_status: 'success',
    last_run_summary: `Index now has ${result.index_totals_after_sync.pages} page(s); ${result.outstanding_work.pages_needing_embeddings} page(s) need embeddings`,
    last_seen_files: [],
  });
  output(global, result, renderSyncText(result));
}

async function handleList(args, global) {
  const config = await loadRuntimeConfig(global);
  const db = await openDatabase(config);
  const rows = listPages(db, { type: argValue(args, '--type') || null });
  output(global, rows, rows.map((row) => `${row.slug}  ${row.title}`).join('\n'));
}

async function handleGet(args, global) {
  const slug = requireFirstArg(args, 'get requires <slug>.');
  const config = await loadRuntimeConfig(global);
  process.stdout.write(await fs.readFile(fullPathFromSlug(config.brainDir, slug), 'utf8'));
}

async function handlePut(args, global) {
  const slug = requireFirstArg(args, 'put requires <slug>.');
  const config = await loadRuntimeConfig(global);
  const content = await readStdin();
  if (!content.trim()) throw new Error('put reads markdown content from stdin.');
  const fullPath = fullPathFromSlug(config.brainDir, slug);
  await fs.mkdir(path.dirname(fullPath), { recursive: true });
  await fs.writeFile(fullPath, content.endsWith('\n') ? content : `${content}\n`, 'utf8');
  output(global, { slug, path: fullPath }, `Wrote ${slug}`);
}

async function handleSearch(args, global) {
  const query = args.join(' ').trim();
  if (!query) throw new Error('search requires a query string.');
  const config = await loadRuntimeConfig(global);
  const db = await openDatabase(config);
  const result = await searchBrain({ db, config, query });
  output(global, result, renderSearchText(result.fused));
}

async function handleQuery(args, global) {
  const question = args.join(' ').trim();
  if (!question) throw new Error('query requires a question.');
  const config = await loadRuntimeConfig(global);
  const db = await openDatabase(config);
  const result = await queryBrain({ db, config, question });
  output(global, result, result.answer ? `${result.answer}\n\nSources:\n${renderSearchText(result.search.fused)}` : `No OpenAI answer generated.\n\nRetrieved:\n${renderSearchText(result.search.fused)}`);
}

async function handleLinks(args, global) {
  const slug = requireFirstArg(args, 'links requires <slug>.');
  const config = await loadRuntimeConfig(global);
  const db = await openDatabase(config);
  const rows = getOutgoingLinks(db, slug);
  output(global, rows, rows.map((row) => `${slug} -> ${row.to_slug} (${row.link_kind})`).join('\n'));
}

async function handleBacklinks(args, global) {
  const slug = requireFirstArg(args, 'backlinks requires <slug>.');
  const config = await loadRuntimeConfig(global);
  const db = await openDatabase(config);
  const rows = getBacklinks(db, slug);
  output(global, rows, rows.map((row) => `${row.from_slug} -> ${slug} (${row.link_kind})`).join('\n'));
}

async function handleHealth(global) {
  const config = await loadRuntimeConfig(global);
  const report = await runHealthCheck(config);
  output(global, report, renderHealthText(report));
}

async function handleMigrate(args, global) {
  const sourceDir = requireFirstArg(args, 'migrate requires <source-dir>.');
  const config = await loadRuntimeConfig(global);
  const report = await migrateBrain({ sourceDir, config });
  output(global, report, `Copied ${report.copied_files.length} file(s), rewrote ${report.rewritten_links.length} link file(s).`);
}

async function handleSchema(global) {
  if (global.json) {
    console.log(JSON.stringify(schemaDescription(), null, 2));
    return;
  }
  process.stdout.write(renderSchemaMarkdown());
}

async function handleFile(args, global) {
  const input = args.join(' ').trim();
  if (!input) throw new Error('file requires a path or description.');
  const recommendation = recommendFolderForInput(input);
  output(global, recommendation, `File this at ${recommendation.relative_path} because ${recommendation.reason}.`);
}

async function handleRefreshTasks(global) {
  const config = await loadRuntimeConfig(global);
  const result = await runTaskRefresh({ configPath: config.configPath, statePath: config.statePath });
  output(global, result, result.summary);
}

async function handleDashboard(args, global) {
  const config = await loadRuntimeConfig(global);
  const port = Number(argValue(args, '--port') || config.dashboardPort);
  await startDashboard(config, { port });
  console.log(`Dashboard running at http://127.0.0.1:${port}`);
}

async function loadRuntimeConfig(global) {
  const brainHome = await resolveBrainHome({
    explicitBrainHome: global.brainHome,
    explicitConfigPath: global.configPath,
  });
  return loadConfig({ brainHome });
}

function parseGlobalArgs(argv) {
  const global = { brainHome: null, configPath: null, json: false };
  const args = [];
  let command;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!command && !arg.startsWith('--') && !arg.startsWith('-')) {
      command = arg;
      continue;
    }
    if (!command && (arg === '--help' || arg === '-h')) {
      command = '--help';
      continue;
    }
    switch (arg) {
      case '--brain-home':
        global.brainHome = path.resolve(argv[++index] ?? '');
        break;
      case '--config':
        global.configPath = path.resolve(argv[++index] ?? '');
        break;
      case '--json':
        global.json = true;
        break;
      default:
        args.push(arg);
        break;
    }
  }

  return { command, args, global };
}

function printHelp() {
  console.log(`Usage: bigbrain <command> [options]

Commands:
  init [brain-home]
  sync
  list [--type TYPE]
  get <slug>
  put <slug>           (reads markdown from stdin)
  search <query>
  query <question>
  links <slug>
  backlinks <slug>
  recent [--since 24h] [--until ISO]
  health
  migrate <source-dir>
  schema
  file <path-or-description>
  refresh-tasks
  dashboard [--port N]

Global options:
  --brain-home <path>
  --config <path>
  --json
`);
}

function output(global, jsonValue, textValue) {
  if (global.json) {
    console.log(JSON.stringify(jsonValue, null, 2));
    return;
  }
  console.log(textValue);
}

function renderSyncText(result) {
  return [
    `Sync succeeded. Index now has ${result.index_totals_after_sync.pages} page(s) and ${result.index_totals_after_sync.links} link(s).`,
    `Outstanding: ${result.outstanding_work.pages_needing_embeddings} page(s) need embeddings, ${result.outstanding_work.embedding_chunks_pending} embedding chunk(s) pending, ${result.outstanding_work.pages_with_embedding_failures} embedding failure(s).`,
    `This run: ${result.run_work.pages_embedded} page(s) embedded, ${result.run_work.embedding_chunks_created} embedding chunk(s) created.`,
  ].join('\n');
}

function renderRecentText(report) {
  if (report.files.length === 0) return `No markdown files changed between ${report.window_start} and ${report.window_end}.`;
  return report.files.map((file) => `${file.mtime}  ${file.category.padEnd(10)}  ${file.relative_path}`).join('\n');
}

function renderSearchText(rows) {
  if (!rows.length) return 'No results.';
  return rows.map((row) => `${row.slug}\n  ${row.snippet || row.summary || ''}`).join('\n');
}

function renderHealthText(report) {
  const lines = [`Pages: ${report.page_count}`, `Findings: ${report.finding_count}`];
  if (report.git_status) lines.push(`Git clean: ${report.git_status.clean}`);
  if (report.cli_status) lines.push(`CLI available anywhere: ${report.cli_status.available}`);
  for (const finding of report.findings.slice(0, 20)) {
    lines.push(`- ${finding.severity} ${finding.finding_type}${finding.page_slug ? ` on ${finding.page_slug}` : ''}${renderHealthFindingDetails(finding.details)}`);
  }
  return lines.join('\n');
}

function renderHealthFindingDetails(details) {
  if (!details || typeof details !== 'object') return '';
  if (Array.isArray(details.missing) && details.missing.length > 0) return `: missing ${details.missing.join(', ')}`;
  if (typeof details.message === 'string' && details.message) return `: ${details.message}`;
  if (typeof details.target_slug === 'string' && details.target_slug) return `: ${details.target_slug}`;
  return '';
}

function requireFirstArg(args, message) {
  if (!args[0]) throw new Error(message);
  return args[0];
}

function argValue(args, name) {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : null;
}

async function readStdin() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return Buffer.concat(chunks.map((chunk) => Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))).toString('utf8');
}
