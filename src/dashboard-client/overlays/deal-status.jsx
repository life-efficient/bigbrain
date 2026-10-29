import React from 'react';
import { Archive, ArchiveRestore, Loader2 } from 'lucide-react';
import { recordStatus } from './deal-status.js';

export function DealStatusAction({ record, introduction = false, onChange, pending, disabled }) {
  const archived = recordStatus(record, introduction) === 'archived';
  const Icon = pending ? Loader2 : archived ? ArchiveRestore : Archive;
  return <div className="deal-status-actions">
    {archived ? <span className="deal-stage-badge">Archived</span> : null}
    <button type="button" className="graph-button" disabled={disabled || pending} aria-busy={pending || undefined}
      aria-label={`${archived ? 'Restore' : 'Archive'} ${record.title || record.page_slug}`}
      onClick={() => onChange?.(record, archived ? 'active' : 'archived', introduction)}>
      <Icon size={14} aria-hidden="true" />{pending ? 'Saving…' : archived ? 'Restore' : 'Archive'}
    </button>
  </div>;
}
