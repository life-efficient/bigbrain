import fs from 'node:fs/promises';
import path from 'node:path';

const DEFAULT_RULES = {
  inbox: 'Legacy holding area for historical unsorted captures; do not use for new actionable work.',
  sources: 'Legacy or evidence-first imports only when no clearer owning collection exists; prefer the primary subject collection for new material.',
  people: 'One page per human being.',
  organizations: 'One page per institution, government body, university, vendor, company, advisory group, or other organization.',
  companies: 'One page per company or organization.',
  meetings: 'Specific meetings, calls, meeting prep, and transcripts.',
  videos: 'Externally published videos. Keep a first-class readable video page with its canonical URL and source metadata; preserve the transcript as a linked raw artifact, not as the primary page body.',
  deals: 'One canonical page per distinct transaction, acquisition, raise, investment, mandate, or commercial opportunity. Meeting prep belongs on the meeting page; deal-owned VDR inventories, diligence packs, teasers, and models belong in deals/.raw sidecars linked from the canonical deal.',
  projects: 'Active execution tracks and workstreams.',
  ideas: 'Unbuilt possibilities that are not yet active projects.',
  initiatives: 'Active named workstreams or programs.',
  deliverables: 'Owned outputs such as reports, decks, PDFs, toolkits, course materials, workshop packs, declarations, episodes, calls, releases, and drafts.',
  tasks: 'One page per assignable task. Task identity is derived from tasks/<slug>.md; task pages use member-backed assignees, status, readiness, priority, source links, current body, and timeline.',
  concepts: 'Reusable concepts, frameworks, pillar notes, strategy, and mental models.',
  components: 'One page per physical or technical component in a larger system. Keep the component boundary atomic and link to the products, organizations, and processes that use or supply it.',
  products: 'One page per named commercial product, platform, or service offering. Keep current specifications and commercial claims source-bounded, and link to the component and organization pages that explain the offering.',
  processes: 'One page per repeatable development, delivery, commissioning, or operating process. Describe the process boundary and link to the components, products, projects, and organizations involved.',
  writing: 'Authored prose artifacts whose primary identity is the writing itself.',
  protocol: 'Repeatable operating rules, preferences, processes, playbooks, and how-things-should-work guidance.',
  ops: 'Operating material such as roadmaps, contribution rules, server notes, MCP notes, and cross-workstream coordination.',
  archive: 'Historical or superseded material that should not stay active.',
};

export const SUMMARY_GUIDANCE = [
  'State the substantive subject and takeaway, not Brain or page mechanics. Do not describe transcripts, raw artifacts, timelines, provenance, source storage, indexing, or rendering.',
  'Write the first-class summary as the one sentence a reader should read if they read nothing else: identify the subject and its core opportunity, argument, significance, or concrete current development.',
  'For deals, lead with the asset or business, transaction or partnership opportunity, and our role or meaningful progress when established. Use concrete evidence-backed language rather than routine diligence, unverified-claims, or authorization disclaimers.',
  'Keep source attribution, diligence gaps, uncertainty, and action permissions accurately in the detailed body or appropriate source and task records. Include uncertainty in the summary only when omitting that specific uncertainty would materially misrepresent the opportunity or current state; use a precise qualifier, not boilerplate. Do not strengthen the evidence or turn proposals into completed actions.',
];

const CURRENT_BODY_GUIDANCE = [
  'For ordinary canonical subject pages, write the body as a synthesized current briefing organized by the subject, not by ingestion dates or successive updates.',
  'On every substantive update, integrate new evidence into the relevant sections, reconcile contradictions, and replace or qualify superseded claims. Preserve useful current commercial and technical details, attribution, and uncertainty.',
  'Do not append dated Update, Meeting update, or Latest update sections to the current body. Keep change chronology and superseded states in the writer-managed Timeline; keep meeting-specific discussion in the linked meeting or source record.',
  'Retain a date in current prose when it materially defines a fact, deadline, freshness, or uncertainty. Historical context may remain when it explains the current subject; do not turn it into an ingestion log.',
  'Before writing and on read-back, check that the body alone explains what the subject is, its current state, material terms and constraints, relationships, and open questions without requiring the reader to reconstruct successive updates.',
];

const TIMELINE_WRITING_GUIDANCE = [
  'When consolidating a legacy body, migrating a canonical page, or repairing missing history, inventory substantive source events against the existing timeline and append each missing milestone through structured timeline entries. Use occurred_at from the evidenced event date and recorded_at from the actual write time; retain per-event provenance. Preserve existing entries, avoid duplicates, and do not guess dates or turn plans into completed actions. Record administrative filing corrections separately; one present-day cleanup entry does not replace substantive deal or subject progress.',
  'Write each timeline entry as a concise, subject-first summary of the durable page change.',
  'Page updates are already authored and attributable through the page operation and provenance; do not lead with the current user\'s name or repeat an implicit approval such as `Harry approved ...`.',
  'Keep source wording and approval context in provenance.source_message; retain a person\'s name in visible timeline text only when the actor\'s identity materially changes the meaning.',
  'Prefer `Added X after approval` or `Updated Y with Z` over `Harry approved adding X` or `Harry updated Y`.',
];

export async function filingRulesForBrain({ config }) {
  const sharedGuidance = await readSharedGuidance(config.brainDir);
  const collections = await readCollections(config.brainDir);
  const rawFileRules = {
    pattern: '<collection>/.raw/<filename>',
    create_with_page_tool: 'create_raw_file_with_page',
    guidance: [
      'Every valuable raw artifact has exactly one same-basename Markdown sidecar under the same owning collection .raw folder.',
      'Attachment sidecars are first-class indexed brain pages and may contain comprehensive extraction, synthesis, provenance, links, visibility, groups, and access metadata.',
      'Raw binaries are never indexed directly. Subject pages link to the indexed attachment sidecar and raw artifact.',
      'When an attachment sidecar is public, its public route renders the declared raw artifact; the sidecar Markdown remains the private searchable representation.',
      'When sharing a raw file through a group or folder view, expose the raw file itself as the shared item; the sidecar markdown only stores metadata for that raw file.',
      'Do not create page-slug folders or other nested folders inside .raw; make filenames collision-safe instead.',
      'Use the owning collection .raw folder for raw attachments; sources/.raw is only for legacy or domain-specific evidence overlays.',
      'Use deliverables/.raw when the raw file is an owned output being reviewed, sent, published, presented, or maintained as the deliverable itself.',
      'Raw uploads are limited to the configured raw_file_max_bytes value, 25 MiB by default; compress oversized files or store a summary/link instead.',
    ],
    examples: [
      {
        raw_path: 'deals/.raw/exampleco-blind-teaser.pdf',
        page_path: 'deals/.raw/exampleco-blind-teaser',
      },
      {
        raw_path: 'deliverables/.raw/example-partner-brief.pdf',
        page_path: 'deliverables/.raw/example-partner-brief',
      },
      {
        raw_path: 'meetings/.raw/unesco-workshop-sync-transcript.txt',
        page_path: 'meetings/.raw/unesco-workshop-sync-transcript',
      },
      {
        raw_path: 'writing/.raw/unassigned-evidence-pack.pdf',
        page_path: 'writing/.raw/unassigned-evidence-pack',
      },
    ],
  };
  return {
    brain_dir: config.brainDir,
    markdown: renderFilingRulesMarkdown({ config, sharedGuidance, collections, rawFileRules }),
    shared_guidance: sharedGuidance,
    summary_guidance: SUMMARY_GUIDANCE,
    current_body_guidance: CURRENT_BODY_GUIDANCE,
    timeline_guidance: TIMELINE_WRITING_GUIDANCE,
    collections,
    page_shape: sharedGuidance.pageShape.length > 0 ? sharedGuidance.pageShape : [
      'YAML frontmatter with title, created, and optional tags/source fields.',
      'A current-state body that can be rewritten as understanding changes.',
      'A separator line: ---',
      'An append-only ## Timeline evidence log.',
    ],
    task_schema: defaultTaskSchema(),
    deal_schema: defaultDealSchema(),
    raw_file_rules: rawFileRules,
    filing_principles: sharedGuidance.filingPrinciples.length > 0 ? sharedGuidance.filingPrinciples : [
      'File by primary subject, not by source format.',
      'Update an existing canonical page when the page already exists.',
      'Create a new page when the item introduces a distinct person, organization, deal, project, idea, meeting, task, concept, writing artifact, protocol, or domain overlay page.',
      'Use relative markdown links instead of duplicating facts across pages.',
      'Each page should be locally comprehensible as a useful 80-20 briefing of its primary subject, without trying to be exhaustive.',
      'Links may lead to deeper detail, adjacent subjects, or related records; use them to connect context without copying another page\'s overall understanding.',
      'Keep the overall understanding of each subject in its canonical page. Other pages may mention that subject in context, but should not become a competing full account.',
      'Raw source pages and attachment sidecars may preserve the detailed account of the source; canonical subject pages should capture the durable 80-20 understanding and link to the source when useful.',
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
    '## Summary Writing',
    '',
    ...SUMMARY_GUIDANCE.map((item) => `- ${item}`),
    '',
    '## Current Body Writing',
    '',
    ...CURRENT_BODY_GUIDANCE.map((item) => `- ${item}`),
    '',
    '## Timeline Writing',
    '',
    ...TIMELINE_WRITING_GUIDANCE.map((item) => `- ${item}`),
    '',
  );

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

  sections.push(
    '## Deal Page Schema',
    '',
    ...renderDealSchemaMarkdownLines(defaultDealSchema()),
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

function defaultDealSchema() {
  return {
    pattern: 'deals/<deal-slug>.md',
    frontmatter: {
      deal_involvement: ['public_unrelated', 'network_observed', 'network_actionable', 'active'],
      asks: 'Optional anonymous, externally shareable asks. Each string is one complete prose sentence stating the specific counterparty or contribution needed and its role in the opportunity. Avoid first-person questions, salutations, headings, and bullet prefixes; each ask must read naturally after the shared teaser.',
      teaser_summary: 'Optional anonymous, externally shareable teaser that makes the opportunity clear and exciting through concrete, evidence-backed substance: the asset or project, its distinguishing features, and the proposed transaction or partnership. Avoid invented claims or commitments, company, project, and contact names, and combinations of identifying details. Keep separate from the internal summary.',
    },
    guidance: [
      'Create one top-level deal page only for an independently evolving actual transaction, raise, investment, mandate, acquisition, or commercial opportunity.',
      'Keep meeting prep, meeting summaries, and transcripts on the canonical meetings/ page and its meetings/.raw sidecars, not as deals/*.md pages.',
      'Keep deal-owned VDR inventories, diligence packs, checklists, teasers, and models in deals/.raw with one indexed same-basename sidecar linked from the canonical deal, not as another top-level deal page.',
      'Set deal_involvement to public_unrelated for a public deal unrelated to us.',
      'Set deal_involvement to network_observed when a network contact is working on the deal without our active involvement.',
      'Set deal_involvement to network_actionable when a network contact is working on the deal and we may be able to help, for example by finding a vendor or investor.',
      'Set deal_involvement to active when we are directly working on the deal.',
      'Set deal_involvement on every newly created actual deal page; this field does not make a prep note or artifact a deal page.',
      'This field is optional for legacy deal pages.',
      'Write teaser_summary as clear, exciting anonymous opportunity prose supported by the deal evidence. State each specific needed counterparty or contribution in asks as a complete prose sentence, without first-person questions or bullet prefixes. Append one ask as prose to the teaser; only the all-asks message may format the asks as bullets. Do not invent claims or commitments.',
      'Keep both fields free of company, project, and contact names, source routes, private URLs, and combinations of identifying details. Do not infer shareable copy from the internal title or summary.',
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

function renderDealSchemaMarkdownLines(schema) {
  return [
    `- Pattern: \`${schema.pattern}\``,
    '- Frontmatter:',
    `  - \`deal_involvement\`: ${schema.frontmatter.deal_involvement.map((item) => `\`${item}\``).join(', ')}`,
    `  - \`asks\`: ${schema.frontmatter.asks}`,
    `  - \`teaser_summary\`: ${schema.frontmatter.teaser_summary}`,
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
