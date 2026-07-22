import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';

import { initializeBrainHome, loadConfig, loadState, loadUserEnv, persistState, resolveBrainHome, updateBrainName } from './config.js';
import { conservativeBrainProfileDraft, loadBrainProfile, parseBrainProfileMarkdown, saveBrainProfileRevision, writeBrainProfile } from './brain-profile.js';
import { MachineCatalog, migrateRegistryV1 } from './machine-catalog.js';
import { routeGranolaMeeting } from './granola-router.js';
import { openRoutingLedger } from './routing-ledger.js';
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
    case 'identity': return handleIdentity(args, global);
    case 'about': return handleAbout(args, global);
    case 'brains': return handleBrains(args, global);
    case 'granola': return handleGranola(args, global);
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
    case 'connect': return handleConnect(args, global);
    case '--help':
    case '-h':
    case undefined:
      printHelp();
      return;
    default:
      throw new Error(`Unknown command: ${command}`);
  }
}

async function handleIdentity(args, global) {
  const action = args[0] || 'show';
  if (action === 'show') {
    const config = await loadRuntimeConfig(global);
    const identity = { brain_id: config.brainId, brain_name: config.brainName };
    output(global, identity, `${identity.brain_name}\n${identity.brain_id}`);
    return;
  }
  if (action === 'set-name') {
    const brainName = args.slice(1).join(' ').trim();
    if (!brainName) throw new Error('Usage: bigbrain identity set-name <name>');
    const config = await updateBrainName(global.configPath ? { configPath: global.configPath } : { brainHome: global.brainHome || await resolveBrainHome({}) }, brainName);
    const identity = { brain_id: config.brainId, brain_name: config.brainName };
    output(global, identity, `Renamed brain to ${identity.brain_name}\nBrain ID: ${identity.brain_id}`);
    return;
  }
  throw new Error(`Unknown identity command: ${action}`);
}

async function handleAbout(args, global) {
  const action = args[0] || 'show';
  const config = await loadRuntimeConfig(global);
  if (action === 'show') {
    const loaded = await loadBrainProfile(config);
    output(global, loaded.about, renderAboutText(loaded.about));
    return;
  }
  if (action === 'init') {
    const existing = await loadBrainProfile(config);
    if (existing.status !== 'missing' && !args.includes('--replace')) {
      throw new Error('BRAIN.md already exists. Use about set to replace it after review.');
    }
    const written = await writeBrainProfile(config, conservativeBrainProfileDraft(config, {
      updatedBy: 'bigbrain-cli',
      generationMethod: 'migration',
    }));
    output(global, written.about, `Created an unreviewed, review-only ${written.about.manifest.filename} draft.`);
    return;
  }
  if (action === 'set') {
    const sourcePath = argValue(args, '--from');
    if (!sourcePath) throw new Error('Usage: bigbrain about set --from <BRAIN.md-or-json>');
    const raw = await fs.readFile(path.resolve(sourcePath), 'utf8');
    const profile = sourcePath.toLowerCase().endsWith('.json') ? JSON.parse(raw) : parseBrainProfileMarkdown(raw);
    const written = await saveBrainProfileRevision(config, profile, {
      updatedBy: 'bigbrain-cli',
      approve: args.includes('--approve'),
    });
    output(global, written.about, `Updated ${written.about.manifest.filename}; routing profile status is ${written.about.manifest.reviewed ? 'approved' : 'draft'}.`);
    return;
  }
  throw new Error('about requires "show", "init", or "set".');
}

async function handleBrains(args, global) {
  const action = args[0] || 'list';
  const catalog = new MachineCatalog();
  if (action === 'list') {
    const value = await catalog.load();
    output(global, value, renderBrainsText(value));
    return;
  }
  if (action === 'add-local') {
    if (!args[1]) throw new Error('Usage: bigbrain brains add-local <brain-home> [--handle HANDLE]');
    const config = await loadConfig({ brainHome: path.resolve(args[1]) });
    const profile = await loadBrainProfile(config);
    const now = new Date().toISOString();
    const value = await catalog.upsert({
      brain_id: config.brainId,
      brain_name: config.brainName,
      kind: 'local',
      connection: {
        type: 'local_runtime',
        handle: argValue(args, '--handle') || `local:${config.brainId}`,
        endpoint: null,
      },
      verification: { state: 'verified', verified_at: now },
      profile: {
        state: profile.valid ? (profile.profile.provenance.review_status === 'approved' ? 'valid' : 'draft') : profile.status,
        schema_version: profile.valid ? profile.profile.schema_version : null,
        profile_version: profile.valid ? profile.profile.provenance.profile_version : null,
      },
      access: { auth_state: 'local_trusted', writability: 'writable' },
      health: { status: 'healthy', checked_at: now },
      local: { home: config.brainHome, host: null, port: config.dashboardPort, service_label: null, service_status: 'unknown' },
      created_at: now,
      updated_at: now,
    });
    output(global, value, `Added ${config.brainName} to the machine catalog.`);
    return;
  }
  if (action === 'import-registry') {
    const sourcePath = argValue(args, '--from') || args[1];
    if (!sourcePath) throw new Error('Usage: bigbrain brains import-registry --from <registry.json>');
    const resolved = path.resolve(sourcePath);
    const source = JSON.parse(await fs.readFile(resolved, 'utf8'));
    const migrated = migrateRegistryV1(source);
    const backup = `${resolved}.v1-backup-${new Date().toISOString().replace(/[:.]/g, '-')}`;
    await fs.copyFile(resolved, backup);
    const saved = await catalog.save(migrated);
    output(global, { catalog: saved, backup }, `Imported ${saved.brains.length} brain(s); preserved the version-1 registry backup.`);
    return;
  }
  if (action === 'remove') {
    if (!args[1]) throw new Error('Usage: bigbrain brains remove <brain-id>');
    const removed = await catalog.remove(args[1]);
    output(global, removed, `Removed ${removed.brain_name} from the machine catalog.`);
    return;
  }
  throw new Error('brains requires "list", "add-local", "import-registry", or "remove".');
}

async function handleGranola(args, global) {
  const action = args[0];
  if (action === 'decide') {
    const inputPath = argValue(args, '--from');
    if (!inputPath) throw new Error('Usage: bigbrain granola decide --from <routing-input.json>');
    const input = JSON.parse(await fs.readFile(path.resolve(inputPath), 'utf8'));
    const decision = routeGranolaMeeting(input);
    output(global, decision, renderGranolaDecisionText(decision));
    return;
  }
  if (action !== 'routes') throw new Error('granola requires "decide" or "routes".');
  const routeAction = args[1] || 'list';
  const ledger = await openRoutingLedger();
  try {
    if (routeAction === 'list') {
      const state = argValue(args, '--state');
      const routes = ledger.list({ states: state || null, limit: Number(argValue(args, '--limit') || 100) });
      output(global, routes, renderRoutesText(routes));
      return;
    }
    const source = requireOption(args, '--source');
    const sourceItemId = requireOption(args, '--item');
    const actorId = argValue(args, '--actor') || 'people/owner';
    if (routeAction === 'approve') {
      const route = ledger.approve({ source, sourceItemId, actorId, selectedBrainId: argValue(args, '--brain') });
      output(global, route, 'Approved held route.');
      return;
    }
    if (routeAction === 'reject') {
      const route = ledger.reject({ source, sourceItemId, actorId, reasonCode: argValue(args, '--reason') || 'user_rejected' });
      output(global, route, 'Rejected held route.');
      return;
    }
    if (routeAction === 'retry') {
      const route = ledger.retry({ source, sourceItemId, actorId });
      output(global, route, 'Queued failed route for retry.');
      return;
    }
    throw new Error('granola routes requires "list", "approve", "reject", or "retry".');
  } finally {
    ledger.close();
  }
}

async function handleInit(args, global) {
  const positional = args.filter((arg, index) => index === 0 || args[index - 1] !== '--name').filter((arg) => arg !== '--name');
  const brainHome = positional[0] ? path.resolve(positional[0]) : global.brainHome || path.resolve(process.cwd(), 'bigbrain-home');
  const result = await initializeBrainHome(brainHome, { brainName: argValue(args, '--name') || null });
  output(global, result, `Initialized ${result.config.brain_name} at ${result.brainHome}\nBrain ID: ${result.config.brain_id}\nConfig: ${result.configPath}`);
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
  const server = await startDashboard(config, { host, port });
  const address = server.address();
  const actualPort = typeof address === 'object' && address ? address.port : port;
  const displayHost = host === '0.0.0.0' || host === '::' ? '127.0.0.1' : host;
  const url = `http://${displayHost}:${actualPort}`;
  if (!args.includes('--no-open')) openBrowser(url);
  console.log(`Dashboard running at ${url}`);
}

async function handleMcp(args, global) {
  const config = await loadRuntimeConfig(global);
  const port = Number(argValue(args, '--port') || process.env.PORT || 55560);
  const host = argValue(args, '--host') || process.env.HOST || '0.0.0.0';
  const { url } = await startMcpServer({ config, host, port });
  console.log(`BigBrain MCP server running at ${url}`);
}

async function handleConnect(args, global) {
  if (args[0] !== 'codex' || !args[1]) throw new Error('Usage: bigbrain connect codex <service-url> [--name NAME] [--auth oauth|token] [--token-stdin]');
  const { connectCodex } = await import('./codex-connect.js');
  const tokenStdin = args.includes('--token-stdin');
  const result = await connectCodex({
    serviceUrl: args[1],
    name: argValue(args, '--name') || '',
    auth: argValue(args, '--auth') || 'oauth',
    tokenStdin,
    token: tokenStdin ? await readStdin() : '',
  });
  output(global, result, result.restart_codex_required
    ? `Connected ${result.name}. Restart Codex before using this token-authenticated brain.`
    : `Connected ${result.name} with OAuth.`);
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
  init [brain-home] [--name NAME]
  identity [show]
  identity set-name <name>
  about show
  about init
  about set --from <BRAIN.md-or-json> [--approve]
  brains list
  brains add-local <brain-home> [--handle HANDLE]
  brains import-registry --from <registry.json>
  brains remove <brain-id>
  granola decide --from <routing-input.json>
  granola routes list [--state held|failed] [--limit N]
  granola routes approve --source granola --item ID --brain BRAIN_ID [--actor PERSON_SLUG]
  granola routes reject --source granola --item ID [--reason CODE] [--actor PERSON_SLUG]
  granola routes retry --source granola --item ID [--actor PERSON_SLUG]
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
  dashboard [--host HOST] [--port N] [--no-open]
  mcp [--host HOST] [--port N]
  connect codex <service-url> [--name NAME] [--auth oauth|token] [--token-stdin]

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

function renderAboutText(about) {
  return [
    `${about.brain_name}`,
    `Profile: ${about.manifest.status}${about.manifest.reviewed ? ', approved' : ', not approved'}`,
    `Routing: ${about.routing.effective_ingestion_mode}`,
  ].join('\n');
}

function renderBrainsText(catalog) {
  if (!catalog.brains.length) return 'No brains are registered in the machine catalog.';
  return catalog.brains.map((brain) => (
    `${brain.brain_name}  ${brain.kind}  ${brain.verification.state}  profile:${brain.profile.state}  ${brain.health.status}`
  )).join('\n');
}

function renderGranolaDecisionText(decision) {
  return decision.decision === 'route'
    ? `Route to ${decision.selected_brain_id}.`
    : `Hold for review: ${decision.reason_codes.join(', ')}.`;
}

function renderRoutesText(routes) {
  if (!routes.length) return 'No matching Granola routes.';
  return routes.map((route) => `${route.decision_state}  ${route.selected_brain_id || 'unassigned'}  ${route.reason_codes.join(',') || 'no reason'}`).join('\n');
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
  if (typeof details.expected_path === 'string' && details.expected_path) return `: missing ${details.expected_path}`;
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

function requireOption(args, name) {
  const value = argValue(args, name);
  if (!value) throw new Error(`Missing required option: ${name}`);
  return value;
}

function openBrowser(url) {
  const opener = process.platform === 'darwin'
    ? { command: 'open', args: [url] }
    : process.platform === 'win32'
      ? { command: 'cmd', args: ['/c', 'start', '', url] }
      : { command: 'xdg-open', args: [url] };
  try {
    const child = spawn(opener.command, opener.args, {
      detached: true,
      stdio: 'ignore',
    });
    child.once('error', () => {});
    child.unref();
  } catch {
    // The dashboard server is still useful even when the OS browser opener is unavailable.
  }
}

async function readStdin() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return Buffer.concat(chunks.map((chunk) => Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))).toString('utf8');
}
