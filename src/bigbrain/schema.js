import path from 'node:path';

import { CANONICAL_SCHEMA_DIRS, PAGE_REQUIRED_TIMELINE_TYPES } from './constants.js';

const FOLDER_RULES = [
  ['people', 'One page per human being. File by the person as the primary subject.'],
  ['companies', 'One page per organization or company.'],
  ['deals', 'Transactions, fundraising, and investment items with terms or decisions.'],
  ['meetings', 'Specific meetings, calls, or transcripts.'],
  ['projects', 'Actively built execution tracks with a repo, spec, or team.'],
  ['ideas', 'Unbuilt possibilities that are not yet active projects.'],
  ['personal-protocol', 'Personal operating instructions, preferences, and repeatable how-to pages.'],
  ['concepts', 'Reusable mental models, frameworks, and general strategy.'],
  ['writing', 'Prose artifacts, drafts, and essay-style outputs.'],
  ['sources', 'Raw imports, archived snapshots, and source material.'],
  ['tasks', 'One page per assignable task, with member-backed assignees and task metadata.'],
  ['inbox', 'Temporary unsorted captures when no canonical home is clear yet.'],
  ['archive', 'Historical or dead pages that should not stay active.'],
  ['dreams', 'Reserved for later dream-cycle outputs; not active in v1.'],
  ['ops', 'Operational notes such as roadmaps, contribution rules, server notes, MCP notes, and cross-workstream coordination.'],
];

export function schemaDescription() {
  return {
    directories: FOLDER_RULES.map(([name, purpose]) => ({ name, purpose })),
    page_shape: [
      'YAML frontmatter',
      'Title and short executive summary',
      'Compiled truth / current state / key context',
      'Open threads where relevant',
      '---',
      'Append-only timeline / evidence log',
    ],
    meeting_page_shape: [
      'YAML frontmatter',
      'Title and meeting metadata',
      'Optional Prep section with Context and Meeting Plan',
      'Structured meeting sections such as Summary, Key Decisions, Action Items, and Discussion Notes',
      'Separator and timeline are optional for meetings',
    ],
    raw_attachment_shape: [
      '<collection>/<page-slug>.md',
      '<collection>/.raw/<filename>',
      'raw attached files such as pdf/png/pptx/xlsx/txt stay outside the indexed page graph',
      'the markdown page carries searchable context and links to the raw file',
      'sources/.raw is for evidence-first uploads without a clearer canonical subject',
      'do not nest page-slug folders or any other folders inside .raw',
    ],
    task_page_shape: {
      path: 'tasks/<task-slug>.md',
      slug: 'concise stable human-readable identifier; it does not need to match the title',
      frontmatter: {
        type: 'task',
        status: ['open', 'in_progress', 'waiting', 'done', 'archived'],
        readiness: ['underspecified', 'ready'],
        execution_mode: ['agent', 'user', 'interactive'],
        priority: ['p0', 'p1', 'p2', 'p3'],
        assignees: 'active member person slugs',
        source: 'related brain slugs',
        due: 'optional YYYY-MM-DD',
      },
      body: 'current task context above --- plus append-only ## Timeline evidence log',
    },
    notes: [
      'Compiled truth lives above --- and gets rewritten as understanding changes.',
      'Timeline lives below --- and is append-only evidence.',
      'Use relative markdown links instead of duplicate pages.',
      'Raw attachments live under per-collection .raw/ directories and are not canonical brain pages.',
      'Task pages live under tasks/*.md; do not use ops/tasks.md.',
      'Use the filing_rules tool as the operational source of truth for the active brain.',
      'Repo documentation pages such as README.md and FILING.md files should be excluded from indexing and strict brain-page validation.',
    ],
  };
}

export function renderSchemaMarkdown() {
  const lines = ['# Bigbrain Schema', '', '## Directory Structure', ''];
  for (const [name, purpose] of FOLDER_RULES) {
    lines.push(`- \`${name}/\` — ${purpose}`);
  }
  lines.push(
    '',
    '## Page Shape',
    '',
    '1. YAML frontmatter',
    '2. Title and short executive summary',
    '3. Compiled truth / current state / key context',
    '4. Open threads where relevant',
    '5. `---`',
    '6. Append-only timeline / evidence log',
    '',
    '## Meeting Page Shape',
    '',
    '1. YAML frontmatter',
    '2. Title and meeting metadata',
    '3. Optional `## Prep` with `### Context` and `### Meeting Plan`',
    '4. Structured meeting sections such as `## Summary`, `## Key Decisions`, `## Action Items`, and `## Discussion Notes`',
    '5. `---` and `## Timeline` are optional for meetings',
    '',
    'Raw transcript dumps belong under the meeting collection `.raw/` folder, not as standalone brain pages.',
    '',
    '## Raw Attachment Shape',
    '',
    '```text',
    '<collection>/<page-slug>.md',
    '<collection>/.raw/<filename>',
    '```',
    '',
    '- Raw attachments are supporting files, not full entity pages.',
    '- Canonical pages link outward to raw attachments.',
    '- The markdown page remains the searchable context surface.',
    '- Use `sources/.raw/` for evidence-first uploads without a clearer canonical subject.',
    '- Do not nest page-slug folders or any other folders inside `.raw`; use collision-safe filenames.',
    '- The `filing_rules` tool is the operational source of truth for the active brain.',
    '',
    '## Task Page Shape',
    '',
    '```yaml',
    '---',
    'type: task',
    'title: Follow up on proposal',
    'status: open',
    'priority: p1',
    'readiness: underspecified',
    'execution_mode: agent',
    'assignees: [people/hani]',
    'source: [meetings/proposal-review]',
    'due: 2026-07-01',
    '---',
    '```',
    '',
    '- Path pattern: `tasks/<task-slug>.md`.',
    '- The task slug is a concise, stable, human-readable identifier; it does not need to match or mirror the full task title.',
    '- `status` must be one of `open`, `in_progress`, `waiting`, `done`, `archived`.',
    '- `open` means known work that is not actively being worked.',
    '- `in_progress` means active work currently underway.',
    '- `waiting` means work paused on an external dependency, reply, approval, access, or date.',
    '- `done` means completed work; `archived` means intentionally closed work.',
    '- `priority` must be one of `p0`, `p1`, `p2`, `p3`.',
    '- `readiness` must be one of `underspecified` or `ready`; default to `underspecified` while context, owner, next action, or completion criteria are missing.',
    '- `ready` means enough context and acceptance criteria exist for a person or agent to execute without another clarification round.',
    '- `execution_mode` must be one of `agent`, `user`, or `interactive`.',
    '- `agent` means an autonomous agent can execute the task; `user` means the user must personally do it; `interactive` means an agent can help only by walking the user through input or review.',
    '- Status and readiness are independent: a task can be `open` but `underspecified`, or `in_progress` and `ready`.',
    '- `assignees` must be active member person slugs; arbitrary `people/*` pages are not assignable.',
    '- `source` links the task to supporting brain pages such as meetings, projects, or inbox notes.',
    '- `due` is optional and must be `YYYY-MM-DD` when present.',
    '- Keep current task context above `---` and append evidence or state changes under `## Timeline`.',
    '- Structure current task context with `## Summary`, `## What Counts as Completed`, `## Body Context`, `## Open Questions`, and `## Anti-Patterns`.',
    '- When marking a task `done` or `archived`, include a completion handoff in the timeline: either `Next task: tasks/<slug>` or `No successor task needed: <reason>`.',
    '- Use MCP `tasks/create` and `tasks/update` for task writes when available.',
    '- Do not use `ops/tasks.md` or maintain a single-file task list.',
    '',
    '## Filing Rules',
    '',
    '- File by primary subject, not by source or format.',
    '- Use cross-links instead of duplicate pages.',
    '- Use `inbox/` when a page does not clearly fit yet.',
    '- Store attached files under per-collection `.raw/` directories, not directly in entity directories.',
    '- Repo documentation pages such as directory `README.md` and `FILING.md` files are not canonical brain pages and should be excluded from indexing.',
  );
  return `${lines.join('\n')}\n`;
}

export function recommendFolderForInput(input) {
  const text = String(input).trim();
  const lower = text.toLowerCase();

  if (/meeting|call|transcript|sync|prep/.test(lower)) return recommendation('meetings', text, 'the primary subject is a specific meeting or call');
  if (/deal|acquisition|investor|fundraise|teaser|valuation/.test(lower)) return recommendation('deals', text, 'the primary subject is a transaction or financing item');
  if (/draft|essay|writeup|proposal|memo|article/.test(lower)) return recommendation('writing', text, 'the primary subject is a prose artifact');
  if (/protocol|preference|operating instruction|how to|how-to|playbook for me|calendar organization|personal rule/.test(lower)) return recommendation('personal-protocol', text, 'the item reads like a personal operating preference or repeatable protocol');
  if (/framework|mental model|thesis|playbook|strategy|concept/.test(lower)) return recommendation('concepts', text, 'the primary subject is a reusable concept or framework');
  if (/idea|possibility|someday|explore/.test(lower)) return recommendation('ideas', text, 'the item sounds like an unbuilt possibility');
  if (/task|todo|to-do|follow[- ]?up|next action|action item|blocked|waiting/.test(lower)) return recommendation('tasks', text, 'the item reads like assignable work');
  if (/project|build|launch|roadmap|implementation/.test(lower)) return recommendation('projects', text, 'the item sounds like an active execution track');
  if (/company|inc\.|llc|firm|organization/.test(lower)) return recommendation('companies', text, 'the primary subject appears to be an organization');
  if (/source|raw|import|email|pdf|screenshot|snapshot/.test(lower)) return recommendation('sources', text, 'the item reads like raw source material');
  return recommendation('inbox', text, 'no higher-confidence canonical home was obvious');
}

export function validatePageShape(parsedPage) {
  if (isRepoDocumentationPage(parsedPage.slug)) return [];

  const findings = [];
  if (!parsedPage.hasFrontmatter) findings.push({ type: 'missing_frontmatter' });
  if (!parsedPage.title) findings.push({ type: 'missing_title' });
  if (!parsedPage.compiledTruth.trim()) findings.push({ type: 'missing_compiled_truth' });
  if (requiresSeparator(parsedPage) && !parsedPage.hasSeparator) findings.push({ type: 'missing_separator' });
  if (PAGE_REQUIRED_TIMELINE_TYPES.has(parsedPage.type) && !parsedPage.timeline.trim()) findings.push({ type: 'missing_timeline' });
  if (parsedPage.type === 'meetings') findings.push(...validateMeetingPage(parsedPage));
  return findings;
}

function requiresSeparator(parsedPage) {
  return parsedPage.type !== 'meetings';
}

function isRepoDocumentationPage(slug) {
  return path.posix.basename(slug).toLowerCase() === 'readme';
}

function validateMeetingPage(parsedPage) {
  const findings = [];
  const outline = extractMeetingOutline(parsedPage.compiledTruth);
  const requiredSections = ['Summary', 'Key Decisions', 'Action Items', 'Discussion Notes'];
  const missingSections = requiredSections.filter((section) => !outline.topNormalized.includes(normalizeHeading(section)));

  if (missingSections.length > 0) {
    findings.push({
      type: 'missing_meeting_heading',
      details: {
        missing: missingSections,
        found: outline.topHeadings,
      },
    });
  }

  const hasPrep = outline.topNormalized.includes('prep');
  const misplacedPrepSubheadings = outline.topHeadings.filter((heading) => {
    const normalized = normalizeHeading(heading);
    return normalized === 'context' || normalized === 'meeting plan';
  });

  if (!hasPrep && misplacedPrepSubheadings.length > 0) {
    findings.push({
      type: 'invalid_meeting_prep_structure',
      details: {
        message: 'Context and Meeting Plan should live under ## Prep, not as top-level headings.',
        found: misplacedPrepSubheadings,
      },
    });
  }

  if (hasPrep) {
    const prepSubheadings = outline.subheadingsBySection.get('prep') || [];
    const prepSubNormalized = prepSubheadings.map(normalizeHeading);
    const requiredPrepSubheadings = ['Context', 'Meeting Plan'];
    const missingPrepSubheadings = requiredPrepSubheadings.filter((heading) => !prepSubNormalized.includes(normalizeHeading(heading)));
    const unexpectedPrepSubheadings = prepSubheadings.filter((heading) => !requiredPrepSubheadings.some((required) => normalizeHeading(required) === normalizeHeading(heading)));

    if (missingPrepSubheadings.length > 0 || unexpectedPrepSubheadings.length > 0) {
      findings.push({
        type: 'invalid_meeting_prep_heading',
        details: {
          required: requiredPrepSubheadings,
          missing: missingPrepSubheadings,
          found: prepSubheadings,
          unexpected: unexpectedPrepSubheadings,
        },
      });
    }
  }

  return findings;
}

function extractMeetingOutline(markdown) {
  const topHeadings = [];
  const topNormalized = [];
  const subheadingsBySection = new Map();
  let currentTopSection = null;

  for (const line of markdown.split('\n')) {
    const topMatch = line.match(/^##\s+(.+?)\s*$/);
    if (topMatch) {
      const heading = cleanHeading(topMatch[1]);
      const normalized = normalizeHeading(heading);
      currentTopSection = normalized;
      topHeadings.push(heading);
      topNormalized.push(normalized);
      if (!subheadingsBySection.has(normalized)) subheadingsBySection.set(normalized, []);
      continue;
    }

    const subMatch = line.match(/^###\s+(.+?)\s*$/);
    if (subMatch && currentTopSection) {
      subheadingsBySection.get(currentTopSection).push(cleanHeading(subMatch[1]));
    }
  }

  return { topHeadings, topNormalized, subheadingsBySection };
}

function cleanHeading(value) {
  return value.trim().replace(/\s+/g, ' ');
}

function normalizeHeading(value) {
  return cleanHeading(value).toLowerCase();
}

function recommendation(folder, input, reason) {
  const slug = slugify(path.basename(input).replace(/\.md$/i, '') || input);
  return {
    folder,
    relative_path: `${folder}/${slug || 'new-page'}.md`,
    reason,
  };
}

function slugify(value) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

export { CANONICAL_SCHEMA_DIRS };
