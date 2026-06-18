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

export async function filingRulesForBrain({ config }) {
  const sharedGuidance = await readSharedGuidance(config.brainDir);
  const collections = await readCollections(config.brainDir);
  const rawFileRules = {
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
  };
  return {
    brain_dir: config.brainDir,
    markdown: renderFilingRulesMarkdown({ config, sharedGuidance, collections, rawFileRules }),
    shared_guidance: sharedGuidance,
    collections,
    page_shape: sharedGuidance.pageShape.length > 0 ? sharedGuidance.pageShape : [
      'YAML frontmatter with type, title, created, and optional tags/source fields.',
      'A current-state body that can be rewritten as understanding changes.',
      'A separator line: ---',
      'An append-only ## Timeline evidence log.',
    ],
    raw_file_rules: rawFileRules,
    filing_principles: sharedGuidance.filingPrinciples.length > 0 ? sharedGuidance.filingPrinciples : [
      'File by primary subject, not by source format.',
      'Update an existing canonical page when the page already exists.',
      'Create a new page when the item introduces a distinct person, organization, meeting, initiative, deliverable, concept, source, or operating note.',
      'Use relative markdown links instead of duplicating facts across pages.',
      'Use inbox/ only when no higher-confidence canonical home is clear.',
    ],
  };
}

async function readSharedGuidance(brainDir) {
  const filePath = path.join(brainDir, 'FILING.md');
  const markdown = await readOptional(filePath);
  if (!markdown) {
    return {
      path: null,
      summary: '',
      markdown: '',
      filingPrinciples: [],
      pageShape: [],
    };
  }
  const extracted = extractSharedGuidance(markdown);
  return {
    path: 'FILING.md',
    summary: extracted.summary,
    markdown,
    filingPrinciples: extracted.filingPrinciples,
    pageShape: extracted.pageShape,
  };
}

async function readCollections(brainDir) {
  const dirents = await fs.readdir(brainDir, { withFileTypes: true });
  const collections = [];
  for (const dirent of dirents) {
    if (!dirent.isDirectory() || shouldIgnoreTopLevel(dirent.name)) continue;
    const collectionGuidance = await readCollectionGuidance(brainDir, dirent.name);
    const extracted = collectionGuidance.markdown ? extractCollectionGuidance(collectionGuidance.markdown) : {};
    collections.push({
      name: dirent.name,
      path: `${dirent.name}/`,
      purpose: extracted.summary || DEFAULT_RULES[dirent.name] || 'No collection filing guidance found.',
      what_goes_here: extracted.whatGoesHere,
      what_does_not_go_here: extracted.whatDoesNotGoHere,
      filing_path: collectionGuidance.path,
      readme_path: collectionGuidance.path?.endsWith('/README.md') ? collectionGuidance.path : null,
      markdown: collectionGuidance.markdown,
    });
  }
  collections.sort((left, right) => left.name.localeCompare(right.name));
  return collections;
}

function renderFilingRulesMarkdown({ config, sharedGuidance, collections, rawFileRules }) {
  const sections = [
    '# BigBrain Filing Rules',
    '',
    `Brain directory: \`${config.brainDir}\``,
    '',
  ];

  if (sharedGuidance.markdown) {
    sections.push(
      `## Shared Guidance (${sharedGuidance.path})`,
      '',
      stripFrontmatter(sharedGuidance.markdown).trim(),
      '',
    );
  }

  sections.push(
    '## Collections',
    '',
  );
  for (const collection of collections) {
    sections.push(
      `### ${collection.name} (${collection.filing_path || 'no filing file'})`,
      '',
      collection.markdown ? stripFrontmatter(collection.markdown).trim() : (collection.purpose || 'No collection filing guidance found.'),
      '',
    );
  }

  sections.push(
    '## Raw File Tooling',
    '',
    `- Pattern: \`${rawFileRules.pattern}\``,
    `- Create with page tool: \`${rawFileRules.create_with_page_tool}\``,
    ...rawFileRules.guidance.map((item) => `- ${item}`),
    '',
  );

  return sections.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd() + '\n';
}

function stripFrontmatter(markdown) {
  return markdown.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, '');
}

async function readCollectionGuidance(brainDir, collectionName) {
  const filingPath = path.join(brainDir, collectionName, 'FILING.md');
  const filing = await readOptional(filingPath);
  if (filing) return { path: `${collectionName}/FILING.md`, markdown: filing };
  const readmePath = path.join(brainDir, collectionName, 'README.md');
  const readme = await readOptional(readmePath);
  if (readme) return { path: `${collectionName}/README.md`, markdown: readme };
  return { path: null, markdown: '' };
}

function extractCollectionGuidance(markdown) {
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
