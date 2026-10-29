import { DealStatusAction } from './deal-status.jsx';
import { recordStatus } from './deal-status.js';
import { Select } from '../components/select.jsx';
import { PageReferences } from './deal-progress.jsx';
import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { DndContext, DragOverlay, KeyboardSensor, PointerSensor, useSensor, useSensors, useDraggable, useDroppable, pointerWithin, closestCenter, MeasuringStrategy } from '@dnd-kit/core';
import { GripVertical } from 'lucide-react';
import { activeDealTasks, INTRODUCTION_STAGE_LABELS, pageReference } from './deal-progress.js';
import { groupIntroductionsByStage, introductionStage, introductionStageDropTarget } from './deal-introduction-kanban.js';

function stageKeyboardCoordinates(event, { currentCoordinates, context }) {
  if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.code)) return;
  event.preventDefault();
  const stages = Object.keys(INTRODUCTION_STAGE_LABELS);
  const current = introductionStageDropTarget(context.over?.id) || introductionStage(context.active?.data.current?.record);
  const direction = ['ArrowLeft', 'ArrowUp'].includes(event.code) ? -1 : 1;
  const next = stages[Math.max(0, Math.min(stages.length - 1, stages.indexOf(current) + direction))];
  const rect = context.droppableRects.get(`introduction-stage:${next}`);
  const collision = context.collisionRect;
  if (!rect || !collision) return;
  return { x: currentCoordinates.x + rect.left + rect.width / 2 - collision.left - collision.width / 2,
    y: currentCoordinates.y + rect.top + Math.min(80, rect.height / 2) - collision.top - collision.height / 2 };
}

const ARRANGEMENT_OPTIONS = [
  { value: 'none', label: 'No arrangement' },
  { value: 'establishing', label: 'Establishing arrangement' },
  { value: 'agreed', label: 'Arrangement agreed' },
];

function CardContent({ record, onOpenPage, handle, actions, overlay = false, onArrangementChange, arrangementPending, disabled }) {
  const title = record.title || record.page_slug;
  const parent = pageReference(record.parent_deal || record.deal);
  const parties = (record.parties || []).map(pageReference).filter(Boolean);
  const tasks = activeDealTasks(record.tasks);
  const waiting = [...new Map(tasks.flatMap(task => (task.waiting_on || []).map(pageReference).filter(Boolean)).map(ref => [ref.page_slug, ref])).values()];
  const arrangementStatus = record.arrangement_status || 'none';
  return <>
    <div className="deal-kanban-card-head">
      {overlay ? <span className="deal-kanban-title">{title}</span> : <button type="button" className="overlay-person-link deal-kanban-title" onClick={() => onOpenPage?.(record.page_slug)}>{title}</button>}
      <div className="deal-kanban-card-actions">{handle}</div>
    </div>
    {parent ? <p className="meta introduction-kanban-parent">Deal: {overlay ? parent.title : <button type="button" className="deal-reference-link" onClick={() => onOpenPage?.(parent.page_slug)}>{parent.title}</button>}</p> : null}
    {parties.length ? <p className="meta introduction-kanban-parties">Parties: {overlay ? parties.map(ref => ref.title).join(', ') : <PageReferences references={parties} onOpenPage={onOpenPage} />}</p> : null}
    <p className="deal-kanban-summary">{record.purpose || record.summary || 'No purpose recorded.'}</p>
    {overlay ? <span className="deal-involvement">{ARRANGEMENT_OPTIONS.find(option => option.value === arrangementStatus)?.label || 'No arrangement'}</span> :
      <Select className="deal-arrangement-pill" value={arrangementStatus} aria-label={`Arrangement for ${title}`}
        aria-busy={arrangementPending || undefined} disabled={disabled || arrangementPending} data-arrangement-status={arrangementStatus}
        onValueChange={next => onArrangementChange?.(record, next)} options={ARRANGEMENT_OPTIONS} />}
    {recordStatus(record, true) === 'archived' ? <span className="deal-stage-badge">Archived</span> : null}
    {tasks.length ? <span className="meta">{tasks.length} open {tasks.length === 1 ? 'action' : 'actions'}</span> : null}
    {waiting.length ? <p className="deal-kanban-waiting">Waiting on: {waiting.map(ref => ref.title).join(', ')}</p> : null}
    {!overlay ? <div className="deal-kanban-card-footer"><div className="deal-kanban-card-actions">{actions}</div></div> : null}
  </>;
}

function DraggableIntroduction({ record, onOpenPage, disabled, saving, statusPending, onStatusChange, onEdit, onArrangementChange, arrangementPending }) {
  const title = record.title || record.page_slug;
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, isDragging } = useDraggable({ id: record.page_slug, data: { record }, disabled: disabled || recordStatus(record, true) === 'archived' });
  return <article ref={setNodeRef} className={`deal-kanban-card introduction-kanban-card${isDragging ? ' is-dragging' : ''}${saving ? ' is-saving' : ''}`} aria-busy={saving || undefined}>
    <CardContent record={record} onArrangementChange={onArrangementChange} arrangementPending={arrangementPending} disabled={disabled} onOpenPage={onOpenPage} actions={<DealStatusAction menu introduction record={record} displayTitle={title} onEdit={onEdit} onChange={onStatusChange} pending={statusPending} disabled={disabled} />} handle={recordStatus(record, true) !== 'archived' ? <button type="button" ref={setActivatorNodeRef} className="deal-drag-handle" {...attributes} {...listeners}
      data-introduction-handle={record.page_slug} aria-label={`Move ${title}`} title="Drag to change stage" disabled={disabled}><GripVertical size={16} aria-hidden="true" /></button> : null} />
    {saving ? <span className="deal-card-saving">Saving stage…</span> : null}
  </article>;
}

function StageColumn({ column, active, overStage, savingSlug, statusSavingSlug, arrangementSavingSlug, onStatusChange, onEdit, onArrangementChange, disabled, onOpenPage }) {
  const { setNodeRef, isOver } = useDroppable({ id: `introduction-stage:${column.stage}`, disabled });
  const entering = active && overStage === column.stage && introductionStage(active) !== column.stage;
  const leaving = active && overStage && introductionStage(active) === column.stage && overStage !== column.stage;
  const count = column.records.length + (entering ? 1 : 0) - (leaving ? 1 : 0);
  return <section ref={setNodeRef} className={`deal-kanban-column${isOver && active ? ' is-drop-target' : ''}${!column.records.length ? ' is-empty' : ''}`} aria-labelledby={`introduction-column-${column.stage}`}>
    <header className="deal-kanban-column-head"><h2 id={`introduction-column-${column.stage}`}>{column.label}</h2><span className="meta">{count}</span></header>
    <div className="deal-kanban-cards">
      {entering ? <div className="deal-drop-preview" aria-hidden="true">Move to {column.label}</div> : null}
      {column.records.map(record => <DraggableIntroduction key={record.page_slug} record={record} onArrangementChange={onArrangementChange} arrangementPending={arrangementSavingSlug === record.page_slug} onOpenPage={onOpenPage} disabled={disabled} saving={savingSlug === record.page_slug} statusPending={statusSavingSlug === record.page_slug} onEdit={onEdit} onStatusChange={onStatusChange} />)}
      {!column.records.length && !entering ? <div className="deal-empty-column">{active ? 'Drop here' : 'No introductions'}</div> : null}
    </div>
  </section>;
}

export function DealIntroductionKanban({ records, onOpenPage, onMoveStage, savingSlug, statusSavingSlug, arrangementSavingSlug, onStatusChange, onEdit, onArrangementChange }) {
  const boardRef = useRef(null);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const [active, setActive] = useState(null);
  const [overStage, setOverStage] = useState(null);
  const [reducedMotion, setReducedMotion] = useState(false);
  useEffect(() => {
    const media = window.matchMedia('(prefers-reduced-motion: reduce)');
    const update = () => setReducedMotion(media.matches); update(); media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: stageKeyboardCoordinates, scrollBehavior: 'auto' }));
  const columns = groupIntroductionsByStage(records, { includeEmpty: true });
  const reset = () => { setActive(null); setOverStage(null); };
  return <DndContext sensors={sensors} measuring={{ droppable: { strategy: MeasuringStrategy.Always } }}
    collisionDetection={args => args.pointerCoordinates ? pointerWithin(args) : closestCenter(args)}
    autoScroll={{ threshold: { x: 0.18, y: 0.1 }, acceleration: 12 }}
    accessibility={{ screenReaderInstructions: { draggable: 'Press Space to pick up an introduction. Use arrow keys to choose a stage, Space to drop, or Escape to cancel.' },
      announcements: {
        onDragStart: ({ active }) => `Picked up ${active.data.current.record.title || active.data.current.record.page_slug}. Use arrow keys to choose a stage.`,
        onDragOver: ({ over }) => over ? `Target stage: ${INTRODUCTION_STAGE_LABELS[introductionStageDropTarget(over.id)]}.` : 'Outside a stage. Release to cancel.',
        onDragEnd: ({ over }) => over ? `Dropped in ${INTRODUCTION_STAGE_LABELS[introductionStageDropTarget(over.id)]}.` : 'Move cancelled.',
        onDragCancel: () => 'Move cancelled. Stage unchanged.',
      } }}
    onDragStart={({ active }) => { setActive(active.data.current.record); setOverStage(introductionStage(active.data.current.record)); }}
    onDragOver={({ over }) => setOverStage(introductionStageDropTarget(over?.id))}
    onDragCancel={reset}
    onDragEnd={async ({ active: dragged, over, activatorEvent }) => {
      const record = dragged.data.current.record;
      const next = introductionStageDropTarget(over?.id);
      reset();
      if (!next || next === introductionStage(record)) return;
      const keyboard = activatorEvent?.type === 'keydown';
      const sourceHandle = document.activeElement;
      let focusMoved = false;
      const relinquishFocus = () => { focusMoved = true; };
      const watchKeyboard = event => { if (event.key === 'Tab') relinquishFocus(); };
      if (keyboard) {
        document.addEventListener('pointerdown', relinquishFocus, true);
        document.addEventListener('keydown', watchKeyboard, true);
      }
      try { await onMoveStage?.(record, next); }
      finally {
        if (keyboard) requestAnimationFrame(() => {
          document.removeEventListener('pointerdown', relinquishFocus, true);
          document.removeEventListener('keydown', watchKeyboard, true);
          if (!mounted.current || focusMoved || !document.hasFocus()) return;
          const target = [...(boardRef.current?.querySelectorAll('[data-introduction-handle]') || [])].find(node => node.dataset.introductionHandle === record.page_slug);
          const focused = document.activeElement;
          // A stage move remounts the card in a new column. Restore its keyboard
          // handle only while focus is still ours, never over a user's next action.
          if (focused === document.body || focused === sourceHandle || focused === target) {
            (target && !target.disabled ? target : boardRef.current)?.focus({ preventScroll: true });
          }
        });
      }
    }}>
    <div ref={boardRef} className={`deal-kanban introduction-kanban${active ? ' is-drag-active' : ''}`} role="region" aria-label="Introductions by stage" tabIndex={0}>
      {columns.map(column => <StageColumn key={column.stage} column={column} arrangementSavingSlug={arrangementSavingSlug} onArrangementChange={onArrangementChange} active={active} overStage={overStage} savingSlug={savingSlug}
        statusSavingSlug={statusSavingSlug} onEdit={onEdit} onStatusChange={onStatusChange} disabled={!!savingSlug || !!statusSavingSlug || !!arrangementSavingSlug} onOpenPage={onOpenPage} />)}
    </div>
    {createPortal(<DragOverlay dropAnimation={reducedMotion ? null : { duration: 180, easing: 'cubic-bezier(0.2, 0.8, 0.2, 1)' }} zIndex={100}>
      {active ? <div className="deals-page deal-drag-overlay" aria-hidden="true"><article className="deal-kanban-card introduction-kanban-card"><CardContent record={active} overlay handle={<GripVertical size={16} />} /></article></div> : null}
    </DragOverlay>, document.body)}
  </DndContext>;
}
