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
  {
    id: 'thermal',
    label: 'Thermal',
    colors: {
      people: '#00B8FF',
      organizations: '#FF6A00',
      companies: '#FF2600',
      deals: '#FFEA00',
      projects: '#2455FF',
      ideas: '#C8FF00',
      meetings: '#00E5FF',
      tasks: '#76FF00',
      concepts: '#00FF7A',
      writing: '#FF9D00',
      protocol: '#B7FF00',
      archive: '#5268A8',
      'personal-protocol': '#00D9C0',
      sources: '#008CFF',
      ops: '#FFB000',
      inbox: '#FF00A8',
    },
  },
  {
    id: 'irezumi',
    label: 'Irezumi',
    colors: {
      people: '#47BFC0',
      organizations: '#E14A2B',
      companies: '#252525',
      deals: '#D9952F',
      projects: '#8584A7',
      ideas: '#F2A126',
      meetings: '#5AC5C2',
      tasks: '#E96B31',
      concepts: '#A7A5B8',
      writing: '#F6E6D0',
      protocol: '#C85B4A',
      archive: '#777777',
      'personal-protocol': '#A56B49',
      sources: '#3A9FA9',
      ops: '#C99035',
      inbox: '#EF6351',
    },
  },
  {
    id: 'desert',
    label: 'Desert',
    colors: {
      people: '#A79B70', organizations: '#766B45', companies: '#4D4933', deals: '#B68A45',
      projects: '#8E845B', ideas: '#C2A86A', meetings: '#6A6245', tasks: '#9B783E',
      concepts: '#B0A889', writing: '#D1C29A', protocol: '#81764F', archive: '#625F4B',
      'personal-protocol': '#927F57', sources: '#77745D', ops: '#B39A5F', inbox: '#A66B3D',
    },
  },
  {
    id: 'arctic',
    label: 'Arctic',
    colors: {
      people: '#D4D7D9', organizations: '#AEB4BA', companies: '#72777D', deals: '#E3E4E3',
      projects: '#BFC5CA', ideas: '#F0F0EC', meetings: '#969CA2', tasks: '#C9CDD0',
      concepts: '#858B91', writing: '#E5E6E4', protocol: '#A2A8AD', archive: '#555B61',
      'personal-protocol': '#777D83', sources: '#BBC2C8', ops: '#D8D9D6', inbox: '#92979B',
    },
  },
  {
    id: 'woodland',
    label: 'Woodland',
    colors: {
      people: '#626C50', organizations: '#464C38', companies: '#252B21', deals: '#7C704A',
      projects: '#566149', ideas: '#8A8055', meetings: '#394332', tasks: '#6E7952',
      concepts: '#73765A', writing: '#A19A76', protocol: '#4D583E', archive: '#30372B',
      'personal-protocol': '#596045', sources: '#65705A', ops: '#85764C', inbox: '#765E3D',
    },
  },
  {
    id: 'digital',
    label: 'Digital',
    colors: {
      people: '#777A7D', organizations: '#5C6063', companies: '#303235', deals: '#919497',
      projects: '#686B70', ideas: '#A0A2A3', meetings: '#45484B', tasks: '#85888A',
      concepts: '#6F7274', writing: '#B2B3B1', protocol: '#55585B', archive: '#292B2D',
      'personal-protocol': '#66686A', sources: '#878A8C', ops: '#9A9690', inbox: '#4B4D50',
    },
  },
  {
    id: 'urban',
    label: 'Urban',
    colors: {
      people: '#74777A', organizations: '#505357', companies: '#292C2F', deals: '#9C4A48',
      projects: '#62666A', ideas: '#A35B55', meetings: '#3E4246', tasks: '#7D5551',
      concepts: '#858789', writing: '#B0B0AB', protocol: '#5C5F60', archive: '#35383B',
      'personal-protocol': '#6E5554', sources: '#687075', ops: '#8F4844', inbox: '#A44442',
    },
  },
  {
    id: 'blue-tiger',
    label: 'Blue Tiger',
    colors: {
      people: '#839CC5', organizations: '#52698F', companies: '#263B60', deals: '#9EACC7',
      projects: '#6883B0', ideas: '#A6B8D5', meetings: '#435B83', tasks: '#7993BD',
      concepts: '#71819B', writing: '#BBC7D9', protocol: '#4F709F', archive: '#27344E',
      'personal-protocol': '#5E769E', sources: '#6889BA', ops: '#8C9CB9', inbox: '#5676AF',
    },
  },
  {
    id: 'red-tiger',
    label: 'Red Tiger',
    colors: {
      people: '#D65A54', organizations: '#A62E31', companies: '#4B171D', deals: '#E27852',
      projects: '#B83A3D', ideas: '#E88955', meetings: '#7D2028', tasks: '#C94943',
      concepts: '#A64A43', writing: '#F0A079', protocol: '#8B252D', archive: '#35161C',
      'personal-protocol': '#9E3438', sources: '#B74C4A', ops: '#D05E43', inbox: '#E53E36',
    },
  },
  {
    id: 'fall',
    label: 'Fall',
    colors: {
      people: '#A56E38', organizations: '#7A4F2D', companies: '#3F3029', deals: '#D08A28',
      projects: '#8E5A2F', ideas: '#C79A3A', meetings: '#67452D', tasks: '#B56A2C',
      concepts: '#96724A', writing: '#D9B26E', protocol: '#87552D', archive: '#4B3B30',
      'personal-protocol': '#98653A', sources: '#7E684A', ops: '#C47D2D', inbox: '#B64A2E',
    },
  },
  {
    id: 'spectral',
    label: 'Spectral',
    colors: {
      people: '#B9DDE1', organizations: '#6F818B', companies: '#27343B', deals: '#A48C6A',
      projects: '#8DA9B4', ideas: '#DCECEF', meetings: '#9BC7CD', tasks: '#C7E5E7',
      concepts: '#78919B', writing: '#EEF7F5', protocol: '#5E747C', archive: '#3B474D',
      'personal-protocol': '#718D95', sources: '#A6D4D9', ops: '#9A8364', inbox: '#B1CACE',
    },
  },
  {
    id: 'aegis',
    label: 'Aegis',
    colors: {
      people: '#D9E0E4', organizations: '#B7BEC3', companies: '#252B30', deals: '#C6A45B',
      projects: '#AEB8BE', ideas: '#E8E9E5', meetings: '#C8D0D3', tasks: '#D0B36A',
      concepts: '#9DA6AC', writing: '#F4F5F1', protocol: '#8E979C', archive: '#4A5156',
      'personal-protocol': '#A9976D', sources: '#C2CDD1', ops: '#B88E3D', inbox: '#D1B66F',
    },
  },
  {
    id: 'inferno',
    label: 'Inferno',
    colors: {
      people: '#FF6A2A', organizations: '#D52B1E', companies: '#481116', deals: '#FFB12B',
      projects: '#A7191D', ideas: '#FF8B32', meetings: '#E43A21', tasks: '#FF5A24',
      concepts: '#B83A2C', writing: '#F09A62', protocol: '#8F171B', archive: '#332326',
      'personal-protocol': '#9E4B32', sources: '#C93A27', ops: '#E67A24', inbox: '#FF3B1F',
    },
  },
  {
    id: 'frostveil',
    label: 'Frostveil',
    colors: {
      people: '#B8E2F2', organizations: '#8C9DAF', companies: '#1C2A3D', deals: '#B7A277',
      projects: '#6D91B3', ideas: '#DDEBF0', meetings: '#9FC8DB', tasks: '#8AA8C1',
      concepts: '#7569A9', writing: '#F1F5F3', protocol: '#536B84', archive: '#394451',
      'personal-protocol': '#655596', sources: '#7DB6D1', ops: '#A18A5C', inbox: '#D47D7F',
    },
  },
  {
    id: 'kusama',
    label: 'Kusama',
    colors: {
      people: '#13BDEB', organizations: '#F31B5B', companies: '#17151D', deals: '#FFD21F',
      projects: '#7C16D8', ideas: '#F7E900', meetings: '#FF4E9A', tasks: '#7CE315',
      concepts: '#16C79A', writing: '#FFFDF5', protocol: '#D70D3C', archive: '#47434C',
      'personal-protocol': '#A91CD0', sources: '#087ED1', ops: '#FF9F0A', inbox: '#F20D24',
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
