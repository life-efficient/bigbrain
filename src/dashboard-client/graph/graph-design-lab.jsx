import React, { useEffect, useState } from 'react';

const VARIANTS = [
  {
    id: 'aurora',
    index: '01',
    name: 'Aurora Field',
    description: 'A luminous knowledge field with soft hierarchy and signal trails.',
    tags: ['glow', 'clusters', 'calm'],
  },
  {
    id: 'console',
    index: '02',
    name: 'Orbit Console',
    description: 'A dark command surface that makes the graph feel operational.',
    tags: ['orbit', 'telemetry', 'precision'],
  },
  {
    id: 'editorial',
    index: '03',
    name: 'Signal Atlas',
    description: 'A crisp editorial map that turns relationships into readable structure.',
    tags: ['contrast', 'index', 'clarity'],
  },
];

const NODES = [
  { id: 'core', x: 50, y: 38, label: 'BigBrain', group: 'core', radius: 7 },
  { id: 'people', x: 25, y: 21, label: 'People', group: 'people', radius: 4.2 },
  { id: 'deals', x: 75, y: 21, label: 'Deals', group: 'deals', radius: 4.2 },
  { id: 'ops', x: 23, y: 56, label: 'Ops', group: 'ops', radius: 4.2 },
  { id: 'ideas', x: 73, y: 56, label: 'Ideas', group: 'ideas', radius: 4.2 },
  { id: 'projects', x: 50, y: 66, label: 'Projects', group: 'projects', radius: 4.2 },
  { id: 'meetings', x: 88, y: 38, label: 'Meetings', group: 'meetings', radius: 3.8 },
  { id: 'archive', x: 12, y: 38, label: 'Archive', group: 'archive', radius: 3.8 },
  { id: 'p1', x: 15, y: 12, group: 'people', radius: 2 },
  { id: 'p2', x: 33, y: 10, group: 'people', radius: 1.8 },
  { id: 'p3', x: 12, y: 26, group: 'people', radius: 1.7 },
  { id: 'd1', x: 66, y: 9, group: 'deals', radius: 1.9 },
  { id: 'd2', x: 86, y: 13, group: 'deals', radius: 1.7 },
  { id: 'd3', x: 91, y: 26, group: 'deals', radius: 1.8 },
  { id: 'o1', x: 10, y: 62, group: 'ops', radius: 1.8 },
  { id: 'o2', x: 31, y: 68, group: 'ops', radius: 1.8 },
  { id: 'i1', x: 67, y: 68, group: 'ideas', radius: 1.8 },
  { id: 'i2', x: 87, y: 64, group: 'ideas', radius: 1.8 },
  { id: 'm1', x: 93, y: 47, group: 'meetings', radius: 1.7 },
  { id: 'a1', x: 7, y: 47, group: 'archive', radius: 1.7 },
];

const EDGES = [
  ['core', 'people'], ['core', 'deals'], ['core', 'ops'], ['core', 'ideas'],
  ['core', 'projects'], ['core', 'meetings'], ['core', 'archive'],
  ['people', 'p1'], ['people', 'p2'], ['people', 'p3'], ['deals', 'd1'],
  ['deals', 'd2'], ['deals', 'd3'], ['ops', 'o1'], ['ops', 'o2'],
  ['ideas', 'i1'], ['ideas', 'i2'], ['meetings', 'm1'], ['archive', 'a1'],
  ['people', 'meetings'], ['deals', 'ideas'], ['ops', 'projects'],
  ['projects', 'ideas'],
];

const NODE_BY_ID = new Map(NODES.map((node) => [node.id, node]));

export function GraphDesignLabApp() {
  const [focusId, setFocusId] = useState('all');

  useEffect(() => {
    function onKeyDown(event) {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if (event.key === '0') setFocusId('all');
      if (event.key === '1') setFocusId('aurora');
      if (event.key === '2') setFocusId('console');
      if (event.key === '3') setFocusId('editorial');
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  const visibleVariants = focusId === 'all'
    ? VARIANTS
    : VARIANTS.filter((variant) => variant.id === focusId);

  return (
    <main className="design-lab-page">
      <header className="design-lab-head">
        <div>
          <div className="design-lab-breadcrumb">BIGBRAIN <span>/</span> GRAPH LAB</div>
          <h1>Three directions for the next graph.</h1>
          <p>Fast visual study with the same relationship model, three different product languages.</p>
        </div>
        <div className="design-lab-meta">
          <span className="design-lab-live"><i /> concept mode</span>
          <span>mock network · 20 nodes · 23 links</span>
        </div>
      </header>

      <nav className="design-lab-switcher" aria-label="Graph design variations">
        <button
          type="button"
          className={focusId === 'all' ? 'active' : ''}
          aria-pressed={focusId === 'all'}
          onClick={() => setFocusId('all')}
        >
          <span>Compare all</span><kbd>0</kbd>
        </button>
        {VARIANTS.map((variant) => (
          <button
            key={variant.id}
            type="button"
            className={focusId === variant.id ? 'active' : ''}
            aria-pressed={focusId === variant.id}
            onClick={() => setFocusId(variant.id)}
          >
            <span>{variant.index} {variant.name}</span><kbd>{variant.index.replace(/^0/, '')}</kbd>
          </button>
        ))}
      </nav>

      <section className={`design-lab-grid ${focusId !== 'all' ? 'is-focused' : ''}`} aria-label="Graph design concepts">
        {visibleVariants.map((variant) => (
          <DesignCard
            key={variant.id}
            variant={variant}
            focused={focusId === variant.id}
            onFocus={() => setFocusId(variant.id)}
          />
        ))}
      </section>

      <footer className="design-lab-foot">
        <span>Use 1 / 2 / 3 to focus a direction</span>
        <span>Concept surface only · no live data connected</span>
      </footer>
    </main>
  );
}

function DesignCard({ variant, focused, onFocus }) {
  return (
    <article className={`design-card design-card-${variant.id} ${focused ? 'is-focused' : ''}`}>
      <div className="design-card-head">
        <div>
          <div className="design-card-kicker"><span>{variant.index}</span> / DIRECTION</div>
          <h2>{variant.name}</h2>
          <p>{variant.description}</p>
        </div>
        {!focused ? (
          <button type="button" className="design-focus-button" onClick={onFocus}>Focus <span>↗</span></button>
        ) : <span className="design-focus-state">Focused</span>}
      </div>
      <div className="design-canvas-shell">
        <DesignCanvas variant={variant} />
        <div className="design-canvas-coordinates"><span>00</span><span>100</span></div>
      </div>
      <div className="design-card-foot">
        <div className="design-tag-list">
          {variant.tags.map((tag) => <span key={tag}>{tag}</span>)}
        </div>
        <span className="design-card-status"><i /> prototype</span>
      </div>
    </article>
  );
}

function DesignCanvas({ variant }) {
  const isAurora = variant.id === 'aurora';
  const isConsole = variant.id === 'console';
  const isEditorial = variant.id === 'editorial';
  const prefix = `design-${variant.id}`;

  return (
    <svg className={`design-canvas design-canvas-${variant.id}`} viewBox="0 0 100 74" role="img" aria-label={`${variant.name} graph concept`}>
      <defs>
        <linearGradient id={`${prefix}-surface`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor={isEditorial ? '#f4f0e8' : '#0a0d17'} />
          <stop offset="1" stopColor={isEditorial ? '#e7e1d5' : '#13172a'} />
        </linearGradient>
        <radialGradient id={`${prefix}-core`} cx="35%" cy="28%">
          <stop offset="0" stopColor={isAurora ? '#d9fbff' : isConsole ? '#fff2b2' : '#ffffff'} />
          <stop offset="0.35" stopColor={isAurora ? '#77d8ff' : isConsole ? '#ffc95c' : '#315df5'} />
          <stop offset="1" stopColor={isAurora ? '#6f45ff' : isConsole ? '#ff5b63' : '#17265d'} />
        </radialGradient>
        <filter id={`${prefix}-glow`} x="-200%" y="-200%" width="400%" height="400%">
          <feGaussianBlur stdDeviation="1.8" result="blur" />
          <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
        </filter>
        <filter id={`${prefix}-soft-glow`} x="-200%" y="-200%" width="400%" height="400%">
          <feGaussianBlur stdDeviation="4" />
        </filter>
      </defs>

      <rect className="design-canvas-bg" width="100" height="74" fill={`url(#${prefix}-surface)`} />
      {isAurora ? <AuroraBackdrop /> : null}
      {isConsole ? <ConsoleBackdrop /> : null}
      {isEditorial ? <EditorialBackdrop /> : null}

      <g className="design-edges">
        {EDGES.map(([fromId, toId], index) => {
          const from = NODE_BY_ID.get(fromId);
          const to = NODE_BY_ID.get(toId);
          const bend = isAurora ? (index % 2 ? 3 : -3) : 0;
          const d = `M ${from.x} ${from.y} Q ${(from.x + to.x) / 2 + bend} ${(from.y + to.y) / 2 - bend} ${to.x} ${to.y}`;
          return <path key={`${fromId}-${toId}`} d={d} className={`design-edge design-edge-${from.group}-${to.group}`} />;
        })}
      </g>

      {isConsole ? <g className="console-rings"><circle cx="50" cy="38" r="20" /><circle cx="50" cy="38" r="30" /><circle cx="50" cy="38" r="40" /></g> : null}

      <g className="design-nodes">
        {NODES.map((node) => <DesignNode key={node.id} node={node} variant={variant} />)}
      </g>

      <g className="design-labels">
        {NODES.filter((node) => node.label).map((node) => (
          <text key={node.id} x={node.x + (node.x > 80 ? -2 : 2)} y={node.y - (node.id === 'core' ? 10 : 5)} textAnchor={node.x > 80 ? 'end' : 'start'} className={node.id === 'core' ? 'design-label-core' : 'design-label'}>
            {node.label}
          </text>
        ))}
        {isConsole ? <text x="6" y="68" className="console-readout">LINKS 023  /  ACTIVE 020</text> : null}
        {isEditorial ? <text x="6" y="68" className="editorial-readout">RELATIONSHIP INDEX / 03</text> : null}
      </g>
    </svg>
  );
}

function DesignNode({ node, variant }) {
  const isCore = node.group === 'core';
  if (variant.id === 'editorial') {
    return isCore ? (
      <g className="editorial-core" transform={`translate(${node.x} ${node.y})`}>
        <circle r="7" />
        <circle r="3.1" className="editorial-core-dot" />
      </g>
    ) : (
      <g className={`design-node design-node-${node.group}`} transform={`translate(${node.x} ${node.y})`}>
        <rect x={-node.radius} y={-node.radius} width={node.radius * 2} height={node.radius * 2} rx="0.7" />
      </g>
    );
  }
  if (variant.id === 'console') {
    return isCore ? (
      <g className="console-core" transform={`translate(${node.x} ${node.y})`}>
        <circle r="8" className="console-core-halo" />
        <circle r="5.2" />
        <path d="M -2 0 H 2 M 0 -2 V 2" />
      </g>
    ) : (
      <g className={`design-node design-node-${node.group}`} transform={`translate(${node.x} ${node.y}) rotate(45)`}>
        <rect x={-node.radius} y={-node.radius} width={node.radius * 2} height={node.radius * 2} />
      </g>
    );
  }
  return isCore ? (
    <g className="aurora-core" transform={`translate(${node.x} ${node.y})`}>
      <circle r="12" className="aurora-core-halo" />
      <circle r="7.4" fill="url(#design-aurora-core)" />
      <circle r="2" className="aurora-core-dot" />
    </g>
  ) : (
    <g className={`design-node design-node-${node.group}`} transform={`translate(${node.x} ${node.y})`}>
      <circle r={node.radius} />
      {node.radius > 3 ? <circle r="1.2" className="aurora-node-dot" /> : null}
    </g>
  );
}

function AuroraBackdrop() {
  return (
    <g className="aurora-backdrop">
      <ellipse cx="50" cy="38" rx="32" ry="19" className="aurora-cloud aurora-cloud-one" />
      <ellipse cx="31" cy="27" rx="20" ry="14" className="aurora-cloud aurora-cloud-two" />
      <ellipse cx="71" cy="49" rx="21" ry="12" className="aurora-cloud aurora-cloud-three" />
      <path d="M 2 57 C 24 45, 29 16, 55 19 S 78 55, 98 12" className="aurora-sweep" />
    </g>
  );
}

function ConsoleBackdrop() {
  return (
    <g className="console-backdrop">
      <path d="M 6 8 H 94 M 6 16 H 94 M 6 58 H 94 M 6 66 H 94" />
      <path d="M 8 6 V 68 M 20 6 V 68 M 80 6 V 68 M 92 6 V 68" />
      <path d="M 7 38 H 93 M 50 7 V 67" className="console-crosshair" />
      <text x="7" y="11" className="console-label">SYSTEM MAP / 04:26:18</text>
      <text x="93" y="11" textAnchor="end" className="console-label">ONLINE</text>
    </g>
  );
}

function EditorialBackdrop() {
  return (
    <g className="editorial-backdrop">
      <path d="M 6 8 H 94 M 6 15 H 94 M 6 60 H 94" />
      <path d="M 6 8 V 66 M 94 8 V 66" />
      <text x="7" y="12" className="editorial-label">BIGBRAIN / FIELD NOTE 07</text>
      <text x="93" y="12" textAnchor="end" className="editorial-label">08—25—26</text>
    </g>
  );
}
