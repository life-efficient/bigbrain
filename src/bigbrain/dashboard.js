import http from 'node:http';
import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

import { build } from 'esbuild';

import {
  getBacklinks,
  getMcpAuditAnalytics,
  getOutgoingLinks,
  getPagesBySlugs,
  listPageProvenance,
  getSharedGroup,
  listMcpAuditLog,
  listPages,
  openDatabase,
} from './db.js';
import { runHealthCheck } from './health.js';
import { authenticatedBrainAbout, isBrainProfileDocument, loadBrainProfile } from './brain-profile.js';
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
import {
  buildKeepInTouchPayload,
  enrollKeepInTouchPerson,
  logKeepInTouchContact,
  setKeepInTouchPriority,
  snoozeKeepInTouchPerson,
} from './playbooks/keep-in-touch.js';
import { getRelatedLinkHistory } from './link-history.js';
import {
  normalizePageVisibility,
  normalizeRawPath,
  pageVisibility,
  publicRawFiles,
  safeBrainPath,
  updatePageVisibility,
} from './page-ops.js';
import { canonicalPagePath, normalizeCanonicalPageSlug, parseCanonicalPagePath } from './page-links.js';
import {
  PUBLIC_RAW_CONTENT_SECURITY_POLICY,
  publicRawMimeTypeForPath,
} from './public-raw-policy.js';

const moduleDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(moduleDir, '..', '..');
const dashboardClientEntry = path.join(repoRoot, 'src', 'dashboard-client', 'main.jsx');
const execFileAsync = promisify(execFile);
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
      const publicRequest = isPublicAppPath(requestUrl.pathname)
        || isSharedAppPath(requestUrl.pathname)
        || (req.method === 'GET' && (
          requestUrl.pathname === '/api/public/page'
          || requestUrl.pathname === '/api/public/raw'
          || requestUrl.pathname === '/api/shared/group'
          || requestUrl.pathname === '/api/shared/raw'
        ));
      if (authEnabled && !publicRequest && requestUrl.pathname !== '/favicon.ico' && !requestUrl.pathname.startsWith('/assets/')) {
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
      const canonicalRouteBasePath = canonicalPageRouteBasePath(requestUrl.pathname, normalizedBasePath);
      if (canonicalRouteBasePath !== null) {
        if (req.method !== 'GET') {
          res.writeHead(405, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
          res.end(JSON.stringify({ error: 'Canonical page routes require GET.' }));
          return;
        }
        let target;
        try {
          target = parseCanonicalPagePath(requestUrl.pathname, { basePath: canonicalRouteBasePath });
        } catch {
          target = null;
        }
        if (!target || target.brainId !== config.brainId || !await canonicalPageExists(config, target.slug)) {
          res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' });
          res.end('Page not found');
          return;
        }
        res.writeHead(200, {
          'Content-Type': 'text/html; charset=utf-8',
          'Cache-Control': 'no-store',
        });
        res.end(renderAppHtml());
        return;
      }
      if (isPublicAppPath(requestUrl.pathname)) {
        const redirectLocation = await publicRedirectLocation(config, db, requestUrl);
        if (redirectLocation) {
          res.writeHead(308, {
            location: redirectLocation,
            'Cache-Control': 'no-store',
          });
          res.end();
          return;
        }
        res.writeHead(200, {
          'Content-Type': 'text/html; charset=utf-8',
          'Cache-Control': 'no-store',
        });
        res.end(renderAppHtml());
        return;
      }
      if (isSharedAppPath(requestUrl.pathname)) {
        const redirectLocation = await sharedRedirectLocation(db, requestUrl);
        if (redirectLocation) {
          res.writeHead(308, {
            location: redirectLocation,
            'Cache-Control': 'no-store',
          });
          res.end();
          return;
        }
        res.writeHead(200, {
          'Content-Type': 'text/html; charset=utf-8',
          'Cache-Control': 'no-store',
        });
        res.end(renderAppHtml());
        return;
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
      if (requestUrl.pathname === '/api/about') {
        if (req.method !== 'GET') {
          res.writeHead(405, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
          res.end(JSON.stringify({ error: 'About requests require GET.' }));
          return;
        }
        const loaded = await loadBrainProfile(config);
        return json(res, authenticatedBrainAbout(config, loaded, {
          authState: actor ? 'authenticated' : 'local_trusted',
          writable: false,
          availableOperations: ['read'],
        }), { noStore: true });
      }
      if (requestUrl.pathname === '/api/tasks') return json(res, await buildTasksPayload(config, db, requestUrl, { actor }));
      if (requestUrl.pathname === '/api/recent') return json(res, await buildRecentPayload(db));
      if (requestUrl.pathname === '/api/graph/events') return streamGraphEvents(db, res);
      if (requestUrl.pathname === '/api/graph') return json(res, await buildGraphPayload(db, config), { noStore: true });
      if (requestUrl.pathname === '/api/graph/lineage') {
        const lineage = await buildGraphLineagePayload(db, config, requestUrl.searchParams.get('slug'));
        if (!lineage) {
          res.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
          res.end(JSON.stringify({ error: 'Graph lineage page not found.' }));
          return;
        }
        return json(res, lineage, { noStore: true });
      }
      if (requestUrl.pathname === '/api/health') return json(res, await buildHealthPayload(config));
      if (requestUrl.pathname === '/api/analytics') return json(res, await buildAnalyticsPayload(config, db));
      if (requestUrl.pathname === '/api/playbooks/keep-in-touch') {
        if (req.method !== 'GET') {
          res.writeHead(405, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
          res.end(JSON.stringify({ error: 'Keep in Touch reads require GET.' }));
          return;
        }
        return json(res, await buildKeepInTouchPayload(config, db, { actor }), { noStore: true });
      }
      if (requestUrl.pathname.startsWith('/api/playbooks/keep-in-touch/')) {
        return json(res, await handleKeepInTouchMutation(config, db, req, requestUrl, actor), { noStore: true });
      }
      if (requestUrl.pathname === '/api/page') return json(res, await buildPagePayload(config, db, requestUrl));
      if (requestUrl.pathname === '/api/page/visibility') return json(res, await updateDashboardPageVisibility(config, db, req, actor));
      if (requestUrl.pathname === '/api/preview') return json(res, await buildPreviewPayload(config, db, requestUrl));
      if (requestUrl.pathname === '/api/public/page') {
        if (req.method !== 'GET') {
          res.writeHead(405, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
          res.end(JSON.stringify({ error: 'Public page requests require GET.' }));
          return;
        }
        const publicPayload = await buildPublicPagePayload(config, requestUrl);
        if (!publicPayload) {
          res.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
          res.end(JSON.stringify({ error: 'Public page not found.' }));
          return;
        }
        return json(res, publicPayload);
      }
      if (requestUrl.pathname === '/api/public/raw') return servePublicRawFile(config, res, requestUrl, req.method);
      if (requestUrl.pathname === '/api/shared/group') {
        if (req.method !== 'GET') {
          res.writeHead(405, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
          res.end(JSON.stringify({ error: 'Shared group requests require GET.' }));
          return;
        }
        const groupPayload = await buildSharedGroupPayload(config, db, requestUrl);
        if (!groupPayload) {
          res.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
          res.end(JSON.stringify({ error: 'Shared group not found.' }));
          return;
        }
        return json(res, groupPayload);
      }
      if (requestUrl.pathname === '/api/shared/raw') return serveSharedRawFile(config, db, res, requestUrl, req.method);
      if (requestUrl.pathname === '/api/explorer/tree') return json(res, await buildExplorerTreePayload(config));
      if (requestUrl.pathname === '/api/explorer/recent') return json(res, await buildExplorerRecentPayload(config, requestUrl));
      if (requestUrl.pathname === '/api/explorer/file') return json(res, await buildExplorerFilePayload(config, requestUrl));
      if (requestUrl.pathname === '/api/explorer/blob') return serveExplorerBlob(config, res, requestUrl);
      res.writeHead(404);
      res.end('Not found');
    } catch (error) {
      console.error(`Dashboard request failed: ${req.url || '/'}: ${error instanceof Error ? error.stack || error.message : String(error)}`);
      res.writeHead(error?.statusCode || 500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }));
    }
  };
}

export async function buildAnalyticsPayload(config, db) {
  return {
    retention_days: config.mcpAuditRetentionDays,
    privacy_note: 'Counts and bounded operational metadata only. Content, prompts, queries, credentials, headers, cookies, IP addresses, and user agents are not stored.',
    ...await getMcpAuditAnalytics(db),
  };
}

async function handleKeepInTouchMutation(config, db, req, requestUrl, actor = null) {
  if (req.method !== 'POST') {
    const error = new Error('Keep in Touch actions require POST.');
    error.statusCode = 405;
    throw error;
  }
  const input = await readJsonRequest(req);
  const action = requestUrl.pathname.slice('/api/playbooks/keep-in-touch/'.length);
  switch (action) {
    case 'enroll':
      return enrollKeepInTouchPerson(config, db, input, { actor });
    case 'log-contact':
      return logKeepInTouchContact(config, db, input, { actor });
    case 'set-priority':
      return setKeepInTouchPriority(config, db, input, { actor });
    case 'snooze':
      return snoozeKeepInTouchPerson(config, db, input, { actor });
    default: {
      const error = new Error(`Unknown Keep in Touch action: ${action}`);
      error.statusCode = 404;
      throw error;
    }
  }
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

async function servePublicRawFile(config, res, requestUrl, method = 'GET') {
  if (method !== 'GET') {
    res.writeHead(405, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify({ error: 'Public raw file requests require GET.' }));
    return;
  }
  const payload = await buildPublicRawFilePayload(config, requestUrl);
  if (!payload) {
    res.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify({ error: 'Public raw file not found.' }));
    return;
  }
  res.writeHead(200, {
    'Content-Type': payload.mime_type,
    'Content-Length': payload.size,
    'Cache-Control': 'public, max-age=300',
    'Content-Security-Policy': PUBLIC_RAW_CONTENT_SECURITY_POLICY,
    'Content-Disposition': `inline; filename="${payload.filename.replace(/["\\]/g, '')}"`,
    'X-Content-Type-Options': 'nosniff',
  });
  const { createReadStream } = await import('node:fs');
  await new Promise((resolve, reject) => {
    const stream = createReadStream(payload.fullPath);
    stream.once('error', reject);
    res.once('error', reject);
    res.once('finish', resolve);
    stream.pipe(res);
  });
}

async function serveSharedRawFile(config, db, res, requestUrl, method = 'GET') {
  if (method !== 'GET') {
    res.writeHead(405, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify({ error: 'Shared raw file requests require GET.' }));
    return;
  }
  const payload = await buildSharedRawFilePayload(config, db, requestUrl);
  if (!payload) {
    res.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify({ error: 'Shared raw file not found.' }));
    return;
  }
  res.writeHead(200, {
    'Content-Type': payload.mime_type,
    'Content-Length': payload.size,
    'Cache-Control': 'public, max-age=300',
    'Content-Security-Policy': PUBLIC_RAW_CONTENT_SECURITY_POLICY,
    'Content-Disposition': `inline; filename="${payload.filename.replace(/["\\]/g, '')}"`,
    'X-Content-Type-Options': 'nosniff',
  });
  const { createReadStream } = await import('node:fs');
  await new Promise((resolve, reject) => {
    const stream = createReadStream(payload.fullPath);
    stream.once('error', reject);
    res.once('error', reject);
    res.once('finish', resolve);
    stream.pipe(res);
  });
}

function json(res, value, { noStore = false } = {}) {
  res.writeHead(200, {
    'Content-Type': 'application/json; charset=utf-8',
    ...(noStore ? { 'Cache-Control': 'no-store' } : {}),
  });
  res.end(JSON.stringify(value, null, 2));
}

async function readJsonRequest(req, { maxBytes = 64 * 1024 } = {}) {
  const chunks = [];
  let total = 0;
  for await (const chunk of req) {
    total += chunk.length;
    if (total > maxBytes) throw new Error('Request body is too large.');
    chunks.push(chunk);
  }
  const text = Buffer.concat(chunks).toString('utf8').trim();
  return text ? JSON.parse(text) : {};
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
  if (!basePath) return pathname === '/' || pathname === '/index.html' || pathname === '/graph-lab';
  return pathname === basePath || pathname === `${basePath}/` || pathname === `${basePath}/index.html`;
}

function canonicalPageRouteBasePath(pathname, basePath) {
  const value = String(pathname || '');
  const configuredPrefix = `${basePath}/page/`.replace(/^\/\//, '/');
  if (value.startsWith(configuredPrefix)) return basePath;
  if (!basePath && value.startsWith('/dashboard/page/')) return '/dashboard';
  return null;
}

function isPublicAppPath(pathname) {
  return pathname === '/public' || pathname.startsWith('/public/');
}

function isSharedAppPath(pathname) {
  return pathname === '/shared' || pathname.startsWith('/shared/');
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
      .public-main { min-height: 100vh; height: 100vh; overflow: auto; display: block; padding: 42px 22px 64px; background: #fafafa; color: #18181b; }
      .public-document { width: min(820px, 100%); margin: 0 auto; display: grid; gap: 22px; }
      .public-document.shared-group-document { width: min(1040px, 100%); }
      .public-document-head { display: flex; align-items: center; justify-content: space-between; gap: 16px; padding-bottom: 18px; border-bottom: 1px solid #e4e4e7; }
      .public-document-head h1,
      .public-document > h1 { margin: 0; color: #18181b; font-size: 40px; line-height: 1.08; letter-spacing: 0; }
      .shared-group-head { align-items: flex-end; }
      .shared-group-head .empty-copy { margin-top: 8px; font-size: 16px; line-height: 1.55; }
      .shared-group-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 14px; align-items: stretch; }
      .shared-group-card { display: grid; align-content: start; gap: 12px; min-height: 220px; padding: 18px; border: 1px solid #e4e4e7; border-radius: 8px; background: #fff; color: inherit; text-decoration: none; transition: border-color 140ms ease, box-shadow 140ms ease, transform 140ms ease; }
      .shared-group-card[href] { cursor: pointer; }
      .shared-group-card[href]:hover { border-color: #a1a1aa; box-shadow: 0 10px 24px rgba(24,24,27,0.08); transform: translateY(-1px); }
      .shared-group-card[href]:focus-visible { outline: 3px solid rgba(23,86,232,0.28); outline-offset: 3px; }
      .shared-group-card h2 { margin: 0; color: #18181b; font-size: 21px; line-height: 1.2; letter-spacing: 0; }
      .shared-group-card p { margin: 0; color: #52525b; font-size: 14px; line-height: 1.55; }
      .shared-group-files { display: grid; gap: 8px; margin-top: 4px; }
      .shared-group-files a { display: block; padding: 10px 11px; border: 1px solid #d4d4d8; border-radius: 8px; color: #18181b; background: #fafafa; text-decoration: none; font-size: 13px; font-weight: 650; overflow-wrap: anywhere; }
      .shared-group-files a:hover { border-color: #a1a1aa; background: #f4f4f5; }
      .public-view-toggle { display: inline-grid; grid-template-columns: repeat(2, 34px); gap: 4px; padding: 3px; border: 1px solid #d4d4d8; border-radius: 8px; background: #fff; flex: 0 0 auto; }
      .public-view-button { width: 34px; height: 30px; display: inline-grid; place-items: center; border: 0; border-radius: 6px; background: transparent; color: #52525b; cursor: pointer; font-size: 17px; line-height: 1; }
      .public-view-button:hover { background: #f4f4f5; color: #18181b; }
      .public-view-button.active { background: #18181b; color: #fafafa; }
      .public-document .meta,
      .public-document .empty-copy,
      .public-document p { color: #52525b; }
      .public-document .markdown-shell { color: #18181b; }
      .public-document .tailwind-prose { color: #18181b; font-size: 16px; line-height: 1.72; }
      .public-document .tailwind-prose h1,
      .public-document .tailwind-prose h2,
      .public-document .tailwind-prose h3,
      .public-document .tailwind-prose h4,
      .public-document .tailwind-prose strong { color: #18181b; }
      .public-document .tailwind-prose a { color: #155eef; }
      .public-document.raw-file-view-grid .tailwind-prose ul:has(a[href*="/api/public/raw"]) { display: grid; grid-template-columns: repeat(auto-fit, minmax(210px, 1fr)); gap: 10px; padding-left: 0; list-style: none; }
      .public-document.raw-file-view-grid .tailwind-prose ul:has(a[href*="/api/public/raw"]) li { margin: 0; }
      .public-document.raw-file-view-grid .tailwind-prose ul:has(a[href*="/api/public/raw"]) a { display: block; min-height: 76px; padding: 13px 14px; border: 1px solid #e4e4e7; border-radius: 8px; background: #fff; text-decoration: none; color: #18181b; font-weight: 650; }
      .public-document.raw-file-view-grid .tailwind-prose ul:has(a[href*="/api/public/raw"]) a:hover { border-color: #a1a1aa; background: #f8fafc; }
      .public-document .tailwind-prose code { background: #f4f4f5; color: #18181b; }
      .public-document .tailwind-prose pre { background: #18181b; color: #fafafa; border-radius: 8px; }
      .public-document .tailwind-prose blockquote { border-left-color: #d4d4d8; color: #52525b; }
      .public-document .tailwind-prose th,
      .public-document .tailwind-prose td { border-color: #e4e4e7; }
      .public-document .tailwind-prose th { background: #f4f4f5; }
      h1 { font-size: 44px; margin: 0 0 6px; letter-spacing: -0.03em; }
      h2 { margin: 0 0 14px; font-size: 20px; }
      h3 { margin: 0 0 10px; font-size: 14px; text-transform: uppercase; letter-spacing: 0.06em; color: var(--muted); }
      p { color: var(--muted); margin: 0; }
      .desktop-drag-strip { display: none; }
      .topline { display: grid; grid-template-columns: minmax(44px, 1fr) auto minmax(44px, 1fr); align-items: center; gap: 16px; margin-bottom: 18px; -webkit-app-region: no-drag; user-select: none; }
      .topline-brand { display: flex; align-items: center; justify-self: start; min-width: 0; width: 100%; }
      .topline-actions { display: flex; align-items: center; gap: 12px; justify-self: end; }
      .demo-mode-badge { display: inline-flex; align-items: center; min-height: 28px; padding: 0 10px; border: 1px solid rgba(0,255,102,0.28); border-radius: 999px; background: rgba(0,255,102,0.08); color: var(--ink); font: 700 10px/1 ui-monospace, SFMono-Regular, Menlo, monospace; letter-spacing: 0.08em; text-transform: uppercase; }
      .view-nav { display: flex; gap: 10px; flex-wrap: wrap; }
      .view-nav-header { justify-content: center; justify-self: center; }
      .view-nav, .view-chip, .topline-actions, .topline-actions > *, .settings-button, .health-button, .settings-dropdown, .health-dropdown { -webkit-app-region: no-drag; }
      html.bigbrain-desktop .desktop-drag-strip { display: block; position: absolute; z-index: 20; top: 0; left: 74px; right: 14px; height: 14px; -webkit-app-region: drag; }
      html.bigbrain-desktop .topline { grid-template-columns: minmax(190px, 1fr) auto minmax(190px, 1fr); padding-left: 60px; }
      @media (max-width: 820px) {
        html.bigbrain-desktop .topline { grid-template-columns: minmax(150px, 1fr) auto minmax(150px, 1fr); gap: 8px; padding-left: 58px; }
        html.bigbrain-desktop .view-nav, html.bigbrain-desktop .topline-actions { gap: 8px; }
      }
      @media (max-width: 740px) {
        html.bigbrain-desktop .view-chip-kbd { display: none; }
      }
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
      .settings-link { display: flex; align-items: center; justify-content: space-between; gap: 12px; width: 100%; padding: 12px 14px; border: 1px solid var(--line); border-radius: 12px; background: var(--surface); color: var(--ink); font: inherit; font-size: 13px; cursor: pointer; text-align: left; }
      .settings-link:hover { border-color: var(--line-strong); background: var(--surface-muted); }
      .settings-demo-toggle.selected { border-color: rgba(0,255,102,0.28); background: rgba(0,255,102,0.08); }
      .settings-demo-toggle strong { font-size: 11px; font-weight: 700; }
      .settings-shortcut { display: inline-flex; align-items: center; justify-content: center; min-width: 18px; margin-left: 5px; padding: 3px 5px; border: 1px solid var(--line); border-bottom-color: var(--line-strong); border-radius: 5px; color: var(--muted); font: 700 10px/1 ui-monospace, SFMono-Regular, Menlo, monospace; }
      .playbooks-menu { position: relative; }
      .playbooks-button { min-height: 38px; display: inline-flex; align-items: center; gap: 8px; padding: 0 13px; border: 1px solid var(--line); border-radius: 999px; background: var(--surface); color: var(--muted); font: inherit; font-size: 12px; font-weight: 700; cursor: pointer; box-shadow: 0 6px 18px rgba(15,23,42,0.04); }
      .playbooks-button:hover, .playbooks-button.open { color: var(--ink); border-color: var(--line-strong); background: var(--surface-muted); }
      .playbooks-live-dot { width: 6px; height: 6px; border-radius: 999px; background: #73ecb8; box-shadow: 0 0 10px #73ecb8; }
      .playbooks-dropdown { position: absolute; top: calc(100% + 10px); right: 0; z-index: 24; width: min(360px, calc(100vw - 40px)); display: grid; gap: 12px; padding: 14px; border: 1px solid var(--line); border-radius: 18px; background: var(--panel); box-shadow: var(--shadow-float); backdrop-filter: blur(18px); }
      .playbooks-dropdown-head, .playbook-section-head, .playbook-queue-head { display: flex; align-items: baseline; justify-content: space-between; gap: 16px; }
      .playbooks-dropdown-head { padding-bottom: 2px; }
      .playbook-launcher-item { display: grid; gap: 12px; padding: 13px; border: 1px solid var(--line); border-radius: 14px; background: var(--surface); }
      .playbook-launcher-copy { display: grid; gap: 5px; }
      .playbook-launcher-copy strong { font-size: 13px; }
      .playbook-launcher-copy span, .playbooks-dropdown-foot { color: var(--muted); font-size: 11px; line-height: 1.45; }
      .playbook-launcher-actions { display: flex; align-items: center; gap: 8px; }
      .playbook-launcher-actions .settings-link { flex: 1; }
      .playbook-text-button { border: 0; padding: 8px 5px; background: transparent; color: var(--muted); font: inherit; font-size: 11px; cursor: pointer; }
      .playbook-text-button:hover { color: var(--ink); }
      .playbooks-dropdown-foot { padding: 0 2px; }
      .playbook-page { flex: 1; min-height: 0; overflow: auto; display: grid; align-content: start; gap: 18px; padding: 6px 2px 24px; }
      .playbook-head { display: flex; align-items: flex-end; justify-content: space-between; gap: 20px; padding: 14px 2px 4px; }
      .playbook-head h1 { margin: 4px 0 7px; font-size: 38px; }
      .playbook-head p { max-width: 560px; font-size: 14px; line-height: 1.5; }
      .playbook-primary-action { flex: 0 0 auto; }
      .playbook-metrics { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 12px; }
      .playbook-metric { min-height: 96px; display: grid; align-content: space-between; gap: 10px; padding: 15px 17px; border: 1px solid var(--line); border-radius: 16px; background: var(--surface); }
      .playbook-metric span { color: var(--muted); font-size: 11px; font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase; }
      .playbook-metric strong { font-size: 29px; letter-spacing: -0.04em; }
      .playbook-metric.tone-warm strong { color: #f2cf8a; }
      .playbook-metric.tone-alert strong { color: #fca5a5; }
      .playbook-metric.tone-quiet strong { color: var(--ink); }
      .playbook-enroll { display: grid; gap: 13px; padding: 17px; border-radius: 18px; }
      .playbook-section-head h2, .playbook-queue-head h2 { margin: 5px 0 0; font-size: 19px; letter-spacing: -0.02em; }
      .playbook-search { width: 100%; min-height: 40px; padding: 9px 12px; border: 1px solid var(--line); border-radius: 10px; background: var(--surface); color: var(--ink); font: inherit; font-size: 13px; }
      .playbook-search:focus-visible { outline: 2px solid var(--accent-strong); outline-offset: 2px; }
      .playbook-candidate-list { display: grid; gap: 6px; max-height: 260px; overflow: auto; }
      .playbook-candidate { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 9px 10px; border: 1px solid rgba(148,163,184,0.12); border-radius: 10px; background: rgba(255,255,255,0.025); }
      .playbook-candidate-copy { min-width: 0; display: grid; gap: 3px; }
      .playbook-candidate-copy strong { overflow: hidden; font-size: 12px; text-overflow: ellipsis; white-space: nowrap; }
      .playbook-candidate-copy span { overflow: hidden; color: var(--muted); font: 10px/1.2 ui-monospace, SFMono-Regular, Menlo, monospace; text-overflow: ellipsis; white-space: nowrap; }
      .playbook-small-button { flex: 0 0 auto; padding: 7px 9px; border: 1px solid var(--line); border-radius: 8px; background: var(--surface); color: var(--ink); font: inherit; font-size: 11px; cursor: pointer; }
      .playbook-small-button:hover { border-color: var(--line-strong); background: var(--surface-muted); }
      .playbook-small-button:disabled { opacity: 0.52; cursor: not-allowed; }
      .playbook-record-list { display: grid; gap: 10px; }
      .playbook-record { display: flex; align-items: center; justify-content: space-between; gap: 18px; padding: 16px 17px; border-radius: 16px; }
      .playbook-record.is-due { border-color: rgba(242,207,138,0.32); }
      .playbook-record.is-overdue { border-color: rgba(252,165,165,0.38); background: linear-gradient(100deg, rgba(127,29,29,0.15), var(--card)); }
      .playbook-record-main { min-width: 0; display: grid; gap: 8px; }
      .playbook-record-title-row { display: flex; align-items: center; gap: 9px; min-width: 0; }
      .playbook-person-link { min-width: 0; overflow: hidden; padding: 0; border: 0; background: transparent; color: var(--ink); font: inherit; font-size: 17px; font-weight: 700; letter-spacing: -0.02em; text-align: left; text-overflow: ellipsis; white-space: nowrap; cursor: pointer; }
      .playbook-person-link:hover { text-decoration: underline; text-underline-offset: 3px; }
      .playbook-priority { display: inline-flex; align-items: center; min-height: 23px; padding: 3px 7px; border: 1px solid var(--line); border-radius: 7px; color: var(--muted); font: 800 10px/1 ui-monospace, SFMono-Regular, Menlo, monospace; }
      .playbook-priority.priority-1 { color: #fca5a5; border-color: rgba(252,165,165,0.38); background: rgba(127,29,29,0.18); }
      .playbook-priority.priority-2 { color: #f2cf8a; border-color: rgba(242,207,138,0.32); background: rgba(146,96,24,0.12); }
      .playbook-record-meta { display: flex; flex-wrap: wrap; gap: 8px 13px; color: var(--muted); font-size: 11px; }
      .playbook-record-meta > span:not(:first-child)::before { content: "·"; margin-right: 13px; color: var(--line-strong); }
      .playbook-due.due { color: #f2cf8a; font-weight: 700; }
      .playbook-due.overdue { color: #fca5a5; font-weight: 700; }
      .playbook-record-summary { max-width: 740px; overflow: hidden; color: var(--muted); font-size: 12px; line-height: 1.45; text-overflow: ellipsis; white-space: nowrap; }
      .playbook-record-actions { flex: 0 0 auto; display: flex; align-items: center; justify-content: flex-end; gap: 7px; flex-wrap: wrap; }
      .playbook-action-primary { color: var(--bg); border-color: var(--ink); background: var(--ink); font-weight: 700; }
      .playbook-action-primary:hover { background: #d4d4d8; }
      .playbook-priority-picker { display: inline-flex; gap: 2px; padding: 2px; border: 1px solid var(--line); border-radius: 9px; background: var(--surface); }
      .playbook-priority-picker button { min-height: 26px; padding: 0 5px; border: 0; border-radius: 6px; background: transparent; color: var(--muted); font: 700 9px/1 ui-monospace, SFMono-Regular, Menlo, monospace; cursor: pointer; }
      .playbook-priority-picker button:hover, .playbook-priority-picker button.selected { background: var(--surface-muted); color: var(--ink); }
      .playbook-priority-picker button:disabled { opacity: 0.5; cursor: wait; }
      .playbook-empty { display: flex; align-items: center; gap: 16px; padding: 18px; }
      .playbook-empty-mark { width: 38px; height: 38px; flex: 0 0 auto; display: grid; place-items: center; border: 1px solid rgba(115,236,184,0.28); border-radius: 12px; background: rgba(115,236,184,0.08); color: #73ecb8; font-size: 20px; }
      .playbook-empty h2 { margin: 0 0 6px; font-size: 16px; }
      .playbook-empty p { max-width: 680px; font-size: 12px; line-height: 1.5; }
      .playbook-empty .graph-button { margin-left: auto; flex: 0 0 auto; }
      .playbook-error { max-width: 680px; margin: 8px auto 0; }
      .playbook-error h1 { margin: 6px 0; font-size: 28px; }
      .playbook-error p { margin-bottom: 14px; }
      .analytics-page { flex: 1; min-height: 0; overflow: auto; display: grid; align-content: start; gap: 18px; padding: 6px 2px 24px; }
      .analytics-head { display: flex; align-items: flex-end; justify-content: space-between; gap: 20px; padding: 14px 2px 4px; }
      .analytics-head h1 { margin: 3px 0 7px; font-size: 34px; }
      .eyebrow { color: var(--muted); font-size: 11px; font-weight: 700; letter-spacing: 0.1em; text-transform: uppercase; }
      .retention-pill, .outcome { border: 1px solid var(--line); border-radius: 999px; background: var(--surface); color: var(--muted); padding: 7px 10px; font-size: 11px; font-weight: 650; white-space: nowrap; }
      .analytics-metrics { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 12px; }
      .metric-card { min-height: 118px; display: grid; align-content: space-between; gap: 18px; padding: 17px; border: 1px solid var(--line); border-radius: 16px; background: var(--surface); }
      .metric-card strong { font-size: 32px; letter-spacing: -0.04em; }
      .metric-card strong.compact { font-size: 17px; letter-spacing: -0.01em; }
      .analytics-grid { display: grid; grid-template-columns: 1.5fr 1fr 1fr; gap: 12px; }
      .analytics-breakdown, .analytics-recent { padding: 17px; border-radius: 16px; }
      .analytics-breakdown h2, .analytics-recent h2 { margin: 0 0 14px; font-size: 15px; }
      .breakdown-row { display: grid; gap: 6px; margin-top: 11px; }
      .breakdown-row > div { display: flex; justify-content: space-between; gap: 12px; font-size: 12px; }
      .breakdown-row span { overflow: hidden; color: var(--muted); text-overflow: ellipsis; white-space: nowrap; }
      .breakdown-row i { display: block; height: 3px; border-radius: 999px; background: var(--ink); opacity: 0.68; }
      .analytics-section-head, .analytics-event, .analytics-event > div { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
      .analytics-event { padding: 12px 0; border-top: 1px solid var(--line); }
      .analytics-event > div:first-child { min-width: 0; align-items: flex-start; flex-direction: column; gap: 4px; }
      .analytics-event strong { max-width: 100%; overflow: hidden; font-size: 12px; text-overflow: ellipsis; white-space: nowrap; }
      .analytics-event-tail { flex: 0 0 auto; }
      .outcome { padding: 4px 7px; }
      .outcome-success { color: #86efac; border-color: rgba(134,239,172,0.24); }
      .outcome-denied, .outcome-error { color: #fca5a5; border-color: rgba(252,165,165,0.24); }
      .analytics-privacy { padding: 0 2px; font-size: 12px; line-height: 1.55; }
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
      .view-tasks.preview-open .view-stage-list { justify-content: flex-start; }
      .view-stage-graph { display: block; }
      .hero-card { min-height: 0; height: 100%; display: flex; flex-direction: column; min-width: 0; border: 0; background: transparent; box-shadow: none; backdrop-filter: none; padding: 0; }
      .list-page-card { width: min(760px, 100%); max-width: 760px; margin: 0 auto; }
      .view-tasks.preview-open .list-page-card { width: 100%; max-width: none; margin: 0; }
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
      .graph-wrap { height: 520px; overflow: hidden; position: relative; border-radius: 18px; background: transparent; border: 1px solid rgba(148,163,184,0.18); }
      .graph-wrap-expanded { flex: 1; min-height: 0; height: auto; }
      .graph-canvas-stage { position: absolute; inset: 0; transition: opacity 260ms ease, transform 320ms cubic-bezier(.22,.61,.36,1), filter 260ms ease; }
      .graph-canvas-stage-dimmed { opacity: .16; transform: scale(.975); filter: blur(1px); pointer-events: none; }
      .graph-lineage-panel { position: absolute; z-index: 5; inset: 18px; display: flex; flex-direction: column; min-width: 0; overflow: hidden; border: 1px solid rgba(148,163,184,0.24); border-radius: 18px; background: color-mix(in srgb, var(--panel) 91%, transparent); box-shadow: 0 24px 80px rgba(15,23,42,0.22); backdrop-filter: blur(22px); animation: graph-lineage-in 320ms cubic-bezier(.22,.61,.36,1); }
      @keyframes graph-lineage-in { from { opacity: 0; transform: translateY(12px) scale(.985); } to { opacity: 1; transform: translateY(0) scale(1); } }
      .graph-lineage-head { display: flex; justify-content: space-between; gap: 16px; padding: 20px 22px 16px; border-bottom: 1px solid var(--line); }
      .graph-lineage-kicker, .graph-lineage-section-title { color: var(--muted); font-size: 10px; font-weight: 800; letter-spacing: .1em; text-transform: uppercase; }
      .graph-lineage-head h3 { margin: 4px 0 3px; font-size: 20px; line-height: 1.15; }
      .graph-lineage-head span { color: var(--muted); font-size: 11px; }
      .graph-lineage-close { width: 30px; height: 30px; flex: 0 0 auto; border: 1px solid var(--line); border-radius: 999px; background: var(--surface); color: var(--ink); cursor: pointer; font-size: 20px; line-height: 1; }
      .graph-lineage-summary { display: flex; gap: 8px; padding: 12px 22px; color: var(--muted); font-size: 11px; }
      .graph-lineage-summary span { padding: 5px 9px; border: 1px solid var(--line); border-radius: 999px; background: var(--surface); }
      .graph-lineage-scroll { min-height: 0; overflow: auto; padding: 0 22px 24px; }
      .graph-lineage-track { display: grid; gap: 0; padding: 5px 0 12px; }
      .graph-lineage-event { position: relative; display: grid; grid-template-columns: 18px minmax(0,1fr); gap: 12px; padding: 13px 0; }
      .graph-lineage-event:not(:last-child)::before { content: ""; position: absolute; left: 8px; top: 29px; bottom: -1px; width: 1px; background: var(--line-strong); }
      .graph-lineage-dot { z-index: 1; width: 17px; height: 17px; margin-top: 1px; border: 3px solid var(--panel); border-radius: 999px; background: #7c9f84; box-shadow: 0 0 0 1px rgba(124,159,132,.5); }
      .graph-lineage-dot.removed { background: #b87878; box-shadow: 0 0 0 1px rgba(184,120,120,.5); }
      .graph-lineage-event-copy { min-width: 0; display: grid; gap: 6px; }
      .graph-lineage-event-meta { display: flex; flex-wrap: wrap; gap: 8px; color: var(--muted); font-size: 10px; }
      .graph-lineage-event-meta span:last-child { color: var(--ink); font-weight: 750; }
      .graph-lineage-connection { display: flex; align-items: center; flex-wrap: wrap; gap: 6px; color: var(--muted); font-size: 12px; }
      .graph-lineage-connection button, .graph-lineage-connection-card { border: 0; background: transparent; color: var(--ink); cursor: pointer; font-weight: 750; padding: 0; text-align: left; }
      .graph-lineage-connection button:hover, .graph-lineage-connection-card:hover { color: var(--accent); }
      .graph-lineage-subject { overflow: hidden; color: var(--muted); font-size: 11px; text-overflow: ellipsis; white-space: nowrap; }
      .graph-lineage-subject code { margin-left: 6px; color: var(--muted); font-size: 10px; }
      .graph-lineage-empty { padding: 22px; color: var(--muted); font-size: 12px; }
      .graph-lineage-sources, .graph-lineage-connections { display: grid; gap: 9px; padding-top: 16px; border-top: 1px solid var(--line); }
      .graph-lineage-source { display: grid; grid-template-columns: max-content minmax(0,1fr); gap: 10px; align-items: start; padding: 10px 0; }
      .graph-lineage-source-type { color: var(--muted); font-size: 10px; font-weight: 800; text-transform: uppercase; }
      .graph-lineage-source div { min-width: 0; display: grid; gap: 3px; }
      .graph-lineage-source strong { overflow: hidden; font-size: 12px; text-overflow: ellipsis; white-space: nowrap; }
      .graph-lineage-source span { overflow: hidden; color: var(--muted); font-size: 11px; text-overflow: ellipsis; white-space: nowrap; }
      .graph-lineage-connection-card { display: flex; gap: 8px; align-items: center; padding: 9px 10px; border: 1px solid var(--line); border-radius: 10px; background: var(--surface); font-size: 12px; }
      .graph-lineage-connection-card span:first-child { color: var(--muted); }
      .graph-canvas-shell { position: relative; z-index: 2; height: 100%; width: 100%; }
      .graph-svg { display: block; width: 100%; height: 100%; cursor: grab; }
      .graph-svg:active { cursor: grabbing; }
      .graph-node-screen-scale { transform-box: fill-box; transform-origin: center; transform: scale(var(--graph-node-scale, 1)); }
      .graph-flow-sibling-hidden { display: none !important; }
      .graph-flow-overlay { position: absolute; inset: 0; z-index: 3; pointer-events: none; }
      .graph-flow-network { position: absolute; inset: 0; z-index: 1; pointer-events: none; }
      .graph-flow-network svg { display: block; width: 100%; height: 100%; overflow: visible; }
      .graph-flow-column { position: absolute; top: 50%; z-index: 2; width: min(250px, 24%); display: grid; gap: 8px; transform: translateY(-50%); pointer-events: auto; }
      .graph-flow-input-column { left: 16px; }
      .graph-flow-output-column { right: 16px; }
      .graph-flow-column-head { display: flex; align-items: center; justify-content: space-between; padding: 0 2px 3px; color: rgba(244,244,245,0.68); font: 700 9px/1 ui-monospace, SFMono-Regular, Menlo, monospace; letter-spacing: 0.12em; text-transform: uppercase; }
      .graph-flow-column-head small { color: rgba(161,161,170,0.8); font: inherit; letter-spacing: 0.05em; }
      .graph-flow-card-list { display: grid; gap: 7px; }
      .graph-flow-card { width: 100%; min-width: 0; display: grid; grid-template-columns: auto minmax(0,1fr) auto; align-items: center; gap: 8px; padding: 9px 10px; border: 1px solid rgba(244,244,245,0.16); border-radius: 10px; background: rgba(12,12,14,0.8); box-shadow: 0 12px 28px rgba(0,0,0,0.22), inset 0 1px 0 rgba(255,255,255,0.04); backdrop-filter: blur(14px); color: rgba(244,244,245,0.9); font: inherit; text-align: left; cursor: pointer; transition: transform 160ms ease, border-color 160ms ease, background 160ms ease; }
      .graph-flow-card:hover, .graph-flow-card:focus-visible { border-color: rgba(244,244,245,0.34); background: rgba(24,24,27,0.9); outline: none; transform: translateY(-1px); }
      .graph-flow-card-type { width: 27px; height: 27px; display: grid; place-items: center; border: 1px solid rgba(244,244,245,0.34); border-radius: 8px; color: rgba(244,244,245,0.88); background: rgba(244,244,245,0.08); font: 800 10px/1 ui-monospace, SFMono-Regular, Menlo, monospace; }
      .graph-flow-card-markers { display: flex; align-items: center; gap: 4px; }
      .graph-flow-card-source, .graph-flow-card-avatar { width: 25px; height: 25px; display: grid; place-items: center; flex: 0 0 auto; border: 1px solid currentColor; }
      .graph-flow-card-source { border-radius: 7px; background: rgba(244,244,245,0.07); }
      .graph-flow-card-source-gmail { color: #f28b82; }
      .graph-flow-card-source-whatsapp { color: #5bd48b; }
      .graph-flow-card-source-slack { color: #c084fc; }
      .graph-flow-card-source-calendar { color: #7dd3fc; }
      .graph-flow-card-source-granola { color: #f5c26b; }
      .graph-flow-card-avatar { border-radius: 999px; color: rgba(244,244,245,0.9); background: rgba(244,244,245,0.1); font: 800 8px/1 ui-monospace, SFMono-Regular, Menlo, monospace; letter-spacing: 0.02em; }
      .graph-flow-card-task { border-radius: 999px; }
      .graph-flow-card-copy { min-width: 0; display: grid; gap: 4px; }
      .graph-flow-card-copy strong { overflow: hidden; color: rgba(250,250,250,0.92); font-size: 11px; font-weight: 650; text-overflow: ellipsis; white-space: nowrap; }
      .graph-flow-card-copy small { overflow: hidden; color: rgba(161,161,170,0.88); font: 8px/1.1 ui-monospace, SFMono-Regular, Menlo, monospace; text-overflow: ellipsis; white-space: nowrap; }
      .graph-flow-card > i { width: 5px; height: 5px; border-radius: 999px; background: #f4f4f5; box-shadow: 0 0 10px rgba(244,244,245,0.7); }
      .graph-flow-card-status { max-width: 48px; overflow: hidden; color: rgba(212,212,216,0.84); font: 700 7px/1 ui-monospace, SFMono-Regular, Menlo, monospace; letter-spacing: 0.06em; text-overflow: ellipsis; text-transform: uppercase; }
      .graph-flow-arc, .graph-flow-energy { fill: none; stroke-linecap: round; vector-effect: non-scaling-stroke; }
      .graph-flow-arc { stroke-width: 0.34; opacity: 0.3; }
      .graph-flow-arc-in { stroke: url(#graph-flow-in-gradient); }
      .graph-flow-arc-out { stroke: url(#graph-flow-out-gradient); }
      .graph-flow-energy { stroke-width: 1.35; stroke-dasharray: 18 40; animation: graph-flow-energy 6s linear infinite; }
      .graph-flow-energy-glow { stroke-width: 4; opacity: 0.24; filter: url(#graph-flow-blur); }
      .graph-flow-energy-in { stroke: url(#graph-flow-energy-in); }
      .graph-flow-energy-out { stroke: url(#graph-flow-energy-out); }
      @keyframes graph-flow-energy { to { stroke-dashoffset: -58; } }
      .force-shell canvas { border-radius: 18px; }
      .force3d-surface { position: absolute; inset: 0; overflow: hidden; border-radius: 18px; background: radial-gradient(circle at 50% 48%, rgba(22,32,50,0.56), rgba(9,10,14,0.98) 72%); }
      .force3d-surface > div { width: 100% !important; height: 100% !important; }
      .force3d-surface canvas { display: block; width: 100%; height: 100%; outline: none; }
      .force3d-surface .graph-info-msg { color: rgba(244,244,245,0.68); font: 700 9px/1 ui-monospace, SFMono-Regular, Menlo, monospace; letter-spacing: 0.16em; text-transform: uppercase; }
      .vis-network-surface { opacity: 0.52; transform-origin: 0 0; will-change: transform; }
      .vis-network-booted .vis-network-surface { animation: vis-network-materialize 720ms cubic-bezier(0.2, 0.8, 0.2, 1) both; }
      .vis-network-boot-overlay { position: absolute; inset: 0; z-index: 4; overflow: hidden; pointer-events: none; opacity: 0; }
      .vis-network-booted .vis-network-boot-overlay { animation: vis-network-boot-stage 760ms ease-out both; }
      .vis-network-scan-beam { position: absolute; left: 4%; right: 4%; top: 0; height: 1px; opacity: 0; background: linear-gradient(90deg, transparent, rgba(244,244,245,0.22) 12%, #ffffff 50%, rgba(244,244,245,0.22) 88%, transparent); box-shadow: 0 0 14px rgba(255,255,255,0.42); }
      .vis-network-booted .vis-network-scan-beam { animation: vis-network-scan 690ms cubic-bezier(0.25, 0.7, 0.2, 1) both; }
      .vis-network-boot-reticle { position: absolute; left: 50%; top: 50%; width: 58px; height: 58px; border: 1px solid rgba(244,244,245,0.6); border-radius: 999px; opacity: 0; transform: translate(-50%, -50%) scale(0.35); box-shadow: 0 0 20px rgba(255,255,255,0.12), inset 0 0 18px rgba(255,255,255,0.08); }
      .vis-network-booted .vis-network-boot-reticle { animation: vis-network-reticle 620ms cubic-bezier(0.2, 0.72, 0.18, 1) 80ms both; }
      .vis-network-boot-copy { position: absolute; left: 50%; top: calc(50% + 52px); color: rgba(250,250,250,0.82); font: 700 9px/1 ui-monospace, SFMono-Regular, Menlo, monospace; letter-spacing: 0.2em; transform: translateX(-50%); opacity: 0; white-space: nowrap; }
      .vis-network-booted .vis-network-boot-copy { animation: vis-network-boot-copy 580ms ease-out 110ms both; }
      .vis-network-label-layer { position: absolute; inset: 0; z-index: 2; overflow: hidden; pointer-events: none; transition: opacity 80ms ease-out; }
      .vis-network-camera-moving .vis-network-label-layer { opacity: 0; transition: none; }
      .vis-network-booting .vis-network-label-layer { opacity: 0; }
      .vis-network-booted .vis-network-label-layer { animation: vis-network-label-reveal 520ms ease-out 120ms both; }
      .vis-network-label { position: absolute; display: flex; align-items: center; max-width: min(280px, 34vw); transform: translate(10px, -50%); color: var(--ink); filter: drop-shadow(0 8px 18px rgba(0,0,0,0.24)); }
      .vis-network-label.flip { flex-direction: row-reverse; transform: translate(calc(-100% - 10px), -50%); }
      .vis-network-label-rule { width: 14px; height: 1px; flex: 0 0 auto; background: rgba(244,244,245,0.48); }
      .vis-network-label-copy { min-width: 0; display: flex; align-items: baseline; gap: 8px; padding: 5px 8px; border: 1px solid rgba(244,244,245,0.14); border-radius: 6px; background: rgba(9,9,11,0.74); backdrop-filter: blur(12px); }
      .vis-network-label-copy strong { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: rgba(244,244,245,0.78); font: 600 11px/1.15 ui-monospace, SFMono-Regular, Menlo, monospace; letter-spacing: 0.01em; }
      .vis-network-label-copy small { display: none; flex: 0 0 auto; color: rgba(161,161,170,0.9); font: 700 8px/1 ui-monospace, SFMono-Regular, Menlo, monospace; letter-spacing: 0.09em; text-transform: uppercase; }
      .vis-network-label.emphasized { z-index: 3; }
      .vis-network-label.emphasized .vis-network-label-rule { width: 20px; background: rgba(250,250,250,0.9); box-shadow: 0 0 10px rgba(255,255,255,0.34); }
      .vis-network-label.emphasized .vis-network-label-copy { padding: 7px 9px; border-color: rgba(244,244,245,0.34); background: rgba(9,9,11,0.9); box-shadow: inset 0 1px 0 rgba(255,255,255,0.06); }
      .vis-network-label.emphasized .vis-network-label-copy strong { color: #fafafa; font-size: 13px; }
      .vis-network-label.emphasized .vis-network-label-copy small { display: inline; }
      .vis-network-live-layer { position: absolute; inset: 0; z-index: 5; overflow: hidden; pointer-events: none; }
      .vis-network-live-pulse { --pulse-color: #f4f4f5; position: absolute; width: 1px; height: 1px; color: var(--pulse-color); }
      .vis-network-live-pulse.created { --pulse-color: #86efac; }
      .vis-network-live-pulse.updated { --pulse-color: #e4e4e7; }
      .vis-network-live-ring { position: absolute; left: 0; top: 0; width: 42px; height: 42px; border: 1px solid currentColor; border-radius: 999px; opacity: 0; transform: translate(-50%, -50%) scale(0.3); box-shadow: 0 0 14px color-mix(in srgb, currentColor 36%, transparent); }
      .vis-network-live-ring.outer { animation: vis-network-live-ring 1380ms cubic-bezier(0.12, 0.68, 0.22, 1) both; }
      .vis-network-live-ring.inner { width: 22px; height: 22px; animation: vis-network-live-ring 980ms cubic-bezier(0.12, 0.68, 0.22, 1) 90ms both; }
      .vis-network-live-crosshair::before, .vis-network-live-crosshair::after { content: ""; position: absolute; left: 0; top: 0; background: currentColor; opacity: 0; animation: vis-network-live-crosshair 900ms ease-out both; }
      .vis-network-live-crosshair::before { width: 54px; height: 1px; transform: translate(-50%, -50%); }
      .vis-network-live-crosshair::after { width: 1px; height: 54px; transform: translate(-50%, -50%); }
      .vis-network-live-copy { position: absolute; left: 28px; top: -23px; display: grid; gap: 4px; width: min(220px, 28vw); padding-left: 9px; border-left: 1px solid currentColor; opacity: 0; animation: vis-network-live-copy 1450ms ease-out 90ms both; filter: drop-shadow(0 5px 12px rgba(0,0,0,0.7)); }
      .vis-network-live-copy small { color: currentColor; font: 800 8px/1 ui-monospace, SFMono-Regular, Menlo, monospace; letter-spacing: 0.14em; }
      .vis-network-live-copy strong { overflow: hidden; color: #fafafa; font: 650 11px/1.25 ui-monospace, SFMono-Regular, Menlo, monospace; text-overflow: ellipsis; white-space: nowrap; }
      @keyframes vis-network-materialize { 0% { opacity: 0.52; } 45%, 100% { opacity: 1; } }
      @keyframes vis-network-boot-stage { 0%, 8% { opacity: 0; } 18%, 82% { opacity: 1; } 100% { opacity: 0; } }
      @keyframes vis-network-scan { 0% { top: 4%; opacity: 0; } 14% { opacity: 0.85; } 84% { opacity: 0.55; } 100% { top: 96%; opacity: 0; } }
      @keyframes vis-network-reticle { 0% { opacity: 0; transform: translate(-50%, -50%) scale(0.35); } 38% { opacity: 0.78; } 100% { opacity: 0; transform: translate(-50%, -50%) scale(2.35); } }
      @keyframes vis-network-boot-copy { 0% { opacity: 0; transform: translate(-50%, 5px); } 35%, 72% { opacity: 0.88; transform: translate(-50%, 0); } 100% { opacity: 0; transform: translate(-50%, -3px); } }
      @keyframes vis-network-label-reveal { from { opacity: 0; transform: translateY(3px); } to { opacity: 1; transform: translateY(0); } }
      @keyframes vis-network-live-ring { 0% { opacity: 0; transform: translate(-50%, -50%) scale(0.3); } 18% { opacity: 0.9; } 100% { opacity: 0; transform: translate(-50%, -50%) scale(2.15); } }
      @keyframes vis-network-live-crosshair { 0% { opacity: 0; } 18%, 46% { opacity: 0.66; } 100% { opacity: 0; } }
      @keyframes vis-network-live-copy { 0% { opacity: 0; transform: translateX(-5px); } 16%, 68% { opacity: 0.94; transform: translateX(0); } 100% { opacity: 0; transform: translateX(3px); } }
      @media (prefers-reduced-motion: reduce) {
        .vis-network-surface, .vis-network-booted .vis-network-surface { opacity: 1; animation: none; }
        .vis-network-boot-overlay, .vis-network-live-layer { display: none; }
        .vis-network-booting .vis-network-label-layer, .vis-network-booted .vis-network-label-layer { opacity: 1; animation: none; }
      }
      .design-lab-page {
        --lab-ink: #f5f7ff;
        --lab-muted: #8890a6;
        --lab-line: rgba(255,255,255,0.11);
        --lab-panel: rgba(16,19,31,0.74);
        height: 100vh;
        min-height: 0;
        overflow: auto;
        padding: 30px 34px 20px;
        display: grid;
        grid-template-rows: auto auto minmax(0, 1fr) auto;
        gap: 20px;
        background:
          radial-gradient(circle at 10% 0%, rgba(86,78,255,0.12), transparent 27%),
          radial-gradient(circle at 94% 100%, rgba(0,210,255,0.07), transparent 28%),
          #07080c;
        color: var(--lab-ink);
      }
      .design-lab-page * { box-sizing: border-box; }
      .design-lab-head { display: flex; align-items: flex-end; justify-content: space-between; gap: 24px; max-width: 1480px; width: 100%; margin: 0 auto; }
      .design-lab-breadcrumb { color: #7e86a0; font: 700 10px/1 ui-monospace, SFMono-Regular, Menlo, monospace; letter-spacing: 0.18em; }
      .design-lab-breadcrumb span { color: #394056; padding: 0 6px; }
      .design-lab-head h1 { margin: 10px 0 7px; color: #f6f7fb; font-size: clamp(27px, 3vw, 44px); font-weight: 500; letter-spacing: -0.055em; line-height: 1; }
      .design-lab-head p { color: #8991a6; font-size: 13px; }
      .design-lab-meta { display: grid; justify-items: end; gap: 8px; color: #697188; font: 10px/1.2 ui-monospace, SFMono-Regular, Menlo, monospace; letter-spacing: 0.08em; text-transform: uppercase; white-space: nowrap; }
      .design-lab-live { display: inline-flex; align-items: center; gap: 7px; color: #c8f7dd; }
      .design-lab-live i, .design-card-status i { width: 6px; height: 6px; display: inline-block; border-radius: 999px; background: #70edb2; box-shadow: 0 0 12px rgba(112,237,178,0.86); }
      .design-lab-switcher { width: 100%; max-width: 1480px; margin: 0 auto; display: flex; align-items: center; gap: 5px; padding: 5px; border: 1px solid rgba(255,255,255,0.08); border-radius: 14px; background: rgba(255,255,255,0.03); }
      .design-lab-switcher button { min-height: 36px; padding: 0 13px; display: inline-flex; align-items: center; justify-content: space-between; gap: 12px; border: 1px solid transparent; border-radius: 9px; color: #747d94; background: transparent; font: 650 11px/1 ui-monospace, SFMono-Regular, Menlo, monospace; letter-spacing: 0.04em; cursor: pointer; }
      .design-lab-switcher button:hover { color: #d7dbeb; background: rgba(255,255,255,0.04); }
      .design-lab-switcher button.active { color: #f8f9ff; border-color: rgba(255,255,255,0.12); background: rgba(255,255,255,0.08); box-shadow: 0 5px 18px rgba(0,0,0,0.16); }
      .design-lab-switcher kbd { min-width: 19px; padding: 4px 5px; border: 1px solid rgba(255,255,255,0.12); border-radius: 5px; color: #8b93aa; font: inherit; font-size: 9px; text-align: center; }
      .design-lab-grid { width: 100%; max-width: 1480px; min-height: 0; margin: 0 auto; display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 14px; }
      .design-lab-grid.is-focused { grid-template-columns: minmax(0, 1fr); }
      .design-lab-grid.is-focused .design-card { min-height: 520px; }
      .design-lab-grid.is-focused .design-canvas-shell { min-height: 420px; background: radial-gradient(circle at 50% 50%, rgba(32,38,64,0.35), rgba(8,10,16,0.96) 65%); }
      .design-card { min-width: 0; min-height: 0; display: grid; grid-template-rows: auto minmax(0, 1fr) auto; overflow: hidden; border: 1px solid rgba(255,255,255,0.1); border-radius: 22px; background: var(--lab-panel); box-shadow: 0 22px 60px rgba(0,0,0,0.22); }
      .design-card:hover { border-color: rgba(255,255,255,0.18); }
      .design-card-head { min-height: 106px; padding: 18px 18px 15px; display: flex; align-items: flex-start; justify-content: space-between; gap: 14px; border-bottom: 1px solid rgba(255,255,255,0.08); }
      .design-card-kicker { color: #788198; font: 700 9px/1 ui-monospace, SFMono-Regular, Menlo, monospace; letter-spacing: 0.16em; }
      .design-card-kicker span { color: #e6e9f4; }
      .design-card h2 { margin: 9px 0 5px; color: #f7f8fc; font-size: 20px; font-weight: 500; letter-spacing: -0.035em; }
      .design-card p { max-width: 340px; color: #838ca3; font-size: 11px; line-height: 1.45; }
      .design-focus-button { flex: 0 0 auto; padding: 7px 9px; border: 1px solid rgba(255,255,255,0.1); border-radius: 7px; background: rgba(255,255,255,0.03); color: #9da5b9; font: 700 9px/1 ui-monospace, SFMono-Regular, Menlo, monospace; cursor: pointer; }
      .design-focus-button:hover { color: #fff; border-color: rgba(255,255,255,0.25); background: rgba(255,255,255,0.09); }
      .design-focus-button span { padding-left: 4px; color: #6f7890; }
      .design-focus-state { flex: 0 0 auto; padding: 7px 9px; color: #b9f8d2; font: 700 9px/1 ui-monospace, SFMono-Regular, Menlo, monospace; letter-spacing: 0.1em; text-transform: uppercase; }
      .design-canvas-shell { min-height: 0; position: relative; overflow: hidden; background: #0c0f18; }
      .design-canvas { display: block; width: 100%; height: 100%; min-height: 280px; }
      .design-canvas-coordinates { position: absolute; right: 13px; bottom: 10px; left: 13px; display: flex; justify-content: space-between; color: rgba(145,154,179,0.56); font: 8px/1 ui-monospace, SFMono-Regular, Menlo, monospace; letter-spacing: 0.1em; pointer-events: none; }
      .design-card-foot { min-height: 42px; padding: 11px 15px; display: flex; align-items: center; justify-content: space-between; gap: 12px; border-top: 1px solid rgba(255,255,255,0.08); }
      .design-tag-list { min-width: 0; display: flex; flex-wrap: wrap; gap: 5px; }
      .design-tag-list span { padding: 4px 6px; border: 1px solid rgba(255,255,255,0.09); border-radius: 5px; color: #7b849a; font: 8px/1 ui-monospace, SFMono-Regular, Menlo, monospace; text-transform: uppercase; letter-spacing: 0.08em; }
      .design-card-status { flex: 0 0 auto; display: inline-flex; align-items: center; gap: 6px; color: #7f899e; font: 8px/1 ui-monospace, SFMono-Regular, Menlo, monospace; text-transform: uppercase; letter-spacing: 0.1em; }
      .design-card-console { --lab-panel: rgba(8,12,19,0.9); border-color: rgba(255,190,83,0.2); }
      .design-card-editorial { --lab-panel: #e9e5dc; color: #17213a; border-color: rgba(255,255,255,0.2); }
      .design-card-editorial .design-card-head { border-color: rgba(23,33,58,0.12); }
      .design-card-editorial .design-card-kicker, .design-card-editorial p, .design-card-editorial .design-tag-list span, .design-card-editorial .design-card-status { color: #687087; }
      .design-card-editorial h2 { color: #17213a; }
      .design-card-editorial .design-focus-button, .design-card-editorial .design-tag-list span { border-color: rgba(23,33,58,0.16); background: rgba(23,33,58,0.03); }
      .design-card-editorial .design-card-foot { border-color: rgba(23,33,58,0.12); }
      .design-card-editorial .design-canvas-shell { background: #e9e5dc; }
      .design-card-editorial .design-canvas-coordinates { color: rgba(23,33,58,0.52); }
      .design-canvas-bg { opacity: 1; }
      .design-edges path { fill: none; stroke: rgba(164,183,255,0.28); stroke-width: 0.22; vector-effect: non-scaling-stroke; }
      .design-card-aurora .design-edges path { stroke: rgba(120,193,255,0.42); stroke-width: 0.28; }
      .design-card-aurora .design-edges path:nth-child(3n) { stroke: rgba(194,128,255,0.48); }
      .design-node circle { fill: #b1c9ff; opacity: 0.92; }
      .design-node-people circle { fill: #6ce2ff; }
      .design-node-deals circle { fill: #bd9cff; }
      .design-node-ops circle { fill: #7ef0b8; }
      .design-node-ideas circle { fill: #ff9dcb; }
      .design-node-projects circle { fill: #ffd47d; }
      .design-node-meetings circle, .design-node-archive circle { fill: #a9b3ca; }
      .aurora-backdrop { opacity: 0.72; }
      .aurora-cloud { fill: #6d55ff; opacity: 0.11; filter: url(#design-aurora-soft-glow); }
      .aurora-cloud-two { fill: #00d9ff; opacity: 0.12; }
      .aurora-cloud-three { fill: #ff57aa; opacity: 0.1; }
      .aurora-sweep { fill: none; stroke: rgba(111,225,255,0.15); stroke-width: 2.3; filter: url(#design-aurora-soft-glow); }
      .aurora-core-halo { fill: rgba(92,194,255,0.23); filter: url(#design-aurora-glow); }
      .aurora-core-dot { fill: #ffffff; opacity: 0.9; }
      .aurora-node-dot { fill: #ffffff; opacity: 0.86; }
      .design-label { fill: rgba(215,225,255,0.7); font: 500 2.8px/1 ui-sans-serif, -apple-system, BlinkMacSystemFont, sans-serif; letter-spacing: 0.04em; }
      .design-label-core { fill: #ffffff; font: 700 3.2px/1 ui-sans-serif, -apple-system, BlinkMacSystemFont, sans-serif; letter-spacing: 0.03em; }
      .console-backdrop path { fill: none; stroke: rgba(247,189,88,0.13); stroke-width: 0.16; vector-effect: non-scaling-stroke; }
      .console-backdrop .console-crosshair { stroke: rgba(255,204,102,0.28); stroke-dasharray: 1 1.4; }
      .console-label, .console-readout { fill: rgba(255,202,111,0.76); font: 2.1px/1 ui-monospace, SFMono-Regular, Menlo, monospace; letter-spacing: 0.13em; }
      .console-rings circle { fill: none; stroke: rgba(255,187,69,0.15); stroke-width: 0.22; stroke-dasharray: 0.8 1.8; vector-effect: non-scaling-stroke; }
      .console-core-halo { fill: rgba(255,178,59,0.12); stroke: rgba(255,198,101,0.4); stroke-width: 0.35; }
      .console-core > circle:not(.console-core-halo) { fill: url(#design-console-core); stroke: #ffe4a5; stroke-width: 0.45; }
      .console-core path { fill: none; stroke: #1b1720; stroke-width: 0.75; stroke-linecap: round; }
      .design-card-console .design-edges path { stroke: rgba(255,198,100,0.42); stroke-width: 0.22; stroke-dasharray: 2 1.6; }
      .design-card-console .design-node rect { fill: #111827; stroke: #f0b554; stroke-width: 0.48; }
      .design-card-console .design-node-people rect { stroke: #6ce2ff; }
      .design-card-console .design-node-deals rect { stroke: #ff9f57; }
      .design-card-console .design-node-ops rect { stroke: #72e7ae; }
      .design-card-console .design-node-ideas rect { stroke: #d29bff; }
      .design-card-console .design-node-projects rect { stroke: #ffe28d; }
      .editorial-backdrop path { fill: none; stroke: rgba(23,33,58,0.16); stroke-width: 0.24; vector-effect: non-scaling-stroke; }
      .editorial-label, .editorial-readout { fill: rgba(23,33,58,0.66); font: 2.1px/1 ui-monospace, SFMono-Regular, Menlo, monospace; letter-spacing: 0.1em; }
      .design-card-editorial .design-edges path { stroke: rgba(37,65,147,0.32); stroke-width: 0.28; }
      .design-card-editorial .design-node rect { fill: #e9e5dc; stroke: #315df5; stroke-width: 0.7; }
      .design-card-editorial .design-node-people rect { stroke: #f05d75; }
      .design-card-editorial .design-node-deals rect { stroke: #315df5; }
      .design-card-editorial .design-node-ops rect { stroke: #0d8c7a; }
      .design-card-editorial .design-node-ideas rect { stroke: #d27924; }
      .design-card-editorial .design-node-projects rect { stroke: #17213a; }
      .editorial-core circle { fill: #17213a; stroke: #e9e5dc; stroke-width: 1.15; }
      .editorial-core-dot { fill: #f3c75f !important; stroke: none !important; }
      .design-lab-foot { width: 100%; max-width: 1480px; margin: 0 auto; display: flex; justify-content: space-between; color: #646d84; font: 9px/1 ui-monospace, SFMono-Regular, Menlo, monospace; letter-spacing: 0.08em; text-transform: uppercase; }
      @media (max-width: 980px) {
        .design-lab-page { padding: 22px 18px 16px; gap: 14px; }
        .design-lab-head { align-items: flex-start; flex-direction: column; gap: 16px; }
        .design-lab-meta { justify-items: start; }
        .design-lab-switcher { overflow-x: auto; }
        .design-lab-switcher button { flex: 0 0 auto; }
        .design-lab-grid { grid-template-columns: 1fr; overflow: visible; }
        .design-card { min-height: 420px; }
        .design-canvas { min-height: 300px; }
        .design-lab-foot { gap: 10px; align-items: flex-start; flex-direction: column; }
      }
      .narrative-lab {
        --lab-ink: #f5f7ff;
        --lab-muted: #8b94aa;
        --lab-line: rgba(255,255,255,0.1);
        grid-template-rows: auto auto minmax(0, 1fr) auto;
        gap: 16px;
        padding: 26px 32px 16px;
        background:
          radial-gradient(circle at 12% 8%, rgba(92,76,255,0.13), transparent 27%),
          radial-gradient(circle at 88% 88%, rgba(0,211,255,0.08), transparent 28%),
          #07090e;
      }
      .narrative-lab .design-lab-head { max-width: 1500px; }
      .narrative-lab .design-lab-head h1 { margin-top: 9px; font-size: clamp(28px, 3vw, 43px); }
      .narrative-lab .design-lab-switcher { max-width: 1500px; }
      .narrative-lab .design-lab-switcher button { min-width: 184px; }
      .narrative-stage { min-height: 0; width: 100%; max-width: 1500px; margin: 0 auto; display: grid; grid-template-rows: auto minmax(0, 1fr); overflow: hidden; border: 1px solid rgba(255,255,255,0.11); border-radius: 25px; background: rgba(12,15,24,0.78); box-shadow: 0 28px 90px rgba(0,0,0,0.28), inset 0 1px 0 rgba(255,255,255,0.04); }
      .narrative-stage-head { min-height: 76px; display: flex; align-items: center; justify-content: space-between; gap: 24px; padding: 15px 22px; border-bottom: 1px solid rgba(255,255,255,0.08); }
      .narrative-stage-kicker { color: #7e88a0; font: 700 9px/1 ui-monospace, SFMono-Regular, Menlo, monospace; letter-spacing: 0.16em; }
      .narrative-stage-head h2 { margin: 8px 0 0; color: #f8f9ff; font-size: 24px; font-weight: 500; letter-spacing: -0.04em; }
      .narrative-stage-description { max-width: 470px; color: #8b94aa; font-size: 12px; line-height: 1.5; text-align: right; }
      .concept-view { min-height: 0; height: 100%; position: relative; overflow: hidden; }
      .concept-view-loop { display: grid; grid-template-columns: minmax(210px, 0.8fr) minmax(340px, 1.35fr) minmax(210px, 0.8fr); align-items: center; gap: clamp(18px, 3vw, 48px); padding: 30px 38px 32px; background: radial-gradient(circle at 50% 50%, rgba(44,42,102,0.22), transparent 42%), linear-gradient(115deg, rgba(7,11,22,0.8), rgba(12,16,29,0.42)); }
      .concept-column { position: relative; z-index: 2; min-width: 0; }
      .concept-column-label { display: flex; align-items: baseline; gap: 8px; margin-bottom: 13px; color: #dce2f3; }
      .concept-column-label > span { color: #69748c; font: 700 9px/1 ui-monospace, SFMono-Regular, Menlo, monospace; }
      .concept-column-label strong { font: 700 10px/1 ui-monospace, SFMono-Regular, Menlo, monospace; letter-spacing: 0.12em; text-transform: uppercase; }
      .concept-column-label small { margin-left: auto; color: #68738c; font: 9px/1 ui-monospace, SFMono-Regular, Menlo, monospace; text-transform: uppercase; }
      .signal-card-list, .output-card-list { display: grid; gap: 9px; }
      .signal-card, .output-card { --tone: #80dfff; min-width: 0; min-height: 57px; display: grid; grid-template-columns: 28px minmax(0, 1fr) auto; align-items: center; gap: 10px; padding: 10px 11px; border: 1px solid color-mix(in srgb, var(--tone) 25%, transparent); border-radius: 12px; background: linear-gradient(110deg, color-mix(in srgb, var(--tone) 8%, rgba(18,23,38,0.75)), rgba(255,255,255,0.025)); box-shadow: inset 0 1px 0 rgba(255,255,255,0.04); }
      .signal-card { animation: signal-breathe 3.4s ease-in-out infinite; animation-delay: var(--signal-delay); }
      .signal-card-icon, .output-card-icon { width: 27px; height: 27px; display: grid; place-items: center; border: 1px solid color-mix(in srgb, var(--tone) 70%, white 10%); border-radius: 8px; color: var(--tone); background: color-mix(in srgb, var(--tone) 12%, transparent); font: 800 11px/1 ui-monospace, SFMono-Regular, Menlo, monospace; }
      .signal-card strong, .output-card strong { display: block; overflow: hidden; color: #eef1fa; font-size: 12px; font-weight: 700; text-overflow: ellipsis; white-space: nowrap; }
      .signal-card small, .output-card small { display: block; overflow: hidden; margin-top: 4px; color: #7e899f; font: 10px/1.2 ui-monospace, SFMono-Regular, Menlo, monospace; text-overflow: ellipsis; white-space: nowrap; }
      .signal-card-dot { width: 5px; height: 5px; border-radius: 999px; background: var(--tone); box-shadow: 0 0 11px var(--tone); }
      .output-card { animation: output-breathe 3.8s ease-in-out infinite; animation-delay: var(--signal-delay); }
      .output-card-icon { border-radius: 999px; }
      .output-card-arrow { color: var(--tone); font-size: 15px; }
      .signal-tone-cyan, .output-tone-cyan { --tone: #6ce3ff; }
      .signal-tone-green, .output-tone-green { --tone: #75efb8; }
      .signal-tone-violet, .output-tone-violet { --tone: #b399ff; }
      .signal-tone-amber, .output-tone-amber { --tone: #ffd27a; }
      .concept-core-wrap { position: relative; z-index: 3; display: grid; justify-items: center; gap: 14px; }
      .process-steps { display: inline-flex; align-items: center; gap: 9px; color: #69758f; font: 700 9px/1 ui-monospace, SFMono-Regular, Menlo, monospace; letter-spacing: 0.12em; text-transform: uppercase; }
      .process-steps span.active { color: #9feaff; }
      .process-steps b { color: #47536f; font-size: 12px; font-weight: 400; }
      .brain-core { width: 204px; height: 204px; position: relative; display: grid; place-items: center; }
      .brain-core-rings, .brain-core-orb { position: absolute; inset: 0; display: grid; place-items: center; }
      .brain-core-rings i { position: absolute; width: 100%; height: 100%; border: 1px solid rgba(111,185,255,0.24); border-radius: 50%; transform: rotate(16deg) scaleX(0.73); animation: brain-ring 5s ease-in-out infinite; }
      .brain-core-rings i:nth-child(2) { width: 78%; height: 78%; border-color: rgba(184,134,255,0.3); transform: rotate(-32deg) scaleX(0.73); animation-delay: -1.4s; }
      .brain-core-rings i:nth-child(3) { width: 58%; height: 58%; border-style: dashed; border-color: rgba(112,231,255,0.4); transform: rotate(56deg) scaleX(0.73); animation-delay: -2.7s; }
      .brain-core-orb { width: 88px; height: 88px; inset: 58px; border: 1px solid rgba(255,255,255,0.56); border-radius: 27px; background: radial-gradient(circle at 35% 26%, #e9fdff, #69dfff 26%, #7258ff 67%, #ff72ae); box-shadow: 0 0 0 9px rgba(112,204,255,0.08), 0 0 44px rgba(102,183,255,0.58), 0 22px 55px rgba(0,0,0,0.34); transform: rotate(45deg); animation: core-breathe 3.6s ease-in-out infinite; }
      .brain-core-orb span { color: #ffffff; font: 800 19px/1 ui-monospace, SFMono-Regular, Menlo, monospace; letter-spacing: -0.1em; transform: rotate(-45deg); text-shadow: 0 2px 14px rgba(0,0,0,0.4); }
      .brain-core-orb b { width: 4px; height: 4px; position: absolute; right: 13px; top: 13px; border-radius: 999px; background: #ffffff; box-shadow: 0 0 12px #ffffff; }
      .brain-core-name { position: absolute; bottom: 14px; color: rgba(235,240,255,0.86); font: 800 9px/1 ui-monospace, SFMono-Regular, Menlo, monospace; letter-spacing: 0.21em; }
      .core-message { display: grid; justify-items: center; gap: 5px; text-align: center; }
      .core-message strong { color: #f6f8ff; font-size: 17px; font-weight: 600; letter-spacing: -0.02em; }
      .core-message span { max-width: 240px; color: #7f8aa3; font: 10px/1.45 ui-monospace, SFMono-Regular, Menlo, monospace; }
      .core-telemetry { display: flex; justify-content: center; gap: 12px; color: #6d7892; font: 8px/1 ui-monospace, SFMono-Regular, Menlo, monospace; letter-spacing: 0.08em; text-transform: uppercase; }
      .core-telemetry i, .control-panel-status i, .control-graph-foot i, .action-queue-note i, .footer-pulse { width: 5px; height: 5px; display: inline-block; border-radius: 999px; background: #73ecb8; box-shadow: 0 0 10px #73ecb8; }
      .flow-network { position: absolute; inset: 0; z-index: 1; pointer-events: none; }
      .flow-network svg { width: 100%; height: 100%; display: block; overflow: visible; }
      .flow-network path { fill: none; stroke: rgba(117,201,255,0.26); stroke-width: 0.28; stroke-dasharray: 1.1 1.5; animation: flow-dash 5s linear infinite; vector-effect: non-scaling-stroke; }
      .flow-network path:nth-child(2n) { stroke: rgba(184,137,255,0.28); animation-delay: -1.3s; }
      .flow-network path:nth-child(3n) { stroke: rgba(116,239,183,0.24); animation-delay: -2.4s; }
      .flow-packet { --packet-tone: #76dcff; width: 7px; height: 7px; position: absolute; border-radius: 999px; background: var(--packet-tone); box-shadow: 0 0 16px var(--packet-tone); }
      .packet-a { left: 24%; top: 33%; animation: packet-in-one 4.4s ease-in-out infinite; }
      .packet-b { left: 29%; top: 56%; --packet-tone: #b197ff; animation: packet-in-two 5.2s ease-in-out -1.2s infinite; }
      .packet-c { left: 65%; top: 40%; --packet-tone: #77efbd; animation: packet-out-one 4.7s ease-in-out -2.1s infinite; }
      .packet-d { left: 68%; top: 57%; --packet-tone: #ffd176; animation: packet-out-two 5.4s ease-in-out -0.8s infinite; }
      .flow-caption { position: absolute; bottom: 12px; z-index: 2; color: #65718a; font: 8px/1 ui-monospace, SFMono-Regular, Menlo, monospace; letter-spacing: 0.15em; text-transform: uppercase; }
      .flow-caption-in { left: 24%; }
      .flow-caption-out { right: 24%; }

      .concept-view-reactor { background: radial-gradient(circle at 48% 50%, rgba(94,77,207,0.2), transparent 23%), radial-gradient(circle at 50% 50%, rgba(20,209,255,0.08), transparent 45%), #090c14; }
      .reactor-orbit { position: absolute; left: 49%; top: 51%; border: 1px solid rgba(117,205,255,0.17); border-radius: 50%; transform: translate(-50%, -50%) rotate(-18deg) scaleY(0.6); animation: reactor-spin 19s linear infinite; }
      .reactor-orbit-one { width: 480px; height: 480px; }
      .reactor-orbit-two { width: 330px; height: 330px; border-color: rgba(191,137,255,0.22); transform: translate(-50%, -50%) rotate(42deg) scaleY(0.6); animation-direction: reverse; animation-duration: 14s; }
      .reactor-orbit-three { width: 210px; height: 210px; border-style: dashed; border-color: rgba(118,235,188,0.2); transform: translate(-50%, -50%) rotate(-58deg) scaleY(0.6); animation-duration: 9s; }
      .reactor-orbit-label { position: absolute; z-index: 2; color: #68748d; font: 8px/1 ui-monospace, SFMono-Regular, Menlo, monospace; letter-spacing: 0.14em; }
      .reactor-orbit-label span { color: #d8e2fa; }
      .reactor-orbit-label-top { left: 30px; top: 27px; }
      .reactor-orbit-label-bottom { left: 30px; bottom: 28px; }
      .reactor-stage-copy { position: absolute; z-index: 2; display: grid; gap: 5px; }
      .reactor-stage-copy strong { color: #f2f5ff; font-size: 14px; font-weight: 600; }
      .reactor-stage-copy span { color: #77829a; font: 10px/1.2 ui-monospace, SFMono-Regular, Menlo, monospace; }
      .reactor-stage-copy-left { left: 30px; top: 47%; }
      .reactor-stage-copy-right { right: 235px; top: 47%; text-align: right; }
      .orbit-source, .orbit-output { position: absolute; z-index: 4; display: grid; grid-template-columns: 24px minmax(0, 1fr); align-items: center; gap: 7px; min-width: 122px; padding: 7px 9px; border: 1px solid color-mix(in srgb, var(--tone) 28%, transparent); border-radius: 9px; background: rgba(11,15,25,0.82); box-shadow: 0 14px 30px rgba(0,0,0,0.2); }
      .orbit-source span, .orbit-output span { width: 23px; height: 23px; display: grid; place-items: center; border-radius: 7px; color: var(--tone); background: color-mix(in srgb, var(--tone) 12%, transparent); font: 800 9px/1 ui-monospace, SFMono-Regular, Menlo, monospace; }
      .orbit-source strong, .orbit-output strong { color: #e8edf9; font-size: 10px; font-weight: 700; }
      .orbit-source small { grid-column: 2; color: #77839b; font: 8px/1.1 ui-monospace, SFMono-Regular, Menlo, monospace; }
      .orbit-source-1 { left: 22%; top: 18%; transform: rotate(-8deg); }
      .orbit-source-2 { left: 13%; top: 57%; transform: rotate(4deg); }
      .orbit-source-3 { left: 38%; top: 9%; transform: rotate(5deg); }
      .orbit-source-4 { left: 36%; bottom: 13%; transform: rotate(-4deg); }
      .orbit-output { min-width: 168px; grid-template-columns: 24px minmax(0, 1fr); }
      .orbit-output-1 { right: 21%; top: 20%; transform: rotate(7deg); }
      .orbit-output-2 { right: 12%; top: 56%; transform: rotate(-4deg); }
      .orbit-output-3 { right: 28%; bottom: 15%; transform: rotate(5deg); }
      .reactor-core-wrap { position: absolute; left: 49%; top: 51%; z-index: 5; display: grid; justify-items: center; transform: translate(-50%, -50%); }
      .reactor-core-wrap .brain-core { width: 238px; height: 238px; }
      .reactor-core-wrap .brain-core-orb { width: 102px; height: 102px; inset: 68px; background: radial-gradient(circle at 35% 26%, #fff6cc, #ffd36e 28%, #ff776e 66%, #a055f5); box-shadow: 0 0 0 14px rgba(255,195,101,0.07), 0 0 62px rgba(255,164,77,0.55), 0 0 110px rgba(146,81,255,0.25); }
      .reactor-core-wrap .brain-core-rings i { border-color: rgba(255,199,94,0.35); }
      .reactor-core-wrap .brain-core-rings i:nth-child(2) { border-color: rgba(221,146,255,0.34); }
      .reactor-core-wrap .brain-core-rings i:nth-child(3) { border-color: rgba(255,232,161,0.48); }
      .reactor-core-scan { position: absolute; left: -40px; right: -40px; top: 50%; height: 1px; background: linear-gradient(90deg, transparent, rgba(255,211,112,0.58), transparent); box-shadow: 0 0 18px rgba(255,185,67,0.7); animation: reactor-scan 4.8s ease-in-out infinite; }
      .reactor-state { position: absolute; top: 204px; left: 50%; width: 200px; display: grid; gap: 5px; text-align: center; transform: translateX(-50%); }
      .reactor-state span { color: #d8a967; font: 800 8px/1 ui-monospace, SFMono-Regular, Menlo, monospace; letter-spacing: 0.14em; }
      .reactor-state strong { color: #f9f4e7; font-size: 13px; font-weight: 600; }
      .reactor-state small { color: #a89477; font: 8px/1.2 ui-monospace, SFMono-Regular, Menlo, monospace; }
      .reactor-state i { width: 5px; height: 5px; display: inline-block; margin-right: 5px; border-radius: 999px; background: #ffcc70; box-shadow: 0 0 10px #ffcc70; }
      .reactor-side-panel { position: absolute; right: 27px; top: 27px; z-index: 6; width: 170px; padding: 13px; display: grid; gap: 12px; border: 1px solid rgba(255,205,114,0.16); border-radius: 13px; background: rgba(15,18,29,0.72); }
      .reactor-panel-head { display: flex; justify-content: space-between; color: #8691a7; font: 9px/1 ui-monospace, SFMono-Regular, Menlo, monospace; text-transform: uppercase; letter-spacing: 0.1em; }
      .reactor-panel-head strong { color: #92f1bd; font-size: 8px; }
      .reactor-metric { display: flex; align-items: baseline; justify-content: space-between; gap: 10px; }
      .reactor-metric strong { color: #f4e6c8; font: 500 21px/1 ui-monospace, SFMono-Regular, Menlo, monospace; }
      .reactor-metric span { color: #7c879d; font: 8px/1.2 ui-monospace, SFMono-Regular, Menlo, monospace; text-align: right; }
      .reactor-panel-footer { padding-top: 9px; border-top: 1px solid rgba(255,255,255,0.08); color: #a58c67; font: 8px/1 ui-monospace, SFMono-Regular, Menlo, monospace; }
      .reactor-panel-footer i { width: 5px; height: 5px; display: inline-block; margin-right: 5px; border-radius: 999px; background: #ffd274; box-shadow: 0 0 9px #ffd274; }

      .concept-view-control { display: grid; grid-template-columns: minmax(220px, 0.78fr) minmax(380px, 1.6fr) minmax(220px, 0.78fr); background: linear-gradient(135deg, rgba(10,14,24,0.96), rgba(15,20,34,0.88)); }
      .control-panel { min-width: 0; padding: 23px 18px; background: rgba(6,9,16,0.42); }
      .control-feed-panel { border-right: 1px solid rgba(255,255,255,0.08); }
      .control-actions-panel { border-left: 1px solid rgba(255,255,255,0.08); }
      .control-panel-status { display: flex; align-items: center; gap: 7px; margin: -2px 0 17px; color: #748097; font: 8px/1 ui-monospace, SFMono-Regular, Menlo, monospace; text-transform: uppercase; letter-spacing: 0.09em; }
      .control-event-list { display: grid; gap: 3px; }
      .control-event { position: relative; display: grid; gap: 5px; padding: 13px 11px 13px 14px; border-left: 2px solid var(--tone); background: linear-gradient(90deg, color-mix(in srgb, var(--tone) 8%, transparent), transparent 80%); }
      .control-tone-cyan { --tone: #6ce3ff; }
      .control-tone-green { --tone: #75efb8; }
      .control-tone-violet { --tone: #b399ff; }
      .control-tone-amber { --tone: #ffd27a; }
      .control-event-time { color: #64708a; font: 8px/1 ui-monospace, SFMono-Regular, Menlo, monospace; }
      .control-event strong { color: #e9eef9; font-size: 11px; font-weight: 650; }
      .control-event small { color: #78849a; font: 9px/1.25 ui-monospace, SFMono-Regular, Menlo, monospace; }
      .control-event em { position: absolute; right: 10px; top: 12px; color: var(--tone); font: 700 7px/1 ui-monospace, SFMono-Regular, Menlo, monospace; letter-spacing: 0.09em; text-transform: uppercase; }
      .control-graph-panel { min-width: 0; display: grid; grid-template-rows: auto minmax(0,1fr) auto; }
      .control-graph-head, .control-graph-foot { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 15px 17px; color: #7b879e; font: 8px/1 ui-monospace, SFMono-Regular, Menlo, monospace; letter-spacing: 0.1em; text-transform: uppercase; }
      .control-graph-head { border-bottom: 1px solid rgba(255,255,255,0.08); }
      .control-graph-head span:first-child { color: #d9e0f1; }
      .control-graph-canvas { min-height: 0; position: relative; overflow: hidden; background: radial-gradient(circle at 50% 50%, rgba(99,77,207,0.22), transparent 27%), linear-gradient(135deg, rgba(70,205,255,0.02), rgba(173,117,255,0.07)); }
      .control-graph-canvas::before { content: ''; position: absolute; inset: 9%; border: 1px solid rgba(139,159,210,0.1); border-radius: 50%; transform: scaleX(0.7); }
      .control-graph-svg { position: absolute; inset: 8%; width: 84%; height: 84%; overflow: visible; }
      .control-graph-svg path { fill: none; stroke: url(#control-link-gradient); stroke-width: 0.32; stroke-dasharray: 1 1.4; animation: flow-dash 5.8s linear infinite; vector-effect: non-scaling-stroke; }
      .control-graph-svg circle { fill: #9d86ff; stroke: rgba(255,255,255,0.62); stroke-width: 0.3; vector-effect: non-scaling-stroke; }
      .brain-core-control { position: absolute; left: 50%; top: 50%; width: 160px; height: 160px; transform: translate(-50%, -50%); }
      .brain-core-control .brain-core-orb { width: 69px; height: 69px; inset: 45px; border-radius: 22px; }
      .brain-core-control .brain-core-orb span { font-size: 15px; }
      .brain-core-control .brain-core-name { bottom: 9px; font-size: 7px; }
      .control-graph-label { position: absolute; z-index: 2; display: grid; gap: 4px; color: #b8c3da; font: 700 10px/1 ui-monospace, SFMono-Regular, Menlo, monospace; }
      .control-graph-label b { color: #6f7e9c; font-size: 8px; font-weight: 500; }
      .label-people { left: 16%; top: 22%; color: #70e0ff; }
      .label-deals { right: 16%; top: 22%; color: #bf9eff; text-align: right; }
      .label-tasks { left: 16%; bottom: 22%; color: #79edb8; }
      .label-ideas { right: 16%; bottom: 22%; color: #ffd27a; text-align: right; }
      .control-graph-pulse { position: absolute; z-index: 3; width: 9px; height: 9px; border-radius: 999px; background: #ffffff; box-shadow: 0 0 16px #8bdcff; animation: control-pulse 3.2s ease-in-out infinite; }
      .pulse-one { left: 22%; top: 38%; }
      .pulse-two { right: 25%; bottom: 36%; animation-delay: -1.7s; }
      .control-graph-foot { border-top: 1px solid rgba(255,255,255,0.08); }
      .control-graph-foot span:first-child { display: inline-flex; align-items: center; gap: 7px; color: #81edba; }
      .action-queue { display: grid; gap: 8px; }
      .action-queue-card { --tone: #74ddff; display: grid; grid-template-columns: 25px minmax(0, 1fr) auto; align-items: center; gap: 8px; padding: 10px; border: 1px solid color-mix(in srgb, var(--tone) 24%, transparent); border-radius: 10px; background: color-mix(in srgb, var(--tone) 6%, rgba(255,255,255,0.02)); }
      .action-queue-cyan { --tone: #6ce3ff; }
      .action-queue-green { --tone: #75efb8; }
      .action-queue-violet { --tone: #b399ff; }
      .action-queue-icon { width: 23px; height: 23px; display: grid; place-items: center; border-radius: 999px; color: var(--tone); background: color-mix(in srgb, var(--tone) 13%, transparent); font-size: 13px; }
      .action-queue-card strong { display: block; overflow: hidden; color: #edf1fa; font-size: 10px; font-weight: 650; text-overflow: ellipsis; white-space: nowrap; }
      .action-queue-card small { display: block; overflow: hidden; margin-top: 4px; color: #77839a; font: 8px/1.2 ui-monospace, SFMono-Regular, Menlo, monospace; text-overflow: ellipsis; white-space: nowrap; }
      .action-queue-card > span { color: var(--tone); font: 700 7px/1 ui-monospace, SFMono-Regular, Menlo, monospace; text-transform: uppercase; }
      .action-queue-note { display: flex; align-items: flex-start; gap: 8px; margin-top: 18px; padding: 10px 0; border-top: 1px solid rgba(255,255,255,0.08); color: #79859c; font: 9px/1.45 ui-monospace, SFMono-Regular, Menlo, monospace; }
      .action-queue-note i { flex: 0 0 auto; margin-top: 4px; }
      .concept-view-schema-flow { display: block; padding: 0; background: radial-gradient(circle at 50% 50%, rgba(62,54,146,0.22), transparent 37%), linear-gradient(115deg, rgba(7,11,22,0.9), rgba(12,16,29,0.5)); }
      .schema-flow-foreground { position: relative; z-index: 3; width: 100%; height: 100%; display: grid; grid-template-columns: minmax(225px, 0.88fr) minmax(390px, 1.45fr) minmax(225px, 0.88fr); align-items: center; gap: clamp(18px, 3vw, 46px); padding: 28px 36px 32px; }
      .schema-flow-column, .schema-flow-brain-panel { position: relative; z-index: 3; min-width: 0; }
      .schema-page-list, .schema-task-list { display: grid; gap: 8px; }
      .schema-page-card, .schema-task-card { --tone: #70e2ff; min-width: 0; min-height: 51px; display: grid; grid-template-columns: 27px minmax(0,1fr) auto; align-items: center; gap: 9px; padding: 9px 10px; border: 1px solid color-mix(in srgb, var(--tone) 25%, transparent); border-radius: 11px; background: linear-gradient(105deg, color-mix(in srgb, var(--tone) 7%, rgba(14,20,34,0.84)), rgba(255,255,255,0.025)); box-shadow: inset 0 1px 0 rgba(255,255,255,0.04); }
      .schema-page-card { animation: schema-page-arrive 4.8s ease-in-out infinite; animation-delay: var(--schema-delay); }
      .schema-tone-cyan { --tone: #6ce3ff; }
      .schema-tone-green { --tone: #75efb8; }
      .schema-tone-violet { --tone: #b399ff; }
      .schema-tone-amber { --tone: #ffd27a; }
      .schema-tone-pink { --tone: #ff9cca; }
      .schema-page-type, .schema-task-check { width: 27px; height: 27px; display: grid; place-items: center; border: 1px solid color-mix(in srgb, var(--tone) 70%, white 8%); border-radius: 8px; color: var(--tone); background: color-mix(in srgb, var(--tone) 12%, transparent); font: 800 10px/1 ui-monospace, SFMono-Regular, Menlo, monospace; }
      .schema-page-card strong, .schema-task-card strong { display: block; overflow: hidden; color: #edf1fa; font-size: 11px; font-weight: 700; text-overflow: ellipsis; white-space: nowrap; }
      .schema-page-card small, .schema-task-card small { display: block; overflow: hidden; margin-top: 4px; color: #78849b; font: 8px/1.2 ui-monospace, SFMono-Regular, Menlo, monospace; text-overflow: ellipsis; white-space: nowrap; }
      .schema-page-card > i { width: 5px; height: 5px; border-radius: 999px; background: var(--tone); box-shadow: 0 0 11px var(--tone); }
      .schema-task-card { animation: schema-task-ready 4.9s ease-in-out infinite; animation-delay: var(--schema-delay); }
      .schema-task-check { border-radius: 999px; }
      .schema-task-status { color: var(--tone); font: 700 7px/1 ui-monospace, SFMono-Regular, Menlo, monospace; letter-spacing: 0.08em; text-transform: uppercase; }
      .schema-flow-brain-panel { display: grid; justify-items: center; gap: 10px; }
      .schema-flow-process { display: inline-flex; align-items: center; gap: 9px; color: #65718c; font: 700 8px/1 ui-monospace, SFMono-Regular, Menlo, monospace; letter-spacing: 0.14em; text-transform: uppercase; }
      .schema-flow-process span.active { color: #a8ecff; }
      .schema-flow-process b { color: #48536d; font-size: 11px; font-weight: 400; }
      .schema-brain-constellation { width: min(100%, 300px); aspect-ratio: 1; position: relative; }
      .schema-brain-constellation > svg { position: absolute; inset: 0; width: 100%; height: 100%; overflow: visible; }
      .schema-brain-constellation line { stroke: rgba(138,173,242,0.28); stroke-width: 0.28; stroke-dasharray: 1 1.4; animation: flow-dash 5.6s linear infinite; vector-effect: non-scaling-stroke; }
      .schema-brain-constellation circle { stroke: rgba(255,255,255,0.45); stroke-width: 0.32; vector-effect: non-scaling-stroke; }
      .schema-node-cyan { fill: #6ce3ff; }
      .schema-node-green { fill: #75efb8; }
      .schema-node-violet { fill: #b399ff; }
      .schema-node-amber { fill: #ffd27a; }
      .schema-brain-core { position: absolute; inset: 50% auto auto 50%; width: 190px; height: 190px; transform: translate(-50%, -50%); display: grid; place-items: center; }
      .schema-brain-core .brain-core { width: 190px; height: 190px; transform: scale(0.86); }
      .schema-flow-brain-caption { display: grid; justify-items: center; gap: 4px; text-align: center; }
      .schema-flow-brain-caption strong { color: #f6f8ff; font-size: 16px; font-weight: 600; }
      .schema-flow-brain-caption span { max-width: 250px; color: #7d89a1; font: 9px/1.4 ui-monospace, SFMono-Regular, Menlo, monospace; }
      .schema-flow-status { display: flex; align-items: center; gap: 7px; color: #7b879e; font: 8px/1 ui-monospace, SFMono-Regular, Menlo, monospace; letter-spacing: 0.08em; text-transform: uppercase; }
      .schema-flow-status i { width: 5px; height: 5px; border-radius: 999px; background: #75efb8; box-shadow: 0 0 10px #75efb8; }
      .schema-flow-status span { color: #5e6a82; }
      .schema-flow-network { position: absolute; inset: 0; z-index: 2; pointer-events: none; }
      .schema-flow-network svg { width: 100%; height: 100%; display: block; overflow: visible; }
      .schema-flow-arc { fill: none; stroke-width: 0.32; stroke-linecap: round; opacity: 0.3; vector-effect: non-scaling-stroke; }
      .schema-flow-arc-in { stroke: url(#schema-flow-in-gradient); }
      .schema-flow-arc-out { stroke: url(#schema-flow-out-gradient); animation-delay: -2.8s; }
      .schema-flow-energy-glow, .schema-flow-energy-arc { fill: none; stroke-linecap: round; stroke-dasharray: 16 36; stroke-dashoffset: 0; animation-name: schema-energy-travel; animation-timing-function: linear; animation-iteration-count: infinite; vector-effect: non-scaling-stroke; }
      .schema-flow-energy-glow { stroke-width: 4; opacity: 0.3; filter: url(#schema-flow-pulse-blur); }
      .schema-flow-energy-glow-in { stroke: url(#schema-flow-pulse-in); }
      .schema-flow-energy-glow-out { stroke: url(#schema-flow-pulse-out); }
      .schema-flow-energy-arc { stroke-width: 1.25; filter: drop-shadow(0 0 3px rgba(146,211,255,0.75)); }
      .schema-flow-energy-arc-in { stroke: url(#schema-flow-pulse-in); }
      .schema-flow-energy-arc-out { stroke: url(#schema-flow-pulse-out); filter: drop-shadow(0 0 3px rgba(152,239,199,0.58)); }
      .schema-flow-footer-label { position: absolute; bottom: 12px; z-index: 2; color: #64718a; font: 8px/1 ui-monospace, SFMono-Regular, Menlo, monospace; letter-spacing: 0.13em; text-transform: uppercase; }
      .schema-flow-footer-left { left: 24%; }
      .schema-flow-footer-right { right: 22%; }
      .narrative-lab .design-lab-foot { max-width: 1500px; }
      .narrative-lab .design-lab-foot .footer-pulse { margin-right: 5px; vertical-align: 1px; }
      @keyframes signal-breathe { 0%, 100% { transform: translateX(0); } 50% { transform: translateX(4px); } }
      @keyframes output-breathe { 0%, 100% { transform: translateX(0); } 50% { transform: translateX(-4px); } }
      @keyframes flow-dash { to { stroke-dashoffset: -24; } }
      @keyframes packet-in-one { 0%, 100% { transform: translate(0, 0); opacity: 0.3; } 45% { transform: translate(65%, 18%); opacity: 1; } 78% { transform: translate(260%, 45%); opacity: 0; } }
      @keyframes packet-in-two { 0%, 100% { transform: translate(0, 0); opacity: 0.2; } 45% { transform: translate(85%, -14%); opacity: 1; } 78% { transform: translate(220%, -30%); opacity: 0; } }
      @keyframes packet-out-one { 0%, 22% { transform: translate(-40%, 0); opacity: 0; } 50% { transform: translate(30%, -12%); opacity: 1; } 100% { transform: translate(240%, -32%); opacity: 0; } }
      @keyframes packet-out-two { 0%, 19% { transform: translate(-30%, 0); opacity: 0; } 48% { transform: translate(45%, 15%); opacity: 1; } 100% { transform: translate(210%, 45%); opacity: 0; } }
      @keyframes brain-ring { 0%, 100% { opacity: 0.48; } 50% { opacity: 1; transform: rotate(24deg) scaleX(0.76); } }
      @keyframes core-breathe { 0%, 100% { filter: brightness(0.96); } 50% { filter: brightness(1.16); } }
      @keyframes reactor-spin { to { transform: translate(-50%, -50%) rotate(342deg) scaleY(0.6); } }
      @keyframes reactor-scan { 0%, 100% { opacity: 0.1; transform: scaleX(0.25); } 50% { opacity: 0.9; transform: scaleX(1); } }
      @keyframes control-pulse { 0%, 100% { opacity: 0.25; transform: scale(0.7); } 50% { opacity: 1; transform: scale(1.25); } }
      @keyframes schema-page-arrive { 0%, 100% { transform: translateX(0); } 50% { transform: translateX(3px); } }
      @keyframes schema-task-ready { 0%, 100% { transform: translateX(0); } 50% { transform: translateX(-3px); } }
      @keyframes schema-energy-travel { to { stroke-dashoffset: -52; } }
      @media (max-width: 1080px) {
        .narrative-lab { padding: 20px 18px 14px; }
        .concept-view-loop { gap: 18px; padding-left: 22px; padding-right: 22px; }
        .reactor-side-panel { right: 14px; }
        .reactor-stage-copy-right { right: 190px; }
        .orbit-source-1 { left: 18%; }
        .orbit-output-1 { right: 17%; }
      }
      @media (max-width: 820px) {
        .narrative-lab { overflow: auto; grid-template-rows: auto auto auto auto; }
        .narrative-stage { min-height: 700px; overflow: visible; }
        .narrative-stage-head { align-items: flex-start; flex-direction: column; gap: 10px; }
        .narrative-stage-description { text-align: left; }
        .concept-view-loop { min-height: 620px; grid-template-columns: 1fr; align-content: center; gap: 22px; overflow: visible; }
        .concept-core-wrap { order: -1; }
        .flow-network, .flow-caption { display: none; }
        .concept-view-reactor { min-height: 620px; }
        .reactor-side-panel { top: auto; right: 15px; bottom: 16px; }
        .reactor-stage-copy-right { right: 22px; }
        .concept-view-control { min-height: 700px; grid-template-columns: 1fr; }
        .control-feed-panel, .control-actions-panel { border: 0; }
        .control-graph-panel { min-height: 340px; order: -1; }
        .concept-view-schema-flow { min-height: 720px; overflow: visible; }
        .schema-flow-foreground { height: auto; min-height: 720px; grid-template-columns: 1fr; align-content: center; gap: 24px; }
        .schema-flow-brain-panel { order: -1; }
        .schema-flow-network, .schema-flow-footer-label { display: none; }
      }
      @media (prefers-reduced-motion: reduce) {
        .narrative-lab *, .narrative-lab *::before, .narrative-lab *::after { animation-duration: 0.001ms !important; animation-iteration-count: 1 !important; }
      }
      .narrative-lab .design-lab-live { color: #e4e4e7; }
      .narrative-lab .design-lab-live i,
      .narrative-lab .footer-pulse,
      .narrative-lab .core-telemetry i,
      .narrative-lab .control-panel-status i,
      .narrative-lab .control-graph-foot i,
      .narrative-lab .action-queue-note i,
      .narrative-lab .reactor-state i,
      .narrative-lab .reactor-panel-footer i { background: #d4d4d8; box-shadow: 0 0 10px rgba(244,244,245,0.58); }
      .narrative-lab .signal-tone-cyan,
      .narrative-lab .output-tone-cyan,
      .narrative-lab .schema-tone-cyan,
      .narrative-lab .control-tone-cyan,
      .narrative-lab .action-queue-cyan { --tone: #f4f4f5; }
      .narrative-lab .signal-tone-green,
      .narrative-lab .output-tone-green,
      .narrative-lab .schema-tone-green,
      .narrative-lab .control-tone-green,
      .narrative-lab .action-queue-green { --tone: #d4d4d8; }
      .narrative-lab .signal-tone-violet,
      .narrative-lab .output-tone-violet,
      .narrative-lab .schema-tone-violet,
      .narrative-lab .control-tone-violet,
      .narrative-lab .action-queue-violet { --tone: #a1a1aa; }
      .narrative-lab .signal-tone-amber,
      .narrative-lab .output-tone-amber,
      .narrative-lab .schema-tone-amber,
      .narrative-lab .control-tone-amber { --tone: #e4e4e7; }
      .narrative-lab .schema-tone-pink { --tone: #71717a; }
      .narrative-lab .brain-core-rings i { border-color: rgba(244,244,245,0.24); }
      .narrative-lab .brain-core-rings i:nth-child(2) { border-color: rgba(161,161,170,0.34); }
      .narrative-lab .brain-core-rings i:nth-child(3) { border-color: rgba(212,212,216,0.42); }
      .narrative-lab .brain-core-orb { background: radial-gradient(circle at 35% 26%, #ffffff, #d4d4d8 28%, #71717a 68%, #27272a); box-shadow: 0 0 0 9px rgba(244,244,245,0.06), 0 0 42px rgba(212,212,216,0.3), 0 22px 55px rgba(0,0,0,0.34); }
      .narrative-lab .brain-core-orb b { background: #ffffff; box-shadow: 0 0 12px rgba(255,255,255,0.85); }
      .narrative-lab .flow-network path { stroke: rgba(244,244,245,0.22); }
      .narrative-lab .flow-network path:nth-child(2n),
      .narrative-lab .flow-network path:nth-child(3n) { stroke: rgba(212,212,216,0.2); }
      .narrative-lab .flow-packet { --packet-tone: #d4d4d8; opacity: 0.55; }
      .narrative-lab .reactor-orbit { border-color: rgba(244,244,245,0.18); }
      .narrative-lab .reactor-orbit-two { border-color: rgba(161,161,170,0.24); }
      .narrative-lab .reactor-orbit-three { border-color: rgba(212,212,216,0.22); }
      .narrative-lab .reactor-core-wrap .brain-core-orb { background: radial-gradient(circle at 35% 26%, #ffffff, #e4e4e7 28%, #71717a 68%, #27272a); box-shadow: 0 0 0 14px rgba(244,244,245,0.06), 0 0 62px rgba(212,212,216,0.32), 0 0 110px rgba(161,161,170,0.18); }
      .narrative-lab .reactor-core-wrap .brain-core-rings i,
      .narrative-lab .reactor-core-wrap .brain-core-rings i:nth-child(2),
      .narrative-lab .reactor-core-wrap .brain-core-rings i:nth-child(3) { border-color: rgba(244,244,245,0.3); }
      .narrative-lab .reactor-core-scan { background: linear-gradient(90deg, transparent, rgba(244,244,245,0.58), transparent); box-shadow: 0 0 18px rgba(244,244,245,0.52); }
      .narrative-lab .reactor-state span,
      .narrative-lab .reactor-state small,
      .narrative-lab .reactor-panel-footer { color: #a1a1aa; }
      .narrative-lab .control-graph-svg circle { fill: #a1a1aa; }
      .narrative-lab .control-graph-label,
      .narrative-lab .control-graph-label.label-people,
      .narrative-lab .control-graph-label.label-deals,
      .narrative-lab .control-graph-label.label-tasks,
      .narrative-lab .control-graph-label.label-ideas { color: #d4d4d8; }
      .narrative-lab .control-graph-pulse { background: #f4f4f5; box-shadow: 0 0 16px rgba(244,244,245,0.68); }
      .narrative-lab .schema-node-cyan,
      .narrative-lab .schema-node-green,
      .narrative-lab .schema-node-violet,
      .narrative-lab .schema-node-amber,
      .narrative-lab .schema-node-real { fill: #d4d4d8; }
      .narrative-lab .schema-brain-constellation line { stroke: rgba(244,244,245,0.18); }
      .narrative-lab .schema-brain-constellation circle { fill: #d4d4d8; stroke: rgba(255,255,255,0.42); }
      .narrative-lab .schema-live-graph { width: min(100%, 420px); height: clamp(250px, 42vh, 380px); aspect-ratio: auto; }
      .narrative-lab .schema-live-graph .graph-canvas-shell { width: 100%; height: 100%; }
      .narrative-lab .schema-live-graph .graph-svg { cursor: default; }
      .narrative-lab .schema-live-graph .graph-relationship-arc { stroke-dasharray: 2 18; animation: graph-lab-arc-shimmer 6.8s linear infinite; }
      .narrative-lab .schema-live-graph .graph-relationship-arc:nth-of-type(4n) { animation-delay: -2.4s; }
      .narrative-lab .schema-live-graph .graph-relationship-arc:nth-of-type(5n) { animation-delay: -4.1s; }
      .narrative-lab .schema-live-graph .graph-relationship-arc-glow { stroke-dasharray: 1 24; animation-duration: 8.4s; opacity: 0.18; }
      @keyframes graph-lab-arc-shimmer { 0% { stroke-dashoffset: 0; opacity: 0.16; } 42% { opacity: 0.42; } 100% { stroke-dashoffset: -48; opacity: 0.16; } }
      .narrative-lab .schema-flow-energy-arc-in,
      .narrative-lab .schema-flow-energy-arc-out,
      .narrative-lab .schema-flow-energy-glow-in,
      .narrative-lab .schema-flow-energy-glow-out { filter: drop-shadow(0 0 3px rgba(244,244,245,0.62)); }
      .narrative-lab .futuristic-graph { background: transparent; }
      .graph-pulse-line { animation: graph-pulse 7s linear infinite; }
      .graph-activity-panel { position: absolute; right: 14px; top: 14px; z-index: 4; width: min(270px, calc(100% - 28px)); display: grid; gap: 0; padding: 0; border: 1px solid transparent; border-radius: 12px; background: transparent; box-shadow: none; backdrop-filter: blur(0); transition: padding 180ms ease, gap 180ms ease, background 180ms ease, border-color 180ms ease, box-shadow 180ms ease, backdrop-filter 180ms ease; }
      .graph-activity-panel:hover, .graph-activity-panel:focus-within { gap: 9px; padding: 10px 12px; border-color: rgba(212,212,216,0.18); background: rgba(12,12,14,0.82); box-shadow: 0 18px 42px rgba(0,0,0,0.24), inset 0 1px 0 rgba(255,255,255,0.04); backdrop-filter: blur(18px); }
      .graph-activity-head, .graph-activity-meta { min-width: 0; max-height: 0; opacity: 0; overflow: hidden; transform: translateY(-3px); display: flex; align-items: center; justify-content: space-between; gap: 10px; color: var(--muted); font-size: 11px; transition: max-height 180ms ease, opacity 180ms ease, transform 180ms ease; }
      .graph-activity-panel:hover .graph-activity-head, .graph-activity-panel:hover .graph-activity-meta, .graph-activity-panel:focus-within .graph-activity-head, .graph-activity-panel:focus-within .graph-activity-meta { max-height: 20px; opacity: 1; transform: translateY(0); }
      .graph-activity-head span { text-transform: uppercase; letter-spacing: 0.08em; font-weight: 750; }
      .graph-activity-head strong { min-width: 0; color: var(--ink); font-size: 12px; font-weight: 650; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .graph-activity-bars { height: 48px; min-width: 0; display: flex; align-items: end; gap: 1px; overflow: hidden; }
      .graph-activity-bar { flex: 1 1 0; min-width: 0; padding: 0; align-self: end; display: flex; align-items: stretch; justify-content: center; border: 0; background: transparent; cursor: pointer; }
      .graph-activity-bar::before { content: ""; width: min(3px, 80%); height: 100%; border-radius: 999px; background: rgba(161,161,170,0.26); box-shadow: inset 0 1px 0 rgba(255,255,255,0.06); transition: background 140ms ease, box-shadow 140ms ease, transform 140ms ease; }
      .graph-activity-bar.active::before { background: linear-gradient(180deg, #f4f4f5 0%, #a1a1aa 100%); box-shadow: 0 0 0 1px rgba(255,255,255,0.10); }
      .graph-activity-bar:hover, .graph-activity-bar:focus-visible { outline: none; }
      .graph-activity-bar:hover::before, .graph-activity-bar:focus-visible::before { background: #ffffff; box-shadow: 0 0 0 2px rgba(255,255,255,0.16); transform: translateY(-1px); }
      .graph-timeline-slider { width: 100%; height: 0; margin: 0; opacity: 0; appearance: none; -webkit-appearance: none; background: transparent; cursor: pointer; pointer-events: none; transition: height 180ms ease, opacity 180ms ease; }
      .graph-activity-panel:hover .graph-timeline-slider, .graph-activity-panel:focus-within .graph-timeline-slider { height: 12px; opacity: 1; pointer-events: auto; }
      .graph-timeline-slider::-webkit-slider-runnable-track { height: 3px; border-radius: 999px; background: linear-gradient(90deg, rgba(244,244,245,0.78), rgba(82,82,91,0.62)); box-shadow: inset 0 0 0 1px rgba(255,255,255,0.06); }
      .graph-timeline-slider::-webkit-slider-thumb { appearance: none; -webkit-appearance: none; width: 13px; height: 13px; margin-top: -5px; border: 1px solid rgba(255,255,255,0.70); border-radius: 999px; background: linear-gradient(180deg, #ffffff, #d4d4d8); box-shadow: 0 2px 8px rgba(0,0,0,0.35); }
      .graph-timeline-slider:focus-visible { outline: none; }
      .graph-timeline-slider:focus-visible::-webkit-slider-thumb { box-shadow: 0 0 0 3px rgba(255,255,255,0.18), 0 2px 8px rgba(0,0,0,0.35); }
      .graph-recent-panel { position: absolute; left: 14px; top: 14px; z-index: 4; width: min(290px, calc(100% - 28px)); display: grid; gap: 8px; max-height: 166px; padding: 9px; overflow: hidden; border: 1px solid rgba(212,212,216,0.14); border-radius: 12px; background: rgba(12,12,14,0.52); box-shadow: 0 14px 34px rgba(0,0,0,0.16), inset 0 1px 0 rgba(255,255,255,0.035); backdrop-filter: blur(12px); transition: max-height 180ms ease, background 180ms ease, border-color 180ms ease, box-shadow 180ms ease, backdrop-filter 180ms ease; }
      .graph-recent-panel:hover, .graph-recent-panel:focus-within { max-height: min(430px, calc(100% - 28px)); border-color: rgba(212,212,216,0.22); background: rgba(12,12,14,0.84); box-shadow: 0 20px 48px rgba(0,0,0,0.26), inset 0 1px 0 rgba(255,255,255,0.045); backdrop-filter: blur(18px); }
      .graph-recent-head { display: flex; align-items: center; justify-content: space-between; gap: 10px; padding: 0 2px; color: var(--muted); font-size: 11px; }
      .graph-recent-head span { text-transform: uppercase; letter-spacing: 0.08em; font-weight: 750; }
      .graph-recent-head strong { color: var(--ink); font-size: 12px; font-weight: 650; }
      .graph-recent-list { display: grid; gap: 6px; overflow: hidden; }
      .graph-recent-card { width: 100%; min-width: 0; display: grid; gap: 4px; padding: 8px 9px; border: 1px solid rgba(212,212,216,0.10); border-radius: 8px; background: rgba(255,255,255,0.045); color: var(--ink); text-align: left; cursor: pointer; transition: background 140ms ease, border-color 140ms ease, transform 140ms ease; }
      .graph-recent-card:hover, .graph-recent-card:focus-visible, .graph-recent-card.active { border-color: rgba(255,255,255,0.26); background: rgba(255,255,255,0.09); transform: translateY(-1px); outline: none; }
      .graph-recent-title { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 12px; line-height: 1.25; font-weight: 700; }
      .graph-recent-update { max-height: 0; opacity: 0; overflow: hidden; color: var(--muted); font-size: 11px; line-height: 1.35; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; transition: max-height 180ms ease, opacity 180ms ease; }
      .graph-recent-panel:hover .graph-recent-update, .graph-recent-panel:focus-within .graph-recent-update { max-height: 34px; opacity: 1; }
      .graph-controls { display: flex; gap: 8px; }
      .graph-controls-inline { position: static; z-index: auto; }
      .graph-button { border: 1px solid var(--line); background: var(--surface-strong); color: var(--ink); border-radius: 999px; padding: 8px 12px; font-size: 12px; cursor: pointer; box-shadow: 0 6px 18px rgba(15,23,42,0.05); }
      .graph-button:hover { background: var(--surface); }
      .graph-button:disabled { opacity: 0.52; cursor: not-allowed; }
      .graph-button-active { background: rgba(255,255,255,0.08); border-color: var(--line-strong); }
      .icon-button { width: 38px; height: 38px; padding: 0; border-radius: 999px; border: 1px solid var(--line); background: var(--surface-strong); color: var(--ink); cursor: pointer; box-shadow: 0 6px 18px rgba(15,23,42,0.05); display: inline-flex; align-items: center; justify-content: center; }
      .icon-button:hover { background: var(--surface); }
      .graph-note { position: absolute; left: 14px; bottom: 14px; z-index: 2; font-size: 12px; color: var(--muted); padding: 8px 10px; border-radius: 999px; background: var(--surface-strong); border: 1px solid var(--line); }
      .graph-controls-inline { position: static; }
      .graph-style-menu-shell, .graph-filter-menu-shell { position: relative; }
      .graph-style-menu { position: absolute; right: 0; bottom: calc(100% + 10px); min-width: 300px; max-height: min(640px, calc(100vh - 32px)); overflow-y: auto; display: grid; gap: 14px; padding: 14px; border-radius: 16px; border: 1px solid var(--line); background: var(--panel); box-shadow: var(--shadow-float); backdrop-filter: blur(18px); z-index: 8; }
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
      .graph-type-color-grid { display: grid; gap: 6px; }
      .graph-type-color-row { display: grid; grid-template-columns: minmax(0, 1fr) 30px 82px; align-items: center; gap: 7px; }
      .graph-type-color-name { min-width: 0; overflow: hidden; color: var(--ink); font-size: 11px !important; text-transform: none !important; letter-spacing: 0 !important; white-space: nowrap; text-overflow: ellipsis; }
      .graph-type-color-swatch { width: 30px; height: 25px; box-sizing: border-box; padding: 2px; border: 1px solid var(--line); border-radius: 6px; background: var(--surface); cursor: pointer; }
      .graph-type-color-code { width: 100%; min-width: 0; box-sizing: border-box; padding: 6px 7px; border: 1px solid var(--line); border-radius: 7px; background: var(--surface); color: var(--ink); font: 10px/1 ui-monospace, SFMono-Regular, Menlo, monospace; text-transform: uppercase; }
      .graph-type-color-code:focus-visible, .graph-type-color-swatch:focus-visible { outline: 2px solid var(--line-strong); outline-offset: 1px; }
      .graph-fixed-labels text { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
      .legend { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 10px; }
      .legend span { font-size: 12px; color: var(--muted); padding: 6px 8px; border-radius: 999px; background: var(--surface); border: 1px solid var(--line); text-transform: lowercase; }
      .task-section, .recent-list, .health-list { display: grid; gap: 12px; }
      .task-section { width: min(680px, 100%); margin: 0 auto; }
      .filter-bar { display: flex; flex-wrap: wrap; align-items: center; justify-content: center; gap: 8px; width: min(680px, 100%); margin: 0 auto 14px; }
      .filter-label { color: var(--muted); font-size: 12px; font-weight: 700; }
      .shadcn-select-trigger { display: inline-flex; align-items: center; justify-content: space-between; gap: 10px; min-height: 36px; width: min(100%, 280px); border: 1px solid var(--line); background: var(--surface); color: var(--ink); border-radius: 8px; padding: 7px 10px 7px 12px; font: inherit; font-size: 13px; font-weight: 650; cursor: pointer; box-shadow: 0 1px 2px rgba(0,0,0,0.08); }
      .shadcn-select-trigger:hover { border-color: var(--line-strong); background: rgba(255,255,255,0.07); }
      .shadcn-select-trigger:focus-visible { outline: 2px solid var(--accent-strong); outline-offset: 2px; }
      .shadcn-select-trigger[data-disabled] { cursor: wait; opacity: 0.68; }
      .shadcn-select-icon { display: inline-flex; align-items: center; justify-content: center; align-self: center; width: 16px; height: 16px; color: var(--muted); font-size: 15px; line-height: 1; }
      .shadcn-select-content { z-index: 80; min-width: var(--radix-select-trigger-width); max-height: min(320px, var(--radix-select-content-available-height)); overflow: hidden; border: 1px solid var(--line); border-radius: 8px; background: var(--panel); color: var(--ink); box-shadow: 0 18px 48px rgba(0,0,0,0.28); }
      .shadcn-select-viewport { padding: 5px; }
      .shadcn-select-item { position: relative; display: flex; min-height: 32px; align-items: center; border-radius: 6px; padding: 6px 30px 6px 9px; color: var(--ink); font-size: 13px; line-height: 1.35; cursor: default; outline: none; user-select: none; }
      .shadcn-select-item[data-highlighted] { background: rgba(255,255,255,0.08); color: var(--ink); }
      .shadcn-select-item[data-state="checked"] { background: rgba(255,255,255,0.06); }
      .shadcn-select-check { position: absolute; right: 9px; display: inline-flex; align-items: center; color: var(--accent-strong); font-size: 12px; }
      .list-loading-state { min-height: 104px; display: flex; align-items: center; justify-content: center; gap: 10px; border: 1px solid rgba(148,163,184,0.16); border-radius: 14px; background: var(--surface); color: var(--muted); font-size: 13px; font-weight: 700; }
      .loading-spinner { width: 16px; height: 16px; border-radius: 999px; border: 2px solid rgba(148,163,184,0.32); border-top-color: var(--accent-strong); animation: spin 700ms linear infinite; }
      @keyframes spin { to { transform: rotate(360deg); } }
      .task-section-compact .task { padding: 10px 12px; }
      .task-group { display: grid; gap: 12px; border-top: 1px solid var(--line); padding-top: 14px; }
      .task-group:first-child { border-top: 0; padding-top: 0; }
      .task { padding: 12px 14px; border-radius: 14px; background: var(--surface); border: 1px solid rgba(148,163,184,0.16); line-height: 1.45; }
      .task-preview-button { cursor: pointer; transition: transform 160ms ease, box-shadow 160ms ease, border-color 160ms ease; }
      .task-preview-button:hover { transform: translateY(-1px); box-shadow: 0 18px 36px rgba(0,0,0,0.18); border-color: rgba(255,255,255,0.16); }
      .task-preview-button:focus-visible { outline: 2px solid var(--accent-strong); outline-offset: 2px; }
      .task.done { opacity: 0.6; }
      .assignee-row { display: flex; flex-wrap: wrap; gap: 6px; margin: 0 0 9px; }
      .assignee-pill { display: inline-flex; align-items: center; min-height: 22px; padding: 3px 8px; border-radius: 999px; border: 1px solid rgba(148,163,184,0.18); background: rgba(255,255,255,0.05); color: var(--muted); font-size: 11px; font-weight: 700; }
      .assignee-pill.invalid { color: #fecaca; border-color: rgba(252,165,165,0.34); background: rgba(127,29,29,0.2); }
      .meta { font-size: 12px; color: var(--muted); }
      .recent-item, .health-item { padding: 14px; border-radius: 14px; background: var(--surface); border: 1px solid rgba(148,163,184,0.16); }
      .recent-item strong { display: block; margin-bottom: 6px; }
      .health-item.high { border-color: rgba(164,69,69,0.35); }
      .health-item.medium { border-color: rgba(188,123,77,0.35); }
      .card-copy { margin-top: 8px; line-height: 1.5; color: var(--ink); }
      .schema { white-space: pre-wrap; font-size: 12px; line-height: 1.5; max-height: 360px; overflow: auto; }
      .explorer-shell { --explorer-tree-width: 310px; height: 100%; min-height: 0; display: grid; grid-template-columns: minmax(220px, var(--explorer-tree-width)) 8px minmax(0, 1fr); border: 1px solid var(--line); background: var(--panel); overflow: hidden; }
      .explorer-tree { min-height: 0; overflow: auto; background: color-mix(in srgb, var(--panel) 92%, #000 8%); padding: 8px 0 12px; }
      .explorer-resizer { min-height: 0; cursor: col-resize; border-left: 1px solid var(--line); border-right: 1px solid var(--line); background: color-mix(in srgb, var(--panel) 86%, #000 14%); position: relative; }
      .explorer-resizer::after { content: ""; position: absolute; top: 50%; left: 50%; width: 2px; height: 42px; border-radius: 999px; background: rgba(148,163,184,0.28); transform: translate(-50%, -50%); }
      .explorer-resizer:hover,
      .explorer-resizer:focus-visible { background: rgba(125,211,252,0.16); outline: none; }
      .explorer-resizer:hover::after,
      .explorer-resizer:focus-visible::after { background: var(--accent-strong); }
      body.explorer-resizing { cursor: col-resize; user-select: none; }
      .explorer-tree-head { min-height: 36px; display: flex; align-items: center; justify-content: space-between; gap: 10px; padding: 2px 10px 6px 12px; color: var(--muted); }
      .explorer-tree-title { font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.08em; }
      .explorer-view-toggle { flex: none; display: inline-flex; align-items: center; padding: 2px; border: 1px solid var(--line); border-radius: 8px; background: rgba(255,255,255,0.035); }
      .explorer-toggle-button { height: 24px; padding: 0 8px; border: 0; border-radius: 6px; background: transparent; color: var(--muted); font-size: 11px; font-weight: 650; cursor: pointer; }
      .explorer-toggle-button:hover { color: var(--ink); }
      .explorer-toggle-button.active { background: var(--surface); color: var(--ink); box-shadow: 0 1px 0 rgba(255,255,255,0.06), 0 8px 18px rgba(2,6,23,0.18); }
      .explorer-row { width: 100%; min-width: 0; height: 26px; padding: 0 10px 0 calc(10px + var(--depth, 0) * 14px); border: 0; background: transparent; color: var(--muted); display: grid; grid-template-columns: 14px 18px minmax(0, 1fr); align-items: center; gap: 4px; text-align: left; font: 12px/1.2 ui-monospace, SFMono-Regular, Menlo, monospace; cursor: pointer; }
      .explorer-row:hover { background: rgba(255,255,255,0.05); color: var(--ink); }
      .explorer-row.selected { background: rgba(125,211,252,0.12); color: var(--ink); }
      .explorer-twist { color: var(--muted); font-size: 13px; text-align: center; }
      .explorer-glyph { width: 18px; height: 18px; border-radius: 5px; display: inline-flex; align-items: center; justify-content: center; color: var(--muted); background: rgba(255,255,255,0.045); font-size: 10px; font-weight: 800; }
      .explorer-glyph.folder { color: var(--accent-strong); background: rgba(125,211,252,0.10); }
      .explorer-label { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .explorer-recents { display: grid; gap: 2px; padding: 0 6px 10px; }
      .explorer-recent-row { width: 100%; min-width: 0; min-height: 42px; padding: 7px 8px; border: 0; border-radius: 7px; background: transparent; color: var(--muted); display: grid; grid-template-columns: 22px minmax(0, 1fr); align-items: start; gap: 7px; text-align: left; cursor: pointer; }
      .explorer-recent-row:hover { background: rgba(255,255,255,0.05); color: var(--ink); }
      .explorer-recent-row.selected { background: rgba(125,211,252,0.12); color: var(--ink); }
      .explorer-recent-copy { min-width: 0; display: grid; gap: 3px; }
      .explorer-recent-name { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font: 12px/1.25 ui-monospace, SFMono-Regular, Menlo, monospace; color: var(--ink); }
      .explorer-recent-meta { font-size: 11px; color: var(--muted); }
      .explorer-viewer { min-width: 0; min-height: 0; overflow: hidden; display: grid; grid-template-rows: auto minmax(0, 1fr); background: var(--bg); }
      .explorer-viewer.empty { display: grid; grid-template-rows: minmax(0, 1fr); place-items: center; }
      .explorer-viewer-head { min-width: 0; min-height: 48px; padding: 10px 14px; border-bottom: 1px solid var(--line); display: grid; align-content: center; gap: 3px; }
      .explorer-viewer-path-row { min-width: 0; display: grid; grid-template-columns: minmax(0, 1fr) auto; align-items: center; gap: 8px; }
      .explorer-viewer-actions { display: inline-flex; align-items: center; gap: 6px; }
      .explorer-header-button { width: 30px; height: 30px; box-shadow: none; color: var(--muted); }
      .explorer-header-button:hover,
      .explorer-header-button:focus-visible,
      .explorer-header-button.copied { color: var(--accent-strong); border-color: var(--accent-strong); background: rgba(125,211,252,0.12); }
      .explorer-header-button svg { width: 15px; height: 15px; }
      .explorer-viewer-head strong,
      .explorer-viewer-head .meta { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .explorer-viewer-body { min-height: 0; overflow: auto; padding: 18px 20px; }
      .explorer-viewer-body .markdown-shell { max-width: 920px; }
      .explorer-markdown-preview { display: grid; gap: 16px; max-width: 920px; }
      .explorer-frontmatter { border: 1px solid var(--line); border-radius: 8px; background: color-mix(in srgb, var(--surface) 72%, transparent); overflow: hidden; }
      .explorer-frontmatter summary { min-height: 36px; padding: 6px 10px; display: flex; align-items: center; flex-wrap: wrap; gap: 7px; color: var(--muted); cursor: pointer; list-style: none; user-select: none; }
      .explorer-frontmatter summary::-webkit-details-marker { display: none; }
      .explorer-frontmatter summary::before { content: "›"; width: 14px; color: var(--muted); font-size: 15px; line-height: 1; transition: transform 140ms ease; }
      .explorer-frontmatter[open] summary::before { transform: rotate(90deg); }
      .explorer-frontmatter-title { color: var(--ink); font-size: 12px; font-weight: 750; }
      .explorer-frontmatter-meta { font-size: 11px; }
      .explorer-frontmatter-chip { max-width: min(210px, 100%); min-height: 22px; display: inline-flex; align-items: center; gap: 5px; padding: 3px 7px; border-radius: 999px; border: 1px solid var(--line); background: rgba(255,255,255,0.04); color: var(--muted); font-size: 11px; }
      .explorer-frontmatter-chip span,
      .explorer-frontmatter-chip strong { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .explorer-frontmatter-chip strong { color: var(--ink); font-weight: 650; }
      .explorer-frontmatter pre { margin: 0; max-height: 260px; overflow: auto; border-top: 1px solid var(--line); background: var(--pre-bg); color: var(--pre-ink); padding: 10px 12px; font: 11px/1.45 ui-monospace, SFMono-Regular, Menlo, monospace; white-space: pre-wrap; word-break: break-word; }
      .explorer-text-preview { margin: 0; min-height: 100%; white-space: pre-wrap; word-break: break-word; background: transparent; color: var(--ink); font: 12px/1.55 ui-monospace, SFMono-Regular, Menlo, monospace; }
      .explorer-media-frame { height: 100%; min-height: 0; display: grid; place-items: center; }
      .explorer-media-frame img { display: block; max-width: 100%; max-height: 100%; object-fit: contain; }
      .explorer-pdf-frame { width: 100%; height: 100%; min-height: 640px; border: 0; background: #fff; }
      .explorer-unsupported { height: 100%; display: grid; place-items: center; align-content: center; gap: 14px; }
      .explorer-document-preview { min-height: 100%; display: grid; place-items: center; align-content: center; gap: 16px; text-align: center; }
      .explorer-document-icon { width: 64px; height: 64px; border-radius: 18px; display: inline-flex; align-items: center; justify-content: center; background: rgba(125,211,252,0.12); color: var(--accent-strong); font-size: 20px; font-weight: 800; }
      .explorer-document-copy { display: grid; gap: 7px; max-width: 460px; }
      .explorer-document-copy h3 { margin: 0; font-size: 18px; }
      .explorer-document-copy p { margin: 0; color: var(--muted); font-size: 13px; line-height: 1.5; }
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
      .sidecar-actions { display: flex; flex-wrap: wrap; justify-content: flex-end; gap: 8px; }
      .sidecar-meta-row { display: flex; align-items: center; flex-wrap: wrap; gap: 8px; }
      .sidecar-chip { display: inline-flex; align-items: center; min-height: 25px; padding: 4px 9px; border-radius: 999px; border: 1px solid var(--line); background: var(--surface); color: var(--muted); font-size: 11px; font-weight: 700; }
      .sidecar-chip.strong { color: var(--ink); border-color: var(--line-strong); background: rgba(255,255,255,0.08); }
      .sidecar-chip.visibility-public { color: #2563eb; border-color: rgba(37,99,235,0.32); background: rgba(37,99,235,0.10); }
      .sidecar-error { color: var(--danger); font-size: 12px; line-height: 1.4; }
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
        .view-stage-list { justify-content: center; }
        .list-page-card { width: 100%; max-width: 760px; }
        .view-tasks.preview-open .list-page-card { max-width: 760px; margin: 0 auto; }
        .topline { grid-template-columns: minmax(44px, 1fr) auto minmax(44px, 1fr); align-items: center; justify-items: initial; }
        .topline-brand { justify-self: start; }
        .view-nav-header { justify-self: center; justify-content: center; }
        .topline-actions { justify-self: end; }
        .page-shell.preview-open { --sidecar-width: 0px; }
        .sidecar-shell { position: fixed; top: 0; right: 0; bottom: 0; left: auto; width: min(560px, 92vw); height: 100vh; padding: 0; z-index: 10; }
        .sidecar-panel { border-left: 1px solid var(--line); border-top: 0; border-radius: 0; }
        .sidecar-link-grid { grid-template-columns: 1fr; }
        .analytics-grid { grid-template-columns: 1fr; }
      }
      @media (max-width: 640px) {
        .sidecar-shell { left: 0; width: 100vw; }
        .analytics-head { align-items: flex-start; flex-direction: column; }
        .analytics-metrics { grid-template-columns: 1fr; }
        .analytics-event { align-items: flex-start; flex-direction: column; }
        .playbook-head, .playbook-section-head, .playbook-queue-head { align-items: flex-start; flex-direction: column; }
        .playbook-metrics { grid-template-columns: 1fr; }
        .playbook-record { align-items: flex-start; flex-direction: column; }
        .playbook-record-actions { width: 100%; justify-content: flex-start; }
        .playbook-empty { align-items: flex-start; flex-wrap: wrap; }
        .playbook-empty .graph-button { margin-left: 54px; }
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
      readiness: normalizeReadiness(parsed.frontmatter.readiness),
      execution_mode: normalizeExecutionMode(parsed.frontmatter.execution_mode),
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
    ['in_progress', 'In Progress'],
    ['waiting', 'Waiting'],
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
          readiness: task.readiness,
          execution_mode: task.execution_mode,
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
  return ['open', 'in_progress', 'waiting', 'done', 'archived', 'triage', 'assigned', 'converted'].includes(normalized)
    ? normalized
    : fallback;
}

function normalizePriority(value) {
  const normalized = String(value || 'p3').trim().toLowerCase();
  return ['p0', 'p1', 'p2', 'p3'].includes(normalized) ? normalized : 'p3';
}

function normalizeReadiness(value) {
  const normalized = String(value || 'underspecified').trim().toLowerCase();
  return ['underspecified', 'ready'].includes(normalized) ? normalized : 'underspecified';
}

function normalizeExecutionMode(value) {
  const normalized = String(value || 'agent').trim().toLowerCase();
  return ['agent', 'user', 'interactive'].includes(normalized) ? normalized : 'agent';
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

export async function buildExplorerRecentPayload(config, requestUrl = new URL('http://127.0.0.1')) {
  const requestedLimit = Number.parseInt(requestUrl.searchParams?.get('limit') || '80', 10);
  const limit = Number.isFinite(requestedLimit) ? Math.max(1, Math.min(250, requestedLimit)) : 80;
  const files = await explorerRecentFiles(config.brainDir, config.brainDir);
  files.sort((a, b) => {
    const byDate = Date.parse(b.updated_at) - Date.parse(a.updated_at);
    return byDate || a.path.localeCompare(b.path, undefined, { sensitivity: 'base', numeric: true });
  });
  return {
    files: files.slice(0, limit),
    meta: {
      root_path: config.brainDir,
      limit,
      total_file_count: files.length,
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

async function canonicalPageExists(config, slug) {
  try {
    const fullPath = resolveBrainMarkdownPath(config.brainDir, slug);
    const stat = await fs.stat(fullPath);
    return stat.isFile();
  } catch {
    return false;
  }
}

export async function buildSharedGroupPayload(config, db, requestUrl) {
  const requestedSlug = publicSlugFromSharedPath(requestUrl.pathname) || requestUrl.searchParams.get('slug')?.trim();
  const group = await getSharedGroup(db, requestedSlug, { resolveRedirect: true });
  if (!group || group.visibility !== 'public') return null;
  const pageRows = await getPagesBySlugs(db, group.pages.map((page) => page.page_slug));
  const pageBySlug = new Map(pageRows.map((row) => [row.slug, row]));
  const items = [];
  for (const member of group.pages) {
    const row = pageBySlug.get(member.page_slug);
    if (!row) continue;
    const rawFiles = await sharedRawFilesForPage(config, group.slug, row, member);
    items.push({
      slug: row.slug,
      title: member.label || row.title,
      page_title: row.title,
      type: row.type,
      summary: member.public_summary || null,
      raw_files: rawFiles,
    });
  }
  return {
    kind: 'group',
    slug: group.slug,
    title: group.title,
    description: group.description,
    redirect_to: group.slug !== requestedSlug ? `/shared/${group.slug}` : null,
    pages: items,
    updated_at: group.updated_at,
  };
}

export async function buildPublicPagePayload(config, requestUrl) {
  const slug = normalizePublicSlug(requestUrl.searchParams.get('slug')?.trim());
  if (!slug) return null;
  const resolved = await resolvePublicMarkdownPage(config, slug);
  const page = resolved?.page || null;
  if (!page || !isPublicPage(page.parsed)) return null;
  const canonicalSlug = resolved.slug;
  const attachmentRawPath = attachmentRawPathForPage(canonicalSlug, page.parsed);
  if (attachmentRawPath) {
    const mimeType = publicRawMimeTypeForPath(attachmentRawPath);
    const fullPath = safeBrainPath(config.brainDir, attachmentRawPath);
    const stat = mimeType ? await fs.lstat(fullPath).catch(() => null) : null;
    if (stat?.isSymbolicLink()) return null;
    if (!stat?.isFile()) return null;
    return {
      slug: canonicalSlug,
      redirect_to: canonicalSlug !== slug ? `/public/${canonicalSlug}` : null,
      title: page.parsed.title,
      summary: '',
      markdown: '',
      page_kind: 'attachment',
      attachment_url: publicRawHref(canonicalSlug, attachmentRawPath),
      raw_files: [{ filename: path.posix.basename(attachmentRawPath), url: publicRawHref(canonicalSlug, attachmentRawPath) }],
      updated_at: page.stat.mtime.toISOString(),
    };
  }
  const rawFiles = publicRawFiles(page.parsed.frontmatter);
  const markdown = stripDuplicatePublicTitle(await sanitizePublicMarkdown({
    config,
    markdown: page.parsed.compiledTruth,
    sourceSlug: canonicalSlug,
    allowedRawFiles: rawFiles,
  }), page.parsed.title);
  const linkedRawFiles = publicRawFilesReferencedByMarkdown(markdown, canonicalSlug, rawFiles);
  return {
    slug: canonicalSlug,
    redirect_to: canonicalSlug !== slug ? `/public/${canonicalSlug}` : null,
    title: page.parsed.title,
    summary: extractPageReaderSummary(page.parsed, markdown),
    markdown,
    raw_files: linkedRawFiles.map((rawPath) => ({
      filename: path.posix.basename(rawPath),
      url: publicRawHref(canonicalSlug, rawPath),
    })),
    updated_at: page.stat.mtime.toISOString(),
  };
}

export async function buildSharedRawFilePayload(config, db, requestUrl) {
  const groupSlug = requestUrl.searchParams.get('group')?.trim();
  const pageSlug = normalizePublicSlug(requestUrl.searchParams.get('page')?.trim());
  const requestedRawPath = normalizePublicRawQueryPath(requestUrl.searchParams.get('path'));
  if (!groupSlug || !pageSlug || !requestedRawPath) return null;
  const group = await getSharedGroup(db, groupSlug, { resolveRedirect: true });
  if (!group || group.visibility !== 'public') return null;
  const member = group.pages.find((page) => page.page_slug === pageSlug);
  if (!member) return null;
  const rows = await getPagesBySlugs(db, [pageSlug]);
  const row = rows[0];
  if (!row) return null;
  const allowedRawFiles = sharedRawPathsForPage(row, member);
  if (!allowedRawFiles.includes(requestedRawPath)) return null;
  const mimeType = publicRawMimeTypeForPath(requestedRawPath);
  if (!mimeType) return null;
  const fullPath = safeBrainPath(config.brainDir, requestedRawPath);
  const stat = await fs.lstat(fullPath).catch(() => null);
  if (stat?.isSymbolicLink()) return null;
  if (!stat?.isFile()) return null;
  return {
    group_slug: group.slug,
    page_slug: pageSlug,
    path: requestedRawPath,
    fullPath,
    filename: path.posix.basename(requestedRawPath),
    mime_type: mimeType,
    size: stat.size,
    updated_at: stat.mtime.toISOString(),
  };
}

function stripDuplicatePublicTitle(markdown, title) {
  const expected = String(title || '').trim();
  if (!expected) return markdown;
  const lines = String(markdown || '').split('\n');
  let index = 0;
  while (index < lines.length && !lines[index].trim()) index += 1;
  if (index >= lines.length) return markdown;
  const heading = lines[index].trim().match(/^#\s+(.+)$/);
  if (!heading || heading[1].trim() !== expected) return markdown;
  lines.splice(index, 1);
  while (index < lines.length && !lines[index].trim()) lines.splice(index, 1);
  return lines.join('\n');
}

export async function buildPublicRawFilePayload(config, requestUrl) {
  const slug = normalizePublicSlug(requestUrl.searchParams.get('slug')?.trim());
  if (!slug) return null;
  const requestedRawPath = normalizePublicRawQueryPath(requestUrl.searchParams.get('path'));
  if (!requestedRawPath) return null;
  const resolved = await resolvePublicMarkdownPage(config, slug);
  const page = resolved?.page || null;
  if (!page || !isPublicPage(page.parsed)) return null;
  const attachmentRawPath = attachmentRawPathForPage(resolved.slug, page.parsed);
  const rawFiles = attachmentRawPath ? [attachmentRawPath] : publicRawFiles(page.parsed.frontmatter);
  if (!rawFiles.includes(requestedRawPath)) return null;
  const mimeType = publicRawMimeTypeForPath(requestedRawPath);
  if (!mimeType) return null;
  const fullPath = safeBrainPath(config.brainDir, requestedRawPath);
  const stat = await fs.lstat(fullPath).catch(() => null);
  if (stat?.isSymbolicLink()) return null;
  if (!stat?.isFile()) return null;
  return {
    path: requestedRawPath,
    slug: resolved.slug,
    fullPath,
    filename: path.posix.basename(requestedRawPath),
    mime_type: mimeType,
    size: stat.size,
    updated_at: stat.mtime.toISOString(),
  };
}

export async function updateDashboardPageVisibility(config, db, req, actor = null) {
  if (req.method !== 'POST') {
    const error = new Error('Page visibility updates require POST.');
    error.statusCode = 405;
    throw error;
  }
  const input = await readJsonRequest(req);
  const slug = normalizePublicSlug(input.slug || input.path);
  if (!slug) throw new Error('Page visibility update requires slug.');
  const visibility = normalizePageVisibility(input.visibility);
  await updatePageVisibility({
    config,
    pagePath: slug,
    visibility,
    publicRawFiles: input.public_raw_files,
    timelineEntry: `Visibility set to ${visibility} from dashboard${actor?.email ? ` by ${actor.email}` : ''}.`,
  });
  return buildPagePayloadForSlug(config, db, slug);
}

async function buildPagePayloadForSlug(config, db, slug) {
  const pageSlug = normalizeDashboardPageSlug(slug);
  const fullPath = resolveBrainMarkdownPath(config.brainDir, pageSlug);
  const raw = await fs.readFile(fullPath, 'utf8');
  const parsed = parseMarkdownPage(raw, pageSlug);
  const stat = await fs.stat(fullPath);
  const outgoing = db ? await getOutgoingLinks(db, pageSlug) : [];
  const backlinks = db ? await getBacklinks(db, pageSlug) : [];
  const relativePath = path.relative(config.brainDir, fullPath);
  let pageUrlPath = null;
  try {
    pageUrlPath = canonicalPagePath(config.brainId, pageSlug);
  } catch {
    // Root infrastructure documents remain readable but do not get page links.
  }
  return {
    slug: pageSlug,
    brain_id: config.brainId,
    page_url_path: pageUrlPath,
    title: parsed.title,
    type: parsed.type,
    path: relativePath,
    visibility: pageVisibility(parsed.frontmatter),
    public_url: pageVisibility(parsed.frontmatter) === 'public' ? `/public/${slug}` : null,
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

function normalizeDashboardPageSlug(slug) {
  try {
    return normalizeCanonicalPageSlug(slug);
  } catch {
    const value = String(slug || '').trim().replace(/\.md$/i, '');
    if (!value || value.includes('/') || value.includes('\\') || value.includes('%')
      || value.includes('?') || value.includes('#') || value === '.' || value === '..') {
      throw new Error('Invalid dashboard page slug.');
    }
    return value;
  }
}

async function readPublicMarkdownPage(config, slug) {
  let fullPath;
  try {
    fullPath = resolveBrainMarkdownPath(config.brainDir, slug);
    const stat = await fs.stat(fullPath);
    if (!stat.isFile()) return null;
    const raw = await fs.readFile(fullPath, 'utf8');
    return { stat, parsed: parseMarkdownPage(raw, slug) };
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') return null;
    return null;
  }
}

async function resolvePublicMarkdownPage(config, slug) {
  const page = await readPublicMarkdownPage(config, slug);
  if (page && isPublicPage(page.parsed)) return { slug, page };
  const redirect = await findPublicRedirectTarget(config, slug);
  if (!redirect) return page ? { slug, page } : null;
  return redirect;
}

async function publicRedirectLocation(config, db, requestUrl) {
  const slug = normalizePublicSlug(publicSlugFromPublicPath(requestUrl.pathname));
  if (!slug) return null;
  const group = await getSharedGroup(db, slug, { resolveRedirect: true });
  if (group?.visibility === 'public') return `/shared/${group.slug}`;
  const page = await readPublicMarkdownPage(config, slug);
  if (page && isPublicPage(page.parsed)) {
    const attachmentRawPath = attachmentRawPathForPage(slug, page.parsed);
    if (attachmentRawPath && publicRawMimeTypeForPath(attachmentRawPath)) {
      const fullPath = safeBrainPath(config.brainDir, attachmentRawPath);
      const stat = await fs.lstat(fullPath).catch(() => null);
      if (stat?.isSymbolicLink()) return null;
      if (stat?.isFile()) return publicRawHref(slug, attachmentRawPath);
    }
    return null;
  }
  const redirect = await findPublicRedirectTarget(config, slug);
  if (!redirect) return null;
  return `/public/${redirect.slug}${requestUrl.search || ''}`;
}

async function sharedRedirectLocation(db, requestUrl) {
  const slug = publicSlugFromSharedPath(requestUrl.pathname);
  if (!slug) return null;
  const group = await getSharedGroup(db, slug, { resolveRedirect: true });
  if (!group || group.visibility !== 'public' || group.slug === slug) return null;
  return `/shared/${group.slug}${requestUrl.search || ''}`;
}

function publicSlugFromPublicPath(pathname) {
  if (!isPublicAppPath(pathname)) return '';
  if (pathname === '/public') return '';
  const raw = String(pathname || '').replace(/^\/public\/?/, '');
  try {
    return decodeURIComponent(raw).replace(/^\/+/, '').replace(/\/+$/, '');
  } catch {
    return raw.replace(/^\/+/, '').replace(/\/+$/, '');
  }
}

function publicSlugFromSharedPath(pathname) {
  if (!isSharedAppPath(pathname)) return '';
  if (pathname === '/shared') return '';
  const raw = String(pathname || '').replace(/^\/shared\/?/, '');
  try {
    return decodeURIComponent(raw).replace(/^\/+/, '').replace(/\/+$/, '');
  } catch {
    return raw.replace(/^\/+/, '').replace(/\/+$/, '');
  }
}

async function findPublicRedirectTarget(config, requestedSlug) {
  const wanted = normalizePublicSlug(requestedSlug);
  if (!wanted) return null;
  const pages = [];
  await walkMarkdownPages(config.brainDir, config.brainDir, pages);
  for (const candidateSlug of pages.sort()) {
    const page = await readPublicMarkdownPage(config, candidateSlug);
    if (!page || !isPublicPage(page.parsed)) continue;
    if (publicRedirects(page.parsed.frontmatter).includes(wanted)) return { slug: candidateSlug, page };
  }
  return null;
}

async function walkMarkdownPages(root, current, pages) {
  const entries = await fs.readdir(current, { withFileTypes: true }).catch(() => []);
  for (const entry of entries) {
    if (entry.name === '.git' || entry.name === '.bigbrain-state' || entry.name === '.raw') continue;
    const fullPath = path.join(current, entry.name);
    if (entry.isDirectory()) {
      await walkMarkdownPages(root, fullPath, pages);
      continue;
    }
    if (!entry.isFile() || !entry.name.endsWith('.md')) continue;
    pages.push(path.relative(root, fullPath).replace(/\\/g, '/').replace(/\.md$/i, ''));
  }
}

function publicRedirects(frontmatter = {}) {
  const redirects = Array.isArray(frontmatter.redirect_from)
    ? frontmatter.redirect_from
    : [frontmatter.redirect_from];
  return redirects.map((value) => normalizePublicSlug(value)).filter(Boolean);
}

async function sharedRawFilesForPage(config, groupSlug, row, member = null) {
  const rawFiles = [];
  for (const rawPath of sharedRawPathsForPage(row, member)) {
    const mimeType = publicRawMimeTypeForPath(rawPath);
    if (!mimeType) continue;
    const fullPath = safeBrainPath(config.brainDir, rawPath);
    const stat = await fs.lstat(fullPath).catch(() => null);
    if (stat?.isSymbolicLink()) continue;
    if (!stat?.isFile()) continue;
    rawFiles.push({
      filename: path.posix.basename(rawPath),
      path: rawPath,
      mime_type: mimeType,
      size: stat.size,
      url: `/api/shared/raw?group=${encodeURIComponent(groupSlug)}&page=${encodeURIComponent(row.slug)}&path=${encodeURIComponent(rawPath)}`,
    });
  }
  return rawFiles;
}

function sharedRawPathsForPage(row, member = null) {
  const frontmatter = parseFrontmatterJson(row?.frontmatter_json);
  const values = [
    ...arrayOfStrings(member?.raw_files),
    ...arrayOfStrings(frontmatter.raw_file),
    ...arrayOfStrings(frontmatter.public_raw_files),
  ];
  return [...new Set(values.map((value) => normalizePublicRawQueryPath(value)).filter(Boolean))];
}

function parseFrontmatterJson(value) {
  if (!value) return {};
  if (typeof value === 'object') return value;
  try {
    return JSON.parse(value);
  } catch {
    return {};
  }
}

function arrayOfStrings(value) {
  if (Array.isArray(value)) return value.map(String);
  if (typeof value === 'string' && value.trim()) return [value.trim()];
  return [];
}

function normalizePublicSlug(value) {
  const slug = String(value || '').trim().replace(/^\/+/, '').replace(/\.md$/i, '');
  if (!slug || slug === '.' || slug.startsWith('../') || path.posix.isAbsolute(slug)) return '';
  const normalized = path.posix.normalize(slug);
  if (normalized === '.' || normalized.startsWith('../') || normalized.split('/').some((part) => !part || part === '.' || part === '..')) return '';
  return normalized.replace(/\.md$/i, '');
}

function extractSummaryFromText(text) {
  return String(text || '')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line && !/^#{1,6}\s/.test(line))
    .slice(0, 2)
    .join('\n\n');
}

function isPublicPage(parsed) {
  return pageVisibility(parsed?.frontmatter) === 'public';
}

async function sanitizePublicMarkdown({ config, markdown, sourceSlug, allowedRawFiles = [] }) {
  let next = String(markdown || '');
  next = await replaceMarkdownLinks(next, /!?\[([^\]]*)\]\(([^)]+)\)/g, async (full, label, target) => {
    if (/^!/.test(full)) return label || '';
    const publicRawHref = publicRawHrefForTarget(sourceSlug, target, allowedRawFiles);
    if (publicRawHref) return `[${label}](${publicRawHref})`;
    const publicHref = await publicHrefForTarget(config, sourceSlug, target);
    return publicHref ? `[${label}](${publicHref})` : label;
  });
  next = await replaceMarkdownLinks(next, /\[\[([^[\]]+)\]\]/g, async (_full, rawTarget) => {
    const [target, label] = String(rawTarget || '').split('|').map((part) => part.trim());
    const publicHref = await publicHrefForTarget(config, sourceSlug, target);
    const publicLabel = label || target;
    return publicHref ? `[${publicLabel}](${publicHref})` : publicLabel;
  });
  return next;
}

function publicRawHrefForTarget(sourceSlug, target, allowedRawFiles) {
  const rawPath = resolveRawLinkTarget(sourceSlug, target);
  if (!rawPath || !allowedRawFiles.includes(rawPath)) return null;
  return publicRawHref(sourceSlug, rawPath);
}

function publicRawFilesReferencedByMarkdown(markdown, sourceSlug, allowedRawFiles) {
  const referencedRawFiles = new Set();
  for (const match of String(markdown || '').matchAll(/!?\[([^\]]*)\]\(([^)]+)\)/g)) {
    const rawPath = publicRawPathForHref(sourceSlug, match[2]);
    if (rawPath && allowedRawFiles.includes(rawPath)) referencedRawFiles.add(rawPath);
  }
  return allowedRawFiles.filter((rawPath) => referencedRawFiles.has(rawPath));
}

function publicRawPathForHref(sourceSlug, href) {
  try {
    const parsed = new URL(String(href || ''), 'http://127.0.0.1');
    if (parsed.pathname !== '/api/public/raw') return null;
    const slug = normalizePublicSlug(parsed.searchParams.get('slug')?.trim());
    if (slug !== sourceSlug) return null;
    return normalizePublicRawQueryPath(parsed.searchParams.get('path'));
  } catch {
    return null;
  }
}

function publicRawHref(sourceSlug, rawPath) {
  return `/api/public/raw?slug=${encodeURIComponent(sourceSlug)}&path=${encodeURIComponent(rawPath)}`;
}

function normalizePublicRawQueryPath(value) {
  try {
    return normalizeRawPath(value);
  } catch {
    return '';
  }
}

function attachmentRawPathForPage(slug, parsed) {
  const parts = String(slug || '').split('/');
  if (parts.length !== 3 || parts[1] !== '.raw') return '';
  const value = parsed?.frontmatter?.raw_file;
  if (typeof value !== 'string' || !value.trim()) return '';
  const rawPath = normalizePublicRawQueryPath(value);
  if (!rawPath) return '';
  const extension = path.posix.extname(rawPath);
  if (!extension || extension.toLowerCase() === '.md') return '';
  const expectedSlug = `${rawPath.slice(0, -extension.length)}`;
  return expectedSlug === slug ? rawPath : '';
}

function resolveRawLinkTarget(sourceSlug, target) {
  const trimmed = String(target || '').trim();
  if (!trimmed || /^(https?:|mailto:|#)/i.test(trimmed)) return null;
  const withoutAnchor = trimmed.split('#')[0].trim();
  if (!withoutAnchor) return null;
  const sourceDir = path.posix.dirname(sourceSlug);
  const candidate = path.posix.normalize(
    withoutAnchor.startsWith('/') ? withoutAnchor.replace(/^\/+/, '') : path.posix.join(sourceDir, withoutAnchor),
  );
  if (!candidate.split('/').includes('.raw')) return null;
  try {
    return normalizeRawPath(candidate);
  } catch {
    return null;
  }
}

async function replaceMarkdownLinks(markdown, pattern, replacer) {
  const matches = [...markdown.matchAll(pattern)];
  if (!matches.length) return markdown;
  let output = '';
  let cursor = 0;
  for (const match of matches) {
    output += markdown.slice(cursor, match.index);
    output += await replacer(...match);
    cursor = match.index + match[0].length;
  }
  output += markdown.slice(cursor);
  return output;
}

async function publicHrefForTarget(config, sourceSlug, target) {
  const trimmed = String(target || '').trim();
  if (!trimmed) return null;
  if (/^(https?:|mailto:|#)/i.test(trimmed)) return trimmed;
  const anchorIndex = trimmed.indexOf('#');
  const targetWithoutAnchor = anchorIndex >= 0 ? trimmed.slice(0, anchorIndex) : trimmed;
  const anchor = anchorIndex >= 0 ? trimmed.slice(anchorIndex) : '';
  const slug = resolveMarkdownLink(sourceSlug, targetWithoutAnchor);
  if (!slug) return null;
  const page = await readPublicMarkdownPage(config, slug);
  if (!page || !isPublicPage(page.parsed)) return null;
  return `/public/${slug}${anchor}`;
}

function resolveBrainMarkdownPath(brainDir, slug) {
  const candidate = path.resolve(fullPathFromSlug(brainDir, slug));
  const resolvedBrainDir = path.resolve(brainDir);
  if (candidate !== resolvedBrainDir && !candidate.startsWith(`${resolvedBrainDir}${path.sep}`)) {
    throw new Error(`Linked file is outside the brain directory: ${slug}`);
  }
  return candidate;
}

function extractPageReaderSummary(parsed, markdown = parsed.compiledTruth) {
  const titlePattern = new RegExp(`^#\\s+${escapeRegExp(parsed.title)}\\s*$`, 'i');
  const blocks = [];
  let current = [];
  for (const rawLine of markdown.split('\n')) {
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
    if (await shouldSkipExplorerEntry(childFullPath, childRelative, dirent)) continue;
    children.push(await explorerEntryForPath(root, childFullPath, true));
  }
  children.sort(compareExplorerEntries);
  return { ...entry, children };
}

async function explorerRecentFiles(root, fullPath) {
  const dirents = await fs.readdir(fullPath, { withFileTypes: true });
  const files = [];
  for (const dirent of dirents) {
    const childFullPath = path.join(fullPath, dirent.name);
    const childRelative = path.relative(root, childFullPath).split(path.sep).join('/');
    if (await shouldSkipExplorerEntry(childFullPath, childRelative, dirent)) continue;
    if (dirent.isDirectory()) {
      files.push(...await explorerRecentFiles(root, childFullPath));
      continue;
    }
    if (!dirent.isFile()) continue;
    files.push(await explorerEntryForPath(root, childFullPath, false));
  }
  return files;
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

async function shouldSkipExplorerEntry(fullPath, relativePath, dirent) {
  if (shouldSkipExplorerPath(relativePath, dirent)) return true;
  const normalized = String(relativePath || '').replace(/\\/g, '/');
  if (normalized !== 'BRAIN.md' || !dirent.isFile()) return false;
  const raw = await fs.readFile(fullPath, 'utf8');
  return isBrainProfileDocument(raw);
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
  if (isPresentationFile(mimeType, extension)) return 'presentation';
  if (mimeType.startsWith('image/')) return 'image';
  if (mimeType.startsWith('text/') || ['.json', '.csv', '.yaml', '.yml', '.log'].includes(extension)) return 'text';
  return 'unsupported';
}

function isPresentationFile(mimeType, extension) {
  return ['.ppt', '.pptx'].includes(extension)
    || mimeType === 'application/vnd.ms-powerpoint'
    || mimeType === 'application/vnd.openxmlformats-officedocument.presentationml.presentation';
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
    '.ppt': 'application/vnd.ms-powerpoint',
    '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
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

export async function buildGraphPayload(db, config = null) {
  const pages = await listPages(db, { includeTimeline: true });
  const graphPages = pages.filter(isDirectoryBackedGraphPage);
  const candidateNodes = (await Promise.all(graphPages.map(async (page) => {
    const outgoing = await getOutgoingLinks(db, page.slug);
    const backlinks = await getBacklinks(db, page.slug);
    const updatedAt = await resolveGraphNodeUpdatedAt(config, page);
    return {
      slug: page.slug,
      title: page.title,
      type: page.type,
      updated_at: updatedAt,
      latest_timeline_entry: latestTimelineEntry(page.timeline),
      degree: outgoing.length + backlinks.length,
      outgoing,
    };
  }))).sort((a, b) => b.degree - a.degree || a.slug.localeCompare(b.slug));

  const allowed = new Set(candidateNodes.map((node) => node.slug));
  const provenanceRows = await listPageProvenance(db, { pageSlugs: [...allowed], limit: 200 });
  const titles = new Map(candidateNodes.map((node) => [node.slug, node.title]));
  const inputs = provenanceRows
    .filter((row) => row.outcome === 'filed' && allowed.has(row.page_slug))
    .map((row) => ({
      id: String(row.id),
      page_slug: row.page_slug,
      title: titles.get(row.page_slug) || row.page_slug,
      occurred_at: row.occurred_at || null,
      received_at: row.received_at || null,
      source: {
        id: row.listener_id || row.source_type,
        type: row.source_type,
        label: row.source_label,
        icon: row.source_icon || null,
      },
      event_id: row.event_id,
      listener_id: row.listener_id || null,
      codex_execution_id: row.codex_execution_id || null,
      codex_thread_id: row.codex_thread_id || null,
      source_url: row.source_url || null,
      raw_ref: row.raw_ref || null,
      outcome: row.outcome,
      commit_message: row.commit_message || null,
    }));
  const history = await buildGraphHistory(config, candidateNodes);
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
      input_count: inputs.length,
    },
    activity: history.activity,
    inputs,
    nodes: candidateNodes.map((node) => ({
      slug: node.slug,
      title: node.title,
      type: node.type,
      updated_at: node.updated_at,
      created_at: history.createdDays.get(`${node.slug}.md`) || node.updated_at,
      latest_timeline_entry: node.latest_timeline_entry,
      degree: node.degree,
    })),
    edges,
  };
}

export async function buildGraphLineagePayload(db, config, slug) {
  const normalizedSlug = String(slug || '').trim().replace(/\.md$/i, '');
  if (!normalizedSlug) return null;
  const page = (await getPagesBySlugs(db, [normalizedSlug]))[0];
  if (!page) return null;
  const [outgoing, backlinks, provenance, events] = await Promise.all([
    getOutgoingLinks(db, normalizedSlug),
    getBacklinks(db, normalizedSlug),
    listPageProvenance(db, { pageSlugs: [normalizedSlug], limit: 200 }),
    getRelatedLinkHistory({ repoRoot: config?.brainDir, pagePath: normalizedSlug, limit: 200 }).catch(() => []),
  ]);
  const relatedSlugs = [...new Set([
    normalizedSlug,
    ...outgoing.map((link) => link.to_slug),
    ...backlinks.map((link) => link.from_slug),
    ...events.flatMap((event) => [event.from_page, event.to_page]),
  ])];
  const relatedPages = new Map((await getPagesBySlugs(db, relatedSlugs)).map((item) => [item.slug, item]));
  const pageSummary = (itemSlug) => {
    const item = relatedPages.get(itemSlug);
    return { slug: itemSlug, title: item?.title || itemSlug, type: item?.type || itemSlug.split('/')[0] || 'unknown' };
  };
  return {
    page: pageSummary(normalizedSlug),
    outgoing: outgoing.map((link) => ({ ...link, page: pageSummary(link.to_slug) })),
    backlinks: backlinks.map((link) => ({ ...link, page: pageSummary(link.from_slug) })),
    provenance: provenance
      .filter((row) => row.outcome === 'filed')
      .map((row) => ({
        event_id: row.event_id,
        source_type: row.source_type,
        source_label: row.source_label,
        commit_message: row.commit_message || null,
        occurred_at: row.occurred_at || null,
        received_at: row.received_at || null,
      })),
    link_events: events.map((event) => ({
      ...event,
      from: pageSummary(event.from_page),
      to: pageSummary(event.to_page),
    })),
  };
}

const GRAPH_MUTATION_TOOLS = new Set([
  'create_page',
  'create_raw_file_with_page',
  'rename_page',
  'set_page_visibility',
  'tasks/create',
  'tasks/update',
  'update_page',
]);

export function graphChangeFromAuditRow(row) {
  if (!row || row.outcome !== 'success' || typeof row.action !== 'string') return null;
  const tool = row.action.replace(/^mcp\.tool\./, '');
  if (!GRAPH_MUTATION_TOOLS.has(tool)) return null;
  let details = {};
  try {
    details = typeof row.details_json === 'string' ? JSON.parse(row.details_json) : row.details_json || {};
  } catch {
    details = {};
  }
  const args = details.arguments || {};
  const slug = row.resource_type === 'page'
    ? row.resource_id
    : args.page_path || args.to_path || args.path || args.slug || null;
  return {
    id: String(row.id),
    event_id: row.event_id || null,
    kind: tool.includes('create') ? 'created' : tool === 'rename_page' ? 'renamed' : 'updated',
    slug: typeof slug === 'string' ? slug.replace(/\.md$/i, '') : null,
    action: tool,
    created_at: row.created_at,
  };
}

async function streamGraphEvents(db, res) {
  const latest = await listMcpAuditLog(db, { limit: 1 });
  let cursor = BigInt(latest[0]?.id || 0);
  let polling = false;
  let heartbeatCount = 0;
  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-store',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.write('event: ready\ndata: {}\n\n');

  const poll = async () => {
    if (polling || res.destroyed) return;
    polling = true;
    try {
      const rows = await listMcpAuditLog(db, { limit: 100 });
      const fresh = rows
        .filter((row) => BigInt(row.id) > cursor)
        .sort((left, right) => BigInt(left.id) < BigInt(right.id) ? -1 : 1);
      for (const row of fresh) {
        cursor = BigInt(row.id) > cursor ? BigInt(row.id) : cursor;
        const change = graphChangeFromAuditRow(row);
        if (!change) continue;
        res.write(`id: ${change.id}\nevent: graph-change\ndata: ${JSON.stringify(change)}\n\n`);
      }
      heartbeatCount += 1;
      if (heartbeatCount % 20 === 0) res.write(': keepalive\n\n');
    } catch {
      res.write('event: graph-error\ndata: {}\n\n');
    } finally {
      polling = false;
    }
  };
  const interval = setInterval(poll, 750);
  interval.unref?.();
  res.once('close', () => clearInterval(interval));
}

async function buildGraphHistory(config, nodes) {
  let gitLog = '';
  if (config?.brainDir) {
    try {
      ({ stdout: gitLog } = await execFileAsync('git', [
        'log', '--reverse', '--format=%x1e%aI', '--name-only', '--', '.',
      ], { cwd: config.brainDir, maxBuffer: 16 * 1024 * 1024 }));
    } catch {
      // Non-git brains use current page timestamps as a bounded fallback.
    }
  }
  const currentPaths = new Set(nodes.map((node) => `${node.slug}.md`));
  return {
    activity: buildContinuousActivity(nodes, gitLog),
    createdDays: firstSeenDaysByPath(gitLog, currentPaths),
  };
}

function firstSeenDaysByPath(gitLog, currentPaths) {
  const result = new Map();
  for (const record of String(gitLog).split('\x1e').filter(Boolean)) {
    const [timestamp, ...files] = record.trim().split('\n').map((line) => line.trim()).filter(Boolean);
    const day = timestamp?.slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day || '')) continue;
    for (const file of files) {
      const normalized = file.replace(/^\.\//, '').replace(/\\/g, '/');
      if (currentPaths.has(normalized) && !result.has(normalized)) result.set(normalized, day);
    }
  }
  return result;
}

export function buildContinuousActivity(nodes, gitLog = '', todayDay = new Date().toISOString().slice(0, 10)) {
  const currentPaths = new Set(nodes.map((node) => `${node.slug}.md`));
  const pathsByDay = new Map();
  let firstDay = null;

  for (const record of String(gitLog).split('\x1e').filter(Boolean)) {
    const [timestamp, ...files] = record.trim().split('\n').map((line) => line.trim()).filter(Boolean);
    const day = timestamp?.slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day || '')) continue;
    if (!firstDay || day < firstDay) firstDay = day;
    const changed = pathsByDay.get(day) || new Set();
    for (const file of files) {
      const normalized = file.replace(/^\.\//, '').replace(/\\/g, '/');
      if (currentPaths.has(normalized)) changed.add(normalized);
    }
    pathsByDay.set(day, changed);
  }

  if (!firstDay) {
    const days = nodes.map((node) => String(node.updated_at || '').slice(0, 10)).filter((day) => /^\d{4}-\d{2}-\d{2}$/.test(day));
    firstDay = days.sort()[0] || null;
    for (const node of nodes) {
      const day = String(node.updated_at || '').slice(0, 10);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) continue;
      const changed = pathsByDay.get(day) || new Set();
      changed.add(`${node.slug}.md`);
      pathsByDay.set(day, changed);
    }
  }
  if (!firstDay) return [];

  const result = [];
  for (let cursor = Date.parse(`${firstDay}T00:00:00.000Z`), end = Date.parse(`${todayDay}T00:00:00.000Z`); cursor <= end; cursor += 86_400_000) {
    const day = new Date(cursor).toISOString().slice(0, 10);
    result.push({ day, count: pathsByDay.get(day)?.size || 0 });
  }
  return result;
}

async function resolveGraphNodeUpdatedAt(config, page) {
  if (!config?.brainDir || !page?.slug) return page.updated_at;
  try {
    const stats = await fs.stat(fullPathFromSlug(config.brainDir, page.slug));
    return stats.mtime.toISOString();
  } catch {
    return page.updated_at;
  }
}

function latestTimelineEntry(timeline) {
  const entries = String(timeline || '')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.startsWith('- '));
  if (!entries.length) return '';
  return entries[entries.length - 1]
    .replace(/^-\s*/, '')
    .replace(/^\*\*(\d{4}-\d{2}-\d{2})\*\*\s*\|\s*/, '$1 | ')
    .trim();
}

export function isDirectoryBackedGraphPage(page) {
  return typeof page?.slug === 'string' && page.slug.includes('/');
}
