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
    accent: '#d4d4d8',
    accentSoft: 'rgba(212,212,216,0.18)',
    accentStrong: '#fafafa',
    accentWarm: '#a1a1aa',
    danger: '#a44545',
    graphBase: '#18181B',
    graphInset: '#18181B',
    graphEdge: 'rgba(255,255,255,0.12)',
    graphEdgeStrong: 'rgba(244,244,245,0.32)',
    graphLabel: '#fafafa',
    graphMutedLabel: 'rgba(244,244,245,0.86)',
    graphHalo: 'rgba(255,255,255,0.08)',
    graphShadow: 'rgba(0,0,0,0.28)',
    graphGrid: 'rgba(255,255,255,0.06)',
    graphRing: 'rgba(255,255,255,0.12)',
    graphSweep: 'rgba(255,255,255,0.06)',
    graphCluster: 'rgba(255,255,255,0.08)',
    graphNodeStroke: 'rgba(244,244,245,0.88)',
  },
  dark: {
    pageBg: '#06111a',
    cardBg: 'rgba(7,17,28,0.88)',
    panelBg: '#071524',
    ink: '#e7f4ff',
    muted: '#8ea9c2',
    line: 'rgba(87,123,158,0.28)',
    lineStrong: 'rgba(110,157,202,0.42)',
    accent: '#d4d4d8',
    accentSoft: 'rgba(212,212,216,0.18)',
    accentStrong: '#fafafa',
    accentWarm: '#a1a1aa',
    danger: '#ff8f8f',
    graphBase: '#18181B',
    graphInset: '#18181B',
    graphEdge: 'rgba(255,255,255,0.12)',
    graphEdgeStrong: 'rgba(244,244,245,0.34)',
    graphLabel: '#fafafa',
    graphMutedLabel: 'rgba(244,244,245,0.86)',
    graphHalo: 'rgba(255,255,255,0.08)',
    graphShadow: 'rgba(0,0,0,0.32)',
    graphGrid: 'rgba(255,255,255,0.06)',
    graphRing: 'rgba(255,255,255,0.12)',
    graphSweep: 'rgba(255,255,255,0.06)',
    graphCluster: 'rgba(255,255,255,0.08)',
    graphNodeStroke: 'rgba(244,244,245,0.88)',
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
