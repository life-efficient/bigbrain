import React from 'react';
import { activeDealTasks, DEAL_STAGE_LABELS, DEAL_TYPE_LABELS, INTRODUCTION_STAGE_LABELS, pageReference, progressDate, TASK_STATUS_LABELS } from './deal-progress.js';

export function PageReferences({ references = [], onOpenPage }) {
  return references.map(pageReference).filter(Boolean).map((reference, index) => (
    <React.Fragment key={reference.page_slug}>
      {index > 0 ? ', ' : ''}
      <button type="button" className="deal-reference-link" onClick={() => onOpenPage?.(reference.page_slug)}>{reference.title}</button>
    </React.Fragment>
  ));
}

export function DealStage({ stage, asOf, introduction = false }) {
  const labels = introduction ? INTRODUCTION_STAGE_LABELS : DEAL_STAGE_LABELS;
  const date = progressDate(asOf);
  return <span className="deal-stage-meta"><span className="deal-involvement">{labels[stage] || labels.unknown}</span>
    {date ? <span className="meta">As of <time dateTime={asOf}>{date}</time></span> : null}</span>;
}

export function DealProgress({ record }) {
  return <div className="deal-progress-meta">
    {(record.deal_types || []).map(type => <span className="deal-involvement" key={type}>{DEAL_TYPE_LABELS[type] || 'Other'}</span>)}
    <DealStage stage={record.deal_stage} asOf={record.stage_as_of} />
  </div>;
}

export function DealNextActions({ tasks, onOpenPage }) {
  const activeTasks = activeDealTasks(tasks);
  if (!activeTasks.length) return null;
  return <section className="deal-next-actions" aria-label="Next actions">
    <h4>Next actions</h4>
    <ul>{activeTasks.map(task => <li key={task.page_slug}>
      <button type="button" className="deal-reference-link" onClick={() => onOpenPage?.(task.page_slug)}>{task.title || pageReference(task)?.title}</button>
      <div className="deal-action-meta">
        <span>{TASK_STATUS_LABELS[task.status] || 'Status not established'}</span>
        {task.assignees?.length ? <span>Owner: <PageReferences references={task.assignees} onOpenPage={onOpenPage} /></span> : <span>Owner not assigned</span>}
        {task.waiting_on?.length ? <span>Waiting on: <PageReferences references={task.waiting_on} onOpenPage={onOpenPage} /></span>
          : task.status === 'waiting' ? <span>Waiting on: not recorded</span> : null}
        {progressDate(task.due) ? <span>Due <time dateTime={task.due}>{progressDate(task.due)}</time></span> : null}
      </div>
    </li>)}</ul>
  </section>;
}

export function DealIntroductions({ introductions = [], onOpenPage }) {
  if (!introductions.length) return <p className="meta deal-introductions-empty">No deal introductions recorded.</p>;
  return <details className="deal-introductions">
    <summary>{introductions.length} deal {introductions.length === 1 ? 'introduction' : 'introductions'}</summary>
    <div className="deal-introduction-list">
      {introductions.map(introduction => <article className="deal-introduction" key={introduction.page_slug}>
        <div className="deal-introduction-heading">
          <button type="button" className="deal-reference-link deal-introduction-title" onClick={() => onOpenPage?.(introduction.page_slug)}>{introduction.title || pageReference(introduction)?.title}</button>
          <DealStage stage={introduction.stage} asOf={introduction.stage_as_of} introduction />
        </div>
        {introduction.parties?.length ? <p className="meta">Parties: <PageReferences references={introduction.parties} onOpenPage={onOpenPage} /></p> : null}
        {introduction.purpose ? <p>{introduction.purpose}</p> : introduction.summary ? <p>{introduction.summary}</p> : null}
        <DealNextActions tasks={introduction.tasks} onOpenPage={onOpenPage} />
        {!activeDealTasks(introduction.tasks).length ? <p className="meta">No open follow-up recorded.</p> : null}
      </article>)}
    </div>
  </details>;
}

export function DealIntroductionRow({ introduction, onOpenPage }) {
  const parent = pageReference(introduction.parent_deal || introduction.deal);
  return <article className="deal-introduction deal-introduction-row">
    <div className="deal-introduction-heading">
      <button type="button" className="deal-reference-link deal-introduction-title" onClick={() => onOpenPage?.(introduction.page_slug)}>{introduction.title || pageReference(introduction)?.title}</button>
      <DealStage stage={introduction.stage} asOf={introduction.stage_as_of} introduction />
    </div>
    {parent ? <p className="meta">Deal: <button type="button" className="deal-reference-link" onClick={() => onOpenPage?.(parent.page_slug)}>{parent.title}</button></p> : null}
    {introduction.parties?.length ? <p className="meta">Parties: <PageReferences references={introduction.parties} onOpenPage={onOpenPage} /></p> : null}
    {introduction.purpose || introduction.summary ? <p>{introduction.purpose || introduction.summary}</p> : null}
    <DealNextActions tasks={introduction.tasks} onOpenPage={onOpenPage} />
    {!activeDealTasks(introduction.tasks).length ? <p className="meta">No open follow-up recorded.</p> : null}
  </article>;
}
