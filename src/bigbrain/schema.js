import path from 'node:path';

import { CANONICAL_SCHEMA_DIRS, PAGE_REQUIRED_TIMELINE_TYPES } from './constants.js';

const FOLDER_RULES = [
  ['people', 'One page per human being. File by the person as the primary subject.'],
  ['companies', 'One page per organization or company.'],
  ['deals', 'Transactions, fundraising, and investment items with terms or decisions.'],
  ['meetings', 'Specific meetings, calls, or transcripts.'],
  ['projects', 'Actively built execution tracks with a repo, spec, or team.'],
  ['ideas', 'Unbuilt possibilities that are not yet active projects.'],
  ['concepts', 'Reusable mental models, frameworks, and general strategy.'],
  ['writing', 'Prose artifacts, drafts, and essay-style outputs.'],
  ['sources', 'Raw imports, archived snapshots, and source material.'],
  ['inbox', 'Temporary unsorted captures when no canonical home is clear yet.'],
  ['archive', 'Historical or dead pages that should not stay active.'],
  ['dreams', 'Reserved for later dream-cycle outputs; not active in v1.'],
  ['ops', 'Operational files such as tasks and run-state documents.'],
  ['.artifacts', 'Attached raw files and generated outputs, organized outside the canonical page graph.'],
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
    artifact_shape: [
      '.artifacts/<artifact-slug>/',
      'artifact.md companion page',
      'raw attached files such as pdf/png/pptx/xlsx/txt',
      'artifact.md carries parents back to one or more canonical brain pages',
      'artifact storage is neutral about input versus output',
    ],
    notes: [
      'Compiled truth lives above --- and gets rewritten as understanding changes.',
      'Timeline lives below --- and is append-only evidence.',
      'Use relative markdown links instead of duplicate pages.',
      'Artifacts live under .artifacts/ and are not canonical brain pages.',
      'Repo documentation pages such as README.md files should be excluded from strict brain-page validation.',
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
    'Meeting pages may later get a dedicated meeting schema. Raw transcript dumps belong under `.artifacts/`, not as standalone brain pages.',
    '',
    '## Artifact Shape',
    '',
    '```text',
    '.artifacts/<artifact-slug>/',
    '  artifact.md',
    '  <raw-files...>',
    '```',
    '',
    '- `artifact.md` is a lightweight companion page, not a full entity page.',
    '- Canonical pages link outward to artifacts.',
    '- `artifact.md` records `parents:` back to one or more canonical pages.',
    '- Artifacts may hold both upstream inputs and generated outputs.',
    '',
    '## Filing Rules',
    '',
    '- File by primary subject, not by source or format.',
    '- Use cross-links instead of duplicate pages.',
    '- Use `inbox/` when a page does not clearly fit yet.',
    '- Store attached files under `.artifacts/`, not directly in entity directories.',
    '- Repo documentation pages such as directory `README.md` files are not canonical brain pages.',
  );
  return `${lines.join('\n')}\n`;
}

export function recommendFolderForInput(input) {
  const text = String(input).trim();
  const lower = text.toLowerCase();

  if (/meeting|call|transcript|sync|prep/.test(lower)) return recommendation('meetings', text, 'the primary subject is a specific meeting or call');
  if (/deal|acquisition|investor|fundraise|teaser|valuation/.test(lower)) return recommendation('deals', text, 'the primary subject is a transaction or financing item');
  if (/draft|essay|writeup|proposal|memo|article/.test(lower)) return recommendation('writing', text, 'the primary subject is a prose artifact');
  if (/framework|mental model|thesis|playbook|strategy|concept/.test(lower)) return recommendation('concepts', text, 'the primary subject is a reusable concept or framework');
  if (/idea|possibility|someday|explore/.test(lower)) return recommendation('ideas', text, 'the item sounds like an unbuilt possibility');
  if (/project|build|launch|roadmap|implementation/.test(lower)) return recommendation('projects', text, 'the item sounds like an active execution track');
  if (/company|inc\.|llc|firm|organization/.test(lower)) return recommendation('companies', text, 'the primary subject appears to be an organization');
  if (/source|raw|import|email|pdf|screenshot|snapshot/.test(lower)) return recommendation('sources', text, 'the item reads like raw source material');
  return recommendation('inbox', text, 'no higher-confidence canonical home was obvious');
}

export function validatePageShape(parsedPage) {
  const findings = [];
  if (!parsedPage.hasFrontmatter) findings.push('missing_frontmatter');
  if (!parsedPage.hasSeparator) findings.push('missing_separator');
  if (!parsedPage.title) findings.push('missing_title');
  if (!parsedPage.compiledTruth.trim()) findings.push('missing_compiled_truth');
  if (PAGE_REQUIRED_TIMELINE_TYPES.has(parsedPage.type) && !parsedPage.timeline.trim()) findings.push('missing_timeline');
  return findings;
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
