import { DealIntroductionKanban } from './deal-introduction-kanban.jsx';
import { saveIntroductionStage } from './deal-introduction-kanban.js';
import { saveIntroductionArrangement } from './deal-arrangement.js';
import { dealDisplayText } from './deal-display.js';
import { DealStatusAction } from './deal-status.jsx';
import { recordStatus, saveRecordStatus } from './deal-status.js';
import React, { useEffect, useRef, useState } from 'react';
import { Select } from '../components/select.jsx';
import * as Dialog from '@radix-ui/react-dialog';
import { X, Plus, Pencil, Trash2, Copy, Square, CheckSquare, Search, Download, List, Columns3, Type, FileText, Loader2 } from 'lucide-react';
import { copyAllDealAsks, copyDealTeaser, dealTeaserParts, formatAllDealAsks, formatDealTeaser } from './deal-teaser.js';
import { DEAL_STAGE_LABELS, DEAL_TYPE_LABELS, INTRODUCTION_STAGE_LABELS, matchesDealFilters, matchesIntroductionFilters } from './deal-progress.js';
import { DealKanban } from './deal-kanban.jsx';
import { saveDealStage } from './deal-kanban.js';
import { DealIntroductionRow, DealNextActions, DealProgress } from './deal-progress.jsx';

import { fetchAnonymisedDealsPdf, loadAllDealRecords } from './deal-view-data.js';

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
      <button type="button" className="graph-button deal-icon-action" disabled={!message || copying} onClick={copy}
        aria-label={copying ? `Copying ask ${askIndex + 1}` : `Copy ask ${askIndex + 1} for WhatsApp`} title={copying ? 'Copying…' : 'Copy for WhatsApp'} aria-busy={copying || undefined}>
        {copying ? <Loader2 size={14} className="is-spinning" aria-hidden="true" /> : <Copy size={14} aria-hidden="true" />}
      </button>
      <button type="button" className="graph-button deal-icon-action" disabled={disabled} onClick={onEdit} aria-label={`Edit ask ${askIndex + 1}`} title="Edit ask"><Pencil size={14} aria-hidden="true" /></button>
      <button type="button" className="graph-button deal-icon-action" disabled={disabled} onClick={onDelete} aria-label={`Delete ask ${askIndex + 1}`} title="Delete ask"><Trash2 size={14} aria-hidden="true" /></button>
      </div>
      {manualCopy ? <textarea ref={manualRef} className="overlay-search deal-editor-input" rows={5}
        readOnly value={message} aria-label={`Complete message for ask ${askIndex + 1}`}
        onFocus={(event) => event.target.select()} style={{ gridColumn: '1 / -1' }} /> : null}
      {feedback ? <p className="meta" role="status" aria-live="polite">{feedback}</p> : null}
    </div>
  );
}

function DealTeaser({ record, onSaved, hideOverview = false }) {
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
        <button type="button" className="graph-button deal-icon-action" disabled={!allMessage || copyingAll} onClick={copyAll}
          aria-label={copyingAll ? 'Copying all asks' : 'Copy all asks'} title={copyingAll ? 'Copying…' : 'Copy all asks'} aria-busy={copyingAll || undefined}>
          {copyingAll ? <Loader2 size={14} className="is-spinning" aria-hidden="true" /> : <Copy size={14} aria-hidden="true" />}
        </button>
        <button type="button" className="graph-button deal-icon-action" disabled={!!editor || saving} onClick={() => begin('title')}
          aria-label={title ? 'Edit anonymised title' : 'Add anonymised title'} title={title ? 'Edit anonymised title' : 'Add anonymised title'}><Type size={14} aria-hidden="true" /></button>
        <button type="button" className="graph-button deal-icon-action" disabled={!!editor || saving} onClick={() => begin('summary')}
          aria-label={summary ? 'Edit anonymised description' : 'Add anonymised description'} title={summary ? 'Edit anonymised description' : 'Add anonymised description'}><FileText size={14} aria-hidden="true" /></button>
        <button type="button" className="graph-button deal-icon-action" disabled={!!editor || saving} onClick={() => begin('add')} aria-label="Add ask" title="Add ask"><Plus size={14} aria-hidden="true" /></button>
      </div>
      </div>
      {manualCopyAll ? <textarea ref={manualAllRef} className="overlay-search deal-editor-input" rows={7}
        readOnly value={allMessage} aria-label="Complete message with all asks"
        onFocus={(event) => event.target.select()} /> : null}
      {copyFeedback ? <p className="meta" role="status" aria-live="polite">{copyFeedback}</p> : null}
      {!hideOverview && title ? <h3>{title}</h3> : null}
      {!hideOverview && summary ? <p className="deal-teaser-summary">{summary}</p> : null}
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

function useDealCollection(endpoint, reload) {
  const [state, setState] = useState({ status: 'loading', records: [], error: null });
  useEffect(() => {
    const controller = new AbortController();
    setState({ status: 'loading', records: [], error: null });
    loadAllDealRecords(endpoint, { signal: controller.signal }).then(records => {
      if (!controller.signal.aborted) setState({ status: 'ready', records, error: null });
    }).catch(error => {
      if (!controller.signal.aborted) setState({ status: 'error', records: [], error: error.message || String(error) });
    });
    return () => controller.abort();
  }, [endpoint, reload]);
  return [state, setState];
}

const DEAL_LAYOUTS = [{ id: 'list', label: 'List view', Icon: List }, { id: 'kanban', label: 'Kanban view', Icon: Columns3 }];

const DEAL_VIEWS = [{ id: 'deals', label: 'Deals' }, { id: 'introductions', label: 'Deal introductions' }];

export function DealsPanel({ onOpenPage }) {
  const viewStorageKey = `bigbrain:deals-view:${window.location.pathname}`;
  const [view, setView] = useState(() => {
    try { return window.sessionStorage.getItem(viewStorageKey) === 'introductions' ? 'introductions' : 'deals'; }
    catch { return 'deals'; }
  });
  const layoutStorageKey = `bigbrain:deals-layout-v2:${window.location.pathname}`;
  const introductionLayoutKey = `bigbrain:introductions-layout:${window.location.pathname}`;
  const readLayout = key => {
    try { return window.sessionStorage.getItem(key) === 'list' ? 'list' : 'kanban'; }
    catch { return 'kanban'; }
  };
  const [dealLayout, setDealLayout] = useState(() => readLayout(layoutStorageKey));
  const [introductionLayout, setIntroductionLayout] = useState(() => readLayout(introductionLayoutKey));
  const layout = view === 'introductions' ? introductionLayout : dealLayout;
  const textModeStorageKey = `bigbrain:deals-text-mode:${window.location.pathname}`;
  const [textMode, setTextMode] = useState(() => {
    try { return window.sessionStorage.getItem(textModeStorageKey) === 'anonymised' ? 'anonymised' : 'regular'; }
    catch { return 'regular'; }
  });
  function changeTextMode(next) {
    setTextMode(next);
    setStageFeedback(null);
    try { window.sessionStorage.setItem(textModeStorageKey, next); } catch { /* Storage is optional. */ }
  }
  const layoutRefs = useRef({});
  const panelRef = useRef(null);
  function changeLayout(next) {
    if (view === 'introductions') setIntroductionLayout(next); else setDealLayout(next);
    try { window.sessionStorage.setItem(view === 'introductions' ? introductionLayoutKey : layoutStorageKey, next); } catch { /* Storage is optional. */ }
  }
  const [search, setSearch] = useState('');
  const [searchExpanded, setSearchExpanded] = useState(false);
  const [selectedSlugs, setSelectedSlugs] = useState(() => new Set());
  function toggleSelection(slug) { setSelectedSlugs(current => { const next = new Set(current); if (next.has(slug)) next.delete(slug); else next.add(slug); return next; }); }
  const searchToggleRef = useRef(null);
  const [dealType, setDealType] = useState('');
  const [dealStatus, setDealStatus] = useState('active');
  const [introductionStatus, setIntroductionStatus] = useState('active');
  const [savingStatus, setSavingStatus] = useState(null);
  const [savingArrangement, setSavingArrangement] = useState(null);
  const [stage, setStage] = useState('');
  const [introductionSearch, setIntroductionSearch] = useState('');
  const [introductionStage, setIntroductionStage] = useState('');
  const [reload, setReload] = useState(0);
  const [state, setState] = useDealCollection('/api/overlays/deals', reload);
  useEffect(() => {
    if (state.status !== 'ready') return;
    const active = new Set(state.records.filter(record => recordStatus(record) === 'active').map(record => record.page_slug));
    setSelectedSlugs(current => { const next = new Set([...current].filter(slug => active.has(slug))); return next.size === current.size ? current : next; });
  }, [state.records, state.status]);
  const [introductions, setIntroductions] = useDealCollection('/api/overlays/deals/introductions', reload);
  const [downloading, setDownloading] = useState(false);
  const [downloadError, setDownloadError] = useState('');
  const [savingStage, setSavingStage] = useState(null);
  const [stageFeedback, setStageFeedback] = useState(null);
  const stagePending = useRef(false);
  async function moveDealStage(record, nextStage) {
    if (stagePending.current) return;
    stagePending.current = true;
    setSavingStage(record.page_slug);
    setStageFeedback({ kind: 'pending', text: `Saving ${dealDisplayText(record, textMode).title} to ${DEAL_STAGE_LABELS[nextStage]}…` });
    setState(current => ({ ...current, records: current.records.map(item => item.page_slug === record.page_slug ? { ...item, deal_stage: nextStage } : item) }));
    try {
      const data = await saveDealStage(record, nextStage);
      setState(current => ({ ...current, records: current.records.map(item => item.page_slug === record.page_slug ? { ...item, ...data.record } : item) }));
      setStageFeedback({ kind: data.maintenance_warning ? 'warning' : 'success', text: data.maintenance_warning || `${dealDisplayText(record, textMode).title} moved to ${DEAL_STAGE_LABELS[nextStage]}.` });
    } catch (error) {
      setState(current => ({ ...current, records: current.records.map(item => item.page_slug === record.page_slug ? { ...item, deal_stage: record.deal_stage, stage_as_of: record.stage_as_of } : item) }));
      setStageFeedback({ kind: 'error', text: error.message });
      if (error.status === 409) setReload(value => value + 1);
    } finally { stagePending.current = false; setSavingStage(null); }
  }
  async function moveIntroductionStage(record, nextStage) {
    if (stagePending.current) return;
    stagePending.current = true;
    setSavingStage(record.page_slug);
    setStageFeedback({ kind: 'pending', text: `Saving ${record.title} to ${INTRODUCTION_STAGE_LABELS[nextStage]}…` });
    setIntroductions(current => ({ ...current, records: current.records.map(item => item.page_slug === record.page_slug ? { ...item, stage: nextStage } : item) }));
    try {
      const data = await saveIntroductionStage(record, nextStage);
      setIntroductions(current => ({ ...current, records: current.records.map(item => item.page_slug === record.page_slug ? { ...item, ...data.record } : item) }));
      setState(current => ({ ...current, records: current.records.map(item => ({ ...item, introductions: (item.introductions || []).map(intro => intro.page_slug === record.page_slug ? { ...intro, ...data.record } : intro) })) }));
      setStageFeedback({ kind: data.maintenance_warning ? 'warning' : 'success', text: data.maintenance_warning || `${record.title} moved to ${INTRODUCTION_STAGE_LABELS[nextStage]}.` });
    } catch (error) {
      setIntroductions(current => ({ ...current, records: current.records.map(item => item.page_slug === record.page_slug ? { ...item, stage: record.stage, stage_as_of: record.stage_as_of } : item) }));
      setStageFeedback({ kind: 'error', text: error.message });
      if (error.status === 409) setReload(value => value + 1);
    } finally { stagePending.current = false; setSavingStage(null); }
  }
  async function changeStatus(record, status, introduction = false) {
    if (stagePending.current) return;
    stagePending.current = true;
    const actionButton = document.activeElement;
    setSavingStatus(record.page_slug);
    setStageFeedback({ kind: 'pending', text: `${status === 'archived' ? 'Archiving' : 'Restoring'} ${introduction ? record.title : dealDisplayText(record, textMode).title}…` });
    try {
      const data = await saveRecordStatus(record, status, introduction);
      const update = introduction ? setIntroductions : setState;
      update(current => ({ ...current, records: current.records.map(item => item.page_slug === record.page_slug ? { ...item, ...data.record } : item) }));
      setStageFeedback({ kind: data.maintenance_warning ? 'warning' : 'success', text: data.maintenance_warning || `${introduction ? record.title : dealDisplayText(record, textMode).title} ${status === 'archived' ? 'archived' : 'restored'}.` });
      requestAnimationFrame(() => {
        if (actionButton && !actionButton.isConnected && document.activeElement === document.body && document.hasFocus()) panelRef.current?.focus({ preventScroll: true });
      });
    } catch (error) {
      setStageFeedback({ kind: 'error', text: error.message });
      if (error.status === 409) setReload(value => value + 1);
    } finally { stagePending.current = false; setSavingStatus(null); }
  }
  async function changeArrangement(record, arrangementStatus) {
    if (stagePending.current) return;
    stagePending.current = true;
    setSavingArrangement(record.page_slug);
    setStageFeedback({ kind: 'pending', text: `Saving arrangement option for ${record.title}…` });
    try {
      const data = await saveIntroductionArrangement(record, arrangementStatus);
      setIntroductions(current => ({ ...current, records: current.records.map(item => item.page_slug === record.page_slug ? { ...item, ...data.record } : item) }));
      setState(current => ({ ...current, records: current.records.map(item => ({ ...item,
        introductions: item.introductions?.map(introduction => introduction.page_slug === record.page_slug ? { ...introduction, ...data.record } : introduction),
      })) }));
      setStageFeedback({ kind: data.maintenance_warning ? 'warning' : 'success', text: data.maintenance_warning || `Arrangement updated for ${record.title}.` });
    } catch (error) {
      setStageFeedback({ kind: 'error', text: error.message });
      if (error.status === 409) setReload(value => value + 1);
    } finally { stagePending.current = false; setSavingArrangement(null); }
  }
  const downloadPending = useRef(false);
  const tabRefs = useRef({});

  function changeView(next) {
    setView(next);
    try { window.sessionStorage.setItem(viewStorageKey, next); } catch { /* Storage is optional. */ }
  }

  async function downloadPdf() {
    if (downloadPending.current) return;
    downloadPending.current = true;
    setDownloading(true);
    setDownloadError('');
    try {
      const blob = await fetchAnonymisedDealsPdf(undefined, selectedSlugs.size ? [...selectedSlugs] : undefined);
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = selectedSlugs.size ? 'anonymised-selected-deals.pdf' : 'anonymised-deals-overview.pdf';
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 60000);
    } catch (error) {
      setDownloadError(error.message || 'Unable to download the PDF. Please retry.');
    } finally {
      downloadPending.current = false;
      setDownloading(false);
    }
  }

  const showingIntroductions = view === 'introductions';
  const current = showingIntroductions ? introductions : state;
  const records = showingIntroductions
    ? introductions.records.filter(record => matchesIntroductionFilters(record, { search: introductionSearch, stage: introductionStage, status: introductionStatus }))
    : state.records.filter(record => matchesDealFilters(record, { search, dealType, stage, status: dealStatus }));
  const filtersChanged = showingIntroductions ? introductionSearch.trim() || introductionStage || introductionStatus !== 'active' : search.trim() || dealType || stage || dealStatus !== 'active';
  const selectableRecords = records.filter(record => recordStatus(record) === 'active');
  const allVisibleSelected = selectableRecords.length > 0 && selectableRecords.every(record => selectedSlugs.has(record.page_slug));
  const noun = showingIntroductions ? 'introduction' : 'deal';

  return (
    <section className="overlay-page deals-page">
      <h1 className="sr-only">Deals</h1>
      <div className="deal-view-toolbar">
        <div className="deal-view-tabs" role="tablist" aria-label="Deals views">
          {DEAL_VIEWS.map(({ id, label }, index) => <button key={id} ref={element => { tabRefs.current[id] = element; }}
            type="button" role="tab" id={`deal-view-${id}`} aria-controls={`deal-panel-${id}`} aria-selected={view === id}
            tabIndex={view === id ? 0 : -1} className="deal-view-tab" onClick={() => changeView(id)}
            onKeyDown={event => {
              if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
              event.preventDefault();
              const next = event.key === 'Home' ? DEAL_VIEWS[0].id : event.key === 'End' ? DEAL_VIEWS.at(-1).id : DEAL_VIEWS[(index + 1) % DEAL_VIEWS.length].id;
              changeView(next); tabRefs.current[next]?.focus();
            }}>{label}</button>)}
        </div>
        <span className="meta deal-result-count" aria-live="polite" aria-label={current.status === 'ready' ? `${records.length} of ${current.records.length} ${noun}s` : `Loading ${noun}s`}>
          {current.status === 'ready' ? `${records.length} / ${current.records.length}` : '…'}
        </span>
        <div className="deal-layout-controls">
        <div className="deal-view-tabs deal-layout-tabs" role="tablist" aria-label={showingIntroductions ? 'Introduction layout' : 'Deal layout'}>
          {DEAL_LAYOUTS.map(({ id, label, Icon }, index) => <button type="button" key={id} role="tab"
            ref={element => { layoutRefs.current[id] = element; }} id={`deal-layout-tab-${id}`} aria-controls={`deal-layout-${id}`}
            aria-label={label} title={label} aria-selected={layout === id} tabIndex={layout === id ? 0 : -1}
            className="deal-view-tab deal-layout-tab" onClick={() => changeLayout(id)} onKeyDown={event => {
              if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
              event.preventDefault();
              const next = event.key === 'Home' ? 'list' : event.key === 'End' ? 'kanban' : DEAL_LAYOUTS[(index + 1) % 2].id;
              changeLayout(next); layoutRefs.current[next]?.focus();
            }}><Icon size={17} aria-hidden="true" /></button>)}
        </div>


        </div>
      </div>
      {stageFeedback ? <div className={`deal-stage-feedback is-${stageFeedback.kind}`} role={stageFeedback.kind === 'error' ? 'alert' : 'status'} aria-live="polite">
        <span>{stageFeedback.text}</span>{stageFeedback.kind !== 'pending' ? <button type="button" aria-label="Dismiss update" onClick={() => setStageFeedback(null)}><X size={15} /></button> : null}
      </div> : null}
      {downloadError && !showingIntroductions ? <p className="deal-export-error" role="alert">{downloadError}</p> : null}
      <div ref={panelRef} className="deal-view-panel" role="tabpanel" id={`deal-panel-${view}`} aria-labelledby={`deal-view-${view}`} tabIndex={0}>
        {current.status === 'loading' ? <div className="deal-list-skeleton" role="status" aria-label={`Loading ${noun}s`}><div /><div /><div /></div>
          : current.status === 'error' ? <div className="overlay-error card" role="alert"><h2>Unable to load {noun}s</h2><p>{current.error}</p><button type="button" className="graph-button" onClick={() => setReload(value => value + 1)}>Retry</button></div>
          : <>
            {current.records.length ? <div className="deal-filters">
              {!showingIntroductions ? <div className="deal-selection-controls">
                <button type="button" role="checkbox" aria-checked={allVisibleSelected} aria-label="Select all visible deals" title="Select all visible deals" className="deal-selection-toggle" disabled={downloading || !selectableRecords.length} onClick={() => setSelectedSlugs(current => { const next = new Set(current); selectableRecords.forEach(record => allVisibleSelected ? next.delete(record.page_slug) : next.add(record.page_slug)); return next; })}>{allVisibleSelected ? <CheckSquare size={16} /> : <Square size={16} />}</button>
                {selectedSlugs.size ? <><span>{selectedSlugs.size} selected</span><button type="button" className="deal-selection-toggle" aria-label="Clear selection" title="Clear selection" disabled={downloading} onClick={() => setSelectedSlugs(new Set())}><X size={14} /></button></> : null}
              </div> : null}
              <div className="deal-compact-search">
                <button ref={searchToggleRef} type="button" className="graph-button deal-icon-action" aria-label="Search this view" title="Search" aria-expanded={searchExpanded || !!(showingIntroductions ? introductionSearch : search)} onClick={() => setSearchExpanded(value => !value)}><Search size={16} aria-hidden="true" /></button>
                {searchExpanded || (showingIntroductions ? introductionSearch : search) ? <input autoFocus className="deal-search-input" type="search" value={showingIntroductions ? introductionSearch : search}
                  onChange={event => showingIntroductions ? setIntroductionSearch(event.target.value) : setSearch(event.target.value)}
                  onBlur={() => setSearchExpanded(false)}
                  onKeyDown={event => { if (event.key === 'Escape') { showingIntroductions ? setIntroductionSearch('') : setSearch(''); setSearchExpanded(false); searchToggleRef.current?.focus(); } }}
                  placeholder="Search…" aria-label={showingIntroductions ? 'Search introductions, parties or deals' : 'Search deals'} /> : null}
              </div>
              <div className="deal-filter-field">
                <span className="sr-only" id="deal-status-filter-label">Status</span>
                <Select value={showingIntroductions ? introductionStatus : dealStatus} onValueChange={showingIntroductions ? setIntroductionStatus : setDealStatus} aria-labelledby="deal-status-filter-label"
                  options={[{ value: 'active', label: 'Active' }, { value: 'archived', label: 'Archived' }, { value: 'all', label: 'All' }]} />
              </div>
              {!showingIntroductions ? <div className="deal-filter-field">
                <span className="sr-only" id="deal-type-filter-label">Deal type</span>
                <Select value={dealType} onValueChange={setDealType} aria-labelledby="deal-type-filter-label"
                  options={[{ value: '', label: 'All types' }, ...Object.entries(DEAL_TYPE_LABELS).map(([value, label]) => ({ value, label }))]} />
              </div> : null}
              <div className="deal-filter-field">
                <span className="sr-only" id="deal-stage-filter-label">{showingIntroductions ? 'Introduction stage' : 'Deal stage'}</span>
                <Select value={showingIntroductions ? introductionStage : stage} onValueChange={showingIntroductions ? setIntroductionStage : setStage} aria-labelledby="deal-stage-filter-label"
                  options={[{ value: '', label: 'All stages' }, ...Object.entries(showingIntroductions ? INTRODUCTION_STAGE_LABELS : DEAL_STAGE_LABELS).map(([value, label]) => ({ value, label }))]} />
              </div>
        {!showingIntroductions ? <div className="deal-view-tabs" role="group" aria-label="Deal text">
          {[['regular', 'Regular'], ['anonymised', 'Anonymised']].map(([id, label]) => <button key={id} type="button"
            className="deal-view-tab" aria-pressed={textMode === id} disabled={!!savingStage || !!savingStatus || !!savingArrangement}
            onClick={() => changeTextMode(id)}>{label}</button>)}
        </div> : null}
        {!showingIntroductions ? <button type="button" className="graph-button deal-download-button"
          title={downloading ? 'Preparing PDF…' : selectedSlugs.size ? 'Download anonymised PDF of selected deals' : 'Download anonymised PDF of all active deals'}
          aria-label={downloading ? 'Preparing PDF' : selectedSlugs.size ? 'Download anonymised PDF of selected deals' : 'Download anonymised PDF of all active deals'}
          onClick={downloadPdf} disabled={downloading || state.status !== 'ready' || !state.records.some(record => recordStatus(record) === 'active')}>
          <Download size={16} aria-hidden="true" />{downloading ? 'Preparing PDF…' : selectedSlugs.size ? `Download selected (${selectedSlugs.size})` : 'Download PDF'}
        </button> : null}
              {filtersChanged ? <button type="button" className="graph-button" onClick={() => {
                if (showingIntroductions) { setIntroductionSearch(''); setIntroductionStage(''); setIntroductionStatus('active'); }
                else { setSearch(''); setDealType(''); setStage(''); setDealStatus('active'); }
              }}>Clear filters</button> : null}
            </div> : null}
            <div role="tabpanel" id={`deal-layout-${layout}`} aria-labelledby={`deal-layout-tab-${layout}`} tabIndex={0}>
            {records.length ? showingIntroductions && layout === 'kanban' ? <DealIntroductionKanban records={records} onOpenPage={onOpenPage} onMoveStage={moveIntroductionStage} savingSlug={savingStage} statusSavingSlug={savingStatus} arrangementSavingSlug={savingArrangement} onStatusChange={changeStatus} onArrangementChange={changeArrangement} /> : !showingIntroductions && layout === 'kanban' ? <DealKanban selectedSlugs={selectedSlugs} onToggleSelection={toggleSelection} selectionDisabled={downloading} textMode={textMode} records={records} onOpenPage={onOpenPage} onMoveStage={moveDealStage} savingSlug={savingStage} statusSavingSlug={savingStatus || savingArrangement} onStatusChange={changeStatus} /> : <div className="overlay-record-list">
              {showingIntroductions ? records.map(introduction => <DealIntroductionRow key={introduction.page_slug} introduction={introduction} onOpenPage={onOpenPage} onStatusChange={changeStatus} statusPending={savingStatus === introduction.page_slug} onArrangementChange={changeArrangement} arrangementPending={savingArrangement === introduction.page_slug} disabled={!!savingStatus || !!savingStage || !!savingArrangement} />)
                : records.map(record => <article className={`overlay-record card deal-record${selectedSlugs.has(record.page_slug) ? ' is-selected' : ''}`} key={record.page_slug}>
                  <div className="overlay-record-main">
                    <div className="overlay-record-title-row">
                      {recordStatus(record) === 'active' ? <button type="button" role="checkbox" aria-checked={selectedSlugs.has(record.page_slug)} aria-label={`Select ${dealDisplayText(record, textMode).title}`} className="deal-selection-toggle" disabled={downloading} onClick={() => toggleSelection(record.page_slug)}>{selectedSlugs.has(record.page_slug) ? <CheckSquare size={16} /> : <Square size={16} />}</button> : null}
                      <button type="button" className="overlay-person-link deal-page-link" onClick={() => onOpenPage?.(record.page_slug)}>{dealDisplayText(record, textMode).title}</button>
                      <span className={`deal-involvement involvement-${record.deal_involvement || 'unset'}`}>{INVOLVEMENT_LABELS[record.deal_involvement] || 'Involvement not set'}</span>
                    </div>
                    <p className="overlay-record-summary deal-record-summary">{dealDisplayText(record, textMode).description}</p>
                    <DealProgress record={record} />
                    <DealStatusAction record={record} displayTitle={dealDisplayText(record, textMode).title} onChange={changeStatus} pending={savingStatus === record.page_slug} disabled={!!savingStatus || !!savingStage || !!savingArrangement} />
                    <DealNextActions tasks={record.tasks} onOpenPage={onOpenPage} />
                    <DealTeaser record={record} hideOverview={textMode === 'anonymised'} onSaved={savedRecord => setState(current => ({
                      ...current, records: current.records.map(item => item.page_slug === savedRecord.page_slug ? { ...item, ...savedRecord } : item),
                    }))} />
                  </div>
                </article>)}
            </div> : <div className="overlay-empty card"><div>
              <h2>{current.records.length ? `No matching ${noun}s` : `No ${noun}s yet`}</h2>
              <p>{current.records.length ? 'Try a different search or clear the filters.' : showingIntroductions ? 'Introductions will appear here when they are recorded for a deal.' : 'Deal pages will appear here when they are added to this Brain.'}</p>
            </div></div>}
            </div>
          </>}
      </div>
    </section>
  );
}
