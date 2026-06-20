import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { build } from 'esbuild';

import { openDatabase, getBacklinks, getOutgoingLinks, listPages } from './db.js';
import { runHealthCheck } from './health.js';
import { fullPathFromSlug, parseMarkdownPage, resolveMarkdownLink, slugFromPath } from './markdown.js';
import { findActiveMemberByEmail, findActiveMemberByPersonSlug, listActiveMembers, memberMapByPersonSlug } from './members.js';
import {
  authRoutesEnabled,
  assertOAuthConfigured,
  authorizeDashboardRequest,
  buildAuthConfig,
  completeOAuthCallback,
  createDashboardOAuthStart,
  renderAuthErrorPage,
} from './mcp-auth.js';
import { createMcpAuthStore } from './mcp-auth-store.js';
import { renderSchemaMarkdown } from './schema.js';

const moduleDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(moduleDir, '..', '..');
const dashboardClientEntry = path.join(repoRoot, 'src', 'dashboard-client', 'main.jsx');
const dashboardBundleFilename = 'dashboard-client.js';
const dashboardIconDir = path.join(repoRoot, 'electron', 'assets');
const faviconPath = path.join(dashboardIconDir, 'favicon.ico');
const faviconPngPath = path.join(dashboardIconDir, 'favicon-32.png');
const appleTouchIconPath = path.join(dashboardIconDir, 'apple-touch-icon.png');

export async function startDashboard(config, {
  host = '127.0.0.1',
  port = config.dashboardPort,
  authConfig = buildAuthConfig(),
} = {}) {
  const handler = await createDashboardRequestHandler(config, { authConfig });
  const server = http.createServer((req, res) => {
    handler(req, res).catch((error) => {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }));
    });
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => {
      server.off('error', reject);
      resolve();
    });
  });
  return server;
}

export async function createDashboardRequestHandler(config, {
  authConfig = buildAuthConfig(),
  basePath = '',
} = {}) {
  const db = await openDatabase(config);
  const clientAssetPath = await ensureDashboardAssets(config);
  const authEnabled = authRoutesEnabled(authConfig);
  const normalizedBasePath = normalizeDashboardBasePath(basePath);
  const authStartPath = `${normalizedBasePath}/auth/start`.replace(/^\/\//, '/');
  const authLogoutPath = `${normalizedBasePath}/auth/logout`.replace(/^\/\//, '/');
  if (authEnabled) {
    if (!authConfig.tokenStore) authConfig.tokenStore = await createMcpAuthStore(config, authConfig);
    if (!authConfig.memberLookup) authConfig.memberLookup = (email) => findActiveMemberByEmail(db, email);
    assertOAuthConfigured(authConfig);
  }

  return async function handleDashboardRequest(req, res) {
    try {
      const requestUrl = new URL(req.url || '/', 'http://127.0.0.1');
      let actor = null;
      if (authEnabled && requestUrl.pathname === authStartPath) {
        const location = await createDashboardOAuthStart(authConfig, req.url || '/auth/start');
        res.writeHead(302, { location });
        res.end();
        return;
      }
      if (authEnabled && requestUrl.pathname === '/auth/callback') {
        try {
          const issued = await completeOAuthCallback(authConfig, {
            code: requestUrl.searchParams.get('code'),
            state: requestUrl.searchParams.get('state'),
          });
          if (!issued.dashboard_session_token) {
            res.writeHead(302, { location: '/' });
            res.end();
            return;
          }
          res.writeHead(302, {
            location: issued.redirect_path || '/',
            'set-cookie': dashboardSessionCookie(issued.dashboard_session_token, authConfig),
          });
          res.end();
          return;
        } catch (error) {
          res.writeHead(403, { 'Content-Type': 'text/html; charset=utf-8' });
          res.end(renderAuthErrorPage(authConfig, error instanceof Error ? error.message : String(error)));
          return;
        }
      }
      if (authEnabled && requestUrl.pathname === authLogoutPath) {
        res.writeHead(302, {
          location: authStartPath,
          'set-cookie': clearDashboardSessionCookie(),
        });
        res.end();
        return;
      }
      if (authEnabled && requestUrl.pathname !== '/favicon.ico' && !requestUrl.pathname.startsWith('/assets/')) {
        const authorization = await authorizeDashboardRequest(req, authConfig);
        if (!authorization.ok) {
          const headers = {};
          if (authorization.clearCookie) headers['set-cookie'] = clearDashboardSessionCookie();
          if (authorization.status === 302) {
            const next = new URL(authStartPath, authConfig.publicUrl || 'http://127.0.0.1');
            next.searchParams.set('redirect', `${requestUrl.pathname}${requestUrl.search}`);
            headers.location = next.pathname + next.search;
            res.writeHead(302, headers);
            res.end();
            return;
          }
          res.writeHead(authorization.status || 401, { 'Content-Type': 'text/plain; charset=utf-8', ...headers });
          res.end(authorization.message || 'Unauthorized');
          return;
        }
        actor = authorization.actor || null;
      }
      if (isDashboardAppPath(requestUrl.pathname, normalizedBasePath)) {
        res.writeHead(200, {
          'Content-Type': 'text/html; charset=utf-8',
          'Cache-Control': 'no-store',
        });
        res.end(renderAppHtml());
        return;
      }
      if (requestUrl.pathname === '/favicon.ico') {
        await serveFile(res, faviconPath, 'image/x-icon');
        return;
      }
      if (requestUrl.pathname === '/assets/favicon-32.png') {
        await serveFile(res, faviconPngPath, 'image/png');
        return;
      }
      if (requestUrl.pathname === '/assets/apple-touch-icon.png') {
        await serveFile(res, appleTouchIconPath, 'image/png');
        return;
      }
      if (requestUrl.pathname === `/assets/${dashboardBundleFilename}`) {
        await serveFile(res, clientAssetPath, 'application/javascript; charset=utf-8');
        return;
      }
      if (requestUrl.pathname === '/api/schema') return json(res, { markdown: renderSchemaMarkdown() });
      if (requestUrl.pathname === '/api/tasks') return json(res, await buildTasksPayload(config, db, requestUrl, { actor }));
      if (requestUrl.pathname === '/api/inbox') return json(res, await buildInboxPayload(config, db, requestUrl, { actor }));
      if (requestUrl.pathname === '/api/recent') return json(res, await buildRecentPayload(db));
      if (requestUrl.pathname === '/api/graph') return json(res, await buildGraphPayload(db));
      if (requestUrl.pathname === '/api/health') return json(res, await buildHealthPayload(config));
      if (requestUrl.pathname === '/api/page') return json(res, await buildPagePayload(config, db, requestUrl));
      if (requestUrl.pathname === '/api/preview') return json(res, await buildPreviewPayload(config, db, requestUrl));
      if (requestUrl.pathname === '/api/explorer/tree') return json(res, await buildExplorerTreePayload(config));
      if (requestUrl.pathname === '/api/explorer/file') return json(res, await buildExplorerFilePayload(config, requestUrl));
      if (requestUrl.pathname === '/api/explorer/blob') return serveExplorerBlob(config, res, requestUrl);
      res.writeHead(404);
      res.end('Not found');
    } catch (error) {
      console.error(`Dashboard request failed: ${req.url || '/'}: ${error instanceof Error ? error.stack || error.message : String(error)}`);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }));
    }
  };
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
  res.writeHead(200, {
    'Content-Type': contentType,
    'Cache-Control': 'no-store',
  });
  res.end(body);
}

async function serveExplorerBlob(config, res, requestUrl) {
  const relativePath = normalizeExplorerPath(requestUrl.searchParams.get('path') || '');
  const fullPath = safeExplorerPath(config.brainDir, relativePath);
  const stats = await fs.stat(fullPath);
  if (!stats.isFile()) throw new Error(`Explorer blob path is not a file: ${relativePath}`);
  const mimeType = mimeTypeForPath(relativePath);
  res.writeHead(200, {
    'Content-Type': mimeType,
    'Content-Length': stats.size,
    'Cache-Control': 'no-store',
    'Content-Disposition': `inline; filename="${path.basename(relativePath).replace(/"/g, '')}"`,
  });
  const { createReadStream } = await import('node:fs');
  await new Promise((resolve, reject) => {
    const stream = createReadStream(fullPath);
    stream.once('error', reject);
    res.once('error', reject);
    res.once('finish', resolve);
    stream.pipe(res);
  });
}

function json(res, value) {
  res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(value, null, 2));
}

export function dashboardSessionCookie(token, authConfig) {
  const secure = authConfig.publicUrl?.startsWith('https://') ? '; Secure' : '';
  return `bigbrain_dashboard_session=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${14 * 24 * 60 * 60}${secure}`;
}

export function clearDashboardSessionCookie() {
  return 'bigbrain_dashboard_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0';
}

function normalizeDashboardBasePath(basePath) {
  const normalized = String(basePath || '').trim().replace(/\/+$/, '');
  if (!normalized || normalized === '/') return '';
  return normalized.startsWith('/') ? normalized : `/${normalized}`;
}

function isDashboardAppPath(pathname, basePath) {
  if (!basePath) return pathname === '/' || pathname === '/index.html';
  return pathname === basePath || pathname === `${basePath}/` || pathname === `${basePath}/index.html`;
}

function renderAppHtml() {
  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <link rel="icon" href="/favicon.ico" sizes="any" />
    <link rel="icon" type="image/png" sizes="32x32" href="/assets/favicon-32.png" />
    <link rel="apple-touch-icon" sizes="180x180" href="/assets/apple-touch-icon.png" />
    <title>Dashboard</title>
    <style>
      :root {
        --bg: #18181b;
        --card: rgba(24,24,27,0.82);
        --panel: rgba(24,24,27,0.96);
        --surface: rgba(255,255,255,0.03);
        --surface-muted: rgba(255,255,255,0.06);
        --surface-strong: rgba(255,255,255,0.05);
        --ink: #fafafa;
        --muted: #a1a1aa;
        --line: rgba(255,255,255,0.1);
        --line-strong: rgba(255,255,255,0.22);
        --accent: #fafafa;
        --accent-soft: rgba(255,255,255,0.08);
        --accent-strong: #ffffff;
        --warm: #d4d4d8;
        --danger: #a44545;
        --graph-bg: #18181B;
        --shadow-soft: 0 18px 48px rgba(0,0,0,0.26);
        --shadow-float: 0 24px 54px rgba(0,0,0,0.34);
        --pre-bg: #09090b;
        --pre-ink: #f8fafc;
      }
      .page-shell.theme-light {
        color-scheme: dark;
      }
      .page-shell.theme-dark {
        color-scheme: dark;
        --danger: #fca5a5;
      }
      * { box-sizing: border-box; }
      body {
        font-family: ui-sans-serif, -apple-system, BlinkMacSystemFont, sans-serif;
        margin: 0;
        background: var(--bg);
        color: var(--ink);
        height: 100vh;
        overflow: hidden;
        color-scheme: light dark;
      }
      #root { height: 100vh; overflow: hidden; }
      .page-shell { --sidecar-width: 0px; position: relative; height: 100vh; overflow: hidden; background: var(--bg); color: var(--ink); }
      .page-shell.preview-open { --sidecar-width: min(560px, 48vw); }
      main { min-width: 0; max-width: none; height: 100vh; margin: 0; padding: 20px calc(20px + var(--sidecar-width)) 16px 20px; width: 100%; overflow: hidden; display: flex; flex-direction: column; transition: padding-right 240ms ease; }
      h1 { font-size: 44px; margin: 0 0 6px; letter-spacing: -0.03em; }
      h2 { margin: 0 0 14px; font-size: 20px; }
      h3 { margin: 0 0 10px; font-size: 14px; text-transform: uppercase; letter-spacing: 0.06em; color: var(--muted); }
      p { color: var(--muted); margin: 0; }
      .topline { display: grid; grid-template-columns: minmax(44px, 1fr) auto minmax(44px, 1fr); align-items: center; gap: 16px; margin-bottom: 18px; -webkit-app-region: drag; user-select: none; }
      .topline-brand { justify-self: start; min-width: 0; }
      .topline-actions { display: flex; align-items: center; gap: 12px; justify-self: end; }
      .view-nav { display: flex; gap: 10px; flex-wrap: wrap; }
      .view-nav-header { justify-content: center; justify-self: center; }
      .view-nav, .topline-actions, .settings-dropdown, .health-dropdown { -webkit-app-region: no-drag; }
      .view-chip { border: 1px solid var(--line); background: var(--surface); color: var(--muted); border-radius: 999px; padding: 10px 14px; font-size: 13px; cursor: pointer; box-shadow: 0 6px 18px rgba(15,23,42,0.04); display: inline-flex; align-items: center; gap: 8px; }
      .view-chip.active { color: var(--ink); border-color: var(--line-strong); background: rgba(255,255,255,0.08); }
      .pill { padding: 8px 12px; border-radius: 999px; background: var(--surface); border: 1px solid var(--line); box-shadow: 0 8px 24px rgba(15,23,42,0.04); font-size: 13px; }
      .view-chip-count { min-width: 22px; height: 22px; padding: 0 7px; border-radius: 999px; display: inline-flex; align-items: center; justify-content: center; background: var(--surface-muted); color: var(--ink); font-size: 12px; font-weight: 600; }
      .view-chip.active .view-chip-count { background: rgba(255,255,255,0.1); }
      .view-chip-kbd { font: inherit; font-size: 11px; line-height: 1; color: var(--muted); border: 1px solid var(--line); border-bottom-color: var(--line-strong); background: var(--surface-strong); border-radius: 7px; padding: 4px 6px; min-width: 20px; text-align: center; box-shadow: inset 0 -1px 0 rgba(148,163,184,0.12); }
      .view-chip.active .view-chip-kbd { color: var(--ink); background: var(--surface); border-color: var(--line-strong); }
      .settings-menu, .health-menu { position: relative; }
      .settings-button, .health-button {
        position: relative;
        min-width: 38px;
        height: 38px;
        padding: 0 11px;
        border-radius: 999px;
        border: 1px solid var(--line);
        background: var(--surface);
        color: var(--muted);
        cursor: pointer;
        box-shadow: 0 6px 18px rgba(15,23,42,0.04);
        display: inline-flex;
        align-items: center;
        justify-content: center;
        gap: 8px;
      }
      .settings-button {
        width: 38px;
        padding: 0;
        color: var(--ink);
        background: linear-gradient(180deg, rgba(255,255,255,0.08), rgba(255,255,255,0.03));
      }
      .settings-button.open, .health-button.open { box-shadow: 0 12px 28px rgba(15,23,42,0.08); }
      .settings-icon { width: 16px; height: 16px; }
      .settings-dropdown, .health-dropdown {
        position: absolute;
        right: 0;
        top: calc(100% + 10px);
        border: 1px solid var(--line);
        background: var(--panel);
        box-shadow: var(--shadow-float);
        backdrop-filter: blur(18px);
        z-index: 20;
      }
      .settings-dropdown {
        width: min(320px, calc(100vw - 40px));
        padding: 14px;
        border-radius: 18px;
        display: grid;
        gap: 14px;
      }
      .settings-dropdown-head {
        display: flex;
        justify-content: space-between;
        align-items: baseline;
        gap: 12px;
      }
      .settings-field {
        display: grid;
        gap: 10px;
        padding: 14px;
        border-radius: 16px;
        border: 1px solid rgba(148,163,184,0.16);
        background: linear-gradient(180deg, rgba(255,255,255,0.05), rgba(255,255,255,0.02));
      }
      .settings-label {
        font-size: 11px;
        font-weight: 600;
        letter-spacing: 0.08em;
        text-transform: uppercase;
        color: var(--muted);
      }
      .theme-toggle {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        padding: 4px;
        border-radius: 999px;
        border: 1px solid var(--line);
        background: rgba(255,255,255,0.03);
        width: fit-content;
      }
      .theme-toggle-button {
        border: 0;
        background: transparent;
        color: var(--muted);
        border-radius: 999px;
        padding: 8px 13px;
        font: inherit;
        font-size: 12px;
        font-weight: 600;
        cursor: pointer;
        transition: background 140ms ease, color 140ms ease, box-shadow 140ms ease;
      }
      .theme-toggle-button:hover {
        color: var(--ink);
      }
      .theme-toggle-button.active {
        background: var(--ink);
        color: var(--bg);
        box-shadow: 0 8px 18px rgba(15,23,42,0.14);
      }
      .health-button.severity-clear,
      .health-button.severity-low { color: var(--muted); border-color: var(--line); background: var(--surface); }
      .health-button.severity-medium { color: #8c6a2f; border-color: rgba(188,123,77,0.22); background: rgba(188,123,77,0.06); }
      .health-button.severity-high { color: var(--danger); border-color: rgba(164,69,69,0.24); background: rgba(164,69,69,0.06); }
      .health-icon { font-size: 14px; line-height: 1; opacity: 0.9; }
      .health-badge { min-width: 20px; height: 20px; padding: 0 6px; border-radius: 999px; background: rgba(15,23,42,0.08); color: var(--ink); font-size: 11px; font-weight: 700; display: inline-flex; align-items: center; justify-content: center; }
      .health-button.severity-medium .health-badge { background: rgba(188,123,77,0.14); color: #7a5624; }
      .health-button.severity-high .health-badge { background: rgba(164,69,69,0.14); color: #913737; }
      .health-dropdown { width: min(380px, calc(100vw - 40px)); max-height: min(440px, 70vh); overflow: auto; padding: 14px; border-radius: 18px; }
      .health-dropdown-head { display: flex; justify-content: space-between; align-items: baseline; gap: 12px; margin-bottom: 12px; }
      .health-dropdown-list { display: grid; gap: 10px; }
      .health-dropdown-item { padding: 12px 13px; border-radius: 14px; border: 1px solid rgba(148,163,184,0.16); background: var(--surface); }
      .health-dropdown-item.high { border-color: rgba(164,69,69,0.28); background: rgba(164,69,69,0.03); }
      .health-dropdown-item.medium { border-color: rgba(188,123,77,0.28); background: rgba(188,123,77,0.03); }
      .health-dropdown-copy { color: var(--ink); font-size: 13px; line-height: 1.45; margin-bottom: 6px; }
      .split { display: grid; gap: 20px; grid-template-columns: 1fr 1fr; }
      .split-gap { margin-top: 20px; }
      .card { background: var(--card); border: 1px solid var(--line); border-radius: 22px; padding: 20px; box-shadow: var(--shadow-soft); backdrop-filter: blur(10px); }
      .view-stage { flex: 1; min-height: 0; width: 100%; }
      .view-stage-list { display: flex; justify-content: center; }
      .view-stage-graph { display: block; }
      .hero-card { min-height: 0; height: 100%; display: flex; flex-direction: column; min-width: 0; border: 0; background: transparent; box-shadow: none; backdrop-filter: none; padding: 0; }
      .list-page-card { width: min(780px, 100%); max-width: 780px; }
      .list-scroll-region { flex: 1; min-height: 0; overflow: auto; padding-right: 4px; }
      .standalone-list-region { height: 100%; overflow: auto; padding-right: 4px; }
      .loading-card { min-height: 180px; display: grid; gap: 10px; align-content: center; }
      .fallback-main { padding: 24px; display: grid; place-items: center; background: var(--bg); }
      .fallback-main .loading-card { width: min(620px, calc(100vw - 48px)); }
      .splash-main { padding: 0; display: grid; place-items: center; background: var(--bg); }
      .splash-stage {
        width: min(520px, calc(100vw - 48px));
        min-height: 360px;
        display: grid;
        place-items: center;
        align-content: center;
        gap: 22px;
        padding: 36px;
      }
      .splash-mark {
        position: relative;
        width: min(260px, 68vw);
        aspect-ratio: 1.22;
        display: grid;
        place-items: center;
      }
      .splash-mark::before {
        content: "";
        position: absolute;
        inset: 12%;
        border: 1px solid rgba(255,255,255,0.12);
        border-radius: 999px;
        transform: rotate(-12deg);
        animation: splash-orbit 3.8s ease-in-out infinite;
      }
      .splash-mark img {
        position: relative;
        z-index: 2;
        width: 74px;
        height: 74px;
        border-radius: 18px;
        box-shadow: 0 18px 44px rgba(0,0,0,0.34);
      }
      .splash-graph {
        position: absolute;
        inset: 0;
        width: 100%;
        height: 100%;
        color: var(--ink);
        opacity: 0.92;
      }
      .splash-graph rect {
        fill: rgba(255,255,255,0.018);
        stroke: rgba(255,255,255,0.1);
      }
      .splash-graph line {
        stroke: rgba(255,255,255,0.18);
        stroke-width: 0.55;
      }
      .splash-graph circle {
        fill: currentColor;
        transform-origin: center;
        animation: splash-node 1.8s ease-in-out infinite;
      }
      .splash-copy {
        display: grid;
        gap: 7px;
        text-align: center;
      }
      .splash-kicker {
        color: var(--ink);
        font-size: 15px;
        font-weight: 700;
      }
      .splash-status {
        color: var(--muted);
        font-size: 13px;
      }
      .splash-progress {
        width: min(260px, 68vw);
        height: 3px;
        border-radius: 999px;
        overflow: hidden;
        background: rgba(255,255,255,0.08);
      }
      .splash-progress span {
        display: block;
        width: 42%;
        height: 100%;
        border-radius: inherit;
        background: rgba(255,255,255,0.86);
        animation: splash-progress 1.5s ease-in-out infinite;
      }
      .error-card { max-width: min(820px, 100%); }
      .error-actions { display: flex; gap: 10px; margin-top: 6px; }
      .error-details { margin: 0; max-height: 320px; overflow: auto; border-radius: 14px; border: 1px solid var(--line); background: var(--pre-bg); color: var(--pre-ink); padding: 14px 16px; font: 12px/1.5 ui-monospace, SFMono-Regular, Menlo, monospace; white-space: pre-wrap; word-break: break-word; }
      .section-head { display: flex; justify-content: space-between; align-items: center; gap: 16px; margin-bottom: 14px; }
      .section-subtle { font-size: 13px; margin-top: 2px; }
      .graph-footer { display: flex; justify-content: space-between; align-items: center; gap: 16px; margin-top: 14px; }
      .graph-stats { display: flex; flex-wrap: wrap; gap: 14px; color: var(--muted); font-size: 12px; font-weight: 400; }
      .graph-stat strong { color: var(--ink); font-weight: 500; }
      .graph-toolbar { display: flex; align-items: center; justify-content: flex-end; gap: 10px; flex-wrap: nowrap; margin-left: auto; }
      .graph-wrap { height: 520px; overflow: hidden; position: relative; border-radius: 18px; background: var(--graph-bg); border: 1px solid rgba(148,163,184,0.18); }
      .graph-wrap-expanded { flex: 1; min-height: 0; height: auto; }
      .graph-canvas-shell { position: relative; height: 100%; width: 100%; }
      .graph-svg { display: block; width: 100%; height: 100%; cursor: grab; }
      .graph-svg:active { cursor: grabbing; }
      .force-shell canvas { border-radius: 18px; }
      .futuristic-graph { background: #18181B; }
      .graph-pulse-line { animation: graph-pulse 7s linear infinite; }
      .graph-controls { display: flex; gap: 8px; }
      .graph-controls-inline { position: static; z-index: auto; }
      .graph-button { border: 1px solid var(--line); background: var(--surface-strong); color: var(--ink); border-radius: 999px; padding: 8px 12px; font-size: 12px; cursor: pointer; box-shadow: 0 6px 18px rgba(15,23,42,0.05); }
      .graph-button:hover { background: var(--surface); }
      .graph-button-active { background: rgba(255,255,255,0.08); border-color: var(--line-strong); }
      .icon-button { width: 38px; height: 38px; padding: 0; border-radius: 999px; border: 1px solid var(--line); background: var(--surface-strong); color: var(--ink); cursor: pointer; box-shadow: 0 6px 18px rgba(15,23,42,0.05); display: inline-flex; align-items: center; justify-content: center; }
      .icon-button:hover { background: var(--surface); }
      .graph-note { position: absolute; left: 14px; bottom: 14px; z-index: 2; font-size: 12px; color: var(--muted); padding: 8px 10px; border-radius: 999px; background: var(--surface-strong); border: 1px solid var(--line); }
      .graph-controls-inline { position: static; }
      .graph-style-menu-shell, .graph-filter-menu-shell { position: relative; }
      .graph-style-menu { position: absolute; right: 0; bottom: calc(100% + 10px); min-width: 300px; display: grid; gap: 14px; padding: 14px; border-radius: 16px; border: 1px solid var(--line); background: var(--panel); box-shadow: var(--shadow-float); backdrop-filter: blur(18px); z-index: 8; }
      .graph-filter-menu { position: absolute; right: 0; bottom: calc(100% + 10px); min-width: 220px; display: grid; gap: 4px; padding: 6px; border-radius: 14px; border: 1px solid var(--line); background: var(--panel); box-shadow: var(--shadow-float); backdrop-filter: blur(18px); z-index: 9; }
      .menu-item { width: 100%; border: 0; background: transparent; color: var(--muted); border-radius: 10px; padding: 9px 10px; display: flex; align-items: center; justify-content: space-between; gap: 16px; font-size: 13px; text-align: left; cursor: pointer; }
      .menu-item:hover, .menu-item.selected { background: rgba(255,255,255,0.07); color: var(--ink); }
      .menu-item-check { width: 16px; text-align: center; color: var(--ink); }
      .graph-menu-field { display: grid; gap: 8px; font-size: 12px; color: var(--muted); }
      .graph-menu-field.disabled { opacity: 0.55; }
      .graph-menu-field span { font-size: 11px; text-transform: uppercase; letter-spacing: 0.08em; }
      .graph-option-grid { display: flex; flex-wrap: wrap; gap: 8px; }
      .graph-option-button { border: 1px solid var(--line); background: var(--surface); color: var(--muted); border-radius: 999px; padding: 8px 12px; font-size: 12px; line-height: 1; cursor: pointer; transition: background 140ms ease, border-color 140ms ease, color 140ms ease; }
      .graph-option-button:hover { background: rgba(255,255,255,0.06); color: var(--ink); }
      .graph-option-button.selected { background: rgba(255,255,255,0.12); border-color: rgba(255,255,255,0.28); color: var(--ink); }
      .graph-option-button:disabled { cursor: not-allowed; }
      .graph-fixed-labels text { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
      .legend { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 10px; }
      .legend span { font-size: 12px; color: var(--muted); padding: 6px 8px; border-radius: 999px; background: var(--surface); border: 1px solid var(--line); text-transform: lowercase; }
      .inbox-task-button { text-align: left; width: 100%; cursor: pointer; transition: transform 160ms ease, box-shadow 160ms ease, border-color 160ms ease; }
      .inbox-task-button:hover { transform: translateY(-1px); box-shadow: 0 18px 36px rgba(0,0,0,0.18); border-color: rgba(255,255,255,0.16); }
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
      .filter-bar { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; margin-bottom: 14px; }
      .filter-label { color: var(--muted); font-size: 12px; font-weight: 700; }
      .filter-select { min-height: 34px; max-width: min(100%, 280px); border: 1px solid var(--line); background: var(--surface); color: var(--ink); border-radius: 8px; padding: 6px 34px 6px 10px; font: inherit; font-size: 13px; font-weight: 650; cursor: pointer; }
      .filter-select:focus-visible { outline: 2px solid var(--accent-strong); outline-offset: 2px; }
      .task-section-compact .task { padding: 10px 12px; }
      .task-group { display: grid; gap: 12px; border-top: 1px solid var(--line); padding-top: 14px; }
      .task-group:first-child { border-top: 0; padding-top: 0; }
      .task { padding: 12px 14px; border-radius: 14px; background: var(--surface); border: 1px solid rgba(148,163,184,0.16); line-height: 1.45; }
      .task-preview-button { cursor: pointer; transition: transform 160ms ease, box-shadow 160ms ease, border-color 160ms ease; }
      .task-preview-button:hover { transform: translateY(-1px); box-shadow: 0 18px 36px rgba(0,0,0,0.18); border-color: rgba(255,255,255,0.16); }
      .task-preview-button:focus-visible,
      .inbox-task-button:focus-visible { outline: 2px solid var(--accent-strong); outline-offset: 2px; }
      .task.done { opacity: 0.6; }
      .assignee-row { display: flex; flex-wrap: wrap; gap: 6px; margin: 0 0 9px; }
      .assignee-pill { display: inline-flex; align-items: center; min-height: 22px; padding: 3px 8px; border-radius: 999px; border: 1px solid rgba(148,163,184,0.18); background: rgba(255,255,255,0.05); color: var(--muted); font-size: 11px; font-weight: 700; }
      .assignee-pill.invalid { color: #fecaca; border-color: rgba(252,165,165,0.34); background: rgba(127,29,29,0.2); }
      .meta { font-size: 12px; color: var(--muted); }
      .inbox-item, .recent-item, .health-item { padding: 14px; border-radius: 14px; background: var(--surface); border: 1px solid rgba(148,163,184,0.16); }
      .recent-item strong, .inbox-item strong { display: block; margin-bottom: 6px; }
      .health-item.high { border-color: rgba(164,69,69,0.35); }
      .health-item.medium { border-color: rgba(188,123,77,0.35); }
      .card-copy { margin-top: 8px; line-height: 1.5; color: var(--ink); }
      .schema { white-space: pre-wrap; font-size: 12px; line-height: 1.5; max-height: 360px; overflow: auto; }
      .explorer-shell { height: 100%; min-height: 0; display: grid; grid-template-columns: minmax(220px, 310px) minmax(0, 1fr); border: 1px solid var(--line); background: var(--panel); overflow: hidden; }
      .explorer-tree { min-height: 0; overflow: auto; border-right: 1px solid var(--line); background: color-mix(in srgb, var(--panel) 92%, #000 8%); padding: 8px 0 12px; }
      .explorer-tree-head { height: 32px; display: flex; align-items: center; padding: 0 12px; color: var(--muted); font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.08em; }
      .explorer-row { width: 100%; min-width: 0; height: 26px; padding: 0 10px 0 calc(10px + var(--depth, 0) * 14px); border: 0; background: transparent; color: var(--muted); display: grid; grid-template-columns: 14px 18px minmax(0, 1fr); align-items: center; gap: 4px; text-align: left; font: 12px/1.2 ui-monospace, SFMono-Regular, Menlo, monospace; cursor: pointer; }
      .explorer-row:hover { background: rgba(255,255,255,0.05); color: var(--ink); }
      .explorer-row.selected { background: rgba(125,211,252,0.12); color: var(--ink); }
      .explorer-twist { color: var(--muted); font-size: 13px; text-align: center; }
      .explorer-glyph { width: 18px; height: 18px; border-radius: 5px; display: inline-flex; align-items: center; justify-content: center; color: var(--muted); background: rgba(255,255,255,0.045); font-size: 10px; font-weight: 800; }
      .explorer-glyph.folder { color: var(--accent-strong); background: rgba(125,211,252,0.10); }
      .explorer-label { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .explorer-viewer { min-width: 0; min-height: 0; overflow: hidden; display: grid; grid-template-rows: auto minmax(0, 1fr); background: var(--bg); }
      .explorer-viewer.empty { place-items: center; display: grid; }
      .explorer-viewer-head { min-width: 0; min-height: 48px; padding: 10px 14px; border-bottom: 1px solid var(--line); display: grid; align-content: center; gap: 3px; }
      .explorer-viewer-head strong,
      .explorer-viewer-head .meta { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .explorer-viewer-body { min-height: 0; overflow: auto; padding: 18px 20px; }
      .explorer-viewer-body .markdown-shell { max-width: 920px; }
      .explorer-text-preview { margin: 0; min-height: 100%; white-space: pre-wrap; word-break: break-word; background: transparent; color: var(--ink); font: 12px/1.55 ui-monospace, SFMono-Regular, Menlo, monospace; }
      .explorer-media-frame { height: 100%; min-height: 0; display: grid; place-items: center; }
      .explorer-media-frame img { display: block; max-width: 100%; max-height: 100%; object-fit: contain; }
      .explorer-pdf-frame { width: 100%; height: 100%; min-height: 640px; border: 0; background: #fff; }
      .explorer-unsupported { height: 100%; display: grid; place-items: center; align-content: center; gap: 14px; }
      .explorer-open-blob { text-decoration: none; display: inline-flex; align-items: center; justify-content: center; }
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
      .tailwind-prose h4 { color: var(--ink); margin: 0 0 0.55em; }
      .tailwind-prose h1 { font-size: 1.45rem; }
      .tailwind-prose h2 { font-size: 1.2rem; }
      .tailwind-prose h3 { font-size: 1rem; text-transform: none; letter-spacing: -0.01em; }
      .tailwind-prose h4 { font-size: 0.95rem; }
      .tailwind-prose a { color: var(--accent-strong); text-decoration: underline; text-underline-offset: 0.18em; }
      .tailwind-prose a:hover { color: #d4d4d8; }
      .tailwind-prose strong { color: var(--ink); }
      .tailwind-prose code { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 0.9em; background: rgba(255,255,255,0.08); padding: 0.15em 0.35em; border-radius: 0.35rem; }
      .tailwind-prose pre { background: var(--pre-bg); color: var(--pre-ink); border-radius: 14px; padding: 14px 16px; overflow: auto; }
      .tailwind-prose pre code { background: transparent; color: inherit; padding: 0; }
      .tailwind-prose ul,
      .tailwind-prose ol { padding-left: 1.2rem; }
      .tailwind-prose li { margin: 0.25em 0; }
      .tailwind-prose ul[data-type="taskList"] { list-style: none; padding-left: 0; }
      .tailwind-prose ul[data-type="taskList"] li { display: flex; align-items: start; gap: 0.6rem; }
      .tailwind-prose ul[data-type="taskList"] li > label { margin-top: 0.18rem; }
      .tailwind-prose blockquote { border-left: 3px solid rgba(255,255,255,0.18); padding-left: 1rem; color: var(--muted); }
      .tailwind-prose hr { border: 0; border-top: 1px solid var(--line); margin: 1rem 0; }
      .tailwind-prose table { width: 100%; border-collapse: collapse; font-size: 13px; }
      .tailwind-prose th,
      .tailwind-prose td { border: 1px solid rgba(31,26,23,0.08); padding: 0.55rem 0.65rem; text-align: left; }
      .tailwind-prose th { background: rgba(31,26,23,0.04); }
      .sidecar-shell { position: absolute; top: 0; right: 0; width: min(560px, 48vw); height: 100vh; padding: 0; overflow: hidden; pointer-events: none; }
      .sidecar-panel { height: 100%; overflow: auto; opacity: 0; transform: translateX(100%); pointer-events: none; transition: opacity 240ms ease, transform 240ms ease; background: var(--panel); border-left: 1px solid var(--line); box-shadow: -24px 0 54px rgba(15,23,42,0.10); backdrop-filter: blur(18px); padding: 0; will-change: transform, opacity; }
      .preview-open .sidecar-shell { pointer-events: auto; }
      .preview-open .sidecar-panel { opacity: 1; transform: translateX(0); pointer-events: auto; }
      .sidecar-head { position: sticky; top: 0; z-index: 2; display: grid; gap: 14px; padding: 26px 28px 18px; border-bottom: 1px solid var(--line); background: color-mix(in srgb, var(--panel) 94%, transparent); backdrop-filter: blur(18px); }
      .sidecar-title-row { display: flex; justify-content: space-between; gap: 18px; align-items: start; }
      .sidecar-title-copy { min-width: 0; display: grid; gap: 8px; }
      .sidecar-title-copy h2 { margin: 0; font-size: 25px; line-height: 1.12; overflow-wrap: anywhere; }
      .sidecar-meta-row { display: flex; align-items: center; flex-wrap: wrap; gap: 8px; }
      .sidecar-chip { display: inline-flex; align-items: center; min-height: 25px; padding: 4px 9px; border-radius: 999px; border: 1px solid var(--line); background: var(--surface); color: var(--muted); font-size: 11px; font-weight: 700; }
      .sidecar-chip.strong { color: var(--ink); border-color: var(--line-strong); background: rgba(255,255,255,0.08); }
      .sidecar-body { padding: 18px 28px 34px; display: grid; gap: 16px; }
      .sidecar-summary { color: var(--muted); overflow-wrap: anywhere; font-style: italic; }
      .sidecar-summary .tailwind-prose { font-size: 12px; line-height: 1.45; color: var(--muted); font-style: italic; }
      .sidecar-summary .tailwind-prose p,
      .sidecar-summary .tailwind-prose ul,
      .sidecar-summary .tailwind-prose ol,
      .sidecar-summary .tailwind-prose blockquote { margin: 0 0 0.4em; }
      .sidecar-summary .tailwind-prose p:empty { display: none; }
      .sidecar-summary .tailwind-prose p:has(> br.ProseMirror-trailingBreak:only-child) { display: none; }
      .sidecar-summary .tailwind-prose > *:last-child { margin-bottom: 0; }
      .sidecar-summary .tailwind-prose h1,
      .sidecar-summary .tailwind-prose h2,
      .sidecar-summary .tailwind-prose h3,
      .sidecar-summary .tailwind-prose h4 { font-size: 12px; line-height: 1.4; margin: 0 0 0.35em; text-transform: none; letter-spacing: 0; color: var(--muted); font-style: italic; }
      .sidecar-section { display: grid; gap: 11px; }
      .sidecar-section h3 { margin: 0; }
      .sidecar-link-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; }
      .sidecar-link-button { min-width: 0; border: 1px solid var(--line); background: var(--surface); color: var(--ink); border-radius: 12px; padding: 10px 11px; text-align: left; cursor: pointer; display: grid; gap: 4px; }
      .sidecar-link-button:hover { border-color: var(--line-strong); background: rgba(255,255,255,0.07); }
      .sidecar-link-title { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 13px; font-weight: 700; }
      .sidecar-link-meta { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 11px; color: var(--muted); }
      .sidecar-document { border-top: 1px solid var(--line); padding-top: 18px; }
      .sidecar-document.has-link-sections { border-bottom: 1px solid var(--line); padding-bottom: 18px; }
      .sidecar-document .tailwind-prose { font-size: 15px; line-height: 1.75; }
      @keyframes graph-pulse {
        from { stroke-dashoffset: 0; }
        to { stroke-dashoffset: -46; }
      }
      @keyframes splash-node {
        0%, 100% { opacity: 0.36; transform: scale(0.92); }
        45% { opacity: 1; transform: scale(1.22); }
      }
      @keyframes splash-progress {
        0% { transform: translateX(-115%); }
        55%, 100% { transform: translateX(255%); }
      }
      @keyframes splash-orbit {
        0%, 100% { transform: rotate(-12deg) scale(1); opacity: 0.52; }
        50% { transform: rotate(8deg) scale(1.05); opacity: 0.86; }
      }
      @media (max-width: 1100px) {
        .split { grid-template-columns: 1fr; }
        main { padding: 16px 16px 12px; }
        .graph-wrap { height: 420px; }
        .graph-wrap-expanded { min-height: 360px; height: auto; }
        .section-head, .graph-footer { align-items: center; flex-direction: row; }
        .graph-toolbar { justify-content: flex-end; align-self: flex-start; }
        .graph-style-menu, .graph-filter-menu { right: 0; left: auto; }
        .view-stage-list { justify-content: stretch; }
        .list-page-card { width: 100%; max-width: none; }
        .topline { grid-template-columns: minmax(44px, 1fr) auto minmax(44px, 1fr); align-items: center; justify-items: initial; }
        .topline-brand { justify-self: start; }
        .view-nav-header { justify-self: center; justify-content: center; }
        .topline-actions { justify-self: end; }
        .page-shell.preview-open { --sidecar-width: 0px; }
        .sidecar-shell { position: fixed; top: 0; right: 0; bottom: 0; left: auto; width: min(560px, 92vw); height: 100vh; padding: 0; z-index: 10; }
        .sidecar-panel { border-left: 1px solid var(--line); border-top: 0; border-radius: 0; }
        .sidecar-link-grid { grid-template-columns: 1fr; }
      }
      @media (max-width: 640px) {
        .sidecar-shell { left: 0; width: 100vw; }
      }
    </style>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/assets/${dashboardBundleFilename}"></script>
  </body>
</html>`;
}

export async function buildTasksPayload(config, db = null, requestUrl = new URL('/api/tasks', 'http://127.0.0.1'), { actor = null } = {}) {
  const taskPages = await readTaskPages(config);
  if (taskPages.length > 0) {
    const activeMembers = db ? await listActiveMembers(db) : [];
    const activeMemberMap = memberMapByPersonSlug(activeMembers);
    const currentMember = await resolveCurrentMember(db, actor);
    const requestedAssignee = await resolveRequestedAssignee(db, requestUrl, actor);
    const hasAssigneeFilter = requestUrl.searchParams.has('assignee');
    const filteredPages = hasAssigneeFilter
      ? requestedAssignee
        ? taskPages.filter((task) => task.assignee_slugs.includes(requestedAssignee.person_slug))
        : []
      : taskPages;
    const sections = groupTaskPages(filteredPages, activeMemberMap);
    const openItems = sections.flatMap((section) => section.items).filter((item) => !item.completed);
    return {
      slug: 'tasks',
      markdown: '',
      source: 'task_pages',
      members: activeMembers,
      filters: {
        assignee: requestedAssignee?.person_slug || null,
        actor_email: actor?.email || null,
        current_member: currentMember,
      },
      sections,
      meta: {
        open_tasks: openItems.length,
        task_pages: taskPages.length,
        invalid_assignments: sections
          .flatMap((section) => section.items)
          .reduce((count, item) => count + item.invalid_assignees.length, 0),
      },
    };
  }

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
    source: 'legacy_tasks_file',
    members: db ? await listActiveMembers(db) : [],
    filters: {
      assignee: null,
      actor_email: actor?.email || null,
      current_member: await resolveCurrentMember(db, actor),
    },
    sections,
    meta: {
      open_tasks: sections.flatMap((section) => section.items).filter((item) => !item.completed).length,
      task_pages: 0,
      invalid_assignments: 0,
    },
  };
}

export async function buildInboxPayload(config, db = null, requestUrl = new URL('/api/inbox', 'http://127.0.0.1'), { actor = null } = {}) {
  const inboxDir = path.join(config.brainDir, 'inbox');
  const entries = await fs.readdir(inboxDir, { withFileTypes: true }).catch(() => []);
  const items = [];
  const activeMembers = db ? await listActiveMembers(db) : [];
  const activeMemberMap = memberMapByPersonSlug(activeMembers);
  const currentMember = await resolveCurrentMember(db, actor);
  const requestedAssignee = await resolveRequestedAssignee(db, requestUrl, actor);
  const hasAssigneeFilter = requestUrl.searchParams.has('assignee');
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith('.md')) continue;
    if (isDocumentationMarkdownFile(entry.name)) continue;
    const fullPath = path.join(inboxDir, entry.name);
    const raw = await fs.readFile(fullPath, 'utf8');
    const slug = `inbox/${entry.name.replace(/\.md$/, '')}`;
    const parsed = parseMarkdownPage(raw, slug);
    const assigneeSlugs = normalizeSlugList(parsed.frontmatter.assignees);
    if (hasAssigneeFilter && (!requestedAssignee || !assigneeSlugs.includes(requestedAssignee.person_slug))) continue;
    const stat = await fs.stat(fullPath);
    items.push({
      slug,
      title: parsed.title,
      summary: extractInboxPreview(parsed),
      markdown: parsed.bodyContentMarkdown,
      status: normalizeStatus(parsed.frontmatter.status, 'triage'),
      assignees: resolveAssignees(assigneeSlugs, activeMemberMap),
      invalid_assignees: assigneeSlugs.filter((assignee) => !activeMemberMap.has(assignee)),
      updated_at: stat.mtime.toISOString(),
    });
  }
  items.sort((a, b) => b.updated_at.localeCompare(a.updated_at));
  return {
    members: activeMembers,
    filters: {
      assignee: requestedAssignee?.person_slug || null,
      actor_email: actor?.email || null,
      current_member: currentMember,
    },
    items,
  };
}

async function readTaskPages(config) {
  const taskDir = path.join(config.brainDir, 'tasks');
  const files = await listMarkdownFiles(taskDir).catch(() => []);
  const pages = [];
  for (const fullPath of files) {
    if (isTaskDocumentationFile(fullPath)) continue;
    const raw = await fs.readFile(fullPath, 'utf8');
    const slug = slugFromPath(config.brainDir, fullPath);
    const parsed = parseMarkdownPage(raw, slug);
    const stat = await fs.stat(fullPath);
    const status = normalizeStatus(parsed.frontmatter.status, 'open');
    pages.push({
      slug,
      title: parsed.title,
      markdown: parsed.bodyContentMarkdown,
      status,
      completed: status === 'done' || status === 'archived',
      priority: normalizePriority(parsed.frontmatter.priority),
      due: normalizeDateValue(parsed.frontmatter.due),
      assignee_slugs: normalizeSlugList(parsed.frontmatter.assignees),
      source_slugs: normalizeSlugList(parsed.frontmatter.source),
      updated_at: stat.mtime.toISOString(),
    });
  }
  return pages.sort(compareTasks);
}

async function listMarkdownFiles(dir) {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...await listMarkdownFiles(fullPath));
    } else if (entry.isFile() && entry.name.endsWith('.md')) {
      files.push(fullPath);
    }
  }
  return files;
}

function isTaskDocumentationFile(fullPath) {
  return isDocumentationMarkdownFile(path.basename(fullPath));
}

function isDocumentationMarkdownFile(filename) {
  const basename = String(filename || '').toLowerCase();
  return basename === 'readme.md' || basename === 'filing.md';
}

function groupTaskPages(taskPages, activeMemberMap) {
  const headings = [
    ['open', 'Open'],
    ['waiting', 'Waiting'],
    ['blocked', 'Blocked'],
    ['done', 'Done'],
    ['archived', 'Archived'],
  ];
  return headings
    .map(([status, heading]) => ({
      heading,
      items: taskPages
        .filter((task) => task.status === status)
        .map((task) => ({
          slug: task.slug,
          completed: task.completed,
          markdown: task.title,
          title: task.title,
          status: task.status,
          priority: task.priority,
          due: task.due,
          assignees: resolveAssignees(task.assignee_slugs, activeMemberMap),
          invalid_assignees: task.assignee_slugs.filter((assignee) => !activeMemberMap.has(assignee)),
          source_slugs: task.source_slugs,
          updated_at: task.updated_at,
        })),
    }))
    .filter((section) => section.items.length > 0);
}

async function resolveRequestedAssignee(db, requestUrl, actor) {
  const requested = requestUrl.searchParams.get('assignee')?.trim();
  if (requested && requested !== 'me') {
    return db ? findActiveMemberByPersonSlug(db, requested) : null;
  }
  if (requested === 'me' && db && actor?.email) {
    return findActiveMemberByEmail(db, actor.email);
  }
  return null;
}

async function resolveCurrentMember(db, actor) {
  if (!db || !actor?.email) return null;
  return findActiveMemberByEmail(db, actor.email);
}

function resolveAssignees(assigneeSlugs, activeMemberMap) {
  return assigneeSlugs
    .map((assignee) => activeMemberMap.get(assignee))
    .filter(Boolean);
}

function normalizeSlugList(value) {
  const values = Array.isArray(value)
    ? value
    : String(value || '').split(',');
  return values
    .map((entry) => String(entry).trim().replace(/^['"]|['"]$/g, '').replace(/\.md$/i, ''))
    .filter(Boolean);
}

function normalizeStatus(value, fallback) {
  const normalized = String(value || fallback).trim().toLowerCase();
  return ['open', 'waiting', 'blocked', 'done', 'archived', 'triage', 'assigned', 'converted'].includes(normalized)
    ? normalized
    : fallback;
}

function normalizePriority(value) {
  const normalized = String(value || 'p3').trim().toLowerCase();
  return ['p0', 'p1', 'p2', 'p3'].includes(normalized) ? normalized : 'p3';
}

function normalizeDateValue(value) {
  const text = String(value || '').trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : null;
}

function compareTasks(a, b) {
  return priorityRank(a.priority) - priorityRank(b.priority)
    || dueSortValue(a.due) - dueSortValue(b.due)
    || b.updated_at.localeCompare(a.updated_at)
    || a.slug.localeCompare(b.slug);
}

function priorityRank(priority) {
  return { p0: 0, p1: 1, p2: 2, p3: 3 }[priority] ?? 3;
}

function dueSortValue(due) {
  return due ? Date.parse(`${due}T00:00:00Z`) : Number.MAX_SAFE_INTEGER;
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

export async function buildPreviewPayload(config, db, requestUrl) {
  const sourceSlug = requestUrl.searchParams.get('from')?.trim();
  const target = requestUrl.searchParams.get('target')?.trim();
  if (!sourceSlug || !target) throw new Error('Preview requires both from and target.');
  const slug = resolveMarkdownLink(sourceSlug, target);
  if (!slug) throw new Error(`Unsupported preview target: ${target}`);
  return buildPagePayloadForSlug(config, db, slug);
}

export async function buildExplorerTreePayload(config) {
  const root = await explorerEntryForPath(config.brainDir, config.brainDir, true);
  return {
    root,
    meta: {
      root_path: config.brainDir,
    },
  };
}

export async function buildExplorerFilePayload(config, requestUrl) {
  const relativePath = normalizeExplorerPath(requestUrl.searchParams.get('path') || '');
  const fullPath = safeExplorerPath(config.brainDir, relativePath);
  const stats = await fs.stat(fullPath);
  if (!stats.isFile()) throw new Error(`Explorer path is not a file: ${relativePath}`);
  const mimeType = mimeTypeForPath(relativePath);
  const kind = viewerKindForMime(mimeType, relativePath);
  const payload = {
    path: relativePath,
    name: path.basename(relativePath),
    kind,
    mime_type: mimeType,
    size: stats.size,
    updated_at: stats.mtime.toISOString(),
    blob_url: `/api/explorer/blob?${new URLSearchParams({ path: relativePath }).toString()}`,
  };
  if (kind === 'markdown' || kind === 'text') {
    if (stats.size > 1024 * 1024) {
      return { ...payload, kind: 'unsupported', reason: 'Text preview is limited to files under 1 MB.' };
    }
    return { ...payload, text: await fs.readFile(fullPath, 'utf8') };
  }
  return payload;
}

export async function buildPagePayload(config, db, requestUrl) {
  const slug = requestUrl.searchParams.get('slug')?.trim();
  if (!slug) throw new Error('Page lookup requires slug.');
  return buildPagePayloadForSlug(config, db, slug);
}

async function buildPagePayloadForSlug(config, db, slug) {
  const fullPath = resolveBrainMarkdownPath(config.brainDir, slug);
  const raw = await fs.readFile(fullPath, 'utf8');
  const parsed = parseMarkdownPage(raw, slug);
  const stat = await fs.stat(fullPath);
  const outgoing = db ? await getOutgoingLinks(db, slug) : [];
  const backlinks = db ? await getBacklinks(db, slug) : [];
  const relativePath = path.relative(config.brainDir, fullPath);
  return {
    slug,
    title: parsed.title,
    type: parsed.type,
    path: relativePath,
    summary: extractPageReaderSummary(parsed),
    frontmatter: parsed.frontmatter,
    markdown: parsed.bodyContentMarkdown,
    updated_at: stat.mtime.toISOString(),
    links: {
      outgoing: outgoing
        .filter((link) => link.link_kind === 'markdown' && link.is_resolved)
        .slice(0, 12)
        .map((link) => ({ slug: link.to_slug, label: link.link_text || link.to_slug })),
      backlinks: backlinks
        .filter((link) => link.link_kind === 'markdown')
        .slice(0, 12)
        .map((link) => ({ slug: link.from_slug, label: link.link_text || link.from_slug })),
    },
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

function extractPageReaderSummary(parsed) {
  const titlePattern = new RegExp(`^#\\s+${escapeRegExp(parsed.title)}\\s*$`, 'i');
  const blocks = [];
  let current = [];
  for (const rawLine of parsed.compiledTruth.split('\n')) {
    const line = rawLine.trim().replace(/^>\s*/, '');
    if (!line || line === '---' || titlePattern.test(line) || /^#{1,6}\s/.test(line)) {
      flushSummaryBlock(blocks, current);
      current = [];
      if (blocks.length >= 2) break;
      continue;
    }
    current.push(line);
  }
  flushSummaryBlock(blocks, current);
  return blocks.slice(0, 2).join('\n\n').trim();
}

function flushSummaryBlock(blocks, lines) {
  if (!lines.length) return;
  const cleaned = stripSourceReferences(lines.join(' '))
    .replace(/\*\*/g, '')
    .replace(/\s+/g, ' ')
    .replace(/\s+-\s+(?:Role|Timezone|WhatsApp|Assistant preference|Physical location):.*$/i, '')
    .trim();
  if (cleaned) blocks.push(cleaned);
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

async function explorerEntryForPath(root, fullPath, includeChildren = false) {
  const stats = await fs.stat(fullPath);
  const relativePath = path.relative(root, fullPath).split(path.sep).join('/');
  const name = relativePath ? path.basename(relativePath) : 'brain';
  const entry = {
    name,
    path: relativePath,
    type: stats.isDirectory() ? 'directory' : 'file',
    size: stats.isFile() ? stats.size : null,
    updated_at: stats.mtime.toISOString(),
    kind: stats.isFile() ? viewerKindForMime(mimeTypeForPath(relativePath), relativePath) : null,
  };
  if (!stats.isDirectory() || !includeChildren) return entry;
  const dirents = await fs.readdir(fullPath, { withFileTypes: true });
  const children = [];
  for (const dirent of dirents) {
    const childFullPath = path.join(fullPath, dirent.name);
    const childRelative = path.relative(root, childFullPath).split(path.sep).join('/');
    if (shouldSkipExplorerPath(childRelative, dirent)) continue;
    children.push(await explorerEntryForPath(root, childFullPath, true));
  }
  children.sort(compareExplorerEntries);
  return { ...entry, children };
}

function shouldSkipExplorerPath(relativePath, dirent) {
  const normalized = String(relativePath || '').replace(/\\/g, '/');
  if (!normalized) return false;
  if (normalized === '.git' || normalized.startsWith('.git/')) return true;
  if (normalized === '.bigbrain' || normalized.startsWith('.bigbrain/')) return true;
  if (normalized === '.bigbrain-state' || normalized.startsWith('.bigbrain-state/')) return true;
  if (dirent.name.startsWith('.') && dirent.name !== '.raw') return true;
  return false;
}

function compareExplorerEntries(a, b) {
  if (a.type !== b.type) return a.type === 'directory' ? -1 : 1;
  return a.name.localeCompare(b.name, undefined, { sensitivity: 'base', numeric: true });
}

function normalizeExplorerPath(input) {
  const trimmed = String(input || '').trim().replace(/\\/g, '/').replace(/^\/+/, '');
  if (!trimmed) throw new Error('Explorer path is required.');
  const normalized = path.posix.normalize(trimmed);
  if (normalized === '.' || normalized.startsWith('../') || path.posix.isAbsolute(normalized)) {
    throw new Error(`Invalid explorer path: ${input}`);
  }
  if (normalized.split('/').some((part) => !part || part === '.' || part === '..')) {
    throw new Error(`Invalid explorer path: ${input}`);
  }
  return normalized;
}

function safeExplorerPath(brainDir, relativePath) {
  const fullPath = path.resolve(brainDir, relativePath);
  const root = path.resolve(brainDir);
  if (fullPath !== root && !fullPath.startsWith(`${root}${path.sep}`)) {
    throw new Error(`Path escapes brain root: ${relativePath}`);
  }
  return fullPath;
}

function viewerKindForMime(mimeType, relativePath) {
  const extension = path.extname(relativePath).toLowerCase();
  if (extension === '.md' || extension === '.markdown') return 'markdown';
  if (mimeType === 'application/pdf') return 'pdf';
  if (mimeType.startsWith('image/')) return 'image';
  if (mimeType.startsWith('text/') || ['.json', '.csv', '.yaml', '.yml', '.log'].includes(extension)) return 'text';
  return 'unsupported';
}

function mimeTypeForPath(relativePath) {
  const extension = path.extname(relativePath).toLowerCase();
  return {
    '.md': 'text/markdown; charset=utf-8',
    '.markdown': 'text/markdown; charset=utf-8',
    '.txt': 'text/plain; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.csv': 'text/csv; charset=utf-8',
    '.yaml': 'text/yaml; charset=utf-8',
    '.yml': 'text/yaml; charset=utf-8',
    '.log': 'text/plain; charset=utf-8',
    '.pdf': 'application/pdf',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.webp': 'image/webp',
    '.svg': 'image/svg+xml',
    '.heic': 'image/heic',
  }[extension] || 'application/octet-stream';
}

function stripSourceReferences(value) {
  return value.replace(/\[Source:[^\]]+\]/g, '').replace(/\s+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}

async function buildRecentPayload(db) {
  const pages = (await listPages(db)).slice(-24).reverse();
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

export async function buildGraphPayload(db) {
  const pages = await listPages(db);
  const graphPages = pages.filter(isDirectoryBackedGraphPage);
  const candidateNodes = (await Promise.all(graphPages.map(async (page) => {
    const outgoing = await getOutgoingLinks(db, page.slug);
    const backlinks = await getBacklinks(db, page.slug);
    return {
      slug: page.slug,
      title: page.title,
      type: page.type,
      updated_at: page.updated_at,
      degree: outgoing.length + backlinks.length,
      outgoing,
    };
  }))).sort((a, b) => b.degree - a.degree || a.slug.localeCompare(b.slug));

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
      page_count: candidateNodes.length,
      node_count: candidateNodes.length,
      edge_count: edges.length,
    },
    nodes: candidateNodes.map((node) => ({
      slug: node.slug,
      title: node.title,
      type: node.type,
      updated_at: node.updated_at,
      degree: node.degree,
    })),
    edges,
  };
}

export function isDirectoryBackedGraphPage(page) {
  return typeof page?.slug === 'string' && page.slug.includes('/');
}
