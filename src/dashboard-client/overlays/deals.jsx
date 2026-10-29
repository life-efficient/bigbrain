import React, { useEffect, useRef, useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { X, Plus, Pencil, Trash2, Copy } from 'lucide-react';
import { copyAllDealAsks, copyDealTeaser, dealTeaserParts, formatAllDealAsks, formatDealTeaser } from './deal-teaser.js';
import { DEAL_STAGE_LABELS, DEAL_TYPE_LABELS, matchesDealFilters } from './deal-progress.js';
import { DealIntroductions, DealNextActions, DealProgress } from './deal-progress.jsx';

const INVOLVEMENT_LABELS = {
  active: 'Our work',
  network_actionable: 'Network opportunity',
  network_observed: 'Network observed',
  public_unrelated: 'Public deal',
};

function DealAsk({ record, askIndex, ask, disabled, onEdit, onDelete }) {
  const [feedback, setFeedback] = useState('');
  const [copying, setCopying] = useState(false);
  const [manualCopy, setManualCopy] = useState(false);
  const manualRef = useRef(null);
  useEffect(() => {
    if (manualCopy) { manualRef.current?.focus({ preventScroll: true }); manualRef.current?.select(); }
  }, [manualCopy]);
  const message = formatDealTeaser(record, askIndex);

  async function copy() {
    setCopying(true);
    setFeedback('');
    setManualCopy(false);
    try {
      await copyDealTeaser(record, askIndex);
      setFeedback('Copied. Ready to paste into WhatsApp.');
    } catch (error) {
      setManualCopy(true);
      setFeedback(error.message);
    } finally {
      setCopying(false);
    }
  }

  return (
    <div className="deal-ask">
      <p className="deal-ask-text">{ask}</p>
      <div className="deal-ask-actions">
      <button type="button" className="graph-button" disabled={!message || copying} onClick={copy} aria-label={`Copy ask ${askIndex + 1} for WhatsApp`}>
        <Copy size={14} />{copying ? 'Copying…' : 'Copy for WhatsApp'}
      </button>
      <button type="button" className="graph-button" disabled={disabled} onClick={onEdit} aria-label={`Edit ask ${askIndex + 1}`}><Pencil size={14} />Edit</button>
      <button type="button" className="graph-button" disabled={disabled} onClick={onDelete} aria-label={`Delete ask ${askIndex + 1}`}><Trash2 size={14} />Delete</button>
      </div>
      {manualCopy ? <textarea ref={manualRef} className="overlay-search deal-editor-input" rows={5}
        readOnly value={message} aria-label={`Complete message for ask ${askIndex + 1}`}
        onFocus={(event) => event.target.select()} style={{ gridColumn: '1 / -1' }} /> : null}
      {feedback ? <p className="meta" role="status" aria-live="polite">{feedback}</p> : null}
    </div>
  );
}

function DealTeaser({ record, onSaved }) {
  const { title, summary, asks } = dealTeaserParts(record);
  const [editor, setEditor] = useState(null);
  const [copyingAll, setCopyingAll] = useState(false);
  const [copyFeedback, setCopyFeedback] = useState('');
  const [manualCopyAll, setManualCopyAll] = useState(false);
  const manualAllRef = useRef(null);
  const allMessage = formatAllDealAsks(record);
  useEffect(() => {
    if (manualCopyAll) { manualAllRef.current?.focus({ preventScroll: true }); manualAllRef.current?.select(); }
  }, [manualCopyAll]);

  async function copyAll() {
    setCopyingAll(true);
    setCopyFeedback('');
    setManualCopyAll(false);
    try {
      await copyAllDealAsks(record);
      setCopyFeedback('Copied all asks. Ready to paste into WhatsApp.');
    } catch (error) {
      setManualCopyAll(true);
      setCopyFeedback(error.message);
    } finally {
      setCopyingAll(false);
    }
  }
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState('');
  const savingRef = useRef(false);
  const modalContainerRef = useRef(null);
  const returnFocusRef = useRef(null);

  function begin(type, index = null) {
    returnFocusRef.current = document.activeElement;
    setFeedback('');
    setEditor({ type, index, text: type === 'title' ? title : type === 'summary' ? summary : type === 'add' ? '' : asks[index],
      baseAsks: Array.isArray(record.anonymised_asks) ? [...record.anonymised_asks] : [],
      baseTitle: record.anonymised_title || '', baseSummary: record.anonymised_description || '' });
  }

  async function save(event) {
    event?.preventDefault();
    if (!editor || savingRef.current) return;
    const value = editor.text.trim();
    if (!['delete', 'summary', 'title'].includes(editor.type) && !value) return;
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
        body: JSON.stringify({ page_slug: record.page_slug, anonymised_asks: nextAsks,
          anonymised_title: editor.type === 'title' ? value : editor.baseTitle,
          expected_anonymised_title: editor.baseTitle,
          anonymised_description: editor.type === 'summary' ? value : editor.baseSummary,
          expected_anonymised_asks: editor.baseAsks, expected_anonymised_description: editor.baseSummary }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(response.status === 409
        ? 'This deal changed elsewhere. Your draft is kept. Refresh the page before trying again.'
        : data.error || `Unable to save changes (${response.status}).`);
      if (!data.record || data.record.page_slug !== record.page_slug || !Array.isArray(data.record.anonymised_asks)) {
        throw new Error('The saved deal could not be verified. Your draft is kept.');
      }
      onSaved(data.record);
      setEditor(null);
      setFeedback(data.maintenance_warning
        ? `Saved to the deal page. ${data.maintenance_warning}`
        : 'Saved to the deal page.');
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : 'Unable to save changes. Your draft is kept.');
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }

  return (
    <div className="deal-teaser" ref={modalContainerRef}>
      <div className="deal-teaser-head">
      <span className="eyebrow">Anonymised details</span>
      <div className="deal-teaser-actions">
        <button type="button" className="graph-button" disabled={!allMessage || copyingAll} onClick={copyAll}><Copy size={14} />{copyingAll ? 'Copying…' : 'Copy all asks'}</button>
        <button type="button" className="graph-button" disabled={!!editor || saving} onClick={() => begin('title')}><Pencil size={14} />{title ? 'Edit title' : 'Add title'}</button>
        <button type="button" className="graph-button" disabled={!!editor || saving} onClick={() => begin('summary')}><Pencil size={14} />{summary ? 'Edit description' : 'Add description'}</button>
        <button type="button" className="graph-button" disabled={!!editor || saving} onClick={() => begin('add')}><Plus size={14} />Add ask</button>
      </div>
      </div>
      {manualCopyAll ? <textarea ref={manualAllRef} className="overlay-search deal-editor-input" rows={7}
        readOnly value={allMessage} aria-label="Complete message with all asks"
        onFocus={(event) => event.target.select()} /> : null}
      {copyFeedback ? <p className="meta" role="status" aria-live="polite">{copyFeedback}</p> : null}
      {title ? <h3>{title}</h3> : null}
      {summary ? <p className="deal-teaser-summary">{summary}</p> : null}
      {!asks.length ? <p className="meta">No external ask recorded.</p> : !title || !summary ? <p className="meta">Add an anonymised title and description to copy these asks.</p> : null}
      {asks.map((ask, askIndex) => <DealAsk key={`${askIndex}:${ask}`} record={record} askIndex={askIndex} ask={ask}
        disabled={!!editor || saving} onEdit={() => begin('edit', askIndex)} onDelete={() => begin('delete', askIndex)} />)}
      <Dialog.Root open={!!editor} onOpenChange={(open) => {
        if (!open && !savingRef.current) { setEditor(null); setFeedback(''); }
      }}>
        {editor ? <Dialog.Portal container={modalContainerRef.current?.closest('.page-shell')}>
          <Dialog.Overlay className="deal-modal-backdrop" />
          <Dialog.Content className="deal-modal"
            onEscapeKeyDown={(event) => { if (savingRef.current) event.preventDefault(); }}
            onPointerDownOutside={(event) => event.preventDefault()}
            onCloseAutoFocus={(event) => { event.preventDefault(); returnFocusRef.current?.focus(); }}>
            <div className="deal-modal-head">
              <Dialog.Title>{editor.type === 'delete' ? 'Delete ask' : editor.type === 'title' ? 'Edit anonymised title' : editor.type === 'summary' ? 'Edit anonymised description' : editor.type === 'add' ? 'Add ask' : 'Edit ask'}</Dialog.Title>
              <Dialog.Close className="deal-modal-close" disabled={saving} aria-label="Close dialog"><X size={18} /></Dialog.Close>
            </div>
            <Dialog.Description>
              {editor.type === 'delete' ? 'Remove this ask from the deal. The title and description will stay unchanged.' : ['title', 'summary'].includes(editor.type) ? 'Prepare anonymised wording to share with your network.' : 'Describe a contribution sought from a new participant, such as investment, compute capacity, customers or delivery support. Keep one need per ask and omit identifying details. Requests for documents, decisions or replies from existing parties belong in follow-up tasks.'}
            </Dialog.Description>
            <form className="deal-teaser-editor" onSubmit={save}>
              {editor.type === 'delete' ? <p className="deal-ask-text">{editor.text}</p> : (
                <label className="deal-editor-label">
                  {editor.type === 'title' ? 'Anonymised title' : editor.type === 'summary' ? 'Anonymised description' : 'Ask'}
                  <textarea autoFocus rows={editor.type === 'title' ? 2 : editor.type === 'summary' ? 6 : 4} maxLength={editor.type === 'title' ? 500 : editor.type === 'summary' ? 20000 : 5000} value={editor.text} disabled={saving}
                    onChange={(event) => setEditor((current) => ({ ...current, text: event.target.value }))}
                    className="overlay-search deal-editor-input" placeholder={editor.type === 'title' ? 'A short title without identifying details…' : editor.type === 'summary' ? 'Describe the opportunity without identifying details…' : 'We are seeking [specific counterparty] to [specific role or transaction], for [brief anonymous opportunity context].'} />
                </label>
              )}
              {feedback ? <p className="deal-modal-error" role="alert">{feedback}</p> : null}
              <div className="deal-modal-footer">
                <Dialog.Close asChild><button type="button" className="graph-button" disabled={saving}>Cancel</button></Dialog.Close>
                <button type="submit" autoFocus={editor.type === 'delete'} className={`graph-button ${editor.type === 'delete' ? 'destructive' : 'primary'}`}
                  disabled={saving || (!['delete', 'summary', 'title'].includes(editor.type) && !editor.text.trim())}>
                  {saving ? 'Saving…' : editor.type === 'delete' ? 'Delete ask' : 'Save changes'}
                </button>
              </div>
            </form>
          </Dialog.Content>
        </Dialog.Portal> : null}
      </Dialog.Root>
      {feedback && !editor ? <p className="meta" role="status" aria-live="polite">{feedback}</p> : null}
    </div>
  );
}

export function DealsPanel({ onOpenPage }) {
  const [state, setState] = useState({ status: 'loading', records: [], error: null });
  const [search, setSearch] = useState('');
  const [dealType, setDealType] = useState('');
  const [stage, setStage] = useState('');
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

  const records = state.records.filter((record) => matchesDealFilters(record, { search, dealType, stage }));
  const filtered = search.trim() || dealType || stage;

  return (
    <section className="overlay-page deals-page">
      <div className="overlay-head">
        <div>
          <span className="eyebrow">Overlay · Deals</span>
          <h1>Deals</h1>
          <p>Deals, introductions and the next steps for each party.</p>
        </div>
        <span className="meta">{filtered ? `${records.length} of ` : ''}{state.records.length} {state.records.length === 1 ? 'deal' : 'deals'}</span>
      </div>

      {state.records.length ? (
        <div className="deal-filters">
        <input
          className="overlay-search"
          type="search"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Search deals, introductions or parties…"
          aria-label="Search deals, introductions or parties"
        />
        <label>Deal type<select value={dealType} onChange={event => setDealType(event.target.value)}>
          <option value="">All types</option>
          {Object.entries(DEAL_TYPE_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select></label>
        <label>Deal stage<select value={stage} onChange={event => setStage(event.target.value)}>
          <option value="">All stages</option>
          {Object.entries(DEAL_STAGE_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select></label>
        {filtered ? <button type="button" className="graph-button" onClick={() => { setSearch(''); setDealType(''); setStage(''); }}>Clear filters</button> : null}
        </div>
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
                  <p className="overlay-record-summary deal-record-summary">
                    {record.summary}
                  </p>
                ) : <p className="overlay-record-summary deal-record-summary">No summary yet.</p>}
                <DealProgress record={record} />
                <DealNextActions tasks={record.tasks} onOpenPage={onOpenPage} />
                <DealIntroductions introductions={record.introductions} onOpenPage={onOpenPage} />
                <DealTeaser record={record} onSaved={(savedRecord) => setState((current) => ({
                  ...current, records: current.records.map((item) => item.page_slug === savedRecord.page_slug ? { ...item, ...savedRecord } : item),
                }))} />
              </div>
            </article>
          ))}
        </div>
      ) : (
        <div className="overlay-empty card">
          <div>
            <h2>{state.records.length ? 'No matching deals' : 'No deals yet'}</h2>
            <p>{state.records.length ? 'Try a different search or clear the filters.' : 'Deal pages will appear here when they are added to this Brain.'}</p>
          </div>
        </div>
      )}
    </section>
  );
}
