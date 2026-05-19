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
    meeting_page_shape: [
      'YAML frontmatter',
      'Title and meeting metadata',
      'Optional Prep section with Context and Meeting Plan',
      'Structured meeting sections such as Summary, Key Decisions, Action Items, and Discussion Notes',
      'Separator and timeline are optional for meetings',
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
      'Repo documentation pages such as README.md files should be excluded from indexing and strict brain-page validation.',
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
    'Raw transcript dumps belong under `.artifacts/`, not as standalone brain pages.',
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
    '- Repo documentation pages such as directory `README.md` files are not canonical brain pages and should be excluded from indexing.',
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
