export const GRAPH_TYPE_ICON_NAMES = {
  people: 'UserRound',
  organizations: 'Building2',
  deals: 'Handshake',
  projects: 'FolderKanban',
  ideas: 'Lightbulb',
  meetings: 'CalendarDays',
  tasks: 'ListChecks',
  concepts: 'BrainCircuit',
  writing: 'PenLine',
  protocol: 'Workflow',
  archive: 'Archive',
  companies: 'Building2',
  'personal-protocol': 'ShieldCheck',
  health: 'HeartPulse',
  sources: 'BookOpen',
  inbox: 'Inbox',
  dreams: 'CloudMoon',
  ops: 'Settings2',
  'dream-cycle-summaries': 'MoonStar',
};

export const GRAPH_FALLBACK_ICON_NAMES = [
  'Box',
  'CircleDot',
  'Compass',
  'Landmark',
  'Shapes',
  'Sparkles',
];

export function getGraphTypeIconName(type) {
  const normalized = String(type || 'unknown').trim().toLowerCase() || 'unknown';
  if (GRAPH_TYPE_ICON_NAMES[normalized]) return GRAPH_TYPE_ICON_NAMES[normalized];
  return GRAPH_FALLBACK_ICON_NAMES[stableStringHash(normalized) % GRAPH_FALLBACK_ICON_NAMES.length];
}

function stableStringHash(value) {
  let hash = 2166136261;
  for (const character of value) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}
