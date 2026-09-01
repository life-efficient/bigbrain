import path from 'node:path';

import { CANONICAL_SCHEMA_DIRS } from './constants.js';

const FOLDER_RULES = [
  ['people', 'One page per human being. File by the person as the primary subject.'],
  ['organizations', 'One page per company, institution, fund, vendor, partner, government body, university, nonprofit, or other non-person entity.'],
  ['deals', 'Transactions, acquisitions, raises, investments, mandates, opportunities, diligence, valuation, buyer/investor processes, and deal-owned artifacts.'],
  ['projects', 'Actively built execution tracks with a repo, spec, or team.'],
  ['ideas', 'Unbuilt possibilities that are not yet active projects.'],
  ['meetings', 'Specific meetings, calls, prep, transcripts, decisions, and action-item context.'],
  ['tasks', 'One page per assignable task, with member-backed assignees and task metadata.'],
  ['concepts', 'Reusable mental models, frameworks, and general strategy.'],
  ['writing', 'Prose artifacts, drafts, and essay-style outputs.'],
  ['protocol', 'Repeatable operating rules, preferences, processes, playbooks, and how-things-should-work guidance.'],
  ['archive', 'Historical or dead pages that should not stay active.'],
];

export function schemaDescription() {
  return {
    directories: FOLDER_RULES.map(([name, purpose]) => ({ name, purpose })),
    page_shape: [
      'YAML frontmatter',
      'Title',
      'One concise opening compiled-truth paragraph',
      'Additional current-context sections; assignable work belongs in tasks/',
      '--- followed by ## Timeline',
      'Append-only structured timeline / evidence log',
    ],
    raw_attachment_shape: [
      '<collection>/<page-slug>.md',
      '<collection>/.raw/<filename>',
      'raw attached files such as pdf/png/pptx/xlsx/txt stay outside the indexed page graph',
      'the markdown page carries searchable context and links to the raw file',
      'legacy sources/.raw folders remain readable, but new raw files should use the owning collection .raw folder',
      'do not nest page-slug folders or any other folders inside .raw',
    ],
    task_page_shape: {
      path: 'tasks/<task-slug>.md',
      slug: 'concise stable human-readable identifier; it does not need to match the title',
      frontmatter: {
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
    timeline_entry: {
      occurred_at: 'YYYY-MM-DD or ISO timestamp for when the underlying event happened; defaults to now and may be overridden for historical ingestion',
      recorded_at: 'ISO timestamp for when BigBrain recorded the entry; defaults to the actual write time',
      text: 'human-readable durable update',
      provenance: 'source event metadata for this entry, including event_id, source_type, source_label, and optional source URL/listener/raw reference',
      significance: ['patch', 'minor', 'major'],
      ordering: 'entries render newest occurred_at first; equal timestamps retain stable input order',
    },
    notes: [
      'Compiled truth lives above --- and gets rewritten as understanding changes.',
      'Timeline lives below --- and is append-only evidence.',
      'Timeline entries carry occurred_at, recorded_at, text, per-entry provenance, and optional significance; new entries render newest first.',
      'Source attribution belongs to the timeline entry that it caused, not to mutable page-level source frontmatter.',
      'Use relative markdown links instead of duplicate pages.',
      'Raw binaries live under per-collection .raw/ directories; each valuable artifact has one same-basename indexed Markdown attachment sidecar.',
      'Task pages live under tasks/*.md; do not use ops/tasks.md.',
      'Create or update a task by default when new intake is actionable, needs an owner, needs status, or is a follow-up.',
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
    '2. Title',
    '3. One concise opening compiled-truth paragraph',
    '4. Additional current-context sections; assignable work belongs in `tasks/`',
    '5. `---` followed by `## Timeline`',
    '6. Append-only structured timeline / evidence log',
    '',
    'Raw transcript dumps belong under the meeting collection `.raw/` folder, not as standalone brain pages.',
    '',
    '## Raw Attachment Shape',
    '',
    '```text',
    '<collection>/.raw/<filename>',
    '<collection>/.raw/<basename>.md',
    '```',
    '',
    '- Every valuable raw artifact has exactly one same-basename indexed Markdown attachment sidecar.',
    '- Sidecars may contain comprehensive extraction, synthesis, links, timelines, visibility, and group metadata.',
    '- Raw binaries are never indexed directly; subject pages link to the attachment sidecar and artifact.',
    '- Public attachment-sidecar routes render the artifact while the sidecar Markdown remains private and searchable.',
    '- Use the owning collection `.raw/` folder for raw attachments; `sources/.raw/` is legacy or domain-specific evidence storage, not the generic default.',
    '- Do not nest page-slug folders or any other folders inside `.raw`; use collision-safe filenames.',
    '- The `filing_rules` tool is the operational source of truth for the active brain.',
    '- Timeline entries carry occurred_at, recorded_at, text, per-entry provenance, and optional significance; new entries render newest first.',
    '- Source attribution belongs to the timeline entry that it caused, not to mutable page-level source frontmatter.',
    '',
    '## Task Page Shape',
    '',
    '```yaml',
    '---',
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
    '- Task identity is derived from the `tasks/` path; legacy `type: task` frontmatter may appear, but it is optional and not used for behavior.',
    '- The task slug is a concise, stable, human-readable identifier; it does not need to match or mirror the full task title.',
    '- `status` must be one of `open`, `in_progress`, `waiting`, `done`, `archived`.',
    '- `open` means known work that is not actively being worked.',
    '- `in_progress` means active work currently underway.',
    '- `waiting` means work paused on an external dependency, reply, approval, access, or date.',
    '- `done` means completed work; `archived` means intentionally closed work.',
    '- `priority` must be one of `p0`, `p1`, `p2`, `p3`.',
    '- `readiness` must be one of `underspecified` or `ready`; treat it as an agent-authored handoff hint, not a schema-enforced permission gate.',
    '- Use `ready` when the task appears specified enough to work, and `underspecified` when it clearly needs more context before useful work can start.',
    '- Open questions in the task body should influence what’s-next and fanout presentation even when frontmatter says `ready`.',
    '- `execution_mode` must be one of `agent`, `user`, or `interactive`.',
    '- `agent` means Codex or another agent can complete the task autonomously with the available context, tools, and files, without missing information, personal judgement, external approval, or a real-world-only action.',
    '- `interactive` means Codex can advance the task but needs the user\'s judgement, preferences, review, or decisions along the way; guided prompts should walk the user through the work step by step and pause at decision points.',
    '- `user` means the task requires a real-world action Codex cannot meaningfully perform, such as sending a personal WhatsApp, conducting a meeting, signing a physical document, or obtaining approval.',
    '- If uncertain between `agent` and `interactive`, prefer `interactive`; if uncertain between `interactive` and `user`, use `interactive` when Codex can still structure or guide the work.',
    '- Status and readiness are independent: a task can be `open` but `underspecified`, or `in_progress` and `ready`.',
    '- `assignees` must be active member person slugs; arbitrary `people/*` pages are not assignable.',
    '- `source` links the task to supporting brain pages such as meetings, projects, writing, protocol, source overlays, or legacy inbox notes.',
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
    '- Use `tasks/` for actionable work by default; use canonical subject pages or owning collection `.raw/` folders for durable knowledge and evidence.',
    '- Treat `inbox/`, `sources/`, and `ops/` as legacy or domain-specific overlays, not generic default destinations.',
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
  if (/protocol|preference|operating instruction|how to|how-to|playbook for me|calendar organization|personal rule|process|operating rule/.test(lower)) return recommendation('protocol', text, 'the item reads like an operating preference, repeatable process, or protocol');
  if (/framework|mental model|thesis|playbook|strategy|concept/.test(lower)) return recommendation('concepts', text, 'the primary subject is a reusable concept or framework');
  if (/idea|possibility|someday|explore/.test(lower)) return recommendation('ideas', text, 'the item sounds like an unbuilt possibility');
  if (/task|todo|to-do|follow[- ]?up|next action|action item|blocked|waiting/.test(lower)) return recommendation('tasks', text, 'the item reads like assignable work');
  if (/project|build|launch|roadmap|implementation/.test(lower)) return recommendation('projects', text, 'the item sounds like an active execution track');
  if (/company|inc\.|llc|firm|organization|institution|vendor|partner|university|fund|government body/.test(lower)) return recommendation('organizations', text, 'the primary subject appears to be an organization');
  if (/source|raw|import|email|pdf|screenshot|snapshot/.test(lower)) return recommendation('writing', text, 'the item appears to be evidence-first material without a clear owning collection; preserve raw files under the owning collection .raw folder once ownership is clear');
  return recommendation('ideas', text, 'no higher-confidence canonical home was obvious; use tasks/ instead if this is actionable work');
}

export function validatePageShape(parsedPage) {
  if (isRepoDocumentationPage(parsedPage.slug)) return [];

  const findings = [];
  if (!parsedPage.hasFrontmatter) findings.push({ type: 'missing_frontmatter' });
  if (!parsedPage.title) findings.push({ type: 'missing_title' });
  if (!parsedPage.compiledTruth.trim()) findings.push({ type: 'missing_compiled_truth' });
  if (!parsedPage.hasSeparator) findings.push({ type: 'missing_separator' });
  if (!hasTimelineEvidence(parsedPage)) findings.push({ type: 'missing_timeline' });
  if (parsedPage.timeline_clean === false) findings.push({ type: 'invalid_timeline' });
  if (parsedPage.timelineBoundaryCount > 1 || parsedPage.timelineHeadingCount > 1) {
    findings.push({
      type: 'duplicate_timeline',
      details: {
        boundaries: parsedPage.timelineBoundaryCount,
        headings: parsedPage.timelineHeadingCount,
      },
    });
  }
  return findings;
}

export function isAttachmentSidecarSlug(slug) {
  const parts = String(slug || '').split('/');
  return parts.length === 3 && parts[1] === '.raw';
}

function isRepoDocumentationPage(slug) {
  return path.posix.basename(slug).toLowerCase() === 'readme';
}

function hasTimelineEvidence(parsedPage) {
  return String(parsedPage.timeline || '')
    .replace(/^##\s+(?:Timeline|History)\s*\n?/i, '')
    .trim().length > 0;
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
