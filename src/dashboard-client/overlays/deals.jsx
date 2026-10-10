import React, { useEffect, useRef, useState } from 'react';
import { copyDealTeaser, dealTeaserParts, formatDealTeaser } from './deal-teaser.js';

const INVOLVEMENT_LABELS = {
  active: 'Our work',
  network_actionable: 'Network opportunity',
  network_observed: 'Network observed',
  public_unrelated: 'Public deal',
};

function DealAsk({ record, askIndex, ask, disabled, onEdit, onDelete }) {
  const [feedback, setFeedback] = useState('');
  const [copying, setCopying] = useState(false);
  const message = formatDealTeaser(record, askIndex);

  async function copy() {
    setCopying(true);
    setFeedback('');
    try {
      await copyDealTeaser(record, askIndex);
      setFeedback('Copied. Ready to paste into WhatsApp.');
    } catch (error) {
      setFeedback(error.message);
    } finally {
      setCopying(false);
    }
  }

  return (
    <div className="deal-ask" style={{ marginTop: '12px' }}>
      <p className="deal-teaser-preview" style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', userSelect: 'text' }}>{message || `Looking for: ${ask}`}</p>
      <button type="button" className="graph-button" disabled={!message || copying} onClick={copy} aria-label={`Copy ask ${askIndex + 1} for WhatsApp`}>
        {copying ? 'Copying…' : 'Copy for WhatsApp'}
      </button>
      <button type="button" className="graph-button" disabled={disabled} onClick={onEdit} aria-label={`Edit ask ${askIndex + 1}`}>Edit</button>
      <button type="button" className="graph-button" disabled={disabled} onClick={onDelete} aria-label={`Delete ask ${askIndex + 1}`}>Delete</button>
      {feedback ? <p className="meta" role="status" aria-live="polite">{feedback}</p> : null}
    </div>
  );
}

function DealTeaser({ record, onSaved }) {
  const { summary, asks } = dealTeaserParts(record);
  const [editor, setEditor] = useState(null);
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState('');
  const savingRef = useRef(false);

  function begin(type, index = null) {
    setFeedback('');
    setEditor({ type, index, text: type === 'summary' ? summary : type === 'add' ? '' : asks[index],
      baseAsks: Array.isArray(record.asks) ? [...record.asks] : [],
      baseSummary: record.teaser_summary || '' });
  }

  async function save(event) {
    event?.preventDefault();
    if (!editor || savingRef.current) return;
    const value = editor.text.trim();
    if (editor.type !== 'delete' && editor.type !== 'summary' && !value) return;
    const nextAsks = [...editor.baseAsks];
    if (editor.type === 'add') nextAsks.push(value);
    if (editor.type === 'edit') nextAsks[editor.index] = value;
    if (editor.type === 'delete') nextAsks.splice(editor.index, 1);
    savingRef.current = true;
    setSaving(true);
    setFeedback('');
    try {
      const response = await fetch('/api/overlays/deals/asks', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ page_slug: record.page_slug, asks: nextAsks,
          teaser_summary: editor.type === 'summary' ? value : editor.baseSummary,
          expected_asks: editor.baseAsks, expected_teaser_summary: editor.baseSummary }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(response.status === 409
        ? 'This deal changed elsewhere. Your draft is kept. Refresh the page before trying again.'
        : data.error || `Unable to save changes (${response.status}).`);
      if (!data.record || data.record.page_slug !== record.page_slug || !Array.isArray(data.record.asks)) {
        throw new Error('The saved deal could not be verified. Your draft is kept.');
      }
      onSaved(data.record);
      setEditor(null);
      setFeedback('Saved to the deal page.');
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : 'Unable to save changes. Your draft is kept.');
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }

  return (
    <div className="deal-teaser" style={{ borderTop: '1px solid var(--border)', paddingTop: '12px', marginTop: '12px' }}>
      <span className="eyebrow">Anonymous asks</span>
      <div style={{ display: 'flex', gap: '8px', marginTop: '8px', flexWrap: 'wrap' }}>
        <button type="button" className="graph-button" disabled={!!editor || saving} onClick={() => begin('summary')}>{summary ? 'Edit teaser summary' : 'Add teaser summary'}</button>
        <button type="button" className="graph-button" disabled={!!editor || saving} onClick={() => begin('add')}>Add ask</button>
      </div>
      {!summary || !asks.length ? <p className="meta">{!summary && !asks.length ? 'Add an anonymous teaser summary and asks to prepare messages.' : !summary ? 'Add an anonymous teaser summary to enable copying each ask.' : 'Add at least one ask to prepare a message.'}</p> : null}
      {!asks.length && summary ? <p style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{summary}</p> : null}
      {asks.map((ask, askIndex) => <DealAsk key={`${askIndex}:${ask}`} record={record} askIndex={askIndex} ask={ask}
        disabled={!!editor || saving} onEdit={() => begin('edit', askIndex)} onDelete={() => begin('delete', askIndex)} />)}
      {editor ? (
        <form onSubmit={save} style={{ marginTop: '12px' }}>
          {editor.type === 'delete' ? (
            <div role="alert">
              <p>Delete this ask from the deal page?</p>
              <p style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{editor.text}</p>
            </div>
          ) : (
            <label style={{ display: 'block' }}>
              {editor.type === 'summary' ? 'Shared anonymous teaser summary' : editor.type === 'add' ? 'New ask' : 'Edit ask'}
              <textarea className="overlay-search" rows={editor.type === 'summary' ? 5 : 3} value={editor.text} disabled={saving}
                onChange={(event) => setEditor((current) => ({ ...current, text: event.target.value }))}
                style={{ display: 'block', width: '100%', resize: 'vertical', marginTop: '8px' }} />
            </label>
          )}
          <div style={{ display: 'flex', gap: '8px', marginTop: '8px' }}>
            <button type="submit" className="graph-button" disabled={saving || (editor.type !== 'delete' && editor.type !== 'summary' && !editor.text.trim())}>
              {saving ? 'Saving…' : editor.type === 'delete' ? 'Confirm delete' : 'Save'}
            </button>
            <button type="button" className="graph-button" disabled={saving} onClick={() => { setEditor(null); setFeedback(''); }}>Cancel</button>
          </div>
        </form>
      ) : null}
      {feedback ? <p className="meta" role={editor ? 'alert' : 'status'} aria-live="polite">{feedback}</p> : null}
    </div>
  );
}

export function DealsPanel({ onOpenPage }) {
  const [state, setState] = useState({ status: 'loading', records: [], error: null });
  const [search, setSearch] = useState('');
  const [reload, setReload] = useState(0);
  const requestVersion = useRef(0);

  useEffect(() => {
    const controller = new AbortController();
    const version = ++requestVersion.current;
    setState({ status: 'loading', records: [], error: null });

    async function load() {
      try {
        const records = [];
        const seenCursors = new Set();
        let cursor = null;
        let total = null;
        do {
          const params = new URLSearchParams({ limit: '100' });
          if (cursor !== null) params.set('cursor', String(cursor));
          const response = await fetch(`/api/overlays/deals?${params}`, { signal: controller.signal });
          if (!response.ok) throw new Error(`Unable to load deals (${response.status}).`);
          const data = await response.json();
          if (!Array.isArray(data.records)) throw new Error('The deals response could not be read.');
          if (Number.isInteger(data.total) && data.total >= 0) total = data.total;
          records.push(...data.records);
          cursor = data.next_cursor ?? null;
          if (cursor !== null) {
            const cursorKey = String(cursor);
            if (seenCursors.has(cursorKey)) throw new Error('Unable to finish loading all deals. Please retry.');
            seenCursors.add(cursorKey);
          }
        } while (cursor !== null);
        if (total !== null && records.length < total) throw new Error('Unable to finish loading all deals. Please retry.');
        if (!controller.signal.aborted && requestVersion.current === version) {
          setState({ status: 'ready', records, error: null });
        }
      } catch (error) {
        if (!controller.signal.aborted && requestVersion.current === version) {
          setState({ status: 'error', records: [], error: error instanceof Error ? error.message : String(error) });
        }
      }
    }

    load();
    return () => controller.abort();
  }, [reload]);

  if (state.status === 'loading') {
    return (
      <section className="overlay-page deals-page">
        <div className="list-loading-state" role="status" aria-live="polite">
          <span className="loading-spinner" aria-hidden="true" />
          <span>Loading deals</span>
        </div>
      </section>
    );
  }

  if (state.status === 'error') {
    return (
      <section className="overlay-page deals-page">
        <div className="overlay-error card" role="alert">
          <span className="eyebrow">Deals</span>
          <h1>Deals unavailable</h1>
          <p>{state.error}</p>
          <button type="button" className="graph-button" onClick={() => setReload((value) => value + 1)}>Retry</button>
        </div>
      </section>
    );
  }

  const needle = search.trim().toLowerCase();
  const records = state.records.filter((record) => !needle || [
    record.title, record.summary, record.page_slug, record.teaser_summary, ...(Array.isArray(record.asks) ? record.asks : []),
    INVOLVEMENT_LABELS[record.deal_involvement] || 'Involvement not set',
  ].join(' ').toLowerCase().includes(needle));

  return (
    <section className="overlay-page deals-page">
      <div className="overlay-head">
        <div>
          <span className="eyebrow">Overlay · Deals</span>
          <h1>Deals</h1>
          <p>Deal summaries and how we are involved.</p>
        </div>
        <span className="meta">{state.records.length} {state.records.length === 1 ? 'deal' : 'deals'}</span>
      </div>

      {state.records.length ? (
        <input
          className="overlay-search"
          type="search"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Search deals…"
          aria-label="Search deals"
        />
      ) : null}

      {records.length ? (
        <div className="overlay-record-list">
          {records.map((record) => (
            <article className="overlay-record card deal-record" key={record.page_slug}>
              <div className="overlay-record-main">
                <div className="overlay-record-title-row">
                  <button type="button" className="overlay-person-link deal-page-link" onClick={() => onOpenPage?.(record.page_slug)}>
                    {record.title || record.page_slug}
                  </button>
                  <span className={`deal-involvement involvement-${record.deal_involvement || 'unset'}`}>
                    {INVOLVEMENT_LABELS[record.deal_involvement] || 'Involvement not set'}
                  </span>
                </div>
                {record.summary ? (
                  <p className="overlay-record-summary deal-record-summary" style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', WebkitLineClamp: 'unset', maxHeight: 'none', overflow: 'visible' }}>
                    {record.summary}
                  </p>
                ) : <p className="overlay-record-summary deal-record-summary">No summary yet.</p>}
                <DealTeaser record={record} onSaved={(savedRecord) => setState((current) => ({
                  ...current, records: current.records.map((item) => item.page_slug === savedRecord.page_slug ? savedRecord : item),
                }))} />
              </div>
            </article>
          ))}
        </div>
      ) : (
        <div className="overlay-empty card">
          <div>
            <h2>{state.records.length ? 'No matching deals' : 'No deals yet'}</h2>
            <p>{state.records.length ? 'Try a different search.' : 'Deal pages will appear here when they are added to this Brain.'}</p>
          </div>
        </div>
      )}
    </section>
  );
}
