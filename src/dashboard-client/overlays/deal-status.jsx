import { ActionMenu } from '../components/action-menu.jsx';
import React from 'react';
import { Archive, ArchiveRestore, Loader2, Pencil } from 'lucide-react';
import { recordStatus } from './deal-status.js';

export function DealStatusAction({ record, displayTitle, menu = false, introduction = false, onChange, onEdit, pending, disabled }) {
  const archived = recordStatus(record, introduction) === 'archived';
  const Icon = pending ? Loader2 : archived ? ArchiveRestore : Archive;
  const action = archived ? 'Restore' : 'Archive';
  if (menu) return <ActionMenu label={`More actions for ${displayTitle || record.title || record.page_slug}`} disabled={disabled} pending={pending}
    items={[...(onEdit ? [{ label: `Edit ${introduction ? 'introduction' : 'deal'}`, Icon: Pencil, opensDialog: true, onSelect: () => onEdit(record, introduction) }] : []), { label: `${action} ${introduction ? 'introduction' : 'deal'}`, Icon: archived ? ArchiveRestore : Archive, onSelect: () => onChange?.(record, archived ? 'active' : 'archived', introduction) }]} />;
  return <div className="deal-status-actions">
    {archived ? <span className="deal-stage-badge">Archived</span> : null}
    <button type="button" className="graph-button deal-icon-action" title={pending ? 'Saving…' : action} disabled={disabled || pending} aria-busy={pending || undefined}
      aria-label={`${archived ? 'Restore' : 'Archive'} ${displayTitle || record.title || record.page_slug}`}
      onClick={() => onChange?.(record, archived ? 'active' : 'archived', introduction)}>
      <Icon size={16} className={pending ? 'is-spinning' : undefined} aria-hidden="true" />
    </button>
  </div>;
}
