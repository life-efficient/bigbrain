import React, { useEffect, useState } from 'react';

const DEFAULT_CADENCE_DAYS = 7;
const DEFAULT_PRIORITY = 3;
const DEFAULT_STAGE = 'building';

export function KeepInTouchPanel({ onOpenPerson }) {
  const [state, setState] = useState({ status: 'loading', data: null, error: null });
  const [enrollOpen, setEnrollOpen] = useState(false);
  const [candidateSearch, setCandidateSearch] = useState('');
  const [workingKey, setWorkingKey] = useState('');

  async function load() {
    setState((current) => ({ ...current, status: 'loading', error: null }));
    try {
      const data = await fetchJson('/api/overlays/keep-in-touch');
      setState({ status: 'ready', data, error: null });
    } catch (error) {
      setState({ status: 'error', data: null, error: error instanceof Error ? error.message : String(error) });
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function submitAction(action, key, body) {
    setWorkingKey(key);
    try {
      await fetchJson(`/api/overlays/keep-in-touch/${action}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      await load();
      if (action === 'enroll') {
        setEnrollOpen(false);
        setCandidateSearch('');
      }
    } catch (error) {
      setState((current) => ({
        ...current,
        status: 'error',
        error: error instanceof Error ? error.message : String(error),
      }));
    } finally {
      setWorkingKey('');
    }
  }

  if (state.status === 'loading') {
    return <section className="overlay-page"><ListLoadingState label="Loading Keep in Touch" /></section>;
  }

  if (state.status === 'error') {
    return (
      <section className="overlay-page">
        <div className="overlay-error card">
          <span className="eyebrow">Keep in Touch</span>
          <h1>Overlay unavailable</h1>
          <p>{state.error}</p>
          <button type="button" className="graph-button" onClick={load}>Retry</button>
        </div>
      </section>
    );
  }

  const data = state.data || {};
  const records = Array.isArray(data.records) ? data.records : [];
  const people = Array.isArray(data.people) ? data.people : [];
  const needle = candidateSearch.trim().toLowerCase();
  const filteredPeople = people
    .filter((person) => !needle || `${person.title} ${person.slug}`.toLowerCase().includes(needle))
    .slice(0, 20);
  const enrolledSlugs = new Set(records.map((record) => record.page_slug));
  const dueCount = records.filter((record) => record.is_due).length;
  const overdueCount = records.filter((record) => record.is_overdue).length;

  return (
    <section className="overlay-page keep-in-touch-page">
      <div className="overlay-head">
        <div>
          <span className="eyebrow">Overlay · People</span>
          <h1>Keep in Touch</h1>
          <p>A small queue for relationships that deserve a deliberate next touch.</p>
        </div>
        <button type="button" className="graph-button overlay-primary-action" onClick={() => setEnrollOpen((value) => !value)}>
          {enrollOpen ? 'Close enrollment' : 'Enroll someone'}
        </button>
      </div>

      <div className="overlay-metrics">
        <Metric label="Due now" value={dueCount} tone={dueCount ? 'warm' : 'quiet'} />
        <Metric label="Overdue" value={overdueCount} tone={overdueCount ? 'alert' : 'quiet'} />
        <Metric label="Enrolled" value={records.length} tone="quiet" />
      </div>

      {enrollOpen ? (
        <div className="overlay-enroll card">
          <div className="overlay-section-head">
            <div>
              <span className="eyebrow">Add a relationship</span>
              <h2>Choose someone from this Brain</h2>
            </div>
            <span className="meta">No page fields are changed</span>
          </div>
          <input
            className="overlay-search"
            type="search"
            value={candidateSearch}
            onChange={(event) => setCandidateSearch(event.target.value)}
            placeholder="Search people…"
            aria-label="Search people to enroll"
            autoFocus
          />
          <div className="overlay-candidate-list">
            {filteredPeople.map((person) => {
              const enrolled = enrolledSlugs.has(person.slug);
              const key = `enroll:${person.slug}`;
              return (
                <div className="overlay-candidate" key={person.slug}>
                  <div className="overlay-candidate-copy">
                    <strong>{person.title || person.slug}</strong>
                    <span>{person.slug}</span>
                  </div>
                  <button
                    type="button"
                    className="overlay-small-button"
                    disabled={enrolled || workingKey === key}
                    onClick={() => submitAction('enroll', key, {
                      page_slug: person.slug,
                      priority: DEFAULT_PRIORITY,
                      stage: DEFAULT_STAGE,
                      cadence_days: DEFAULT_CADENCE_DAYS,
                      next_due_at: new Date().toISOString(),
                    })}
                  >
                    {enrolled ? 'Enrolled' : workingKey === key ? 'Adding…' : 'Enroll'}
                  </button>
                </div>
              );
            })}
            {!filteredPeople.length ? <div className="empty-copy">No matching people found.</div> : null}
          </div>
        </div>
      ) : null}

      <div className="overlay-queue-head">
        <div>
          <span className="eyebrow">Relationship queue</span>
          <h2>{records.length ? 'Your current queue' : 'Nothing enrolled yet'}</h2>
        </div>
        {records.length ? <span className="meta">Sorted by priority, then due date</span> : null}
      </div>

      {records.length ? (
        <div className="overlay-record-list">
          {records.map((record) => (
            <KeepInTouchRecord
              key={record.page_slug}
              record={record}
              workingKey={workingKey}
              onOpenPerson={onOpenPerson}
              onAction={submitAction}
            />
          ))}
        </div>
      ) : (
        <div className="overlay-empty card">
          <div className="overlay-empty-mark" aria-hidden="true">↗</div>
          <div>
            <h2>Start with one real relationship</h2>
            <p>Enroll someone you want to follow up with. Their Keep in Touch state will live alongside the Brain, without changing their page.</p>
          </div>
          <button type="button" className="graph-button" onClick={() => setEnrollOpen(true)}>Choose someone</button>
        </div>
      )}
    </section>
  );
}

function KeepInTouchRecord({ record, workingKey, onOpenPerson, onAction }) {
  const priority = normalizePriority(record.priority);
  const dueLabel = record.is_overdue
    ? `${Math.max(1, Number(record.overdue_days || 1))}d overdue`
    : record.is_due
      ? 'Due today'
      : `Due ${formatDate(record.next_due_at)}`;
  const contactKey = `contact:${record.page_slug}`;
  const snoozeKey = `snooze:${record.page_slug}`;
  const priorityKey = (next) => `priority:${record.page_slug}:${next}`;

  return (
    <article className={`overlay-record card ${record.is_overdue ? 'is-overdue' : record.is_due ? 'is-due' : ''}`}>
      <div className="overlay-record-main">
        <div className="overlay-record-title-row">
          <button type="button" className="overlay-person-link" onClick={() => onOpenPerson?.(record.page_slug)}>
            {record.title || record.page_slug}
          </button>
          <span className={`overlay-priority priority-${priority}`}>P{priority}</span>
        </div>
        <div className="overlay-record-meta">
          <span className={record.is_overdue ? 'overlay-due overdue' : record.is_due ? 'overlay-due due' : 'overlay-due'}>{dueLabel}</span>
          <span>{record.stage || 'building'}</span>
          <span>Every {record.cadence_days || DEFAULT_CADENCE_DAYS}d</span>
          {record.last_contacted_at ? <span>Last touch {formatDate(record.last_contacted_at)}</span> : <span>Not contacted yet</span>}
        </div>
        {record.summary ? <p className="overlay-record-summary">{record.summary}</p> : null}
      </div>
      <div className="overlay-record-actions">
        <button
          type="button"
          className="graph-button overlay-action-primary"
          disabled={workingKey === contactKey}
          onClick={() => onAction('log-contact', contactKey, { page_slug: record.page_slug })}
        >
          {workingKey === contactKey ? 'Saving…' : 'Mark contacted'}
        </button>
        <button
          type="button"
          className="overlay-small-button"
          disabled={workingKey === snoozeKey}
          onClick={() => onAction('snooze', snoozeKey, { page_slug: record.page_slug, days: 7 })}
        >
          {workingKey === snoozeKey ? 'Saving…' : 'Snooze 7d'}
        </button>
        <div className="overlay-priority-picker" aria-label={`Set priority for ${record.title || record.page_slug}`}>
          {[1, 2, 3, 4, 5].map((value) => (
            <button
              key={value}
              type="button"
              className={value === priority ? 'selected' : ''}
              disabled={workingKey === priorityKey(value)}
              onClick={() => onAction('set-priority', priorityKey(value), { page_slug: record.page_slug, priority: value })}
            >
              P{value}
            </button>
          ))}
        </div>
      </div>
    </article>
  );
}

function Metric({ label, value, tone }) {
  return <div className={`overlay-metric tone-${tone}`}><span>{label}</span><strong>{value}</strong></div>;
}

function normalizePriority(value) {
  const number = Number(value);
  return Number.isInteger(number) && number >= 1 && number <= 5 ? number : DEFAULT_PRIORITY;
}

function formatDate(value) {
  if (!value) return 'not set';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'not set';
  return new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' }).format(date);
}

async function fetchJson(url, options) {
  const response = await fetch(url, options);
  if (!response.ok) throw new Error(`${url} failed with ${response.status}`);
  return response.json();
}

function ListLoadingState({ label }) {
  return <div className="list-loading-state" role="status" aria-live="polite"><span className="loading-spinner" aria-hidden="true" /><span>{label}</span></div>;
}
