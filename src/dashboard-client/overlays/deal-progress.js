export const DEAL_TYPE_LABELS = {
  capital_raise: 'Capital raise', acquisition: 'Acquisition', compute_brokerage: 'Compute brokerage',
  customer_introduction: 'Customer introduction', commercial_partnership: 'Commercial partnership',
  advisory: 'Advisory', other: 'Other',
};
export const DEAL_STAGE_LABELS = {
  unknown: 'Stage not established', qualifying: 'Qualifying', preparing: 'Preparing',
  seeking_counterparties: 'Seeking counterparties', negotiating: 'Negotiating', closing: 'Closing',
  delivering: 'Delivering', completed: 'Completed', paused: 'Paused', dropped: 'Dropped',
};
export const INTRODUCTION_STAGE_LABELS = {
  unknown: 'Stage not established', candidate: 'Candidate', proposed: 'Introduction proposed',
  introduced: 'Introduced', discussing: 'Discussing', negotiating: 'Negotiating', agreed: 'Agreed',
  delivering: 'Delivering', completed: 'Completed', paused: 'Paused', declined: 'Declined',
};
export const TASK_STATUS_LABELS = { open: 'Open', in_progress: 'In progress', waiting: 'Waiting' };

export function pageReference(value) {
  const page_slug = typeof value === 'string' ? value : value?.page_slug;
  if (!page_slug) return null;
  return { page_slug, title: (typeof value === 'object' && value.title) || page_slug.split('/').at(-1).replace(/[-_]/g, ' ') };
}

export function activeDealTasks(tasks) {
  return (Array.isArray(tasks) ? tasks : []).filter(task => task?.page_slug && !['done', 'archived'].includes(task.status));
}

export function progressDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}(?:T|$)/.test(value)) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }).format(date);
}

function taskSearchText(task) {
  return [task.title, TASK_STATUS_LABELS[task.status], ...(task.assignees || []).map(ref => pageReference(ref)?.title),
    ...(task.waiting_on || []).map(ref => pageReference(ref)?.title)].join(' ');
}

export function matchesDealFilters(record, { search = '', dealType = '', stage = '' } = {}) {
  if (dealType && !(record.deal_types || []).includes(dealType)) return false;
  if (stage && (record.deal_stage || 'unknown') !== stage) return false;
  const needle = search.trim().toLowerCase();
  if (!needle) return true;
  const text = [record.title, record.summary, record.page_slug, record.anonymised_title, record.anonymised_description,
    ...(Array.isArray(record.anonymised_asks) ? record.anonymised_asks : []),
    ...(record.deal_types || []).map(type => DEAL_TYPE_LABELS[type]), DEAL_STAGE_LABELS[record.deal_stage || 'unknown'],
    ...activeDealTasks(record.tasks).map(taskSearchText),
    ...(record.introductions || []).map(introduction => [introduction.title, introduction.summary, introduction.purpose,
      INTRODUCTION_STAGE_LABELS[introduction.stage || 'unknown'], ...(introduction.parties || []).map(ref => pageReference(ref)?.title),
      ...activeDealTasks(introduction.tasks).map(taskSearchText)].join(' ')),
  ].join(' ').toLowerCase();
  return text.includes(needle);
}

export function matchesIntroductionFilters(introduction, { search = '', stage = '' } = {}) {
  if (stage && (introduction.stage || 'unknown') !== stage) return false;
  const needle = search.trim().toLowerCase();
  if (!needle) return true;
  return [introduction.title, introduction.summary, introduction.purpose,
    pageReference(introduction.parent_deal || introduction.deal)?.title,
    INTRODUCTION_STAGE_LABELS[introduction.stage || 'unknown'],
    ...(introduction.parties || []).map(ref => pageReference(ref)?.title),
    ...activeDealTasks(introduction.tasks).map(taskSearchText),
  ].join(' ').toLowerCase().includes(needle);
}
