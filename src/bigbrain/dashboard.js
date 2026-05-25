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
      .page-shell { display: grid; grid-template-columns: minmax(0, 1fr) 0; height: 100vh; overflow: hidden; transition: grid-template-columns 180ms ease; }
      .page-shell.preview-open { grid-template-columns: minmax(0, 1fr) minmax(320px, 460px); }
      main { min-width: 0; max-width: 1380px; height: 100vh; margin: 0 auto; padding: 36px 24px 24px; width: 100%; overflow: auto; }
      h1 { font-size: 44px; margin: 0 0 6px; letter-spacing: -0.03em; }
      h2 { margin: 0 0 14px; font-size: 20px; }
      h3 { margin: 0 0 10px; font-size: 14px; text-transform: uppercase; letter-spacing: 0.06em; color: var(--muted); }
      p { color: var(--muted); margin: 0; }
      .topline { display: flex; justify-content: space-between; align-items: end; gap: 16px; margin-bottom: 28px; }
      .stats { display: flex; gap: 10px; flex-wrap: wrap; }
      .pill { padding: 8px 12px; border-radius: 999px; background: #ffffff; border: 1px solid var(--line); box-shadow: 0 8px 24px rgba(15,23,42,0.04); font-size: 13px; }
      .layout { display: grid; gap: 20px; grid-template-columns: 1.3fr 0.9fr; }
      .stack { display: grid; gap: 20px; }
      .split { display: grid; gap: 20px; grid-template-columns: 1fr 1fr; }
      .split-gap { margin-top: 20px; }
      .card { background: var(--card); border: 1px solid var(--line); border-radius: 22px; padding: 20px; box-shadow: 0 18px 48px rgba(15,23,42,0.06); backdrop-filter: blur(10px); }
      .loading-card { min-height: 180px; display: grid; gap: 10px; align-content: center; }
      .section-head { display: flex; justify-content: space-between; align-items: start; gap: 16px; margin-bottom: 14px; }
      .section-subtle { font-size: 13px; margin-top: 2px; }
      .graph-toolbar { display: flex; align-items: center; justify-content: flex-end; gap: 10px; flex-wrap: wrap; }
      .graph-wrap { height: 520px; overflow: hidden; position: relative; border-radius: 18px; background:
        radial-gradient(circle at 18% 18%, rgba(191,231,198,0.18), transparent 24%),
        radial-gradient(circle at 82% 16%, rgba(184,192,255,0.16), transparent 22%),
        radial-gradient(circle at 72% 72%, rgba(255,211,224,0.18), transparent 24%),
        #ffffff; border: 1px solid rgba(148,163,184,0.18); }
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
      .task-section, .inbox-list, .recent-list, .health-list { display: grid; gap: 12px; }
      .task-group { border-top: 1px solid var(--line); padding-top: 14px; }
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
      .sidecar-shell { min-width: 0; position: sticky; top: 0; height: 100vh; padding: 24px 24px 24px 0; }
      .sidecar-panel { height: 100%; overflow: auto; opacity: 0; transform: translateX(28px); pointer-events: none; transition: opacity 180ms ease, transform 180ms ease; background: rgba(255,255,255,0.96); border-left: 1px solid var(--line); box-shadow: -18px 0 40px rgba(15,23,42,0.08); backdrop-filter: blur(18px); padding: 28px 24px 32px; }
      .preview-open .sidecar-panel { opacity: 1; transform: translateX(0); pointer-events: auto; }
      .sidecar-head { display: flex; justify-content: space-between; gap: 16px; align-items: start; margin-bottom: 18px; }
      @media (max-width: 1100px) {
        .page-shell,
        .page-shell.preview-open { grid-template-columns: 1fr; }
        .layout { grid-template-columns: 1fr; }
        .split { grid-template-columns: 1fr; }
        .graph-wrap { height: 420px; }
        .section-head { align-items: stretch; flex-direction: column; }
        .graph-toolbar { justify-content: space-between; }
        .sidecar-shell { position: fixed; inset: auto 0 0 0; height: min(68vh, 720px); padding: 0; z-index: 10; }
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
      summary: parsed.summary,
      markdown: parsed.bodyContentMarkdown,
      updated_at: stat.mtime.toISOString(),
    });
  }
  items.sort((a, b) => b.updated_at.localeCompare(a.updated_at));
  return { items };
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

function resolveBrainMarkdownPath(brainDir, slug) {
  const candidate = path.resolve(fullPathFromSlug(brainDir, slug));
  const resolvedBrainDir = path.resolve(brainDir);
  if (candidate !== resolvedBrainDir && !candidate.startsWith(`${resolvedBrainDir}${path.sep}`)) {
    throw new Error(`Linked file is outside the brain directory: ${slug}`);
  }
  return candidate;
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
