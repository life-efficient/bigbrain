import fs from 'node:fs/promises';
import path from 'node:path';

const DEFAULT_RULES = {
  inbox: 'Legacy holding area for historical unsorted captures; do not use for new actionable work.',
  sources: 'Legacy or evidence-first imports only when no clearer owning collection exists; prefer the primary subject collection for new material.',
  people: 'One page per human being.',
  organizations: 'One page per institution, government body, university, vendor, company, advisory group, or other organization.',
  companies: 'One page per company or organization.',
  meetings: 'Specific meetings, calls, meeting prep, and transcripts.',
  deals: 'Transactions, acquisitions, raises, investments, mandates, opportunities, diligence, valuation, buyer/investor processes, and deal-owned artifacts.',
  projects: 'Active execution tracks and workstreams.',
  ideas: 'Unbuilt possibilities that are not yet active projects.',
  initiatives: 'Active named workstreams or programs.',
  deliverables: 'Owned outputs such as reports, decks, PDFs, toolkits, course materials, workshop packs, declarations, episodes, calls, releases, and drafts.',
  tasks: 'One page per assignable task. Task identity is derived from tasks/<slug>.md; task pages use member-backed assignees, status, readiness, priority, source links, current body, and timeline.',
  concepts: 'Reusable concepts, frameworks, pillar notes, strategy, and mental models.',
  writing: 'Authored prose artifacts whose primary identity is the writing itself.',
  protocol: 'Repeatable operating rules, preferences, processes, playbooks, and how-things-should-work guidance.',
  ops: 'Operating material such as roadmaps, contribution rules, server notes, MCP notes, and cross-workstream coordination.',
  archive: 'Historical or superseded material that should not stay active.',
};

export async function filingRulesForBrain({ config }) {
  const sharedGuidance = await readSharedGuidance(config.brainDir);
  const collections = await readCollections(config.brainDir);
  const rawFileRules = {
    pattern: '<collection>/.raw/<filename>',
    create_with_page_tool: 'create_raw_file_with_page',
    guidance: [
      'Raw files are attachments, not canonical brain pages.',
      'For uploads such as PDFs, decks, screenshots, spreadsheets, and transcripts, create a markdown page and raw file together when the raw file has brain value.',
      'Place the raw file directly under the same collection .raw folder as the markdown page it supports, choosing the collection by artifact role rather than file type.',
      'Use a normal collection page path when the markdown page is the canonical searchable meeting, report, source, deliverable, deal, or project page.',
      'Use a <collection>/.raw/<slug>.md page path only when the markdown page is a raw-file sidecar whose main purpose is metadata, visibility, groups, or provenance for that raw file.',
      'When sharing a raw file through a group or folder view, expose the raw file itself as the shared item; the sidecar markdown only stores metadata for that raw file.',
      'Do not create page-slug folders or other nested folders inside .raw; make filenames collision-safe instead.',
      'Use the owning collection .raw folder for raw attachments; sources/.raw is only for legacy or domain-specific evidence overlays.',
      'Use deliverables/.raw when the raw file is an owned output being reviewed, sent, published, presented, or maintained as the deliverable itself.',
      'Raw uploads are limited to the configured raw_file_max_bytes value, 25 MiB by default; compress oversized files or store a summary/link instead.',
    ],
    examples: [
      {
        raw_path: 'deals/.raw/exampleco-blind-teaser.pdf',
        page_path: 'deals/exampleco-blind-teaser',
      },
      {
        raw_path: 'deliverables/.raw/example-partner-brief.pdf',
        page_path: 'deliverables/example-partner-brief',
      },
      {
        raw_path: 'meetings/.raw/unesco-workshop-sync-transcript.txt',
        page_path: 'meetings/unesco-workshop-sync',
      },
      {
        raw_path: 'writing/.raw/unassigned-evidence-pack.pdf',
        page_path: 'writing/unassigned-evidence-pack',
      },
    ],
  };
  return {
    brain_dir: config.brainDir,
    markdown: renderFilingRulesMarkdown({ config, sharedGuidance, collections, rawFileRules }),
    shared_guidance: sharedGuidance,
    collections,
    page_shape: sharedGuidance.pageShape.length > 0 ? sharedGuidance.pageShape : [
      'YAML frontmatter with title, created, and optional tags/source fields.',
      'A current-state body that can be rewritten as understanding changes.',
      'A separator line: ---',
      'An append-only ## Timeline evidence log.',
    ],
    task_schema: defaultTaskSchema(),
    raw_file_rules: rawFileRules,
    filing_principles: sharedGuidance.filingPrinciples.length > 0 ? sharedGuidance.filingPrinciples : [
      'File by primary subject, not by source format.',
      'Update an existing canonical page when the page already exists.',
      'Create a new page when the item introduces a distinct person, organization, deal, project, idea, meeting, task, concept, writing artifact, protocol, or domain overlay page.',
      'Use relative markdown links instead of duplicating facts across pages.',
      'Use tasks/ for assignable work by default; use canonical subject pages for durable knowledge.',
      'Use the owning collection .raw folder for evidence files, and keep sources/ only when a specific brain treats it as a domain overlay.',
      'Treat inbox/ and ops/ as legacy folders, not active default destinations.',
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

  sections.push(
    '## Task Page Schema',
    '',
    ...renderTaskSchemaMarkdownLines(defaultTaskSchema()),
    '',
  );

  return sections.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd() + '\n';
}

function defaultTaskSchema() {
  return {
    pattern: 'tasks/<task-slug>.md',
    frontmatter: {
      title: 'Required human-readable task title.',
      status: ['open', 'in_progress', 'waiting', 'done', 'archived'],
      readiness: ['underspecified', 'ready'],
      execution_mode: ['agent', 'user', 'interactive'],
      priority: ['p0', 'p1', 'p2', 'p3'],
      assignees: 'Array of active member person slugs, for example [people/hani]. Use me only through MCP task tools.',
      source: 'Array of related brain slugs, for example [meetings/proposal-review].',
      due: 'Optional YYYY-MM-DD date.',
    },
    guidance: [
      'Create one page per assignable task under tasks/.',
      'Create or update a task by default when new intake is actionable, needs an owner, needs status, or is a follow-up.',
      'Use the task slug as a concise, stable, human-readable identifier; it does not need to match or mirror the full task title.',
      'Task identity is derived from the tasks/ path. Legacy type: task frontmatter may appear, but it is optional and not used for behavior.',
      'Set status to open for known work that is not actively being worked.',
      'Set status to in_progress for active work currently underway.',
      'Set status to waiting when work is paused on an external dependency, reply, approval, access, or date.',
      'Set status to done only when the task is completed.',
      'Set status to archived when intentionally closing a task without treating it as active work.',
      'Set readiness to underspecified or ready. Readiness is separate from status and records the agent-authored handoff state.',
      'Default to readiness: underspecified when context is clearly missing and useful work cannot begin.',
      'Use readiness: ready when the task appears specified enough to work, while letting what’s-next and fanout presentation surface substantive open questions as input-needed.',
      'Set execution_mode to agent, user, or interactive on every new or materially updated task.',
      'Use execution_mode: agent only when Codex or another agent can complete the task autonomously with the available context, tools, and files, without missing information, personal judgement, external approval, or a real-world-only action.',
      'Use execution_mode: interactive when Codex can advance the task but needs the user\'s judgement, preferences, review, or decisions along the way; guided prompts should walk the user through the work step by step and pause at decision points.',
      'Use execution_mode: user only when the task requires a real-world action Codex cannot meaningfully perform, such as sending a personal WhatsApp, conducting a meeting, signing a physical document, or obtaining approval.',
      'If uncertain between agent and interactive, prefer interactive. If uncertain between interactive and user, use interactive when Codex can still structure or guide the work.',
      'Status and readiness are independent: a task can be open but underspecified, or in_progress and ready.',
      'Assignees must be active members, not arbitrary people pages.',
      'Use source links to connect the task to the meeting, project, source, legacy inbox item, or other brain page that justifies it.',
      'Keep the current task brief above the separator and append evidence or state changes under ## Timeline.',
      'Structure task bodies with ## Summary, ## What Counts as Completed, ## Body Context, ## Open Questions, and ## Anti-Patterns.',
      'When marking a task done or archived, include a completion handoff in the timeline: either Next task: tasks/<slug> or No successor task needed: <reason>.',
      'Use tasks/create and tasks/update MCP tools for task writes when available.',
      'Do not use ops/tasks.md or recreate a single-file task list.',
    ],
  };
}

function renderTaskSchemaMarkdownLines(schema) {
  return [
    `- Pattern: \`${schema.pattern}\``,
    '- Frontmatter:',
    '  - `title`: required title',
    `  - \`status\`: ${schema.frontmatter.status.map((item) => `\`${item}\``).join(', ')}`,
    `  - \`readiness\`: ${schema.frontmatter.readiness.map((item) => `\`${item}\``).join(', ')}`,
    `  - \`execution_mode\`: ${schema.frontmatter.execution_mode.map((item) => `\`${item}\``).join(', ')}`,
    `  - \`priority\`: ${schema.frontmatter.priority.map((item) => `\`${item}\``).join(', ')}`,
    '  - `assignees`: active member person slugs such as `people/hani`',
    '  - `source`: related brain slugs such as `meetings/proposal-review`',
    '  - `due`: optional `YYYY-MM-DD` date',
    ...schema.guidance.map((item) => `- ${item}`),
  ];
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
