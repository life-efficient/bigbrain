import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';

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
      if (req.url === '/api/tasks') return json(res, await buildTasksPayload(config));
      if (req.url === '/api/inbox') return json(res, await buildInboxPayload(config));
      if (req.url === '/api/recent') return json(res, buildRecentPayload(db));
      if (req.url === '/api/graph') {
        return json(res, buildGraphPayload(db));
      }
      if (req.url === '/api/health') return json(res, await buildHealthPayload(config));
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
      :root {
        --bg: #f4f1ea;
        --card: rgba(255,255,255,0.72);
        --ink: #1f1a17;
        --muted: #665c55;
        --line: rgba(31,26,23,0.08);
        --accent: #205c5b;
        --warm: #bc7b4d;
        --danger: #a44545;
      }
      * { box-sizing: border-box; }
      body { font-family: ui-sans-serif, -apple-system, BlinkMacSystemFont, sans-serif; margin: 0; background:
        radial-gradient(circle at top left, rgba(188,123,77,0.10), transparent 30%),
        radial-gradient(circle at top right, rgba(32,92,91,0.10), transparent 28%),
        var(--bg); color: var(--ink); }
      main { max-width: 1380px; margin: 0 auto; padding: 36px 24px 80px; }
      h1 { font-size: 44px; margin: 0 0 6px; letter-spacing: -0.03em; }
      h2 { margin: 0 0 14px; font-size: 20px; }
      h3 { margin: 0 0 10px; font-size: 14px; text-transform: uppercase; letter-spacing: 0.06em; color: var(--muted); }
      p { color: var(--muted); margin: 0; }
      .topline { display: flex; justify-content: space-between; align-items: end; gap: 16px; margin-bottom: 28px; }
      .stats { display: flex; gap: 10px; flex-wrap: wrap; }
      .pill { padding: 8px 12px; border-radius: 999px; background: rgba(255,255,255,0.7); border: 1px solid var(--line); font-size: 13px; }
      .layout { display: grid; gap: 20px; grid-template-columns: 1.3fr 0.9fr; }
      .stack { display: grid; gap: 20px; }
      .split { display: grid; gap: 20px; grid-template-columns: 1fr 1fr; }
      .card { background: var(--card); border: 1px solid var(--line); border-radius: 22px; padding: 20px; box-shadow: 0 12px 34px rgba(31,26,23,0.05); backdrop-filter: blur(14px); }
      .graph-wrap { height: 520px; overflow: hidden; position: relative; }
      .graph-hud { position: absolute; top: 14px; right: 14px; display: flex; gap: 8px; z-index: 2; }
      .graph-button { border: 1px solid var(--line); background: rgba(255,255,255,0.86); color: var(--ink); border-radius: 999px; padding: 8px 12px; font-size: 12px; cursor: pointer; }
      .graph-button:hover { background: rgba(255,255,255,0.96); }
      .graph-note { position: absolute; left: 14px; bottom: 14px; z-index: 2; font-size: 12px; color: var(--muted); padding: 8px 10px; border-radius: 999px; background: rgba(255,255,255,0.84); border: 1px solid var(--line); }
      svg { width: 100%; height: 100%; display: block; }
      .legend { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 10px; }
      .legend span { font-size: 12px; color: var(--muted); padding: 6px 8px; border-radius: 999px; background: rgba(255,255,255,0.72); border: 1px solid var(--line); }
      .task-section, .inbox-list, .recent-list, .health-list { display: grid; gap: 12px; }
      .task-group { border-top: 1px solid var(--line); padding-top: 14px; }
      .task-group:first-child { border-top: 0; padding-top: 0; }
      .task { padding: 12px 14px; border-radius: 14px; background: rgba(255,255,255,0.7); border: 1px solid rgba(31,26,23,0.06); line-height: 1.45; }
      .task.done { opacity: 0.6; }
      .meta { font-size: 12px; color: var(--muted); }
      .inbox-item, .recent-item, .health-item { padding: 14px; border-radius: 14px; background: rgba(255,255,255,0.7); border: 1px solid rgba(31,26,23,0.06); }
      .recent-item strong, .inbox-item strong { display: block; margin-bottom: 6px; }
      .health-item.high { border-color: rgba(164,69,69,0.35); }
      .health-item.medium { border-color: rgba(188,123,77,0.35); }
      .schema { white-space: pre-wrap; font-size: 12px; line-height: 1.5; max-height: 360px; overflow: auto; }
      @media (max-width: 1100px) {
        .layout { grid-template-columns: 1fr; }
        .split { grid-template-columns: 1fr; }
        .graph-wrap { height: 420px; }
      }
    </style>
  </head>
  <body>
    <main>
      <div class="topline">
        <div>
          <h1>bigbrain</h1>
          <p>Graph, tasks, inbox, recent movement, and brain health in one place.</p>
        </div>
        <div class="stats" id="stats"></div>
      </div>
      <div class="layout">
        <section class="card">
          <h2>Knowledge Graph</h2>
          <div class="graph-wrap">
            <div class="graph-hud">
              <button class="graph-button" id="graph-zoom-in" type="button">Zoom in</button>
              <button class="graph-button" id="graph-zoom-out" type="button">Zoom out</button>
              <button class="graph-button" id="graph-reset" type="button">Reset</button>
            </div>
            <div class="graph-note">Drag to move. Scroll to zoom.</div>
            <svg id="graph"></svg>
          </div>
          <div class="legend">
            <span>people</span><span>companies</span><span>projects</span><span>meetings</span><span>deals</span><span>concepts</span>
          </div>
        </section>
        <div class="stack">
          <section class="card">
            <h2>Tasks</h2>
            <div id="tasks" class="task-section"></div>
          </section>
          <section class="card">
            <h2>Inbox</h2>
            <div id="inbox" class="inbox-list"></div>
          </section>
        </div>
      </div>
      <div class="split" style="margin-top:20px;">
        <section class="card">
          <h2>Recent Pages</h2>
          <div id="recent" class="recent-list"></div>
        </section>
        <section class="card">
          <h2>Health</h2>
          <div id="health" class="health-list"></div>
        </section>
      </div>
      <div class="split" style="margin-top:20px;">
        <section class="card">
          <h2>Schema</h2>
          <div id="schema" class="schema"></div>
        </section>
        <section class="card">
          <h2>What This Is</h2>
          <p style="line-height:1.6;">This dashboard now favors operating views over raw payloads: a live graph, rendered tasks, inbox cards, recent page movement, and a compressed health summary. It is still lightweight, but it should feel much closer to a real brain console than a JSON inspector.</p>
        </section>
      </div>
    </main>
    <script>
      const TYPE_COLORS = {
        people: '#205c5b',
        companies: '#bc7b4d',
        projects: '#516a93',
        meetings: '#7a5c8d',
        deals: '#9a4c4c',
        concepts: '#54734f',
        writing: '#7b6a52',
        inbox: '#8a6d45'
      };

      Promise.all([
        fetch('/api/schema').then(r => r.json()),
        fetch('/api/tasks').then(r => r.json()),
        fetch('/api/inbox').then(r => r.json()),
        fetch('/api/recent').then(r => r.json()),
        fetch('/api/health').then(r => r.json()),
        fetch('/api/graph').then(r => r.json())
      ]).then(([schema, tasks, inbox, recent, health, graph]) => {
        renderStats(graph, tasks, inbox, health);
        renderSchema(schema);
        renderTasks(tasks);
        renderInbox(inbox);
        renderRecent(recent);
        renderHealth(health);
        renderGraph(graph);
      }).catch((error) => {
        document.body.innerHTML = '<pre style="padding:20px;">' + String(error) + '</pre>';
      });

      function renderStats(graph, tasks, inbox, health) {
        const stats = [
          ['pages', graph.meta.page_count],
          ['edges', graph.meta.edge_count],
          ['open tasks', tasks.meta.open_tasks],
          ['inbox', inbox.items.length],
          ['health findings', health.finding_count]
        ];
        document.getElementById('stats').innerHTML = stats.map(([label, value]) =>
          '<div class="pill"><strong>' + value + '</strong> ' + label + '</div>'
        ).join('');
      }

      function renderSchema(schema) {
        document.getElementById('schema').textContent = schema.markdown;
      }

      function renderTasks(tasks) {
        const root = document.getElementById('tasks');
        root.innerHTML = tasks.sections.map(section => {
          const items = section.items.map(item =>
            '<div class="task ' + (item.completed ? 'done' : '') + '">' +
              item.text +
            '</div>'
          ).join('');
          return '<div class="task-group"><h3>' + section.heading + '</h3>' + items + '</div>';
        }).join('');
      }

      function renderInbox(inbox) {
        const root = document.getElementById('inbox');
        root.innerHTML = inbox.items.map(item =>
          '<div class="inbox-item">' +
            '<strong>' + escapeHtml(item.title) + '</strong>' +
            '<div class="meta">' + escapeHtml(item.slug) + '</div>' +
            '<div style="margin-top:8px; line-height:1.5;">' + escapeHtml(item.summary) + '</div>' +
          '</div>'
        ).join('');
      }

      function renderRecent(recent) {
        const root = document.getElementById('recent');
        root.innerHTML = recent.pages.map(page =>
          '<div class="recent-item">' +
            '<strong>' + escapeHtml(page.title) + '</strong>' +
            '<div class="meta">' + escapeHtml(page.slug) + ' · ' + escapeHtml(page.type) + '</div>' +
            '<div style="margin-top:8px; line-height:1.5;">' + escapeHtml(page.summary || '') + '</div>' +
          '</div>'
        ).join('');
      }

      function renderHealth(health) {
        const root = document.getElementById('health');
        root.innerHTML = health.top_findings.map(item =>
          '<div class="health-item ' + item.severity + '">' +
            '<strong>' + escapeHtml(item.finding_type) + '</strong>' +
            '<div class="meta">' + escapeHtml(item.page_slug || 'brain-wide') + '</div>' +
          '</div>'
        ).join('');
      }

      function renderGraph(graph) {
        const svg = document.getElementById('graph');
        const width = svg.clientWidth || 800;
        const height = svg.clientHeight || 520;
        const nodes = graph.nodes.map((node, index) => ({
          ...node,
          x: width / 2 + Math.cos(index / graph.nodes.length * Math.PI * 2) * (width * 0.28),
          y: height / 2 + Math.sin(index / graph.nodes.length * Math.PI * 2) * (height * 0.28),
          vx: 0,
          vy: 0
        }));
        const nodeMap = new Map(nodes.map(node => [node.slug, node]));
        const edges = graph.edges
          .map(edge => ({ source: nodeMap.get(edge.source), target: nodeMap.get(edge.target) }))
          .filter(edge => edge.source && edge.target);

        for (let step = 0; step < 180; step++) {
          for (let i = 0; i < nodes.length; i++) {
            for (let j = i + 1; j < nodes.length; j++) {
              const a = nodes[i];
              const b = nodes[j];
              let dx = b.x - a.x;
              let dy = b.y - a.y;
              let dist2 = dx * dx + dy * dy + 0.01;
              let force = 2800 / dist2;
              a.vx -= dx * force * 0.0006;
              a.vy -= dy * force * 0.0006;
              b.vx += dx * force * 0.0006;
              b.vy += dy * force * 0.0006;
            }
          }
          for (const edge of edges) {
            const dx = edge.target.x - edge.source.x;
            const dy = edge.target.y - edge.source.y;
            const dist = Math.sqrt(dx * dx + dy * dy) || 1;
            const targetDist = 90;
            const force = (dist - targetDist) * 0.0025;
            edge.source.vx += dx / dist * force;
            edge.source.vy += dy / dist * force;
            edge.target.vx -= dx / dist * force;
            edge.target.vy -= dy / dist * force;
          }
          for (const node of nodes) {
            node.vx += (width / 2 - node.x) * 0.0008;
            node.vy += (height / 2 - node.y) * 0.0008;
            node.x += node.vx;
            node.y += node.vy;
            node.vx *= 0.86;
            node.vy *= 0.86;
            node.x = Math.max(30, Math.min(width - 30, node.x));
            node.y = Math.max(30, Math.min(height - 30, node.y));
          }
        }

        const lines = edges.map(edge =>
          '<line x1="' + edge.source.x + '" y1="' + edge.source.y + '" x2="' + edge.target.x + '" y2="' + edge.target.y + '" stroke="rgba(31,26,23,0.11)" stroke-width="1" />'
        ).join('');

        const circles = nodes.map(node => {
          const color = TYPE_COLORS[node.type] || '#7b6a52';
          const radius = Math.max(5, Math.min(16, 4 + Math.sqrt(node.degree || 1)));
          return '<g>' +
            '<circle cx="' + node.x + '" cy="' + node.y + '" r="' + radius + '" fill="' + color + '" fill-opacity="0.86" />' +
            (radius > 9 ? '<text x="' + (node.x + radius + 4) + '" y="' + (node.y + 4) + '" font-size="10" fill="#1f1a17">' + escapeHtml(node.title.slice(0, 28)) + '</text>' : '') +
          '</g>';
        }).join('');

        svg.innerHTML = '<g id="graph-viewport">' + lines + circles + '</g>';
        attachGraphInteractions(svg, width, height);
      }

      function attachGraphInteractions(svg, width, height) {
        const viewport = document.getElementById('graph-viewport');
        if (!viewport) return;

        const state = {
          scale: 1,
          minScale: 0.45,
          maxScale: 3.2,
          x: 0,
          y: 0,
          dragging: false,
          dragStartX: 0,
          dragStartY: 0,
          originX: 0,
          originY: 0
        };

        svg.style.cursor = 'grab';
        svg.setAttribute('viewBox', '0 0 ' + width + ' ' + height);

        const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

        function apply() {
          viewport.setAttribute('transform', 'translate(' + state.x + ' ' + state.y + ') scale(' + state.scale + ')');
        }

        function zoomAt(factor, clientX, clientY) {
          const rect = svg.getBoundingClientRect();
          const cursorX = clientX - rect.left;
          const cursorY = clientY - rect.top;
          const nextScale = clamp(state.scale * factor, state.minScale, state.maxScale);
          const appliedFactor = nextScale / state.scale;
          if (appliedFactor === 1) return;
          state.x = cursorX - (cursorX - state.x) * appliedFactor;
          state.y = cursorY - (cursorY - state.y) * appliedFactor;
          state.scale = nextScale;
          apply();
        }

        svg.onwheel = (event) => {
          event.preventDefault();
          const factor = event.deltaY < 0 ? 1.12 : 1 / 1.12;
          zoomAt(factor, event.clientX, event.clientY);
        };

        svg.onpointerdown = (event) => {
          state.dragging = true;
          state.dragStartX = event.clientX;
          state.dragStartY = event.clientY;
          state.originX = state.x;
          state.originY = state.y;
          svg.style.cursor = 'grabbing';
          svg.setPointerCapture(event.pointerId);
        };

        svg.onpointermove = (event) => {
          if (!state.dragging) return;
          state.x = state.originX + (event.clientX - state.dragStartX);
          state.y = state.originY + (event.clientY - state.dragStartY);
          apply();
        };

        function stopDragging(event) {
          state.dragging = false;
          svg.style.cursor = 'grab';
          if (event?.pointerId !== undefined && svg.hasPointerCapture(event.pointerId)) {
            svg.releasePointerCapture(event.pointerId);
          }
        }

        svg.onpointerup = stopDragging;
        svg.onpointerleave = stopDragging;
        svg.onpointercancel = stopDragging;

        document.getElementById('graph-zoom-in').onclick = () => zoomAt(1.18, width / 2, height / 2);
        document.getElementById('graph-zoom-out').onclick = () => zoomAt(1 / 1.18, width / 2, height / 2);
        document.getElementById('graph-reset').onclick = () => {
          state.scale = 1;
          state.x = 0;
          state.y = 0;
          apply();
        };

        apply();
      }

      function escapeHtml(value) {
        return String(value)
          .replace(/&/g, '&amp;')
          .replace(/</g, '&lt;')
          .replace(/>/g, '&gt;')
          .replace(/"/g, '&quot;')
          .replace(/'/g, '&#39;');
      }
    </script>
  </body>
</html>`;
}

async function buildTasksPayload(config) {
  const markdown = await fs.readFile(config.tasksFile, 'utf8');
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
        text: task[2].trim(),
      });
    }
  }
  return {
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
    const title = raw.match(/^title:\s*(.+)$/m)?.[1]?.trim().replace(/^['"]|['"]$/g, '') || raw.match(/^#\s+(.+)$/m)?.[1]?.trim() || entry.name;
    const summary = raw.split('\n').map((line) => line.trim()).find((line) => line && !line.startsWith('#') && !line.startsWith('---') && !line.startsWith('title:') && !line.startsWith('type:') && !line.startsWith('created:')) || '';
    const stat = await fs.stat(fullPath);
    items.push({
      slug: `inbox/${entry.name.replace(/\.md$/, '')}`,
      title,
      summary,
      updated_at: stat.mtime.toISOString(),
    });
  }
  items.sort((a, b) => b.updated_at.localeCompare(a.updated_at));
  return { items };
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
