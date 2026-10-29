import React, { useRef, useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { Plus, Trash2, X } from 'lucide-react';
import { Select } from '../components/select.jsx';

export function DealRecordEditor({ record, introduction = false, onClose, onSaved }) {
  const base = useRef(record.edit_values || (introduction
    ? { title: record.title || '', purpose: record.purpose || '', arrangement_status: record.arrangement_status || 'none' }
    : { title: record.title || '', summary: record.summary || '', anonymised_title: record.anonymised_title || '', anonymised_description: record.anonymised_description || '', anonymised_asks: record.anonymised_asks || [] }));
  const [values, setValues] = useState(() => ({ ...base.current, ...(introduction ? {} : { summary: base.current.summary || record.summary || '', anonymised_asks: [...base.current.anonymised_asks] }) }));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const savingRef = useRef(false);

  const change = (key, value) => setValues(current => ({ ...current, [key]: value }));
  async function save(event) {
    event.preventDefault();
    if (savingRef.current) return;
    savingRef.current = true; setSaving(true); setError('');
    try {
      const response = await fetch('/api/overlays/deals/edit', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ page_slug: record.page_slug, values, expected_values: base.current }) });
      const data = await response.json();
      if (!response.ok) throw new Error(response.status === 409 ? 'This record changed elsewhere. Your draft is kept. Refresh before saving.' : data.error || 'Unable to save changes. Your draft is kept.');
      if (data.record?.page_slug !== record.page_slug || !data.record.edit_values) throw new Error('The saved record could not be verified. Your draft is kept.');
      onSaved?.({ ...record, ...data.record }, data.maintenance_warning);
    } catch (cause) { setError(cause.message || 'Unable to save changes. Your draft is kept.'); }
    finally { savingRef.current = false; setSaving(false); }
  }
  function field(key, label, rows = 2, required = false) {
    return <label className="deal-editor-label">{label}<textarea className="overlay-search deal-editor-input" style={{ minHeight: rows === 2 ? 64 : 96 }} rows={rows}
      value={values[key]} required={required} maxLength={key.includes('title') ? 500 : 20000} disabled={saving} onChange={event => change(key, event.target.value)} /></label>;
  }
  return <><Dialog.Root open onOpenChange={open => { if (!open && !savingRef.current) onClose?.(); }}>
    <Dialog.Portal container={document.querySelector('.page-shell') || document.body}>
      <Dialog.Overlay className="deal-modal-backdrop" />
      <Dialog.Content className="deal-modal deal-record-editor" onOpenAutoFocus={event => { event.preventDefault(); const field = event.currentTarget.querySelector('textarea'); requestAnimationFrame(() => field?.focus()); }} onPointerDownOutside={event => event.preventDefault()}
        onEscapeKeyDown={event => { if (savingRef.current) event.preventDefault(); }}
        onCloseAutoFocus={event => { event.preventDefault(); requestAnimationFrame(() => {
          const buttons = [...document.querySelectorAll('button[aria-label]')];
          buttons.find(button => [record.title || record.page_slug, record.anonymised_title || 'Anonymised title not provided'].some(title => button.getAttribute('aria-label') === `More actions for ${title}`))?.focus();
        }); }}>
        <div className="deal-modal-head"><Dialog.Title>Edit {introduction ? 'deal introduction' : 'deal'}</Dialog.Title>
          <Dialog.Close className="deal-modal-close" disabled={saving} aria-label="Close dialog"><X size={18} /></Dialog.Close></div>
        <Dialog.Description>{introduction ? 'Update the introduction details and facilitation arrangement.' : 'Update the internal details and the anonymised wording used for sharing.'}</Dialog.Description>
        <form className="deal-teaser-editor" onSubmit={save}>
          {field('title', 'Title', 2, true)}
          {introduction ? <>
            {field('purpose', 'Purpose', 3, true)}
            <label className="deal-editor-label">Arrangement<Select aria-label="Arrangement" value={values.arrangement_status} disabled={saving} onValueChange={value => change('arrangement_status', value)}
              options={[{ value: 'none', label: 'No arrangement' }, { value: 'establishing', label: 'Establishing arrangement' }, { value: 'agreed', label: 'Arrangement agreed' }]} /></label>
          </> : <>
            {field('summary', 'Description', 3)}
            {field('anonymised_title', 'Anonymised title')}
            {field('anonymised_description', 'Anonymised description', 3)}
            <div className="deal-editor-label">Anonymised asks
              <p className="meta">Contributions sought from new participants. Requests to existing parties belong in follow-up tasks.</p>
              {values.anonymised_asks.map((ask, index) => <div key={index} style={{ display: 'flex', gap: 8, alignItems: 'start' }}>
                <textarea className="overlay-search deal-editor-input" style={{ minHeight: 80 }} rows={3} aria-label={`Anonymised ask ${index + 1}`} required maxLength={5000} value={ask} disabled={saving}
                  onChange={event => change('anonymised_asks', values.anonymised_asks.map((item, at) => at === index ? event.target.value : item))} />
                <button type="button" className="graph-button deal-icon-action" title="Remove ask" aria-label={`Remove ask ${index + 1}`} disabled={saving} onClick={() => change('anonymised_asks', values.anonymised_asks.filter((_, at) => at !== index))}><Trash2 size={16} /></button>
              </div>)}
              <button type="button" className="graph-button" style={{ justifySelf: 'start' }} disabled={saving || values.anonymised_asks.length >= 100} onClick={() => change('anonymised_asks', [...values.anonymised_asks, ''])}><Plus size={16} />Add ask</button>
            </div>
          </>}
          {error ? <p className="deal-modal-error" role="alert">{error}</p> : null}
          <div className="deal-modal-footer"><Dialog.Close asChild><button type="button" className="graph-button" disabled={saving}>Cancel</button></Dialog.Close>
            <button type="submit" className="graph-button primary" disabled={saving}>{saving ? 'Saving…' : 'Save changes'}</button></div>
        </form>
      </Dialog.Content>
    </Dialog.Portal>
  </Dialog.Root></>;
}
