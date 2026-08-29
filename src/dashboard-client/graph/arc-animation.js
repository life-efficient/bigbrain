export const GRAPH_ARC_ANIMATIONS = [
  { id: 'none', label: 'None' },
  { id: 'instant', label: 'Instant' },
  { id: 'grow', label: 'Grow' },
  { id: 'shoot', label: 'Shoot' },
];

const ARC_ANIMATION_DURATION = 620;

export function startArcAnimation(target, mode, links, onFrame) {
  cancelArcAnimation(target);
  const normalizedMode = mode === 'grow' || mode === 'shoot' ? mode : mode === 'none' ? 'none' : 'instant';
  const state = {
    mode: normalizedMode,
    links,
    progress: normalizedMode === 'grow' || normalizedMode === 'shoot' ? 0 : normalizedMode === 'instant' ? 1 : 0,
    frame: 0,
    startedAt: typeof performance !== 'undefined' ? performance.now() : 0,
  };
  target.__bigBrainArcAnimation = state;
  onFrame?.(state.progress, state);
  if (state.mode !== 'grow' && state.mode !== 'shoot') return state;

  const tick = (time) => {
    state.progress = Math.min(1, Math.max(0, (time - state.startedAt) / ARC_ANIMATION_DURATION));
    onFrame?.(state.progress, state);
    if (state.progress < 1) state.frame = window.requestAnimationFrame(tick);
    else state.frame = 0;
  };
  state.frame = window.requestAnimationFrame(tick);
  return state;
}

export function cancelArcAnimation(target) {
  const state = target?.__bigBrainArcAnimation;
  if (state?.frame) window.cancelAnimationFrame(state.frame);
  if (target) target.__bigBrainArcAnimation = null;
}

export function arcAnimationProgress(target, link) {
  const state = target?.__bigBrainArcAnimation;
  if (!state?.links?.has(link)) return 0;
  return state.mode === 'none' ? 0 : state.mode === 'instant' ? 1 : state.progress;
}

export function blendArcColors(start, end, progress) {
  const from = parseHex(start);
  const to = parseHex(end);
  if (!from || !to) return end;
  const amount = Math.min(1, Math.max(0, progress));
  return `#${[0, 1, 2].map((index) => Math.round(from[index] + (to[index] - from[index]) * amount).toString(16).padStart(2, '0')).join('')}`;
}

function parseHex(value) {
  const match = /^#([0-9a-f]{6})$/i.exec(String(value || ''));
  if (!match) return null;
  return [0, 1, 2].map((index) => Number.parseInt(match[1].slice(index * 2, index * 2 + 2), 16));
}
