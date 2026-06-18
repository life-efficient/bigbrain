import fs from 'node:fs/promises';
import path from 'node:path';

const DEFAULT_RULES = {
  inbox: 'Temporary unsorted captures when no canonical home is clear yet.',
  sources: 'Source documents, imports, raw evidence, transcripts, decks, reports, and source extracts.',
  people: 'One page per human being.',
  organizations: 'One page per institution, government body, university, vendor, company, advisory group, or other organization.',
  companies: 'One page per company or organization.',
  meetings: 'Specific meetings, calls, meeting prep, and transcripts.',
  initiatives: 'Active named workstreams or programmes.',
  deliverables: 'Concrete outputs such as reports, toolkits, course materials, workshop packs, declarations, episodes, calls, releases, and drafts.',
  concepts: 'Reusable concepts, frameworks, pillar notes, strategy, and mental models.',
  ops: 'Operating material such as roadmaps, tasks, contribution rules, server notes, MCP notes, and cross-workstream coordination.',
  archive: 'Historical or superseded material that should not stay active.',
};

const ROUTING_HINTS = [
  { collection: 'meetings', pattern: /\b(meeting|call|transcript|sync|prep|agenda|minutes)\b/i, reason: 'the primary subject is a specific meeting or call' },
  { collection: 'people', pattern: /\b(person|people|owner|contact|bio)\b/i, reason: 'the primary subject appears to be a person' },
  { collection: 'organizations', pattern: /\b(organization|organisation|unesco|sdaia|ministry|university|vendor|partner|company|institution|committee)\b/i, reason: 'the primary subject appears to be an organization' },
  { collection: 'companies', pattern: /\b(company|firm|vendor|partner|organization|organisation|institution)\b/i, reason: 'the primary subject appears to be an organization' },
  { collection: 'initiatives', pattern: /\b(initiative|workstream|programme|program|pillar delivery|activation)\b/i, reason: 'the item is an active named workstream' },
  { collection: 'deliverables', pattern: /\b(deliverable|report|toolkit|course|workshop pack|declaration|podcast|episode|paper|publication|glossary|release|draft|memo)\b/i, reason: 'the item is a concrete output' },
  { collection: 'concepts', pattern: /\b(concept|framework|strategy|pillar|model|principle|methodology|thesis)\b/i, reason: 'the item is reusable strategy or conceptual material' },
  { collection: 'ops', pattern: /\b(roadmap|task|todo|operating|ops|mcp|server|deployment|sync|contribution|rule|cadence)\b/i, reason: 'the item is operating or coordination material' },
  { collection: 'sources', pattern: /\b(source|raw|import|pdf|deck|slides|screenshot|snapshot|document|evidence|attachment)\b/i, reason: 'the item is source material or evidence' },
];

export async function filingRulesForBrain({ config, input = '', fileName = '', mimeType = '' }) {
  const sharedGuidance = await readSharedGuidance(config.brainDir);
  const collections = await readCollections(config.brainDir);
  const available = new Set(collections.map((collection) => collection.name));
  return {
    brain_dir: config.brainDir,
    shared_guidance: sharedGuidance,
    collections,
    page_shape: sharedGuidance.pageShape.length > 0 ? sharedGuidance.pageShape : [
      'YAML frontmatter with type, title, created, and optional tags/source fields.',
      'A current-state body that can be rewritten as understanding changes.',
      'A separator line: ---',
      'An append-only ## Timeline evidence log.',
    ],
    raw_file_rules: {
      pattern: '<collection>/.raw/<file-or-folder>/<filename>',
      create_with_page_tool: 'create_raw_file_with_page',
      guidance: [
        'Raw files are attachments, not canonical brain pages.',
        'For uploads such as PDFs, decks, screenshots, spreadsheets, and transcripts, create a markdown page and raw file together when the raw file has brain value.',
        'Place the raw file under the same collection as the markdown page it supports.',
        'Use sources/.raw for evidence-first uploads whose subject has not yet become another canonical entity.',
      ],
      examples: [
        {
          raw_path: 'sources/.raw/example-strategic-initiatives-deck.pdf',
          page_path: 'sources/example-strategic-initiatives-deck',
        },
        {
          raw_path: 'meetings/.raw/unesco-workshop-sync/transcript.txt',
          page_path: 'meetings/unesco-workshop-sync',
        },
      ],
    },
    filing_principles: sharedGuidance.filingPrinciples.length > 0 ? sharedGuidance.filingPrinciples : [
      'File by primary subject, not by source format.',
      'Update an existing canonical page when the page already exists.',
      'Create a new page when the item introduces a distinct person, organization, meeting, initiative, deliverable, concept, source, or operating note.',
      'Use relative markdown links instead of duplicating facts across pages.',
      'Use inbox/ only when no higher-confidence canonical home is clear.',
    ],
    recommendation: recommendFiling({ input, fileName, mimeType, available }),
  };
}

async function readSharedGuidance(brainDir) {
  const filePath = path.join(brainDir, 'FILING.md');
  const markdown = await readOptional(filePath);
  if (!markdown) {
    return {
      path: null,
      summary: '',
      filingPrinciples: [],
      pageShape: [],
    };
  }
  const extracted = extractSharedGuidance(markdown);
  return {
    path: 'FILING.md',
    summary: extracted.summary,
    filingPrinciples: extracted.filingPrinciples,
    pageShape: extracted.pageShape,
  };
}

async function readCollections(brainDir) {
  const dirents = await fs.readdir(brainDir, { withFileTypes: true });
  const collections = [];
  for (const dirent of dirents) {
    if (!dirent.isDirectory() || shouldIgnoreTopLevel(dirent.name)) continue;
    const readmePath = path.join(brainDir, dirent.name, 'README.md');
    const readme = await readOptional(readmePath);
    const extracted = readme ? extractCollectionReadme(readme) : {};
    collections.push({
      name: dirent.name,
      path: `${dirent.name}/`,
      purpose: extracted.summary || DEFAULT_RULES[dirent.name] || 'No collection README guidance found.',
      what_goes_here: extracted.whatGoesHere,
      what_does_not_go_here: extracted.whatDoesNotGoHere,
      readme_path: readme ? `${dirent.name}/README.md` : null,
    });
  }
  collections.sort((left, right) => left.name.localeCompare(right.name));
  return collections;
}

function extractCollectionReadme(markdown) {
  const lines = markdown.split(/\r?\n/);
  const titleIndex = lines.findIndex((line) => /^#\s+/.test(line));
  const summary = titleIndex >= 0 ? paragraphAfterHeading(lines, titleIndex + 1) : '';
  return {
    summary,
    whatGoesHere: bulletsUnderHeading(lines, 'What Goes Here'),
    whatDoesNotGoHere: bulletsUnderHeading(lines, 'What Does Not Go Here'),
  };
}

function extractSharedGuidance(markdown) {
  const lines = markdown.split(/\r?\n/);
  const titleIndex = lines.findIndex((line) => /^#\s+/.test(line));
  return {
    summary: titleIndex >= 0 ? paragraphAfterHeading(lines, titleIndex + 1) : '',
    filingPrinciples: bulletsUnderHeading(lines, 'Filing Principles'),
    pageShape: bulletsUnderHeading(lines, 'Page Shape'),
  };
}

function paragraphAfterHeading(lines, startIndex) {
  const out = [];
  for (let index = startIndex; index < lines.length; index += 1) {
    const line = lines[index].trim();
    if (!line) {
      if (out.length > 0) break;
      continue;
    }
    if (/^#+\s+/.test(line) || line === '---') break;
    out.push(line);
  }
  return out.join(' ').trim();
}

function bulletsUnderHeading(lines, heading) {
  const start = lines.findIndex((line) => normalizeHeading(line) === normalizeHeading(`## ${heading}`));
  if (start < 0) return [];
  const bullets = [];
  for (let index = start + 1; index < lines.length; index += 1) {
    const line = lines[index].trim();
    if (/^##\s+/.test(line) || line === '---') break;
    const match = line.match(/^-\s+(.+)/);
    if (match) bullets.push(match[1].trim());
  }
  return bullets;
}

function normalizeHeading(line) {
  return line.trim().replace(/\s+/g, ' ').toLowerCase();
}

function recommendFiling({ input, fileName, mimeType, available }) {
  const text = [input, fileName, mimeType].filter(Boolean).join(' ').trim();
  if (!text) return null;
  const slugInput = fileName ? path.basename(fileName).replace(/\.[a-z0-9]+$/i, '') : input;
  for (const hint of ROUTING_HINTS) {
    if (!available.has(hint.collection) || !hint.pattern.test(text)) continue;
    return recommendation(hint.collection, slugInput || text, hint.reason);
  }
  const fallback = available.has('inbox') ? 'inbox' : Array.from(available).sort()[0] || null;
  return fallback ? recommendation(fallback, slugInput || text, 'no higher-confidence canonical home was obvious') : null;
}

function recommendation(collection, text, reason) {
  const slug = slugify(path.basename(text).replace(/\.[a-z0-9]+$/i, '') || text) || 'new-page';
  return {
    collection,
    page_path: `${collection}/${slug}`,
    raw_path_pattern: `${collection}/.raw/${slug}/<filename>`,
    reason,
  };
}

function slugify(value) {
  return String(value).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

async function readOptional(filePath) {
  try {
    return await fs.readFile(filePath, 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

function shouldIgnoreTopLevel(name) {
  return name.startsWith('.') || name === 'node_modules';
}
