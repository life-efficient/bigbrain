import React, { useEffect, useRef, useState } from 'react';

const INVOLVEMENT_LABELS = {
  active: 'Our work',
  network_actionable: 'Network opportunity',
  network_observed: 'Network observed',
  public_unrelated: 'Public deal',
};

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
    record.title, record.summary, record.page_slug,
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
