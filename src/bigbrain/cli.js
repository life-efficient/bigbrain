import fs from 'node:fs/promises';
import path from 'node:path';

import { initializeBrainHome, loadConfig, loadState, loadUserEnv, persistState, resolveBrainHome } from './config.js';
import { dbDoctor, openDatabase, getBacklinks, getOutgoingLinks, listPages } from './db.js';
import { runHealthCheck } from './health.js';
import { fullPathFromSlug } from './markdown.js';
import { ensureLocalOwnerMember, listMembers, upsertMember } from './members.js';
import { startMcpServer } from './mcp-server.js';
import { migrateBrain } from './migrate.js';
import { listRecentFiles } from './recent.js';
import { renderSchemaMarkdown, recommendFolderForInput, schemaDescription } from './schema.js';
import { queryBrain, searchBrain, searchModesReport } from './search.js';
import { syncBrain } from './sync.js';
import { resolveWindow } from './time.js';

export async function runCli(argv) {
  await loadUserEnv();
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
    case 'db': return handleDb(args, global);
    case 'schema': return handleSchema(global);
    case 'file': return handleFile(args, global);
    case 'tasks': return handleTasks(args, global);
    case 'members': return handleMembers(args, global);
    case 'eval': return handleEval(args, global);
    case 'dashboard': return handleDashboard(args, global);
    case 'mcp': return handleMcp(args, global);
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
  const rows = await listPages(db, { type: argValue(args, '--type') || null });
  await db.close?.();
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
  if (args[0] === 'modes') {
    const report = searchModesReport(argValue(args, '--mode') || undefined);
    output(global, report, renderSearchModesText(report));
    return;
  }
  const options = parseSearchArgs(args);
  const query = options.positionals.join(' ').trim();
  if (!query) throw new Error('search requires a query string.');
  const config = await loadRuntimeConfig(global);
  const db = await openDatabase(config);
  const result = await searchBrain({
    db,
    config,
    query,
    limit: options.limit,
    mode: options.mode,
    explain: options.explain,
  });
  await db.close?.();
  output(global, result, renderWarningText(result.warnings, renderSearchText(result.fused, options.explain)));
}

async function handleQuery(args, global) {
  const options = parseSearchArgs(args);
  const question = options.positionals.join(' ').trim();
  if (!question) throw new Error('query requires a question.');
  const config = await loadRuntimeConfig(global);
  const db = await openDatabase(config);
  const result = await queryBrain({
    db,
    config,
    question,
    limit: options.limit ?? 6,
    mode: options.mode,
    explain: options.explain,
    expand: options.expand,
  });
  await db.close?.();
  const text = result.answer
    ? `${result.answer}\n\nSources:\n${renderSearchText(result.search.fused, options.explain)}`
    : `No OpenAI answer generated.\n\nRetrieved:\n${renderSearchText(result.search.fused, options.explain)}`;
  output(global, result, renderWarningText(result.warnings, text));
}

async function handleLinks(args, global) {
  const slug = requireFirstArg(args, 'links requires <slug>.');
  const config = await loadRuntimeConfig(global);
  const db = await openDatabase(config);
  const rows = await getOutgoingLinks(db, slug);
  await db.close?.();
  output(global, rows, rows.map((row) => `${slug} -> ${row.to_slug} (${row.link_kind})`).join('\n'));
}

async function handleBacklinks(args, global) {
  const slug = requireFirstArg(args, 'backlinks requires <slug>.');
  const config = await loadRuntimeConfig(global);
  const db = await openDatabase(config);
  const rows = await getBacklinks(db, slug);
  await db.close?.();
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

async function handleDb(args, global) {
  const subcommand = args[0];
  if (subcommand === 'doctor') {
    const config = await loadRuntimeConfig(global);
    const report = await dbDoctor(config);
    output(global, report, report.ok
      ? `Database ok (${report.backend}). Pages: ${report.page_count}, embeddings: ${report.embedding_count}.`
      : `Database has issues (${report.backend}): ${report.warnings.join('; ')}`);
    return;
  }
  if (subcommand === 'migrate' && args[1] === 'sqlite-to-postgres') {
    const config = await loadRuntimeConfig(global);
    const { migrateSqliteToPostgres } = await import('./postgres-migrate.js');
    const report = await migrateSqliteToPostgres(config);
    output(global, report, `Migrated ${report.pages} page(s), ${report.links} link(s), and ${report.embeddings} embedding chunk(s) to Postgres.`);
    return;
  }
  throw new Error('db requires "doctor" or "migrate sqlite-to-postgres".');
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

async function handleTasks(args, global) {
  const config = await loadRuntimeConfig(global);
  const db = await openDatabase(config);
  const { buildTasksPayload } = await import('./dashboard.js');
  const url = new URL('/api/tasks', 'http://127.0.0.1');
  const assignee = argValue(args, '--assignee');
  if (assignee) url.searchParams.set('assignee', assignee);
  const result = await buildTasksPayload(config, db, url);
  await db.close?.();
  const openItems = result.sections.flatMap((section) =>
    section.items
      .filter((item) => !item.completed)
      .map((item) => ({ section: section.heading, item })),
  );
  output(global, result, openItems.length
    ? openItems.map(({ section, item }) => `${section}: ${item.title || item.markdown}`).join('\n')
    : 'No open tasks.');
}

async function handleMembers(args, global) {
  const config = await loadRuntimeConfig(global);
  const db = await openDatabase(config);
  try {
    if (args[0] === 'ensure-local-owner') {
      const personSlug = args[1] || argValue(args, '--person') || argValue(args, '--person-slug');
      if (!personSlug) throw new Error('members ensure-local-owner requires <people/slug>.');
      const member = await ensureLocalOwnerMember(db, {
        personSlug,
        email: argValue(args, '--email') || null,
        name: argValue(args, '--name') || null,
      });
      output(global, member, `Ensured local owner ${member.person_slug}.`);
      return;
    }
    if (args[0] === 'add') {
      const email = args[1];
      const personSlug = args[2];
      if (!email || !personSlug) throw new Error('members add requires <email> <people/slug>.');
      const member = await upsertMember(db, {
        email,
        person_slug: personSlug,
        name: argValue(args, '--name') || email,
        role: argValue(args, '--role') || 'member',
        status: argValue(args, '--status') || 'active',
      });
      output(global, member, `Added ${member.email} as ${member.person_slug}.`);
      return;
    }
    const members = await listMembers(db, { status: argValue(args, '--status') || null });
    output(global, members, members.length
      ? members.map((member) => `${member.person_slug}  ${member.email}  ${member.status}  ${member.role}`).join('\n')
      : 'No members.');
  } finally {
    await db.close?.();
  }
}

async function handleEval(args, global) {
  const subcommand = args[0];
  const {
    compareRetrievalEvalModes,
    defaultPrivateRetrievalEvalCasesPath,
    exportRetrievalEvalBaseline,
    loadRetrievalEvalCases,
    maybeLoadDefaultPrivateRetrievalEvalCases,
    renderRetrievalCompareText,
    runRetrievalEval,
    runRetrievalEvalOnConfig,
    renderRetrievalEvalBaselineNdjson,
    renderRetrievalEvalText,
    renderRetrievalReplayText,
    replayRetrievalEvalBaseline,
  } = await import('./eval-retrieval.js');

  if (subcommand === 'retrieval') {
    const casesPath = argValue(args, '--cases');
    const usePrivateDefault = args.includes('--private');
    const loadedDefault = !casesPath && usePrivateDefault ? await maybeLoadDefaultPrivateRetrievalEvalCases() : null;
    const common = {
      mode: argValue(args, '--mode') || undefined,
      limit: argValue(args, '--limit') ? Number(argValue(args, '--limit')) : undefined,
      failOnRegression: casesPath || loadedDefault ? args.includes('--fail-on-private-regression') : true,
      redact: args.includes('--redact'),
    };
    const report = casesPath || loadedDefault
      ? await runRetrievalEvalOnConfig({
        config: await loadRuntimeConfig(global),
        cases: casesPath ? await loadRetrievalEvalCases(casesPath) : loadedDefault.cases,
        caseSource: casesPath ? 'external' : 'default-private',
        ...common,
      })
      : await runRetrievalEval(common);
    if (common.failOnRegression && !report.gates.passed) {
      throw new Error(`Retrieval eval gates failed: ${report.gates.failures.length} failure(s).`);
    }
    output(global, report, renderRetrievalEvalText(report));
    return;
  }

  if (subcommand === 'export') {
    const cases = await loadEvalCasesForRealBrain({ args, loadRetrievalEvalCases, maybeLoadDefaultPrivateRetrievalEvalCases, defaultPrivateRetrievalEvalCasesPath });
    const rows = await exportRetrievalEvalBaseline({
      config: await loadRuntimeConfig(global),
      cases: cases.cases,
      caseSource: cases.source,
      mode: argValue(args, '--mode') || undefined,
      limit: argValue(args, '--limit') ? Number(argValue(args, '--limit')) : undefined,
      redact: args.includes('--redact'),
    });
    if (global.json) output(global, rows, renderRetrievalEvalBaselineNdjson(rows));
    else process.stdout.write(renderRetrievalEvalBaselineNdjson(rows));
    return;
  }

  if (subcommand === 'replay') {
    const against = argValue(args, '--against') || args[1];
    if (!against) throw new Error('eval replay requires --against <baseline.ndjson>.');
    const report = await replayRetrievalEvalBaseline({
      config: await loadRuntimeConfig(global),
      baselinePath: against,
      mode: argValue(args, '--mode') || null,
      limit: argValue(args, '--limit') ? Number(argValue(args, '--limit')) : null,
      redact: args.includes('--redact'),
    });
    output(global, report, renderRetrievalReplayText(report));
    return;
  }

  if (subcommand === 'compare') {
    const casesPath = argValue(args, '--cases');
    const modes = argValue(args, '--modes')
      ? argValue(args, '--modes').split(',').map((mode) => mode.trim()).filter(Boolean)
      : ['conservative', 'balanced', 'tokenmax'];
    const common = {
      modes,
      limit: argValue(args, '--limit') ? Number(argValue(args, '--limit')) : undefined,
      failOnRegression: args.includes('--fail-on-private-regression'),
      redact: args.includes('--redact'),
    };
    let report;
    if (casesPath || args.includes('--private')) {
      const cases = await loadEvalCasesForRealBrain({ args, loadRetrievalEvalCases, maybeLoadDefaultPrivateRetrievalEvalCases, defaultPrivateRetrievalEvalCasesPath });
      report = await compareRetrievalEvalModes({
        config: await loadRuntimeConfig(global),
        cases: cases.cases,
        caseSource: cases.source,
        ...common,
      });
    } else {
      const reports = [];
      for (const mode of modes) reports.push(await runRetrievalEval({ mode, limit: common.limit, redact: common.redact }));
      report = {
        schema_version: 1,
        suite: 'retrieval',
        limit: common.limit ?? 5,
        case_source: 'fixture',
        modes: Object.fromEntries(reports.map((modeReport) => [modeReport.mode, {
          metrics: modeReport.metrics,
          family_metrics: modeReport.family_metrics,
          gates: modeReport.gates,
          warnings: modeReport.warnings,
        }])),
        reports,
        _meta: reports[0]?._meta ?? {},
      };
    }
    output(global, report, renderRetrievalCompareText(report, { markdown: args.includes('--markdown') }));
    return;
  }

  throw new Error('eval requires "retrieval", "export", "replay", or "compare".');
}

async function loadEvalCasesForRealBrain({
  args,
  loadRetrievalEvalCases,
  maybeLoadDefaultPrivateRetrievalEvalCases,
  defaultPrivateRetrievalEvalCasesPath,
}) {
  const casesPath = argValue(args, '--cases');
  if (casesPath) return { source: 'external', path: casesPath, cases: await loadRetrievalEvalCases(casesPath) };
  const loaded = await maybeLoadDefaultPrivateRetrievalEvalCases();
  if (loaded) return { source: 'default-private', ...loaded };
  throw new Error(`No retrieval eval cases found. Pass --cases <path> or create ${defaultPrivateRetrievalEvalCasesPath()}.`);
}

async function handleDashboard(args, global) {
  const config = await loadRuntimeConfig(global);
  const port = Number(argValue(args, '--port') || config.dashboardPort);
  const host = argValue(args, '--host') || process.env.HOST || '127.0.0.1';
  const { startDashboard } = await import('./dashboard.js');
  await startDashboard(config, { host, port });
  console.log(`Dashboard running at http://${host === '0.0.0.0' ? '127.0.0.1' : host}:${port}`);
}

async function handleMcp(args, global) {
  const config = await loadRuntimeConfig(global);
  const port = Number(argValue(args, '--port') || process.env.PORT || 3333);
  const host = argValue(args, '--host') || process.env.HOST || '0.0.0.0';
  const { url } = await startMcpServer({ config, host, port });
  console.log(`BigBrain MCP server running at ${url}`);
}

async function loadRuntimeConfig(global) {
  if (global.configPath) return loadConfig({ configPath: global.configPath });
  const brainHome = await resolveBrainHome({
    explicitBrainHome: global.brainHome,
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
  search <query> [--limit N] [--mode conservative|balanced|tokenmax] [--explain]
  search modes [--json]
  query <question> [--limit N] [--mode conservative|balanced|tokenmax] [--explain] [--no-expand]
  links <slug>
  backlinks <slug>
  recent [--since 24h] [--until ISO]
  health
  migrate <source-dir>
  db doctor
  db migrate sqlite-to-postgres
  schema
  file <path-or-description>
  tasks [--assignee people/name]
  members [--status active|inactive|invited]
  members ensure-local-owner <people/slug> [--name NAME] [--email EMAIL]
  members add <email> <people/slug> [--name NAME] [--role owner|member|viewer] [--status active|inactive|invited]
  eval retrieval [--mode conservative|balanced|tokenmax] [--limit N] [--cases PATH] [--private] [--redact]
  eval export [--cases PATH] [--mode MODE] [--limit N] [--redact]
  eval replay --against baseline.ndjson [--mode MODE] [--limit N]
  eval compare [--cases PATH] [--modes conservative,balanced,tokenmax] [--markdown]
  dashboard [--host HOST] [--port N]
  mcp [--host HOST] [--port N]

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
    `This run: ${result.run_work.pages_embedded} page(s) embedded, ${result.run_work.embedding_chunks_created} embedding chunk(s) created, ${result.run_work.pages_embedding_skipped_by_guard ?? 0} page(s) skipped by embedding guard.`,
  ].join('\n');
}

function renderRecentText(report) {
  if (report.files.length === 0) return `No markdown files changed between ${report.window_start} and ${report.window_end}.`;
  return report.files.map((file) => `${file.mtime}  ${file.category.padEnd(10)}  ${file.relative_path}`).join('\n');
}

function renderSearchText(rows, explain = false) {
  if (!rows.length) return 'No results.';
  return rows.map((row) => {
    const lines = [`${row.slug}`, `  ${row.snippet || row.summary || ''}`];
    if (explain) {
      lines.push(`  score=${formatNumber(row.score)} evidence=${row.evidence || 'n/a'} create_safety=${row.create_safety || 'n/a'}`);
      if (row.rerank_score !== undefined) lines.push(`  rerank_score=${formatNumber(row.rerank_score)}`);
      if (Array.isArray(row.boosts) && row.boosts.length > 0) {
        lines.push(`  boosts=${row.boosts.map((boost) => boost.type).join(',')}`);
      }
    }
    return lines.join('\n');
  }).join('\n');
}

function renderSearchModesText(report) {
  return [
    `Default mode: ${report.default_mode}`,
    `Active mode: ${report.active_mode}`,
    '',
    ...Object.entries(report.bundles).map(([mode, bundle]) => (
      `${mode}: limit=${bundle.searchLimit}, expansion=${bundle.expansion}, rerank=${bundle.rerank}, tokenBudget=${bundle.tokenBudget ?? 'none'}`
    )),
  ].join('\n');
}

function parseSearchArgs(args) {
  const options = { positionals: [], limit: null, mode: undefined, explain: false, expand: undefined };
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--limit') {
      options.limit = Number(args[++index]);
      continue;
    }
    if (arg === '--mode') {
      options.mode = args[++index];
      continue;
    }
    if (arg === '--explain') {
      options.explain = true;
      continue;
    }
    if (arg === '--no-expand') {
      options.expand = false;
      continue;
    }
    options.positionals.push(arg);
  }
  return options;
}

function formatNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number.toFixed(3) : 'n/a';
}

function renderWarningText(warnings, text) {
  if (!Array.isArray(warnings) || warnings.length === 0) return text;
  const warningLines = warnings.map((warning) => `Warning: ${warning}`).join('\n');
  return `${warningLines}\n\n${text}`;
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
