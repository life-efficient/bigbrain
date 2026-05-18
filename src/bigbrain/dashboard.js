import http from 'node:http';
import fs from 'node:fs/promises';

import { openDatabase, getBacklinks, getOutgoingLinks, listPages } from './db.js';
import { runHealthCheck } from './health.js';
import { renderSchemaMarkdown } from './schema.js';

export async function startDashboard(config, { port = config.dashboardPort } = {}) {
  const db = await openDatabase(config);
  const server = http.createServer(async (req, res) => {
    try {
      if (req.url === '/' || req.url === '/index.html') {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(renderAppHtml());
        return;
      }
      if (req.url === '/api/schema') return json(res, { markdown: renderSchemaMarkdown() });
      if (req.url === '/api/tasks') return json(res, { markdown: await fs.readFile(config.tasksFile, 'utf8') });
      if (req.url === '/api/recent') return json(res, { pages: listPages(db).slice(-20).reverse() });
      if (req.url === '/api/graph') {
        const pages = listPages(db).slice(0, 100);
        return json(res, {
          graph: pages.map((page) => ({
            slug: page.slug,
            links: getOutgoingLinks(db, page.slug).map((row) => row.to_slug),
            backlinks: getBacklinks(db, page.slug).map((row) => row.from_slug),
          })),
        });
      }
      if (req.url === '/api/health') return json(res, await runHealthCheck(config));
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

function json(res, value) {
  res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(value, null, 2));
}

function renderAppHtml() {
  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>bigbrain dashboard</title>
    <style>
      body { font-family: ui-sans-serif, -apple-system, BlinkMacSystemFont, sans-serif; margin: 0; background: #f4f1ea; color: #1f1a17; }
      main { max-width: 1200px; margin: 0 auto; padding: 40px 24px 80px; }
      h1 { font-size: 40px; margin: 0 0 8px; }
      p { color: #5e544d; }
      .grid { display: grid; gap: 20px; grid-template-columns: repeat(auto-fit, minmax(320px, 1fr)); margin-top: 28px; }
      .card { background: rgba(255,255,255,0.7); border: 1px solid rgba(31,26,23,0.08); border-radius: 18px; padding: 18px; box-shadow: 0 10px 30px rgba(31,26,23,0.05); }
      pre { white-space: pre-wrap; word-break: break-word; font-size: 12px; line-height: 1.5; }
    </style>
  </head>
  <body>
    <main>
      <h1>bigbrain</h1>
      <p>Minimal local dashboard for sanity, tasks, graph, health, and schema help.</p>
      <div class="grid">
        <section class="card"><h2>Schema</h2><pre id="schema"></pre></section>
        <section class="card"><h2>Tasks</h2><pre id="tasks"></pre></section>
        <section class="card"><h2>Recent</h2><pre id="recent"></pre></section>
        <section class="card"><h2>Health</h2><pre id="health"></pre></section>
        <section class="card"><h2>Graph</h2><pre id="graph"></pre></section>
      </div>
    </main>
    <script>
      for (const endpoint of ['schema', 'tasks', 'recent', 'health', 'graph']) {
        fetch('/api/' + endpoint).then((r) => r.json()).then((data) => {
          document.getElementById(endpoint).textContent =
            typeof data.markdown === 'string' ? data.markdown : JSON.stringify(data, null, 2);
        }).catch((error) => {
          document.getElementById(endpoint).textContent = String(error);
        });
      }
    </script>
  </body>
</html>`;
}
