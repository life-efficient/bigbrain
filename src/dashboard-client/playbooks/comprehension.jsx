import React, { useEffect, useState } from 'react';

export function ComprehensionPanel({ onOpenPage }) {
  const [state, setState] = useState({ status: 'loading', data: null, error: null });
  const [guidance, setGuidance] = useState('');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  async function load() {
    setState((current) => ({ ...current, status: 'loading', error: null }));
    try {
      const data = await fetchJson('/api/playbooks/comprehension');
      setGuidance(data?.setup?.guidance || '');
      setState({ status: 'ready', data, error: null });
    } catch (error) {
      setState({ status: 'error', data: null, error: error instanceof Error ? error.message : String(error) });
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function saveGuidance(event) {
    event.preventDefault();
    setSaving(true);
    setSaved(false);
    try {
      const data = await fetchJson('/api/playbooks/comprehension', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ guidance }),
      });
      setGuidance(data?.setup?.guidance || guidance.trim());
      setState({ status: 'ready', data, error: null });
      setSaved(true);
      window.setTimeout(() => setSaved(false), 1800);
    } catch (error) {
      setState((current) => ({ ...current, error: error instanceof Error ? error.message : String(error) }));
    } finally {
      setSaving(false);
    }
  }

  if (state.status === 'loading') {
    return <section className="playbook-page"><ListLoadingState label="Loading Comprehension" /></section>;
  }

  if (state.status === 'error') {
    return (
      <section className="playbook-page">
        <div className="playbook-error card">
          <span className="eyebrow">Comprehension</span>
          <h1>Playbook unavailable</h1>
          <p>{state.error}</p>
          <button type="button" className="graph-button" onClick={load}>Retry</button>
        </div>
      </section>
    );
  }

  const pages = Array.isArray(state.data?.pages) ? state.data.pages : [];
  return (
    <section className="playbook-page comprehension-page">
      <div className="playbook-head">
        <div>
          <span className="eyebrow">Playbook · Learning</span>
          <h1>Comprehension</h1>
          <p>Tell the tutor what matters to you. It will choose evidence, teach, test, remediate, and keep a current summary.</p>
        </div>
      </div>

      <form className="playbook-enroll card" onSubmit={saveGuidance}>
        <div className="playbook-section-head">
          <div>
            <span className="eyebrow">Your learning guidance</span>
            <h2>What do you want to understand?</h2>
          </div>
          <span className="meta">Used as judgement, not page metadata</span>
        </div>
        <textarea
          className="playbook-guidance"
          value={guidance}
          onChange={(event) => setGuidance(event.target.value)}
          placeholder="For example: Help me understand the ideas most relevant to building BigBrain and making better product decisions. Prefer first-principles explanations and practical transfer questions."
          rows={6}
          aria-label="Comprehension guidance"
        />
        <div className="playbook-form-actions">
          <button type="submit" className="graph-button playbook-action-primary" disabled={saving}>
            {saving ? 'Saving…' : saved ? 'Saved' : 'Save guidance'}
          </button>
          {state.error ? <span className="playbook-inline-error">{state.error}</span> : null}
        </div>
      </form>

      <div className="playbook-queue-head">
        <div>
          <span className="eyebrow">Recent source pages</span>
          <h2>{pages.length ? 'Pages used in Comprehension sessions' : 'No sessions yet'}</h2>
        </div>
        {pages.length ? <span className="meta">{pages.length} page{pages.length === 1 ? '' : 's'}</span> : null}
      </div>

      {pages.length ? (
        <div className="playbook-record-list">
          {pages.map((page) => (
            <article className="playbook-record card" key={`${page.page_slug}:${page.session_id}`}>
              <div className="playbook-record-main">
                <div className="playbook-record-title-row">
                  <button type="button" className="playbook-person-link" onClick={() => onOpenPage?.(page.page_slug)}>
                    {page.title || page.page_slug}
                  </button>
                  {!page.page_exists ? <span className="meta">Page unavailable</span> : null}
                </div>
                <div className="playbook-record-meta">
                  <span>{page.page_slug}</span>
                  <span>Updated summary {formatDate(page.updated_at)}</span>
                  {page.page_updated_at ? <span>Page updated {formatDate(page.page_updated_at)}</span> : null}
                </div>
                <p className="playbook-record-summary">{page.summary}</p>
              </div>
            </article>
          ))}
        </div>
      ) : (
        <div className="playbook-empty card">
          <div className="playbook-empty-mark" aria-hidden="true">◎</div>
          <div>
            <h2>Start with a question</h2>
            <p>Run the Comprehension skill from Codex or an automation. Your evolving summaries will appear here without creating task pages.</p>
          </div>
        </div>
      )}
    </section>
  );
}

function formatDate(value) {
  if (!value) return 'not set';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'not set';
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(date);
}

async function fetchJson(url, options) {
  const response = await fetch(url, options);
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || `Request failed (${response.status})`);
  return body;
}

function ListLoadingState({ label }) {
  return <div className="playbook-empty card"><div className="empty-copy">{label}…</div></div>;
}
