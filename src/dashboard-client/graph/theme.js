export const GRAPH_THEME_MODES = ['auto', 'light', 'dark'];

export const GRAPH_THEME_TOKENS = {
  light: {
    pageBg: '#f4f7fb',
    cardBg: 'rgba(255,255,255,0.9)',
    panelBg: '#ffffff',
    ink: '#172033',
    muted: '#667085',
    line: 'rgba(148,163,184,0.22)',
    lineStrong: 'rgba(148,163,184,0.34)',
    accent: '#44d7ff',
    accentSoft: 'rgba(68,215,255,0.18)',
    accentStrong: '#09b8f2',
    accentWarm: '#9df7ff',
    danger: '#a44545',
    graphBase: '#f8fbff',
    graphInset: '#eef5ff',
    graphEdge: 'rgba(57,80,120,0.18)',
    graphEdgeStrong: 'rgba(32,192,255,0.42)',
    graphLabel: '#20324f',
    graphMutedLabel: 'rgba(32,50,79,0.68)',
    graphHalo: 'rgba(82,228,255,0.22)',
    graphShadow: 'rgba(23,32,51,0.14)',
    graphGrid: 'rgba(62,102,153,0.11)',
    graphRing: 'rgba(35,159,214,0.18)',
    graphSweep: 'rgba(82,228,255,0.12)',
    graphCluster: 'rgba(116,193,255,0.13)',
    graphNodeStroke: 'rgba(255,255,255,0.9)',
  },
  dark: {
    pageBg: '#06111a',
    cardBg: 'rgba(7,17,28,0.88)',
    panelBg: '#071524',
    ink: '#e7f4ff',
    muted: '#8ea9c2',
    line: 'rgba(87,123,158,0.28)',
    lineStrong: 'rgba(110,157,202,0.42)',
    accent: '#5cf1ff',
    accentSoft: 'rgba(92,241,255,0.16)',
    accentStrong: '#30cfff',
    accentWarm: '#b4f9ff',
    danger: '#ff8f8f',
    graphBase: '#07101b',
    graphInset: '#08192a',
    graphEdge: 'rgba(107,165,214,0.18)',
    graphEdgeStrong: 'rgba(92,241,255,0.45)',
    graphLabel: '#dff6ff',
    graphMutedLabel: 'rgba(205,233,255,0.72)',
    graphHalo: 'rgba(92,241,255,0.24)',
    graphShadow: 'rgba(0,0,0,0.32)',
    graphGrid: 'rgba(92,163,219,0.14)',
    graphRing: 'rgba(92,241,255,0.18)',
    graphSweep: 'rgba(92,241,255,0.16)',
    graphCluster: 'rgba(92,241,255,0.12)',
    graphNodeStroke: 'rgba(198,239,255,0.86)',
  },
};

export function resolveThemeMode(themeMode, prefersDark = false) {
  if (themeMode === 'dark') return 'dark';
  if (themeMode === 'light') return 'light';
  return prefersDark ? 'dark' : 'light';
}

export function getGraphThemeTokens(resolvedTheme) {
  return GRAPH_THEME_TOKENS[resolvedTheme] || GRAPH_THEME_TOKENS.light;
}
