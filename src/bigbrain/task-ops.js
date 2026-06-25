import fs from 'node:fs/promises';
import path from 'node:path';

import { parseMarkdownPage, slugFromPath } from './markdown.js';
import { assertAllowedPagePath, createBrainPage, normalizePagePath, readBrainPage, safeBrainPath } from './page-ops.js';
import { findActiveMemberByPersonSlug, listActiveMembers, memberMapByPersonSlug, resolveActorMember } from './members.js';

const TASK_STATUSES = ['open', 'waiting', 'blocked', 'done', 'archived'];
const TASK_PRIORITIES = ['p0', 'p1', 'p2', 'p3'];
const TASK_READINESS = ['underspecified', 'ready'];
const COMPLETION_HANDOFF_ERROR = 'Completing a task requires a completion handoff: either Next task: tasks/<slug> or No successor task needed: <reason>.';

export async function listTaskPages({ config, db, assignee = null, status = null, priority = null, readiness = null, actor = null, memberResolution = {} } = {}) {
  const members = await listActiveMembers(db);
  const memberMap = memberMapByPersonSlug(members);
  const assigneeMember = await resolveAssigneeFilter({ db, assignee, actor, memberResolution });
  const hasAssigneeFilter = assignee !== null && assignee !== undefined && String(assignee).trim() !== '';
  const normalizedStatus = status ? normalizeStatus(status) : null;
  const normalizedPriority = priority ? normalizePriority(priority) : null;
  const normalizedReadiness = readiness ? normalizeReadiness(readiness) : null;
  const tasks = await readTaskPages(config, memberMap);
  return tasks
    .filter((task) => !hasAssigneeFilter || task.assignee_slugs.includes(assigneeMember.person_slug))
    .filter((task) => !normalizedStatus || task.status === normalizedStatus)
    .filter((task) => !normalizedPriority || task.priority === normalizedPriority)
    .filter((task) => !normalizedReadiness || task.readiness === normalizedReadiness)
    .sort(compareTasks);
}

export async function createTaskPage({
  config,
  db,
  title,
  body,
  assignees = [],
  status = 'open',
  priority = 'p3',
  readiness = 'underspecified',
  source = [],
  path: taskPath = null,
  timelineEntry = null,
  actor = null,
  memberResolution = {},
} = {}) {
  const normalizedTitle = requireNonEmpty(title, 'title');
  const assigneeSlugs = await normalizeAndValidateAssignees(db, assignees, actor, memberResolution);
  const normalizedStatus = normalizeStatus(status);
  const normalizedPriority = normalizePriority(priority);
  const normalizedReadiness = normalizeReadiness(readiness);
  assertCompletionHandoff({
    nextStatus: normalizedStatus,
    previousStatus: null,
    timelineEntry,
  });
  const slug = taskPath ? normalizeTaskSlug(taskPath) : `tasks/${slugify(normalizedTitle)}`;
  const page = await createBrainPage({
    config,
    pagePath: slug,
    title: normalizedTitle,
    body: requireNonEmpty(body, 'body'),
    timelineEntry: timelineEntry || 'Task created.',
    frontmatter: {
      type: 'task',
      status: normalizedStatus,
      priority: normalizedPriority,
      readiness: normalizedReadiness,
      assignees: assigneeSlugs,
      source: normalizeSlugList(source),
    },
  });
  return decorateTaskPage(page, memberMapByPersonSlug(await listActiveMembers(db)));
}

export async function updateTaskPage({
  config,
  db,
  path: taskPath,
  body = null,
  status = null,
  priority = null,
  readiness = null,
  assignees = null,
  source = null,
  timelineEntry = null,
  actor = null,
  memberResolution = {},
} = {}) {
  const relative = normalizeTaskPagePath(taskPath);
  const fullPath = safeBrainPath(config.brainDir, relative);
  const raw = await fs.readFile(fullPath, 'utf8');
  const parsed = parseMarkdownPage(raw, relative.replace(/\.md$/i, ''));
  const previousStatus = normalizeStatus(parsed.frontmatter.status || 'open');
  const statusProvided = status !== null && status !== undefined;
  const normalizedStatus = statusProvided ? normalizeStatus(status) : previousStatus;
  assertCompletionHandoff({
    nextStatus: normalizedStatus,
    previousStatus,
    timelineEntry,
    isExplicitStatusChange: statusProvided,
  });
  const nextFrontmatter = {
    ...parsed.frontmatter,
    type: parsed.frontmatter.type || 'task',
    status: normalizedStatus,
    priority: priority === null || priority === undefined ? normalizePriority(parsed.frontmatter.priority || 'p3') : normalizePriority(priority),
    readiness: readiness === null || readiness === undefined ? normalizeReadiness(parsed.frontmatter.readiness || 'underspecified') : normalizeReadiness(readiness),
  };
  if (assignees !== null && assignees !== undefined) {
    nextFrontmatter.assignees = await normalizeAndValidateAssignees(db, assignees, actor, memberResolution);
  } else {
    nextFrontmatter.assignees = normalizeSlugList(parsed.frontmatter.assignees);
  }
  if (source !== null && source !== undefined) {
    nextFrontmatter.source = normalizeSlugList(source);
  } else if (parsed.frontmatter.source !== undefined) {
    nextFrontmatter.source = normalizeSlugList(parsed.frontmatter.source);
  }

  const nextBody = body === null || body === undefined ? parsed.compiledTruth : requireNonEmpty(body, 'body');
  const now = new Date().toISOString().slice(0, 10);
  const nextTimeline = appendTimelineEntry(parsed.timeline, timelineEntry || 'Task updated.', now);
  const markdown = renderTaskMarkdown({
    frontmatter: {
      ...nextFrontmatter,
      title: parsed.title,
      created: parsed.frontmatter.created || now,
    },
    title: parsed.title,
    body: nextBody,
    timeline: nextTimeline,
  });
  await fs.writeFile(fullPath, markdown, 'utf8');
  return decorateTaskPage(await readBrainPage({ config, pagePath: relative }), memberMapByPersonSlug(await listActiveMembers(db)));
}

export async function resolveAssigneeFilter({ db, assignee, actor, memberResolution = {} } = {}) {
  const normalized = String(assignee || '').trim();
  if (!normalized || normalized === 'all') return null;
  if (normalized === 'me') {
    const member = await resolveActorMember(db, actor, memberResolution);
    if (!member) throw new Error('The authenticated user is not an active member, so assignee=me cannot be resolved.');
    return member;
  }
  const member = await findActiveMemberByPersonSlug(db, normalized);
  if (!member) throw new Error(`Assignee is not an active member: ${normalized}`);
  return member;
}

async function readTaskPages(config, memberMap) {
  const taskDir = path.join(config.brainDir, 'tasks');
  const files = await listMarkdownFiles(taskDir).catch(() => []);
  const pages = [];
  for (const fullPath of files) {
    if (isTaskDocumentationFile(fullPath)) continue;
    const raw = await fs.readFile(fullPath, 'utf8');
    const slug = slugFromPath(config.brainDir, fullPath);
    const parsed = parseMarkdownPage(raw, slug);
    const stat = await fs.stat(fullPath);
    pages.push(decorateParsedTask(parsed, memberMap, stat.mtime.toISOString()));
  }
  return pages;
}

async function listMarkdownFiles(dir) {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...await listMarkdownFiles(fullPath));
    else if (entry.isFile() && entry.name.endsWith('.md')) files.push(fullPath);
  }
  return files;
}

function isTaskDocumentationFile(fullPath) {
  const basename = path.basename(fullPath).toLowerCase();
  return basename === 'readme.md' || basename === 'filing.md';
}

async function normalizeAndValidateAssignees(db, assignees, actor = null, memberResolution = {}) {
  const slugs = normalizeSlugList(assignees);
  if (!slugs.length) return [];
  const validated = [];
  for (const slug of slugs) {
    const member = slug === 'me' ? await resolveActorMember(db, actor, memberResolution) : await findActiveMemberByPersonSlug(db, slug);
    if (!member) throw new Error(`Task assignee is not an active member: ${slug}`);
    validated.push(member.person_slug);
  }
  return Array.from(new Set(validated));
}

function decorateTaskPage(page, memberMap) {
  const parsed = parseMarkdownPage(page.markdown, page.slug);
  return decorateParsedTask(parsed, memberMap, null, page.path);
}

function decorateParsedTask(parsed, memberMap, updatedAt = null, pagePath = null) {
  const assigneeSlugs = normalizeSlugList(parsed.frontmatter.assignees);
  const status = normalizeStatus(parsed.frontmatter.status || 'open');
  return {
    path: pagePath || `${parsed.slug}.md`,
    slug: parsed.slug,
    title: parsed.title,
    status,
    readiness: normalizeReadiness(parsed.frontmatter.readiness || 'underspecified'),
    completed: status === 'done' || status === 'archived',
    priority: normalizePriority(parsed.frontmatter.priority || 'p3'),
    due: normalizeDateValue(parsed.frontmatter.due),
    assignee_slugs: assigneeSlugs,
    assignees: assigneeSlugs.map((slug) => memberMap.get(slug)).filter(Boolean),
    invalid_assignees: assigneeSlugs.filter((slug) => !memberMap.has(slug)),
    source_slugs: normalizeSlugList(parsed.frontmatter.source),
    body: parsed.compiledTruth,
    timeline: parsed.timeline,
    markdown: parsed.bodyContentMarkdown,
    updated_at: updatedAt,
  };
}

function normalizeTaskSlug(value) {
  const normalized = normalizeTaskPagePath(value).replace(/\.md$/i, '');
  return normalized;
}

function normalizeTaskPagePath(value) {
  const relative = normalizePagePath(value);
  assertAllowedPagePath(relative);
  if (!relative.startsWith('tasks/')) throw new Error('Task path must live under tasks/.');
  return relative;
}

function normalizeSlugList(value) {
  const values = Array.isArray(value) ? value : String(value || '').split(',');
  return values
    .map((entry) => String(entry).trim().replace(/^['"]|['"]$/g, '').replace(/\.md$/i, ''))
    .filter(Boolean);
}

function normalizeStatus(value) {
  const normalized = String(value || '').trim().toLowerCase();
  if (!TASK_STATUSES.includes(normalized)) {
    throw new Error(`Invalid task status: ${value}. Expected one of ${TASK_STATUSES.join(', ')}.`);
  }
  return normalized;
}

function normalizePriority(value) {
  const normalized = String(value || '').trim().toLowerCase();
  if (!TASK_PRIORITIES.includes(normalized)) {
    throw new Error(`Invalid task priority: ${value}. Expected one of ${TASK_PRIORITIES.join(', ')}.`);
  }
  return normalized;
}

function normalizeReadiness(value) {
  const normalized = String(value || '').trim().toLowerCase();
  if (!TASK_READINESS.includes(normalized)) {
    throw new Error(`Invalid task readiness: ${value}. Expected one of ${TASK_READINESS.join(', ')}.`);
  }
  return normalized;
}

function assertCompletionHandoff({
  nextStatus,
  previousStatus = null,
  timelineEntry,
  isExplicitStatusChange = true,
} = {}) {
  if (!isExplicitStatusChange || !isTerminalTaskStatus(nextStatus)) return;
  if (isTerminalTaskStatus(previousStatus)) return;
  const entry = String(timelineEntry || '').trim();
  if (!hasCompletionHandoff(entry)) throw new Error(COMPLETION_HANDOFF_ERROR);
}

function isTerminalTaskStatus(status) {
  return status === 'done' || status === 'archived';
}

function hasCompletionHandoff(text) {
  const value = String(text || '');
  return /\bNext task:\s+tasks\/[a-z0-9][a-z0-9-]*(?:\/[a-z0-9][a-z0-9-]*)*\b/i.test(value)
    || /\bNo successor task needed:\s+\S.+/i.test(value);
}

function normalizeDateValue(value) {
  const text = String(value || '').trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : null;
}

function compareTasks(a, b) {
  return priorityRank(a.priority) - priorityRank(b.priority)
    || dueSortValue(a.due) - dueSortValue(b.due)
    || String(b.updated_at || '').localeCompare(String(a.updated_at || ''))
    || a.slug.localeCompare(b.slug);
}

function priorityRank(priority) {
  return { p0: 0, p1: 1, p2: 2, p3: 3 }[priority] ?? 3;
}

function dueSortValue(due) {
  return due ? Date.parse(`${due}T00:00:00Z`) : Number.MAX_SAFE_INTEGER;
}

function renderTaskMarkdown({ frontmatter, title, body, timeline }) {
  return [
    '---',
    renderFrontmatter(frontmatter),
    '---',
    '',
    normalizeCurrentBody(title, body),
    '',
    '---',
    '',
    '## Timeline',
    '',
    timeline.trim(),
    '',
  ].join('\n');
}

function renderFrontmatter(frontmatter) {
  return Object.entries(frontmatter)
    .filter(([, value]) => value !== undefined && value !== null && !(Array.isArray(value) && value.length === 0))
    .map(([key, value]) => `${key}: ${formatYamlValue(value)}`)
    .join('\n');
}

function formatYamlValue(value) {
  if (Array.isArray(value)) return `[${value.map((item) => String(item)).join(', ')}]`;
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  const text = String(value);
  return /[:#\n]|^\s|\s$/.test(text) ? JSON.stringify(text) : text;
}

function normalizeCurrentBody(title, body) {
  const trimmed = body.trim();
  if (/^#\s+/m.test(trimmed)) return trimmed;
  return [`# ${title}`, '', trimmed].join('\n');
}

function appendTimelineEntry(timeline, entry, date) {
  return [normalizeTimelineEntries(timeline), `- **${date}** | ${entry}`].filter(Boolean).join('\n');
}

function normalizeTimelineEntries(timeline) {
  return String(timeline || '')
    .trim()
    .replace(/^##\s+Timeline\s*/i, '')
    .trim();
}

function slugify(value) {
  const slug = String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug || `task-${Date.now()}`;
}

function requireNonEmpty(value, fieldName) {
  const text = String(value || '').trim();
  if (!text) throw new Error(`${fieldName} is required.`);
  return text;
}
