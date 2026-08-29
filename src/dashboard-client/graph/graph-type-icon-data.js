import { getGraphTypeIconName } from './type-icons.js';

// The force renderers need the same Lucide artwork as the SVG renderers, but
// they draw into canvas or Three.js textures instead of a React SVG tree.
export const GRAPH_TYPE_ICON_PATHS = {
  UserRound: [['circle', { cx: '12', cy: '8', r: '5' }], ['path', { d: 'M20 21a8 8 0 0 0-16 0' }]],
  Building2: [['path', { d: 'M6 22V4a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v18Z' }], ['path', { d: 'M6 12H4a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2h2' }], ['path', { d: 'M18 9h2a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2h-2' }], ['path', { d: 'M10 6h4' }], ['path', { d: 'M10 10h4' }], ['path', { d: 'M10 14h4' }], ['path', { d: 'M10 18h4' }]],
  Handshake: [['path', { d: 'm11 17 2 2a1 1 0 1 0 3-3' }], ['path', { d: 'm14 14 2.5 2.5a1 1 0 1 0 3-3l-3.88-3.88a3 3 0 0 0-4.24 0l-.88.88a1 1 0 1 1-3-3l2.81-2.81a5.79 5.79 0 0 1 7.06-.87l.47.28a2 2 0 0 0 1.42.25L21 4' }], ['path', { d: 'm21 3 1 11h-2' }], ['path', { d: 'M3 3 2 14l6.5 6.5a1 1 0 1 0 3-3' }], ['path', { d: 'M3 4h8' }]],
  FolderKanban: [['path', { d: 'M4 20h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.93a2 2 0 0 1-1.66-.9l-.82-1.2A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13c0 1.1.9 2 2 2Z' }], ['path', { d: 'M8 10v4' }], ['path', { d: 'M12 10v2' }], ['path', { d: 'M16 10v6' }]],
  Lightbulb: [['path', { d: 'M15 14c.2-1 .7-1.7 1.5-2.5 1-.9 1.5-2.2 1.5-3.5A6 6 0 0 0 6 8c0 1 .2 2.2 1.5 3.5.7.7 1.3 1.5 1.5 2.5' }], ['path', { d: 'M9 18h6' }], ['path', { d: 'M10 22h4' }]],
  CalendarDays: [['path', { d: 'M8 2v4' }], ['path', { d: 'M16 2v4' }], ['rect', { width: '18', height: '18', x: '3', y: '4', rx: '2' }], ['path', { d: 'M3 10h18' }], ['path', { d: 'M8 14h.01' }], ['path', { d: 'M12 14h.01' }], ['path', { d: 'M16 14h.01' }], ['path', { d: 'M8 18h.01' }], ['path', { d: 'M12 18h.01' }], ['path', { d: 'M16 18h.01' }]],
  ListChecks: [['path', { d: 'm3 17 2 2 4-4' }], ['path', { d: 'm3 7 2 2 4-4' }], ['path', { d: 'M13 6h8' }], ['path', { d: 'M13 12h8' }], ['path', { d: 'M13 18h8' }]],
  BrainCircuit: [['path', { d: 'M12 5a3 3 0 1 0-5.997.125 4 4 0 0 0-2.526 5.77 4 4 0 0 0 .556 6.588A4 4 0 1 0 12 18Z' }], ['path', { d: 'M9 13a4.5 4.5 0 0 0 3-4' }], ['path', { d: 'M6.003 5.125A3 3 0 0 0 6.401 6.5' }], ['path', { d: 'M3.477 10.896a4 4 0 0 1 .585-.396' }], ['path', { d: 'M6 18a4 4 0 0 1-1.967-.516' }], ['path', { d: 'M12 13h4' }], ['path', { d: 'M12 18h6a2 2 0 0 1 2 2v1' }], ['path', { d: 'M12 8h8' }], ['path', { d: 'M16 8V5a2 2 0 0 1 2-2' }], ['circle', { cx: '16', cy: '13', r: '.5' }], ['circle', { cx: '18', cy: '3', r: '.5' }], ['circle', { cx: '20', cy: '21', r: '.5' }], ['circle', { cx: '20', cy: '8', r: '.5' }]],
  PenLine: [['path', { d: 'M12 20h9' }], ['path', { d: 'M16.376 3.622a1 1 0 0 1 3.002 3.002L7.368 18.635a2 2 0 0 1-.855.506l-2.872.838a.5.5 0 0 1-.62-.62l.838-2.872a2 2 0 0 1 .506-.854z' }]],
  Workflow: [['rect', { width: '8', height: '8', x: '3', y: '3', rx: '2' }], ['path', { d: 'M7 11v4a2 2 0 0 0 2 2h4' }], ['rect', { width: '8', height: '8', x: '13', y: '13', rx: '2' }]],
  Archive: [['rect', { width: '20', height: '5', x: '2', y: '3', rx: '1' }], ['path', { d: 'M4 8v11a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8' }], ['path', { d: 'M10 12h4' }]],
  HeartPulse: [['path', { d: 'M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z' }], ['path', { d: 'M3.22 12H9.5l.5-1 2 4.5 2-7 1.5 3.5h5.27' }]],
  BookOpen: [['path', { d: 'M12 7v14' }], ['path', { d: 'M3 18a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h5a4 4 0 0 1 4 4 4 4 0 0 1 4-4h5a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1h-6a3 3 0 0 0-3 3 3 3 0 0 0-3-3z' }]],
  Inbox: [['polyline', { points: '22 12 16 12 14 15 10 15 8 12 2 12' }], ['path', { d: 'M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z' }]],
  CloudMoon: [['path', { d: 'M10.188 8.5A6 6 0 0 1 16 4a1 1 0 0 0 6 6 6 6 0 0 1-3 5.197' }], ['path', { d: 'M13 16a3 3 0 1 1 0 6H7a5 5 0 1 1 4.9-6Z' }]],
  Settings2: [['path', { d: 'M20 7h-9' }], ['path', { d: 'M14 17H5' }], ['circle', { cx: '17', cy: '17', r: '3' }], ['circle', { cx: '7', cy: '7', r: '3' }]],
  MoonStar: [['path', { d: 'M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9' }], ['path', { d: 'M20 3v4' }], ['path', { d: 'M22 5h-4' }]],
  ShieldCheck: [['path', { d: 'M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z' }], ['path', { d: 'm9 12 2 2 4-4' }]],
  Box: [['path', { d: 'M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z' }], ['path', { d: 'm3.3 7 8.7 5 8.7-5' }], ['path', { d: 'M12 22V12' }]],
  CircleDot: [['circle', { cx: '12', cy: '12', r: '10' }], ['circle', { cx: '12', cy: '12', r: '1' }]],
  Compass: [['path', { d: 'm16.24 7.76-1.804 5.411a2 2 0 0 1-1.265 1.265L7.76 16.24l1.804-5.411a2 2 0 0 1 1.265-1.265z' }], ['circle', { cx: '12', cy: '12', r: '10' }]],
  Landmark: [['line', { x1: '3', x2: '21', y1: '22', y2: '22' }], ['line', { x1: '6', x2: '6', y1: '18', y2: '11' }], ['line', { x1: '10', x2: '10', y1: '18', y2: '11' }], ['line', { x1: '14', x2: '14', y1: '18', y2: '11' }], ['line', { x1: '18', x2: '18', y1: '18', y2: '11' }], ['polygon', { points: '12 2 20 7 4 7' }]],
  Shapes: [['path', { d: 'M8.3 10a.7.7 0 0 1-.626-1.079L11.4 3a.7.7 0 0 1 1.198-.043L16.3 8.9a.7.7 0 0 1-.572 1.1Z' }], ['rect', { x: '3', y: '14', width: '7', height: '7', rx: '1' }], ['circle', { cx: '17.5', cy: '17.5', r: '3.5' }]],
  Sparkles: [['path', { d: 'M9.937 15.5A2 2 0 0 0 8.5 14.063l-6.135-1.582a.5.5 0 0 1 0-.962L8.5 9.936A2 2 0 0 0 9.937 8.5l1.582-6.135a.5.5 0 0 1 .963 0L14.063 8.5A2 2 0 0 0 15.5 9.937l6.135 1.581a.5.5 0 0 1 0 .964L15.5 14.063a2 2 0 0 0-1.437 1.437l-1.582 6.135a.5.5 0 0 1-.963 0z' }], ['path', { d: 'M20 3v4' }], ['path', { d: 'M22 5h-4' }], ['path', { d: 'M4 17v2' }], ['path', { d: 'M5 18H3' }]],
};

export function getGraphTypeIconPathData(type) {
  return GRAPH_TYPE_ICON_PATHS[getGraphTypeIconName(type)] || GRAPH_TYPE_ICON_PATHS.Shapes;
}

export function graphTypeIconSvg(type, { color = '#FFFFFF', iconStyle = 'outline' } = {}) {
  if (iconStyle === 'none') return null;
  const solid = iconStyle === 'solid';
  const children = getGraphTypeIconPathData(type).map(([tag, attributes]) => {
    const serialized = Object.entries(attributes).map(([key, value]) => `${key}="${value}"`).join(' ');
    return `<${tag} ${serialized} />`;
  }).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="${solid ? color : 'none'}" stroke="${color}" stroke-width="${solid ? 2.2 : 1.85}" stroke-linecap="round" stroke-linejoin="round">${children}</svg>`;
}
