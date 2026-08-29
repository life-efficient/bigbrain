export const TYPE_ORDER = ['people', 'organizations', 'deals', 'projects', 'ideas', 'meetings', 'tasks', 'concepts', 'writing', 'protocol', 'archive', 'companies', 'personal-protocol', 'sources', 'ops', 'inbox'];

const SOFT_PALETTE = {
  people: '#8ECAE6',
  organizations: '#F7B7A3',
  companies: '#F7B7A3',
  deals: '#FFB3C7',
  projects: '#B8C0FF',
  ideas: '#FFE29A',
  meetings: '#D4B8FF',
  tasks: '#F6C85F',
  concepts: '#BFE7C6',
  writing: '#F6D7A7',
  protocol: '#CDECCF',
  archive: '#C4C4C4',
  'personal-protocol': '#CDECCF',
  sources: '#A7D8F0',
  ops: '#CDECCF',
  inbox: '#FFD6A5',
};

export const GRAPH_DEFAULT_PALETTE_ID = 'jarvis';

export const GRAPH_COLOR_PALETTES = [
  {
    id: 'jarvis',
    label: 'Jarvis',
    colors: {
      people: '#00E5FF',
      organizations: '#4DA3FF',
      companies: '#1D7AF2',
      deals: '#FFB000',
      projects: '#7C9CFF',
      ideas: '#FFD166',
      meetings: '#00B8D9',
      tasks: '#00E676',
      concepts: '#46E0B0',
      writing: '#FF8A3D',
      protocol: '#8BC34A',
      archive: '#8391A2',
      'personal-protocol': '#2DD4BF',
      sources: '#29B6F6',
      ops: '#A3E635',
      inbox: '#F97316',
    },
  },
  {
    id: 'terminal',
    label: 'Terminal',
    colors: {
      people: '#39FF14',
      organizations: '#00E5FF',
      companies: '#00BFA5',
      deals: '#FFD166',
      projects: '#7CFF00',
      ideas: '#F9F871',
      meetings: '#4DFFB5',
      tasks: '#A6FF4D',
      concepts: '#00FFC6',
      writing: '#FFB000',
      protocol: '#00FF66',
      archive: '#7F8C8D',
      'personal-protocol': '#00D084',
      sources: '#00B8D9',
      ops: '#B6F542',
      inbox: '#FF9F1C',
    },
  },
  {
    id: 'cobalt',
    label: 'Cobalt',
    colors: {
      people: '#38BDF8',
      organizations: '#60A5FA',
      companies: '#2563EB',
      deals: '#FB923C',
      projects: '#818CF8',
      ideas: '#FBBF24',
      meetings: '#22D3EE',
      tasks: '#34D399',
      concepts: '#14B8A6',
      writing: '#F97316',
      protocol: '#10B981',
      archive: '#64748B',
      'personal-protocol': '#0D9488',
      sources: '#0EA5E9',
      ops: '#84CC16',
      inbox: '#EA580C',
    },
  },
  {
    id: 'soft',
    label: 'Soft',
    colors: SOFT_PALETTE,
  },
  {
    id: 'crimson-loom',
    label: 'Crimson Loom',
    colors: {
      people: '#1769B0',
      organizations: '#B3263E',
      companies: '#8D172B',
      deals: '#D68724',
      projects: '#1F5AA6',
      ideas: '#E5A13A',
      meetings: '#A9474B',
      tasks: '#C96842',
      concepts: '#D18A7D',
      writing: '#E8C6B8',
      protocol: '#B75D55',
      archive: '#8D7777',
      'personal-protocol': '#8F3D4B',
      sources: '#4E7CA7',
      ops: '#C87A35',
      inbox: '#D33A3F',
    },
  },
  {
    id: 'neural-lumen',
    label: 'Neural Lumen',
    colors: {
      people: '#58D7FF',
      organizations: '#F0B36B',
      companies: '#2B9DDB',
      deals: '#F6D365',
      projects: '#72CFFF',
      ideas: '#FFE88A',
      meetings: '#8EEBFF',
      tasks: '#F4E27A',
      concepts: '#61C8C9',
      writing: '#F1B5AA',
      protocol: '#F5D46C',
      archive: '#71879A',
      'personal-protocol': '#B8A7D9',
      sources: '#9CEBFF',
      ops: '#D8C45F',
      inbox: '#F08A73',
    },
  },
];

export const GRAPH_COLOR_PALETTE_OPTIONS = [
  ...GRAPH_COLOR_PALETTES.map(({ id, label }) => ({ id, label })),
  { id: 'custom', label: 'Custom' },
];

// Defined separately so palette lookup is safe while TYPE_COLORS is initialized.
const TYPE_COLORS_FALLBACK = SOFT_PALETTE;

export const TYPE_COLORS = getGraphColorPalette(GRAPH_DEFAULT_PALETTE_ID);

export const GRAPH_UPDATED_RECENT_COLOR = '#00FF66';
export const GRAPH_UPDATED_OLD_COLOR = '#FFFFFF';
export const GRAPH_UPDATED_SCALE_DAYS = 5;

export function getGraphColorPalette(paletteId) {
  return GRAPH_COLOR_PALETTES.find((palette) => palette.id === paletteId)?.colors
    || GRAPH_COLOR_PALETTES.find((palette) => palette.id === GRAPH_DEFAULT_PALETTE_ID)?.colors
    || TYPE_COLORS_FALLBACK;
}

export function sanitizeGraphTypeColors(colors, fallback = TYPE_COLORS_FALLBACK) {
  const next = { ...fallback };
  for (const type of TYPE_ORDER) {
    if (isGraphHexColor(colors?.[type])) next[type] = colors[type].toUpperCase();
  }
  return next;
}

export function isGraphHexColor(value) {
  return /^#[0-9A-F]{6}$/i.test(String(value || ''));
}

export function getGraphNodeColor(node, colorMode = 'updated', typeColors = TYPE_COLORS) {
  if (colorMode === 'none') {
    return null;
  }
  if (colorMode === 'type') {
    return typeColors?.[node?.type] || TYPE_COLORS[node?.type] || GRAPH_UPDATED_OLD_COLOR;
  }
  return getUpdatedNodeColor(node?.updated_at);
}

export function getUpdatedNodeColor(updatedAt, nowMs = Date.now()) {
  const timestamp = Date.parse(updatedAt || '');
  if (!Number.isFinite(timestamp)) return GRAPH_UPDATED_OLD_COLOR;

  const ageDays = Math.max(0, (nowMs - timestamp) / (24 * 60 * 60 * 1000));
  const progress = clamp(ageDays / GRAPH_UPDATED_SCALE_DAYS, 0, 1);
  const eased = 1 - Math.pow(1 - progress, 2);
  return mixHexColor(GRAPH_UPDATED_RECENT_COLOR, GRAPH_UPDATED_OLD_COLOR, eased);
}

function mixHexColor(fromHex, toHex, amount) {
  const from = parseHexColor(fromHex);
  const to = parseHexColor(toHex);
  const next = from.map((channel, index) => Math.round(channel + (to[index] - channel) * amount));
  return `#${next.map((channel) => channel.toString(16).padStart(2, '0')).join('')}`.toUpperCase();
}

function parseHexColor(value) {
  const normalized = String(value || '').replace(/^#/, '');
  if (!/^[0-9a-f]{6}$/i.test(normalized)) return [255, 255, 255];
  return [
    Number.parseInt(normalized.slice(0, 2), 16),
    Number.parseInt(normalized.slice(2, 4), 16),
    Number.parseInt(normalized.slice(4, 6), 16),
  ];
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}
