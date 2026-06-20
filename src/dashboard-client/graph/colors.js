export const TYPE_COLORS = {
  people: '#8ecae6',
  companies: '#f7b7a3',
  projects: '#b8c0ff',
  meetings: '#d4b8ff',
  deals: '#ffb3c7',
  'personal-protocol': '#cdeccf',
  concepts: '#bfe7c6',
  writing: '#f6d7a7',
  inbox: '#ffd6a5',
};

export const TYPE_ORDER = ['people', 'companies', 'projects', 'meetings', 'deals', 'personal-protocol', 'concepts', 'writing', 'inbox'];

export const GRAPH_UPDATED_RECENT_COLOR = '#00FF66';
export const GRAPH_UPDATED_OLD_COLOR = '#FFFFFF';
export const GRAPH_UPDATED_SCALE_DAYS = 5;

export function getGraphNodeColor(node, colorMode = 'updated') {
  if (colorMode === 'type') {
    return TYPE_COLORS[node?.type] || GRAPH_UPDATED_OLD_COLOR;
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
