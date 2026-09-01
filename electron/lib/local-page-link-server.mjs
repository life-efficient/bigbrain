import http from 'node:http';

import {
  LOCAL_PAGE_LINK_HOST,
  LOCAL_PAGE_LINK_PORT,
  canonicalPageUrl,
  parseCanonicalPagePath,
} from '../../src/bigbrain/page-links.js';

export async function startLocalPageLinkServer({
  resolveBrain,
  openPage,
  port = LOCAL_PAGE_LINK_PORT,
} = {}) {
  if (typeof resolveBrain !== 'function' || typeof openPage !== 'function') {
    throw new Error('Local page link server requires brain resolution and page opening callbacks.');
  }
  const server = http.createServer(async (request, response) => {
    try {
      if (request.method !== 'GET') return send(response, 405, 'Method not allowed');
      const url = new URL(request.url || '/', `http://${LOCAL_PAGE_LINK_HOST}`);
      let target;
      try {
        target = parseCanonicalPagePath(url.pathname, { basePath: '' });
      } catch {
        target = null;
      }
      if (!target) return send(response, 404, 'Page link not found');
      const brain = await resolveBrain(target.brainId).catch(() => null);
      if (!brain?.dashboardUrl) return send(response, 404, 'Page link not found');
      const dashboardOrigin = new URL(brain.dashboardUrl).origin;
      const targetUrl = canonicalPageUrl(dashboardOrigin, target.brainId, target.slug);
      await openPage({ brain, targetUrl, slug: target.slug });
      return send(response, 200, 'Opened in BigBrain');
    } catch {
      return send(response, 500, 'BigBrain could not open this page');
    }
  });
  await new Promise((resolve, reject) => {
    const handleError = (error) => {
      const message = error?.code === 'EADDRINUSE'
        ? `BigBrain could not start its local page-link router on ${LOCAL_PAGE_LINK_HOST}:${port} because that port is already in use.`
        : `BigBrain could not start its local page-link router on ${LOCAL_PAGE_LINK_HOST}:${port}.`;
      reject(Object.assign(new Error(message, { cause: error }), { code: error?.code }));
    };
    server.once('error', handleError);
    server.listen(port, LOCAL_PAGE_LINK_HOST, () => {
      server.off('error', handleError);
      resolve();
    });
  });
  return server;
}

function send(response, status, message) {
  response.writeHead(status, {
    'content-type': 'text/html; charset=utf-8',
    'cache-control': 'no-store',
    'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'",
    'x-content-type-options': 'nosniff',
  });
  response.end(`<!doctype html><meta charset="utf-8"><title>BigBrain</title><p>${message}</p>`);
}
