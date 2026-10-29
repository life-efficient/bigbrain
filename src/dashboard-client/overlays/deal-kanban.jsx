import React from 'react';
import { activeDealTasks, DEAL_TYPE_LABELS, pageReference } from './deal-progress.js';
import { groupDealsByStage } from './deal-kanban.js';

export function DealKanban({ records, onOpenPage }) {
  return <div className="deal-kanban" role="region" aria-label="Deals by stage" tabIndex={0}>
    {groupDealsByStage(records).map(column => <section className="deal-kanban-column" key={column.stage} aria-labelledby={`deal-column-${column.stage}`}>
      <header className="deal-kanban-column-head">
        <h2 id={`deal-column-${column.stage}`}>{column.label}</h2><span className="meta">{column.records.length}</span>
      </header>
      <div className="deal-kanban-cards">
        {column.records.map(record => {
          const tasks = activeDealTasks(record.tasks);
          const waiting = [...new Map(tasks.flatMap(task => (task.waiting_on || []).map(pageReference).filter(Boolean)).map(ref => [ref.page_slug, ref])).values()];
          return <article className="deal-kanban-card" key={record.page_slug}>
            <button type="button" className="overlay-person-link deal-kanban-title" onClick={() => onOpenPage?.(record.page_slug)}>{record.title || record.page_slug}</button>
            <p className="deal-kanban-summary">{record.summary || 'No summary yet.'}</p>
            <div className="deal-kanban-types">{(record.deal_types || []).map(type => <span className="deal-involvement" key={type}>{DEAL_TYPE_LABELS[type] || type}</span>)}</div>
            {tasks.length ? <span className="meta">{tasks.length} open {tasks.length === 1 ? 'action' : 'actions'}</span> : null}
            {waiting.length ? <p className="deal-kanban-waiting">Waiting on: {waiting.map(ref => ref.title).join(', ')}</p> : null}
          </article>;
        })}
      </div>
    </section>)}
  </div>;
}
