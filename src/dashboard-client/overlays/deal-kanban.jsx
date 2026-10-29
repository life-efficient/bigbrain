import { DealStatusAction } from './deal-status.jsx';
import { recordStatus } from './deal-status.js';
import { dealDisplayText } from './deal-display.js';
import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { DndContext, DragOverlay, KeyboardSensor, PointerSensor, useSensor, useSensors, useDraggable, useDroppable, pointerWithin, closestCenter, MeasuringStrategy } from '@dnd-kit/core';
import { GripVertical } from 'lucide-react';
import { activeDealTasks, DEAL_STAGE_LABELS, DEAL_TYPE_LABELS, pageReference } from './deal-progress.js';
import { groupDealsByStage, dealStage, stageDropTarget } from './deal-kanban.js';

function stageKeyboardCoordinates(event, { currentCoordinates, context }) {
  if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.code)) return;
  event.preventDefault();
  const stages = Object.keys(DEAL_STAGE_LABELS);
  const current = stageDropTarget(context.over?.id) || dealStage(context.active?.data.current?.record);
  const direction = ['ArrowLeft', 'ArrowUp'].includes(event.code) ? -1 : 1;
  const next = stages[Math.max(0, Math.min(stages.length - 1, stages.indexOf(current) + direction))];
  const rect = context.droppableRects.get(`stage:${next}`);
  const collision = context.collisionRect;
  if (!rect || !collision) return;
  return { x: currentCoordinates.x + rect.left + rect.width / 2 - collision.left - collision.width / 2,
    y: currentCoordinates.y + rect.top + Math.min(80, rect.height / 2) - collision.top - collision.height / 2 };
}

function CardContent({ record, onOpenPage, handle, actions, overlay = false, textMode }) {
  const { title, description } = dealDisplayText(record, textMode);
  const tasks = activeDealTasks(record.tasks);
  const waiting = [...new Map(tasks.flatMap(task => (task.waiting_on || []).map(pageReference).filter(Boolean)).map(ref => [ref.page_slug, ref])).values()];
  return <>
    <div className="deal-kanban-card-head">
      {overlay ? <span className="deal-kanban-title">{title}</span> : <button type="button" className="overlay-person-link deal-kanban-title" onClick={() => onOpenPage?.(record.page_slug)}>{title}</button>}
      <div className="deal-kanban-card-actions">{handle}{actions}</div>
    </div>
    <p className="deal-kanban-summary">{description}</p>
    <div className="deal-kanban-types">{(record.deal_types || []).map(type => <span className="deal-involvement" key={type}>{DEAL_TYPE_LABELS[type] || type}</span>)}</div>
    {tasks.length ? <span className="meta">{tasks.length} open {tasks.length === 1 ? 'action' : 'actions'}</span> : null}
    {waiting.length ? <p className="deal-kanban-waiting">Waiting on: {waiting.map(ref => ref.title).join(', ')}</p> : null}
  </>;
}

function DraggableDeal({ record, onOpenPage, disabled, saving, statusPending, onStatusChange, textMode }) {
  const { title } = dealDisplayText(record, textMode);
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, isDragging } = useDraggable({ id: record.page_slug, data: { record }, disabled: disabled || recordStatus(record) === 'archived' });
  return <article ref={setNodeRef} className={`deal-kanban-card${isDragging ? ' is-dragging' : ''}${saving ? ' is-saving' : ''}`} aria-busy={saving || undefined}>
    <CardContent record={record} textMode={textMode} onOpenPage={onOpenPage} actions={<DealStatusAction menu record={record} displayTitle={title} onChange={onStatusChange} pending={statusPending} disabled={disabled} />} handle={recordStatus(record) !== 'archived' ? <button type="button" ref={setActivatorNodeRef} className="deal-drag-handle" {...attributes} {...listeners}
      data-deal-handle={record.page_slug} aria-label={`Move ${title}`} title="Drag to change stage" disabled={disabled}><GripVertical size={17} aria-hidden="true" /></button> : null} />
    {saving ? <span className="deal-card-saving">Saving stage…</span> : null}
  </article>;
}

function StageColumn({ column, active, overStage, savingSlug, statusSavingSlug, onStatusChange, disabled, onOpenPage, textMode }) {
  const { setNodeRef, isOver } = useDroppable({ id: `stage:${column.stage}`, disabled });
  const entering = active && overStage === column.stage && dealStage(active) !== column.stage;
  const leaving = active && overStage && dealStage(active) === column.stage && overStage !== column.stage;
  const count = column.records.length + (entering ? 1 : 0) - (leaving ? 1 : 0);
  return <section ref={setNodeRef} className={`deal-kanban-column${isOver && active ? ' is-drop-target' : ''}${!column.records.length ? ' is-empty' : ''}`} aria-labelledby={`deal-column-${column.stage}`}>
    <header className="deal-kanban-column-head"><h2 id={`deal-column-${column.stage}`}>{column.label}</h2><span className="meta">{count}</span></header>
    <div className="deal-kanban-cards">
      {entering ? <div className="deal-drop-preview" aria-hidden="true">Move to {column.label}</div> : null}
      {column.records.map(record => <DraggableDeal key={record.page_slug} record={record} textMode={textMode} onOpenPage={onOpenPage} disabled={disabled} saving={savingSlug === record.page_slug} statusPending={statusSavingSlug === record.page_slug} onStatusChange={onStatusChange} />)}
      {!column.records.length && !entering ? <div className="deal-empty-column">{active ? 'Drop here' : 'No deals'}</div> : null}
    </div>
  </section>;
}

export function DealKanban({ records, onOpenPage, onMoveStage, savingSlug, statusSavingSlug, onStatusChange, textMode = 'regular' }) {
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
  const columns = groupDealsByStage(records, { includeEmpty: true });
  const reset = () => { setActive(null); setOverStage(null); };
  return <DndContext sensors={sensors} measuring={{ droppable: { strategy: MeasuringStrategy.Always } }}
    collisionDetection={args => args.pointerCoordinates ? pointerWithin(args) : closestCenter(args)}
    autoScroll={{ threshold: { x: 0.18, y: 0.1 }, acceleration: 12 }}
    accessibility={{ screenReaderInstructions: { draggable: 'Press Space to pick up a deal. Use arrow keys to choose a stage, Space to drop, or Escape to cancel.' },
      announcements: {
        onDragStart: ({ active }) => `Picked up ${dealDisplayText(active.data.current.record, textMode).title}. Use arrow keys to choose a stage.`,
        onDragOver: ({ over }) => over ? `Target stage: ${DEAL_STAGE_LABELS[stageDropTarget(over.id)]}.` : 'Outside a stage. Release to cancel.',
        onDragEnd: ({ over }) => over ? `Dropped in ${DEAL_STAGE_LABELS[stageDropTarget(over.id)]}.` : 'Move cancelled.',
        onDragCancel: () => 'Move cancelled. Stage unchanged.',
      } }}
    onDragStart={({ active }) => { setActive(active.data.current.record); setOverStage(dealStage(active.data.current.record)); }}
    onDragOver={({ over }) => setOverStage(stageDropTarget(over?.id))}
    onDragCancel={reset}
    onDragEnd={async ({ active: dragged, over, activatorEvent }) => {
      const record = dragged.data.current.record;
      const next = stageDropTarget(over?.id);
      reset();
      if (!next || next === dealStage(record)) return;
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
          const target = [...(boardRef.current?.querySelectorAll('[data-deal-handle]') || [])].find(node => node.dataset.dealHandle === record.page_slug);
          const focused = document.activeElement;
          // A stage move remounts the card in a new column. Restore its keyboard
          // handle only while focus is still ours, never over a user's next action.
          if (focused === document.body || focused === sourceHandle || focused === target) {
            (target && !target.disabled ? target : boardRef.current)?.focus({ preventScroll: true });
          }
        });
      }
    }}>
    <div ref={boardRef} className={`deal-kanban${active ? ' is-drag-active' : ''}`} role="region" aria-label="Deals by stage" tabIndex={0}>
      {columns.map(column => <StageColumn key={column.stage} column={column} textMode={textMode} active={active} overStage={overStage} savingSlug={savingSlug}
        statusSavingSlug={statusSavingSlug} onStatusChange={onStatusChange} disabled={!!savingSlug || !!statusSavingSlug} onOpenPage={onOpenPage} />)}
    </div>
    {createPortal(<DragOverlay dropAnimation={reducedMotion ? null : { duration: 180, easing: 'cubic-bezier(0.2, 0.8, 0.2, 1)' }} zIndex={100}>
      {active ? <div className="deals-page deal-drag-overlay" aria-hidden="true"><article className="deal-kanban-card"><CardContent record={active} textMode={textMode} overlay handle={<GripVertical size={17} />} /></article></div> : null}
    </DragOverlay>, document.body)}
  </DndContext>;
}
