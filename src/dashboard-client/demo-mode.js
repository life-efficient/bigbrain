const DEMO_TITLE_POOLS = {
  people: ['Maya Bennett', 'Elias Nouri', 'Priya Shah', 'Theo Martins', 'Lina Haddad', 'Rowan Ellis', 'Nadia Karim', 'Jon Bell'],
  organizations: ['Northstar Systems', 'Cedar & Co.', 'Meridian Lab', 'Juniper Works', 'Harbor House', 'Atlas Collective'],
  companies: ['Northstar Systems', 'Cedar & Co.', 'Meridian Lab', 'Juniper Works', 'Harbor House', 'Atlas Collective'],
  deals: ['Atlas Partnership', 'Harbor Renewal', 'Cedar Acquisition', 'Meridian Expansion', 'Juniper Alliance', 'Northstar Mandate'],
  projects: ['Project Lantern', 'Signal Garden', 'Quiet Harbor', 'Northstar Console', 'Paper Kite', 'Field Guide'],
  ideas: ['Quiet Momentum', 'Contextual Atlas', 'Small Systems', 'The Clarity Loop', 'Signal Before Scale', 'Useful Friction'],
  meetings: ['Weekly Strategy Sync', 'Partner Discovery', 'Product Review', 'Research Roundtable', 'Operating Session', 'Planning Check-in'],
  tasks: ['Prepare the partner brief', 'Review the onboarding flow', 'Confirm the research inputs', 'Draft the next-step note', 'Map the open decisions', 'Refresh the launch checklist'],
  concepts: ['Trust Surface', 'Signal to Action', 'Context Windows', 'Human-scale Automation', 'The Attention Budget', 'Durable Memory'],
  writing: ['The Quiet Advantage', 'A Practical Field Guide', 'Notes on Good Systems', 'The Shape of Useful Work', 'A Small Operating Manual', 'Working in Public'],
  protocol: ['Weekly Review Protocol', 'Safe Handoff Checklist', 'Decision Capture Protocol', 'Meeting Closeout Routine', 'Source Review Protocol', 'Demo Readiness Checklist'],
  archive: ['Archived Field Notes', 'Previous Launch Notes', 'Closed Research Thread', 'Retired Operating Plan', 'Past Partner Brief', 'Stored Reference'],
  'personal-protocol': ['Morning Reset Protocol', 'Focus Block Routine', 'Weekly Reflection', 'Travel Readiness Checklist', 'Energy Budget', 'Evening Closeout'],
  health: ['Training Log', 'Recovery Check-in', 'Movement Baseline', 'Sleep Review', 'Nutrition Notes', 'Wellbeing Dashboard'],
  sources: ['Research Digest', 'Field Interview Notes', 'Market Signals', 'Reference Library', 'Source Review', 'Evidence Map'],
  inbox: ['Partner Follow-up', 'New Research Lead', 'Review Request', 'Unsorted Note', 'Incoming Brief', 'Open Question'],
  dreams: ['Night Garden', 'The Long Corridor', 'Blue House', 'Flying Over Water', 'The Hidden Room', 'Morning Train'],
  ops: ['Operations Handbook', 'Workspace Maintenance', 'Release Checklist', 'Access Review', 'System Inventory', 'Runbook Index'],
  'dream-cycle-summaries': ['Dream Cycle Summary', 'Sleep Pattern Review', 'Night Notes Digest', 'Rest and Recall', 'Dream Themes', 'Morning Signals'],
  page: ['Example Knowledge Page', 'Sample Working Note', 'Demo Reference Page', 'Illustrative Brief', 'Example Record', 'Safe Preview'],
};

const DEMO_TEMPLATES = {
  people: {
    summary: 'A fictional contact record used to demonstrate the People page layout.',
    body: '## Snapshot\n\nThis sample person is part of the demo dataset.\n\n- Role: Example collaborator\n- Focus: Relationship mapping\n- Status: Ready for conversation\n\n## Notes\n\nUse this space to show how a people page reads without exposing a real profile.',
  },
  organizations: {
    summary: 'A fictional organization page used to demonstrate company context and relationship structure.',
    body: '## Overview\n\nThis sample organization represents a safe, fictional operating context.\n\n- Sector: Applied systems\n- Stage: Exploring\n- Relationship: Example partner\n\n## Working context\n\nA real organization page would show its useful context here. Demo mode keeps that context illustrative.',
  },
  companies: {
    summary: 'A fictional company page used to demonstrate the company template.',
    body: '## Company brief\n\nThis is an example company profile with no live business data.\n\n- Market: Example market\n- Motion: Early exploration\n- Next step: Compare priorities\n\n## Notes\n\nThe demo template shows the shape of a company page while keeping the underlying record private.',
  },
  deals: {
    summary: 'A fictional deal page used to demonstrate a safe transaction workspace.',
    body: '## Deal brief\n\nThis example deal is a placeholder for a commercial opportunity.\n\n- Phase: Initial review\n- Priority: Medium\n- Owner: Demo team\n\n## Next actions\n\nReview the example assumptions, capture questions, and prepare a decision-ready summary.',
  },
  projects: {
    summary: 'A fictional project page used to demonstrate goals, momentum, and delivery context.',
    body: '## Project brief\n\nThis sample project exists only to illustrate the dashboard page reader.\n\n- Direction: Build a useful prototype\n- Momentum: In progress\n- Horizon: This example cycle\n\n## Current shape\n\nThe real page would contain project detail here. Demo mode keeps it safe and intentionally generic.',
  },
  ideas: {
    summary: 'A fictional idea page used to demonstrate an early concept capture.',
    body: '## Premise\n\nThis is a safe example of an idea captured before validation.\n\n## Why it might matter\n\nA concise explanation, a useful tension, and a possible experiment would live here.\n\n## Experiment\n\nChoose one small test that could turn this idea into evidence.',
  },
  meetings: {
    summary: 'A fictional meeting page used to demonstrate decisions, notes, and follow-up structure.',
    body: '## Meeting brief\n\nThis example meeting has no real attendees or transcript.\n\n## Agenda\n\n- Align on the current question\n- Surface decisions\n- Agree the next useful step\n\n## Follow-up\n\nCapture owners and dates here in a real meeting record.',
  },
  tasks: {
    summary: 'A fictional task page used to demonstrate an actionable work item.',
    body: '## Task brief\n\nThis sample task is ready to demonstrate task-page rendering.\n\n- Status: Open\n- Priority: Medium\n- Readiness: Ready\n\n## Definition of done\n\nComplete the example action and record the resulting decision or artifact.',
  },
  concepts: {
    summary: 'A fictional concept page used to demonstrate a durable idea or mental model.',
    body: '## Working definition\n\nThis example concept names a useful pattern without referencing a real project.\n\n## Signals\n\n- It clarifies a recurring question\n- It can be explained simply\n- It changes how a decision is made\n\n## Use\n\nConnect the concept to examples when a real page is available.',
  },
  writing: {
    summary: 'A fictional writing page used to demonstrate a draft or finished piece.',
    body: '## Draft\n\nThis is illustrative writing for the dashboard demo. It gives the reader enough texture to feel like a real document while keeping every detail synthetic.\n\n## Editorial note\n\nThe real page would continue with the argument, examples, and final polish.',
  },
  protocol: {
    summary: 'A fictional protocol page used to demonstrate repeatable operating guidance.',
    body: '## Purpose\n\nThis example protocol shows how a repeatable practice can be presented.\n\n## Steps\n\n1. Gather the relevant inputs.\n2. Make the smallest useful decision.\n3. Record the result and the next check.\n\n## Guardrail\n\nKeep the process clear enough that another person can run it.',
  },
  archive: {
    summary: 'A fictional archive page used to demonstrate a safely retained reference.',
    body: '## Archived reference\n\nThis example is retained for historical context only.\n\n- State: Archived\n- Relevance: Reference\n- Action: None required\n\n## Context\n\nA real archive entry would preserve its history here without being part of current work.',
  },
  'personal-protocol': {
    summary: 'A fictional personal protocol page used to demonstrate a private routine template.',
    body: '## Routine\n\nThis sample routine is intentionally generic.\n\n- Start with a short reset\n- Choose one priority\n- Close the loop before switching context\n\n## Reminder\n\nUse the real page for personal detail. This demo stays safely illustrative.',
  },
  health: {
    summary: 'A fictional health page used to demonstrate a wellbeing tracking template.',
    body: '## Check-in\n\nThis is a safe health example with no personal measurements.\n\n- Recovery: Example baseline\n- Movement: Light session\n- Focus: Notice trends\n\n## Reflection\n\nA real page could capture observations and adjustments here.',
  },
  sources: {
    summary: 'A fictional source page used to demonstrate evidence and reference capture.',
    body: '## Source note\n\nThis example source is a placeholder for a useful reference.\n\n## Key signal\n\nThe central point would be summarized here in a few clear sentences.\n\n## Application\n\nRecord why the source matters and where it should inform future work.',
  },
  inbox: {
    summary: 'A fictional inbox page used to demonstrate an incoming item awaiting triage.',
    body: '## Incoming item\n\nThis example represents a new item that has not yet been fully processed.\n\n## Triage\n\n- Clarify the request\n- Choose the owning page type\n- Decide the next action\n\n## Status\n\nAwaiting review in the demo workspace.',
  },
  dreams: {
    summary: 'A fictional dream page used to demonstrate a reflective note template.',
    body: '## Recall\n\nThis sample dream note uses atmospheric detail without any personal source material.\n\n## Motifs\n\n- A changing landscape\n- A familiar threshold\n- A question carried into the morning\n\n## Reflection\n\nKeep interpretation open and lightweight.',
  },
  ops: {
    summary: 'A fictional operations page used to demonstrate a system or runbook template.',
    body: '## Operating note\n\nThis example shows the shape of an operational reference.\n\n## Checklist\n\n- Confirm the system state\n- Make the smallest safe change\n- Verify the result\n- Record what changed\n\n## Owner\n\nDemo operations team.',
  },
  'dream-cycle-summaries': {
    summary: 'A fictional dream-cycle summary used to demonstrate a compact pattern review.',
    body: '## Pattern review\n\nThis example summarizes a fictional period of dream notes.\n\n## Recurring themes\n\n- Movement between places\n- Returning to unfinished questions\n- A preference for open endings\n\n## Next reflection\n\nNotice what changes without forcing a conclusion.',
  },
  page: {
    summary: 'A safe example page used to demonstrate the BigBrain page reader.',
    body: '## Example page\n\nThis is synthetic content for Demo mode. It is designed to show the reader layout without exposing any live page data.\n\n## What to notice\n\nThe title, structure, and details are all generated examples.',
  },
};

const TYPE_ALIASES = {
  company: 'companies',
  contact: 'people',
  person: 'people',
  organization: 'organizations',
  project: 'projects',
  task: 'tasks',
  meeting: 'meetings',
  idea: 'ideas',
  source: 'sources',
};

export function createDemoSeed() {
  return `demo-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export function buildDemoGraph(graph, seed = 'demo') {
  if (!graph || typeof graph !== 'object') return graph;
  return {
    ...graph,
    nodes: Array.isArray(graph.nodes)
      ? graph.nodes.map((node) => ({ ...node, title: demoTitleForNode(node, seed) }))
      : [],
  };
}

export function buildDemoTasks(tasks, seed = 'demo') {
  return (Array.isArray(tasks) ? tasks : []).map((task, index) => buildDemoTask(task, seed, index));
}

export function buildDemoTaskSections(sections, seed = 'demo') {
  return (Array.isArray(sections) ? sections : []).map((section) => ({
    ...section,
    items: Array.isArray(section?.items)
      ? section.items.map((task, index) => buildDemoTask(task, seed, index))
      : [],
  }));
}

export function buildDemoPagePreview(node, seed = 'demo') {
  const source = node && typeof node === 'object' ? node : {};
  const slug = String(source.slug || 'demo/page');
  const type = displayTypeForNode(source);
  const normalizedType = normalizeDemoType(type);
  const title = demoTitleForNode({ ...source, type, slug }, seed);
  const template = DEMO_TEMPLATES[normalizedType] || DEMO_TEMPLATES.page;
  return {
    status: 'ready',
    demo: true,
    slug,
    brain_id: 'demo',
    page_url_path: null,
    title,
    type,
    path: `demo/${normalizedType}/${slugify(title)}.md`,
    visibility: 'internal',
    public_url: null,
    summary: template.summary,
    frontmatter: { title, type, demo: true },
    markdown: `# ${title}\n\n${template.body}`,
    updated_at: '2026-01-01T00:00:00.000Z',
    links: { outgoing: [], backlinks: [] },
  };
}

export function buildDemoExplorer(explorer, seed = 'demo') {
  if (!explorer || typeof explorer !== 'object') return explorer;
  return {
    ...explorer,
    root: buildDemoExplorerEntry(explorer.root, seed),
    recent: explorer.recent
      ? {
        ...explorer.recent,
        files: Array.isArray(explorer.recent.files)
          ? explorer.recent.files.map((file) => buildDemoExplorerEntry(file, seed))
          : [],
      }
      : explorer.recent,
  };
}

export function buildDemoExplorerFile(filePath, fallback = {}, seed = 'demo') {
  const rawPath = String(filePath || 'demo/page.md');
  const slug = rawPath.replace(/\.(?:md|markdown)$/i, '');
  const type = normalizeDemoType(slug.split('/')[0] || 'page');
  const title = demoTitleForNode({ slug, type }, seed);
  const extension = rawPath.match(/\.([a-z0-9]+)$/i)?.[1]?.toLowerCase() || 'md';
  const isMarkdown = extension === 'md' || extension === 'markdown';
  const preview = buildDemoPagePreview({ slug, type }, seed);
  const safeName = `${slugify(title)}.${isMarkdown ? 'md' : extension}`;
  const safePath = `demo/${type}/${safeName}`;
  const text = isMarkdown
    ? `---\ntitle: ${preview.title}\ntype: ${preview.type}\ndemo: true\n---\n\n${preview.markdown}`
    : `Demo mode\n\nThis is a safe example preview for a ${type} file.`;
  return {
    ...fallback,
    demo: true,
    name: safeName,
    path: safePath,
    kind: isMarkdown ? 'markdown' : 'text',
    size: text.length,
    mime_type: isMarkdown ? 'text/markdown' : 'text/plain',
    text,
    blob_url: null,
  };
}

export function demoTitleForNode(node, seed = 'demo') {
  const type = normalizeDemoType(displayTypeForNode(node));
  const pool = DEMO_TITLE_POOLS[type] || DEMO_TITLE_POOLS.page;
  const key = String(node?.slug || node?.id || 'page');
  return pool[stableHash(`${seed}:${type}:${key}`) % pool.length];
}

function buildDemoTask(task, seed, index) {
  const source = task && typeof task === 'object' ? task : {};
  const title = demoTitleForNode({ ...source, type: 'tasks', slug: source.slug || `demo/task/${index}` }, seed);
  return {
    ...source,
    title,
    markdown: `# ${title}\n\nThis is a safe example task for Demo mode.\n\n- Status: ${String(source.status || 'open').replace(/_/g, ' ')}\n- Next step: Complete the illustrative action.`,
    assignees: [],
    invalid_assignees: [],
  };
}

function buildDemoExplorerEntry(entry, seed) {
  if (!entry || typeof entry !== 'object') return entry;
  if (entry.type === 'directory') {
    const pathValue = String(entry.path || '');
    const directoryType = normalizeDemoType(pathValue.split('/').filter(Boolean).pop() || 'page');
    return {
      ...entry,
      name: pathValue ? formatDirectoryName(directoryType) : 'brain',
      children: Array.isArray(entry.children)
        ? entry.children.map((child) => buildDemoExplorerEntry(child, seed))
        : entry.children,
    };
  }
  const pathValue = String(entry.path || entry.name || 'demo/page.md');
  const slug = pathValue.replace(/\.(?:md|markdown)$/i, '');
  const type = normalizeDemoType(slug.split('/')[0] || 'page');
  const title = demoTitleForNode({ slug, type }, seed);
  const extension = pathValue.match(/\.([a-z0-9]+)$/i)?.[1]?.toLowerCase() || 'md';
  return {
    ...entry,
    name: `${slugify(title)}.${extension}`,
  };
}

function displayTypeForNode(node) {
  const explicitType = String(node?.type || '').trim();
  if (explicitType) return explicitType;
  return String(node?.slug || '').split('/').filter(Boolean)[0] || 'page';
}

function normalizeDemoType(type) {
  const normalized = String(type || 'page').trim().toLowerCase() || 'page';
  return TYPE_ALIASES[normalized] || (DEMO_TITLE_POOLS[normalized] ? normalized : 'page');
}

function formatDirectoryName(type) {
  return type
    .split('-')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

function slugify(value) {
  return String(value || 'example')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'example';
}

function stableHash(value) {
  let hash = 2166136261;
  for (const character of String(value)) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}
