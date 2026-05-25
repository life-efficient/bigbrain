import React, { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';

import { TYPE_ORDER } from './graph/colors.js';
import { GRAPH_CONTROL_LABELS, graphVisualizers } from './graph/registry.jsx';
import { MarkdownDocument } from './markdown.jsx';

function DashboardApp() {
  const [state, setState] = useState({ status: 'loading', error: null, data: null });
  const [visualizerId, setVisualizerId] = useState(graphVisualizers[0].id);
  const [preview, setPreview] = useState(null);
  const visualizerRef = useRef(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const [schema, tasks, inbox, recent, health, graph] = await Promise.all([
          fetchJson('/api/schema'),
          fetchJson('/api/tasks'),
          fetchJson('/api/inbox'),
          fetchJson('/api/recent'),
          fetchJson('/api/health'),
          fetchJson('/api/graph'),
        ]);
        if (cancelled) return;
        setState({
          status: 'ready',
          error: null,
          data: { schema, tasks, inbox, recent, health, graph },
        });
      } catch (error) {
        if (cancelled) return;
        setState({ status: 'error', error: String(error), data: null });
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, []);

  if (state.status === 'loading') {
    return (
      <main>
        <section className="card loading-card">
          <h1>bigbrain</h1>
          <p>Loading dashboard data…</p>
        </section>
      </main>
    );
  }

  if (state.status === 'error') {
    return (
      <main>
        <section className="card loading-card">
          <h1>bigbrain</h1>
          <p>{state.error}</p>
        </section>
      </main>
    );
  }

  const { schema, tasks, inbox, recent, health, graph } = state.data;
  const visualizer = graphVisualizers.find((item) => item.id === visualizerId) || graphVisualizers[0];
  const VisualizerComponent = visualizer.Component;
  const presentTypes = new Set(graph.nodes.map((node) => node.type));
  const legendTypes = TYPE_ORDER.filter((type) => presentTypes.has(type));

  const stats = [
    ['pages', graph.meta.page_count],
    ['edges', graph.meta.edge_count],
    ['open tasks', tasks.meta.open_tasks],
    ['inbox', inbox.items.length],
    ['health findings', health.finding_count],
  ];

  async function openPreview({ href, sourceSlug }) {
    setPreview({ status: 'loading', href, sourceSlug });
    try {
      const params = new URLSearchParams({ from: sourceSlug, target: href });
      const data = await fetchJson(`/api/preview?${params.toString()}`);
      setPreview({ status: 'ready', href, sourceSlug, ...data });
    } catch (error) {
      setPreview({
        status: 'error',
        href,
        sourceSlug,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return (
    <div className={`page-shell ${preview ? 'preview-open' : ''}`}>
      <main>
        <div className="topline">
          <div>
            <h1>bigbrain</h1>
            <p>Graph, tasks, inbox, recent movement, and brain health in one place.</p>
          </div>
          <div className="stats">
            {stats.map(([label, value]) => (
              <div key={label} className="pill">
                <strong>{value}</strong> {label}
              </div>
            ))}
          </div>
        </div>

        <div className="layout">
          <section className="card">
            <div className="section-head">
            <div>
              <h2>Knowledge Graph</h2>
            </div>
              <div className="graph-toolbar">
                <label className="graph-select-shell">
                  <span>View</span>
                  <select value={visualizerId} onChange={(event) => setVisualizerId(event.target.value)}>
                    {graphVisualizers.map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.label}
                      </option>
                    ))}
                  </select>
                </label>
                {visualizer.controls?.length ? (
                  <div className="graph-controls graph-controls-inline">
                    {visualizer.controls.map((control) => (
                      <button
                        key={control}
                        type="button"
                        className="graph-button"
                        onClick={() => visualizerRef.current?.[control]?.()}
                      >
                        {GRAPH_CONTROL_LABELS[control] || control}
                      </button>
                    ))}
                  </div>
                ) : null}
              </div>
            </div>
            <div className="graph-wrap">
              <VisualizerComponent ref={visualizerRef} graph={graph} />
            </div>
            <div className="legend">
              {legendTypes.map((type) => (
                <span key={type}>{type}</span>
              ))}
            </div>
          </section>

          <div className="stack">
            <section className="card">
              <h2>Tasks</h2>
              <div className="task-section">
                {tasks.sections.map((section) => (
                  <div key={section.heading} className="task-group">
                    <h3>{section.heading}</h3>
                    {section.items.map((item, index) => (
                      <div key={`${section.heading}:${index}`} className={`task ${item.completed ? 'done' : ''}`}>
                        <MarkdownDocument markdown={item.markdown} sourceSlug={tasks.slug} onRelativeLinkClick={openPreview} />
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            </section>

            <section className="card">
              <h2>Inbox</h2>
              <div className="inbox-list">
                {inbox.items.map((item) => (
                  <div key={item.slug} className="inbox-item">
                    <strong>{item.title}</strong>
                    <div className="meta">{item.slug}</div>
                    <div className="card-copy">
                      <MarkdownDocument markdown={item.markdown} sourceSlug={item.slug} onRelativeLinkClick={openPreview} />
                    </div>
                  </div>
                ))}
              </div>
            </section>
          </div>
        </div>

        <div className="split split-gap">
          <section className="card">
            <h2>Recent Pages</h2>
            <div className="recent-list">
              {recent.pages.map((page) => (
                <div key={page.slug} className="recent-item">
                  <strong>{page.title}</strong>
                  <div className="meta">{page.slug} · {page.type}</div>
                  <div className="card-copy">{page.summary || ''}</div>
                </div>
              ))}
            </div>
          </section>
          <section className="card">
            <h2>Health</h2>
            <div className="health-list">
              {health.top_findings.map((item, index) => (
                <div key={`${item.finding_type}:${item.page_slug || 'brain-wide'}:${index}`} className={`health-item ${item.severity}`}>
                  <strong>{item.finding_type}</strong>
                  <div className="meta">{item.page_slug || 'brain-wide'}</div>
                </div>
              ))}
            </div>
          </section>
        </div>

        <div className="split split-gap">
          <section className="card">
            <h2>Schema</h2>
            <div className="schema">{schema.markdown}</div>
          </section>
          <section className="card">
            <h2>What This Is</h2>
            <p className="card-copy">
              This dashboard now favors operating views over raw payloads: a live graph, rendered tasks, inbox cards,
              recent page movement, and a compressed health summary. The graph view is now designed around switchable
              renderers rather than one hard-coded implementation.
            </p>
          </section>
        </div>
      </main>

      <aside className="sidecar-shell" aria-hidden={!preview}>
        <div className="sidecar-panel">
          <div className="sidecar-head">
            <div>
              <h2>{preview?.title || 'Linked File'}</h2>
              <div className="meta">{preview?.slug || preview?.href || ''}</div>
            </div>
            <button type="button" className="graph-button" onClick={() => setPreview(null)}>
              Close
            </button>
          </div>
          {preview?.status === 'loading' && <div className="empty-copy">Loading linked file…</div>}
          {preview?.status === 'error' && <div className="empty-copy">{preview.message}</div>}
          {preview?.status === 'ready' && (
            <MarkdownDocument
              markdown={preview.markdown}
              sourceSlug={preview.slug}
              onRelativeLinkClick={openPreview}
              emptyLabel="This file is empty."
            />
          )}
        </div>
      </aside>
    </div>
  );
}

async function fetchJson(url) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`${url} failed with ${response.status}`);
  }
  return response.json();
}

const root = createRoot(document.getElementById('root'));
root.render(<DashboardApp />);
