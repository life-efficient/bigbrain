import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { build } from 'esbuild';

import { openDatabase, getBacklinks, getOutgoingLinks, listPages } from './db.js';
import { runHealthCheck } from './health.js';
import { fullPathFromSlug, parseMarkdownPage, resolveMarkdownLink, slugFromPath } from './markdown.js';
import { renderSchemaMarkdown } from './schema.js';

const moduleDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(moduleDir, '..', '..');
const dashboardClientEntry = path.join(repoRoot, 'src', 'dashboard-client', 'main.jsx');
const dashboardBundleFilename = 'dashboard-client.js';

export async function startDashboard(config, { port = config.dashboardPort } = {}) {
  const db = await openDatabase(config);
  const clientAssetPath = await ensureDashboardAssets(config);

  const server = http.createServer(async (req, res) => {
    try {
      const requestUrl = new URL(req.url || '/', 'http://127.0.0.1');
      if (requestUrl.pathname === '/' || requestUrl.pathname === '/index.html') {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(renderAppHtml());
        return;
      }
      if (requestUrl.pathname === `/assets/${dashboardBundleFilename}`) {
        await serveFile(res, clientAssetPath, 'application/javascript; charset=utf-8');
        return;
      }
      if (requestUrl.pathname === '/api/schema') return json(res, { markdown: renderSchemaMarkdown() });
      if (requestUrl.pathname === '/api/tasks') return json(res, await buildTasksPayload(config));
      if (requestUrl.pathname === '/api/inbox') return json(res, await buildInboxPayload(config));
      if (requestUrl.pathname === '/api/recent') return json(res, buildRecentPayload(db));
      if (requestUrl.pathname === '/api/graph') return json(res, buildGraphPayload(db));
      if (requestUrl.pathname === '/api/health') return json(res, await buildHealthPayload(config));
      if (requestUrl.pathname === '/api/page') return json(res, await buildPagePayload(config, requestUrl));
      if (requestUrl.pathname === '/api/preview') return json(res, await buildPreviewPayload(config, requestUrl));
      res.writeHead(404);
      res.end('Not found');
    } catch (error) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }));
    }
  });
  await new Promise((resolve) => server.listen(port, '127.0.0.1', resolve));
  return server;
}

async function ensureDashboardAssets(config) {
  const outdir = path.join(config.metaDir, 'dashboard-assets');
  const outfile = path.join(outdir, dashboardBundleFilename);
  await fs.mkdir(outdir, { recursive: true });
  await build({
    entryPoints: [dashboardClientEntry],
    bundle: true,
    format: 'esm',
    platform: 'browser',
    outfile,
    sourcemap: 'inline',
    jsx: 'automatic',
    target: ['es2022'],
  });
  return outfile;
}

async function serveFile(res, filePath, contentType) {
  const body = await fs.readFile(filePath);
  res.writeHead(200, { 'Content-Type': contentType });
  res.end(body);
}

function json(res, value) {
  res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(value, null, 2));
}

function renderAppHtml() {
  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>bigbrain dashboard</title>
    <style>
      :root {
        --bg: #ffffff;
        --card: rgba(255,255,255,0.94);
        --ink: #172033;
        --muted: #6b7280;
        --line: rgba(148,163,184,0.22);
        --accent: #5f8fe8;
        --warm: #f4c7b8;
        --danger: #a44545;
      }
      * { box-sizing: border-box; }
      body {
        font-family: ui-sans-serif, -apple-system, BlinkMacSystemFont, sans-serif;
        margin: 0;
        background: var(--bg);
        color: var(--ink);
        height: 100vh;
        overflow: hidden;
      }
      #root { height: 100vh; overflow: hidden; }
      .page-shell { --sidecar-width: 0px; position: relative; height: 100vh; overflow: hidden; }
      .page-shell.preview-open { --sidecar-width: min(420px, 46vw); }
      main { min-width: 0; max-width: none; height: 100vh; margin: 0; padding: 20px calc(20px + var(--sidecar-width)) 16px 20px; width: 100%; overflow: hidden; display: flex; flex-direction: column; transition: padding-right 240ms ease; }
      h1 { font-size: 44px; margin: 0 0 6px; letter-spacing: -0.03em; }
      h2 { margin: 0 0 14px; font-size: 20px; }
      h3 { margin: 0 0 10px; font-size: 14px; text-transform: uppercase; letter-spacing: 0.06em; color: var(--muted); }
      p { color: var(--muted); margin: 0; }
      .topline { display: grid; grid-template-columns: minmax(0, 1fr) auto minmax(0, 1fr); align-items: center; gap: 16px; margin-bottom: 18px; }
      .topline-brand { justify-self: start; min-width: 0; }
      .topline-actions { display: flex; align-items: center; gap: 12px; justify-self: end; }
      .view-nav { display: flex; gap: 10px; flex-wrap: wrap; }
      .view-nav-header { justify-content: center; justify-self: center; }
      .view-chip { border: 1px solid var(--line); background: #fff; color: var(--muted); border-radius: 999px; padding: 10px 14px; font-size: 13px; cursor: pointer; box-shadow: 0 6px 18px rgba(15,23,42,0.04); display: inline-flex; align-items: center; gap: 8px; }
      .view-chip.active { color: var(--ink); border-color: rgba(95,143,232,0.3); background: rgba(95,143,232,0.08); }
      .pill { padding: 8px 12px; border-radius: 999px; background: #ffffff; border: 1px solid var(--line); box-shadow: 0 8px 24px rgba(15,23,42,0.04); font-size: 13px; }
      .view-chip-count { min-width: 22px; height: 22px; padding: 0 7px; border-radius: 999px; display: inline-flex; align-items: center; justify-content: center; background: rgba(15,23,42,0.06); color: var(--ink); font-size: 12px; font-weight: 600; }
      .view-chip.active .view-chip-count { background: rgba(95,143,232,0.16); }
      .view-chip-kbd { font: inherit; font-size: 11px; line-height: 1; color: var(--muted); border: 1px solid rgba(148,163,184,0.24); border-bottom-color: rgba(148,163,184,0.34); background: rgba(255,255,255,0.9); border-radius: 7px; padding: 4px 6px; min-width: 20px; text-align: center; box-shadow: inset 0 -1px 0 rgba(148,163,184,0.12); }
      .view-chip.active .view-chip-kbd { color: var(--ink); background: rgba(255,255,255,0.8); border-color: rgba(95,143,232,0.24); }
      .health-menu { position: relative; }
      .health-button { position: relative; min-width: 38px; height: 38px; padding: 0 11px; border-radius: 999px; border: 1px solid var(--line); background: #ffffff; color: var(--muted); cursor: pointer; box-shadow: 0 6px 18px rgba(15,23,42,0.04); display: inline-flex; align-items: center; justify-content: center; gap: 8px; }
      .health-button.severity-clear,
      .health-button.severity-low { color: var(--muted); border-color: var(--line); background: #ffffff; }
      .health-button.severity-medium { color: #8c6a2f; border-color: rgba(188,123,77,0.22); background: rgba(188,123,77,0.06); }
      .health-button.severity-high { color: var(--danger); border-color: rgba(164,69,69,0.24); background: rgba(164,69,69,0.06); }
      .health-button.open { box-shadow: 0 12px 28px rgba(15,23,42,0.08); }
      .health-icon { font-size: 14px; line-height: 1; opacity: 0.9; }
      .health-badge { min-width: 20px; height: 20px; padding: 0 6px; border-radius: 999px; background: rgba(15,23,42,0.08); color: var(--ink); font-size: 11px; font-weight: 700; display: inline-flex; align-items: center; justify-content: center; }
      .health-button.severity-medium .health-badge { background: rgba(188,123,77,0.14); color: #7a5624; }
      .health-button.severity-high .health-badge { background: rgba(164,69,69,0.14); color: #913737; }
      .health-dropdown { position: absolute; right: 0; top: calc(100% + 10px); width: min(380px, calc(100vw - 40px)); max-height: min(440px, 70vh); overflow: auto; padding: 14px; border-radius: 18px; border: 1px solid var(--line); background: rgba(255,255,255,0.98); box-shadow: 0 24px 54px rgba(15,23,42,0.12); backdrop-filter: blur(18px); z-index: 20; }
      .health-dropdown-head { display: flex; justify-content: space-between; align-items: baseline; gap: 12px; margin-bottom: 12px; }
      .health-dropdown-list { display: grid; gap: 10px; }
      .health-dropdown-item { padding: 12px 13px; border-radius: 14px; border: 1px solid rgba(148,163,184,0.16); background: #ffffff; }
      .health-dropdown-item.high { border-color: rgba(164,69,69,0.28); background: rgba(164,69,69,0.03); }
      .health-dropdown-item.medium { border-color: rgba(188,123,77,0.28); background: rgba(188,123,77,0.03); }
      .health-dropdown-copy { color: var(--ink); font-size: 13px; line-height: 1.45; margin-bottom: 6px; }
      .split { display: grid; gap: 20px; grid-template-columns: 1fr 1fr; }
      .split-gap { margin-top: 20px; }
      .card { background: var(--card); border: 1px solid var(--line); border-radius: 22px; padding: 20px; box-shadow: 0 18px 48px rgba(15,23,42,0.06); backdrop-filter: blur(10px); }
      .view-stage { flex: 1; min-height: 0; width: 100%; }
      .view-stage-list { display: flex; justify-content: center; }
      .view-stage-graph { display: block; }
      .hero-card { min-height: 0; height: 100%; display: flex; flex-direction: column; min-width: 0; }
      .list-page-card { width: min(780px, 100%); max-width: 780px; }
      .list-scroll-region { flex: 1; min-height: 0; overflow: auto; padding-right: 4px; }
      .standalone-list-region { height: 100%; overflow: auto; padding-right: 4px; }
      .loading-card { min-height: 180px; display: grid; gap: 10px; align-content: center; }
      .section-head { display: flex; justify-content: space-between; align-items: start; gap: 16px; margin-bottom: 14px; }
      .section-subtle { font-size: 13px; margin-top: 2px; }
      .graph-stats { display: flex; flex-wrap: wrap; gap: 8px; }
      .graph-toolbar { display: flex; align-items: center; justify-content: flex-end; gap: 10px; flex-wrap: wrap; }
      .graph-wrap { height: 520px; overflow: hidden; position: relative; border-radius: 18px; background:
        radial-gradient(circle at 18% 18%, rgba(191,231,198,0.18), transparent 24%),
        radial-gradient(circle at 82% 16%, rgba(184,192,255,0.16), transparent 22%),
        radial-gradient(circle at 72% 72%, rgba(255,211,224,0.18), transparent 24%),
        #ffffff; border: 1px solid rgba(148,163,184,0.18); }
      .graph-wrap-expanded { height: 100%; min-height: 560px; }
      .graph-canvas-shell { position: relative; height: 100%; width: 100%; }
      .graph-svg { display: block; width: 100%; height: 100%; cursor: grab; }
      .force-shell canvas { border-radius: 18px; }
      .graph-controls { display: flex; gap: 8px; }
      .graph-controls-inline { position: static; z-index: auto; }
      .graph-button { border: 1px solid var(--line); background: rgba(255,255,255,0.98); color: var(--ink); border-radius: 999px; padding: 8px 12px; font-size: 12px; cursor: pointer; box-shadow: 0 6px 18px rgba(15,23,42,0.05); }
      .graph-button:hover { background: #ffffff; }
      .graph-note { position: absolute; left: 14px; bottom: 14px; z-index: 2; font-size: 12px; color: var(--muted); padding: 8px 10px; border-radius: 999px; background: rgba(255,255,255,0.84); border: 1px solid var(--line); }
      .graph-toolbar { display: flex; flex-wrap: wrap; justify-content: end; align-items: center; gap: 10px; }
      .graph-controls-inline { position: static; }
      .graph-select-shell { display: inline-flex; align-items: center; gap: 8px; padding: 8px 10px; border-radius: 999px; border: 1px solid var(--line); background: #ffffff; color: var(--muted); font-size: 12px; box-shadow: 0 6px 18px rgba(15,23,42,0.04); }
      .graph-select-shell select { border: 0; background: transparent; color: var(--ink); font: inherit; outline: none; }
      .legend { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 10px; }
      .legend span { font-size: 12px; color: var(--muted); padding: 6px 8px; border-radius: 999px; background: #ffffff; border: 1px solid var(--line); text-transform: lowercase; }
      .inbox-task-button { text-align: left; width: 100%; cursor: pointer; transition: transform 160ms ease, box-shadow 160ms ease, border-color 160ms ease; }
      .inbox-task-button:hover { transform: translateY(-1px); box-shadow: 0 18px 36px rgba(15,23,42,0.07); border-color: rgba(95,143,232,0.22); }
      .inbox-card-head { display: grid; gap: 6px; margin-bottom: 10px; }
      .inbox-card-summary { font-size: 14px; line-height: 1.55; color: var(--ink); max-height: 7.8em; overflow: hidden; }
      .inbox-card-summary .tailwind-prose { font-size: inherit; line-height: inherit; }
      .inbox-card-summary .tailwind-prose h1,
      .inbox-card-summary .tailwind-prose h2,
      .inbox-card-summary .tailwind-prose h3,
      .inbox-card-summary .tailwind-prose h4,
      .inbox-card-summary .tailwind-prose pre,
      .inbox-card-summary .tailwind-prose table,
      .inbox-card-summary .tailwind-prose hr { display: none; }
      .inbox-card-summary .tailwind-prose p,
      .inbox-card-summary .tailwind-prose ul,
      .inbox-card-summary .tailwind-prose ol,
      .inbox-card-summary .tailwind-prose blockquote { margin: 0 0 0.45em; }
      .task-section, .inbox-list, .recent-list, .health-list { display: grid; gap: 12px; }
      .task-section-compact .task { padding: 10px 12px; }
      .task-group { display: grid; gap: 12px; border-top: 1px solid var(--line); padding-top: 14px; }
      .task-group:first-child { border-top: 0; padding-top: 0; }
      .task { padding: 12px 14px; border-radius: 14px; background: #ffffff; border: 1px solid rgba(148,163,184,0.16); line-height: 1.45; }
      .task.done { opacity: 0.6; }
      .meta { font-size: 12px; color: var(--muted); }
      .inbox-item, .recent-item, .health-item { padding: 14px; border-radius: 14px; background: #ffffff; border: 1px solid rgba(148,163,184,0.16); }
      .recent-item strong, .inbox-item strong { display: block; margin-bottom: 6px; }
      .health-item.high { border-color: rgba(164,69,69,0.35); }
      .health-item.medium { border-color: rgba(188,123,77,0.35); }
      .card-copy { margin-top: 8px; line-height: 1.5; color: var(--ink); }
      .schema { white-space: pre-wrap; font-size: 12px; line-height: 1.5; max-height: 360px; overflow: auto; }
      .markdown-shell { color: var(--ink); }
      .empty-copy { color: var(--muted); font-size: 14px; }
      .tailwind-prose { color: var(--ink); font-size: 14px; line-height: 1.7; }
      .tailwind-prose:focus { outline: none; }
      .tailwind-prose > *:first-child { margin-top: 0; }
      .tailwind-prose > *:last-child { margin-bottom: 0; }
      .tailwind-prose p,
      .tailwind-prose ul,
      .tailwind-prose ol,
      .tailwind-prose blockquote,
      .tailwind-prose pre,
      .tailwind-prose table { margin: 0 0 0.95em; }
      .tailwind-prose h1,
      .tailwind-prose h2,
      .tailwind-prose h3,
      .tailwind-prose h4 { color: var(--ink); letter-spacing: -0.02em; margin: 0 0 0.55em; }
      .tailwind-prose h1 { font-size: 1.45rem; }
      .tailwind-prose h2 { font-size: 1.2rem; }
      .tailwind-prose h3 { font-size: 1rem; text-transform: none; letter-spacing: -0.01em; }
      .tailwind-prose h4 { font-size: 0.95rem; }
      .tailwind-prose a { color: var(--accent); text-decoration: underline; text-underline-offset: 0.18em; }
      .tailwind-prose a:hover { color: #426fd0; }
      .tailwind-prose strong { color: var(--ink); }
      .tailwind-prose code { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 0.9em; background: rgba(95,143,232,0.08); padding: 0.15em 0.35em; border-radius: 0.35rem; }
      .tailwind-prose pre { background: #172033; color: #f8fafc; border-radius: 14px; padding: 14px 16px; overflow: auto; }
      .tailwind-prose pre code { background: transparent; color: inherit; padding: 0; }
      .tailwind-prose ul,
      .tailwind-prose ol { padding-left: 1.2rem; }
      .tailwind-prose li { margin: 0.25em 0; }
      .tailwind-prose ul[data-type="taskList"] { list-style: none; padding-left: 0; }
      .tailwind-prose ul[data-type="taskList"] li { display: flex; align-items: start; gap: 0.6rem; }
      .tailwind-prose ul[data-type="taskList"] li > label { margin-top: 0.18rem; }
      .tailwind-prose blockquote { border-left: 3px solid rgba(32,92,91,0.24); padding-left: 1rem; color: var(--muted); }
      .tailwind-prose hr { border: 0; border-top: 1px solid var(--line); margin: 1rem 0; }
      .tailwind-prose table { width: 100%; border-collapse: collapse; font-size: 13px; }
      .tailwind-prose th,
      .tailwind-prose td { border: 1px solid rgba(31,26,23,0.08); padding: 0.55rem 0.65rem; text-align: left; }
      .tailwind-prose th { background: rgba(31,26,23,0.04); }
      .sidecar-shell { position: absolute; top: 0; right: 0; width: min(420px, 46vw); height: 100vh; padding: 0; overflow: hidden; pointer-events: none; }
      .sidecar-panel { height: 100%; overflow: auto; opacity: 0; transform: translateX(100%); pointer-events: none; transition: opacity 240ms ease, transform 240ms ease; background: rgba(255,255,255,0.98); border-left: 1px solid var(--line); box-shadow: -24px 0 54px rgba(15,23,42,0.10); backdrop-filter: blur(18px); padding: 28px 28px 32px; will-change: transform, opacity; }
      .preview-open .sidecar-shell { pointer-events: auto; }
      .preview-open .sidecar-panel { opacity: 1; transform: translateX(0); pointer-events: auto; }
      .sidecar-head { display: flex; justify-content: space-between; gap: 16px; align-items: start; margin-bottom: 18px; }
      @media (max-width: 1100px) {
        .split { grid-template-columns: 1fr; }
        main { padding: 16px 16px 12px; }
        .graph-wrap { height: 420px; }
        .graph-wrap-expanded { min-height: 420px; height: 100%; }
        .section-head { align-items: stretch; flex-direction: column; }
        .graph-toolbar { justify-content: space-between; }
        .view-stage-list { justify-content: stretch; }
        .list-page-card { width: 100%; max-width: none; }
        .topline { grid-template-columns: 1fr; align-items: start; justify-items: stretch; }
        .topline-brand { justify-self: start; }
        .view-nav-header { justify-self: start; justify-content: flex-start; }
        .topline-actions { justify-self: start; }
        .page-shell.preview-open { --sidecar-width: 0px; }
        .sidecar-shell { position: fixed; inset: auto 0 0 0; width: 100%; height: min(72vh, 760px); padding: 0; z-index: 10; }
        .sidecar-panel { border-left: 0; border-top: 1px solid var(--line); border-radius: 22px 22px 0 0; padding-top: 22px; }
      }
    </style>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/assets/${dashboardBundleFilename}"></script>
  </body>
</html>`;
}

async function buildTasksPayload(config) {
  const markdown = await fs.readFile(config.tasksFile, 'utf8');
  const slug = slugFromPath(config.brainDir, config.tasksFile);
  const sections = [];
  let current = null;
  for (const line of markdown.split('\n')) {
    const heading = /^##\s+(.*)$/.exec(line);
    if (heading) {
      current = { heading: heading[1].trim(), items: [] };
      sections.push(current);
      continue;
    }
    const task = /^- \[([ xX])\] (.*)$/.exec(line);
    if (task && current) {
      current.items.push({
        completed: task[1].toLowerCase() === 'x',
        markdown: task[2].trim(),
      });
    }
  }
  return {
    slug,
    markdown,
    sections,
    meta: {
      open_tasks: sections.flatMap((section) => section.items).filter((item) => !item.completed).length,
    },
  };
}

async function buildInboxPayload(config) {
  const inboxDir = path.join(config.brainDir, 'inbox');
  const entries = await fs.readdir(inboxDir, { withFileTypes: true }).catch(() => []);
  const items = [];
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith('.md')) continue;
    const fullPath = path.join(inboxDir, entry.name);
    const raw = await fs.readFile(fullPath, 'utf8');
    const slug = `inbox/${entry.name.replace(/\.md$/, '')}`;
    const parsed = parseMarkdownPage(raw, slug);
    const stat = await fs.stat(fullPath);
    items.push({
      slug,
      title: parsed.title,
      summary: extractInboxPreview(parsed),
      markdown: parsed.bodyContentMarkdown,
      updated_at: stat.mtime.toISOString(),
    });
  }
  items.sort((a, b) => b.updated_at.localeCompare(a.updated_at));
  return { items };
}

function extractInboxPreview(parsed) {
  const withoutTitle = stripSourceReferences(
    parsed.compiledTruth
      .replace(new RegExp(`^#\\s+${escapeRegExp(parsed.title)}\\s*`, 'i'), '')
      .trim(),
  );
  const lines = withoutTitle
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line && !/^#{1,6}\s/.test(line) && line !== '---' && !/^Date:\s/i.test(line));
  const previewLines = [];
  let totalLength = 0;
  for (const line of lines) {
    const normalizedLine = line.replace(/\s+/g, ' ').trim();
    if (!normalizedLine) continue;
    previewLines.push(normalizedLine);
    totalLength += normalizedLine.length;
    if (previewLines.length >= 3 || totalLength >= 320) break;
  }
  return previewLines.join('\n\n').trim();
}

async function buildPreviewPayload(config, requestUrl) {
  const sourceSlug = requestUrl.searchParams.get('from')?.trim();
  const target = requestUrl.searchParams.get('target')?.trim();
  if (!sourceSlug || !target) throw new Error('Preview requires both from and target.');
  const slug = resolveMarkdownLink(sourceSlug, target);
  if (!slug) throw new Error(`Unsupported preview target: ${target}`);
  const fullPath = resolveBrainMarkdownPath(config.brainDir, slug);
  const raw = await fs.readFile(fullPath, 'utf8');
  const parsed = parseMarkdownPage(raw, slug);
  return {
    slug,
    title: parsed.title,
    markdown: parsed.bodyContentMarkdown,
  };
}

async function buildPagePayload(config, requestUrl) {
  const slug = requestUrl.searchParams.get('slug')?.trim();
  if (!slug) throw new Error('Page lookup requires slug.');
  const fullPath = resolveBrainMarkdownPath(config.brainDir, slug);
  const raw = await fs.readFile(fullPath, 'utf8');
  const parsed = parseMarkdownPage(raw, slug);
  return {
    slug,
    title: parsed.title,
    markdown: parsed.bodyContentMarkdown,
  };
}

function resolveBrainMarkdownPath(brainDir, slug) {
  const candidate = path.resolve(fullPathFromSlug(brainDir, slug));
  const resolvedBrainDir = path.resolve(brainDir);
  if (candidate !== resolvedBrainDir && !candidate.startsWith(`${resolvedBrainDir}${path.sep}`)) {
    throw new Error(`Linked file is outside the brain directory: ${slug}`);
  }
  return candidate;
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function stripSourceReferences(value) {
  return value.replace(/\[Source:[^\]]+\]/g, '').replace(/\s+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}

function buildRecentPayload(db) {
  const pages = listPages(db).slice(-24).reverse();
  return { pages };
}

async function buildHealthPayload(config) {
  const report = await runHealthCheck(config);
  const grouped = new Map();
  for (const finding of report.findings) {
    grouped.set(finding.finding_type, (grouped.get(finding.finding_type) || 0) + 1);
  }
  const summary = [...grouped.entries()]
    .map(([finding_type, count]) => ({ finding_type, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 8);
  return {
    ...report,
    summary,
    top_findings: report.findings.slice(0, 16),
  };
}

function buildGraphPayload(db) {
  const pages = listPages(db);
  const candidateNodes = pages.map((page) => {
    const outgoing = getOutgoingLinks(db, page.slug);
    const backlinks = getBacklinks(db, page.slug);
    return {
      slug: page.slug,
      title: page.title,
      type: page.type,
      degree: outgoing.length + backlinks.length,
      outgoing,
    };
  }).sort((a, b) => b.degree - a.degree || a.slug.localeCompare(b.slug)).slice(0, 90);

  const allowed = new Set(candidateNodes.map((node) => node.slug));
  const edges = [];
  for (const node of candidateNodes) {
    for (const link of node.outgoing) {
      if (allowed.has(link.to_slug)) {
        edges.push({ source: node.slug, target: link.to_slug });
      }
    }
  }

  return {
    meta: {
      page_count: pages.length,
      node_count: candidateNodes.length,
      edge_count: edges.length,
    },
    nodes: candidateNodes.map((node) => ({
      slug: node.slug,
      title: node.title,
      type: node.type,
      degree: node.degree,
    })),
    edges,
  };
}
