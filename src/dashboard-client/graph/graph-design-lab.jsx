import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';

const CONCEPTS = [
  {
    id: 'schema-flow',
    index: '01',
    name: 'Page → Brain → Tasks',
    description: 'Recently updated pages feed the constellation, while next tasks leave with the context they need.',
    label: 'CANONICAL FLOW',
  },
  {
    id: 'loop',
    index: '02',
    name: 'Living Loop',
    description: 'A continuous system: many sources in, connected memory in the middle, useful action out.',
    label: 'SOURCE TO ACTION',
  },
  {
    id: 'reactor',
    index: '03',
    name: 'Reactor',
    description: 'A living knowledge engine that pulls signals inward and emits decisions with momentum.',
    label: 'KNOWLEDGE ENGINE',
  },
  {
    id: 'control',
    index: '04',
    name: 'Control Room',
    description: 'A practical command surface showing the live queue of signals, context, and next actions.',
    label: 'OPERATING SYSTEM',
  },
];

const INPUTS = [
  { id: 'gmail', icon: 'G', name: 'Gmail', detail: 'Thread · Fawaz follow-up', tone: 'cyan' },
  { id: 'whatsapp', icon: 'W', name: 'WhatsApp', detail: 'Conversation · Luciano', tone: 'green' },
  { id: 'meetings', icon: 'M', name: 'Meetings', detail: 'Transcript · 42 minutes', tone: 'violet' },
  { id: 'documents', icon: 'D', name: 'Documents', detail: 'Brief · 6 new pages', tone: 'amber' },
];

const OUTPUTS = [
  { icon: '↗', name: 'Prepare a briefing', detail: 'Fawaz · relationship context', tone: 'cyan' },
  { icon: '✓', name: 'Create next action', detail: 'Send investor criteria', tone: 'green' },
  { icon: '◎', name: 'Surface a connection', detail: 'Saudi structuring thread', tone: 'violet' },
];

const CONTROL_EVENTS = [
  { time: '04:26:18', title: 'Meeting transcript indexed', detail: '42 min · 8 entities resolved', tone: 'violet' },
  { time: '04:26:11', title: 'Gmail thread connected', detail: 'Fawaz Farooqui · 3 new facts', tone: 'cyan' },
  { time: '04:25:54', title: 'WhatsApp context refreshed', detail: 'Luciano Vital · existing thread', tone: 'green' },
  { time: '04:25:31', title: 'Task inferred', detail: 'Prepare investor criteria', tone: 'amber' },
];

const RECENT_PAGES = [
  { title: 'Fawaz Farooqui', meta: 'People · 2 min ago', type: 'person', tone: 'cyan' },
  { title: 'One Studio', meta: 'Company · 7 min ago', type: 'company', tone: 'violet' },
  { title: 'BigBrain visual demo', meta: 'Task · 11 min ago', type: 'task', tone: 'green' },
  { title: 'Saudi Company Structuring', meta: 'Project · 18 min ago', type: 'project', tone: 'amber' },
  { title: 'Workshop conversation', meta: 'Meeting · 26 min ago', type: 'meeting', tone: 'pink' },
];

const NEXT_TASKS = [
  { title: 'Prepare investor criteria', meta: 'Next · Luciano', status: 'ready', tone: 'green' },
  { title: 'Set up Saudi investment company', meta: 'Blocked · awaiting choice', status: 'review', tone: 'amber' },
  { title: 'Run Batic BD AI pilot', meta: 'Next · Harry', status: 'ready', tone: 'cyan' },
  { title: 'Schedule Suhail introduction', meta: 'Next · outreach', status: 'next', tone: 'violet' },
];

export function GraphDesignLabApp() {
  const [conceptId, setConceptId] = useState('schema-flow');
  const concept = CONCEPTS.find((item) => item.id === conceptId) || CONCEPTS[0];

  useEffect(() => {
    function onKeyDown(event) {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if (event.key === '1') setConceptId('schema-flow');
      if (event.key === '2') setConceptId('loop');
      if (event.key === '3') setConceptId('reactor');
      if (event.key === '4') setConceptId('control');
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  return (
    <main className={`design-lab-page narrative-lab narrative-lab-${concept.id}`}>
      <header className="design-lab-head">
        <div>
          <div className="design-lab-breadcrumb">BIGBRAIN <span>/</span> GRAPH LAB <span>/</span> NARRATIVE PROTOTYPES</div>
          <h1>From information to action.</h1>
          <p>Four ways to make BigBrain feel alive: input, understanding, and output in one visible system.</p>
        </div>
        <div className="design-lab-meta">
          <span className="design-lab-live"><i /> concept mode</span>
          <span>mock scenario · live feed simulation</span>
        </div>
      </header>

      <nav className="design-lab-switcher" aria-label="Narrative graph concepts">
        {CONCEPTS.map((item) => (
          <button
            key={item.id}
            type="button"
            className={conceptId === item.id ? 'active' : ''}
            aria-pressed={conceptId === item.id}
            onClick={() => setConceptId(item.id)}
          >
            <span>{item.index} {item.name}</span><kbd>{item.index.replace(/^0/, '')}</kbd>
          </button>
        ))}
      </nav>

      <section className="narrative-stage" aria-label={`${concept.name} concept`}>
        <div className="narrative-stage-head">
          <div>
            <span className="narrative-stage-kicker">{concept.index} / {concept.label}</span>
            <h2>{concept.name}</h2>
          </div>
          <div className="narrative-stage-description">{concept.description}</div>
        </div>
        {conceptId === 'schema-flow' ? <SchemaFlowView /> : null}
        {conceptId === 'loop' ? <LivingLoopView /> : null}
        {conceptId === 'reactor' ? <ReactorView /> : null}
        {conceptId === 'control' ? <ControlRoomView /> : null}
      </section>

      <footer className="design-lab-foot">
        <span>1 / 2 / 3 / 4 switch direction</span>
        <span><i className="footer-pulse" /> input · knowledge · action</span>
        <span>Concept surface only · no live data connected</span>
      </footer>
    </main>
  );
}
function LivingLoopView() {
  return (
    <div className="concept-view concept-view-loop">
      <FlowNetwork theme="loop" />
      <div className="concept-column concept-inputs">
        <ColumnLabel index="01" label="Incoming signals" meta="4 sources" />
        <div className="signal-card-list">
          {INPUTS.map((item, index) => <SignalCard key={item.id} item={item} index={index} />)}
        </div>
      </div>
      <div className="concept-core-wrap">
        <div className="process-steps" aria-label="BigBrain process">
          <span className="active">ingest</span><b>→</b><span>connect</span><b>→</b><span>act</span>
        </div>
        <BrainCore mode="loop" />
        <div className="core-message"><strong>BigBrain</strong><span>turns fragmented context into connected memory</span></div>
        <div className="core-telemetry"><span><i /> indexing now</span><span>1,192 pages</span><span>3,448 links</span></div>
      </div>
      <div className="concept-column concept-outputs">
        <ColumnLabel index="03" label="Useful action" meta="3 ready" />
        <div className="output-card-list">
          {OUTPUTS.map((item, index) => <OutputCard key={item.name} item={item} index={index} />)}
        </div>
      </div>
      <div className="flow-caption flow-caption-in">raw context</div>
      <div className="flow-caption flow-caption-out">actionable context</div>
    </div>
  );
}

function SchemaFlowView() {
  const stageRef = useRef(null);
  const brainRef = useRef(null);
  const inputRefs = useRef(new Map());
  const taskRefs = useRef(new Map());
  const [flowLayout, setFlowLayout] = useState(null);

  useLayoutEffect(() => {
    function measureFlow() {
      const stage = stageRef.current;
      const brain = brainRef.current;
      if (!stage || !brain) return;
      const stageRect = stage.getBoundingClientRect();
      const brainRect = brain.getBoundingClientRect();
      if (!stageRect.width || !stageRect.height || !brainRect.width) return;
      const pointFor = (node, edge) => {
        const rect = node?.getBoundingClientRect();
        if (!rect) return null;
        return {
          x: (edge === 'right' ? rect.right : rect.left) - stageRect.left,
          y: rect.top + (rect.height / 2) - stageRect.top,
        };
      };
      const brainCenterY = brainRect.top + (brainRect.height / 2) - stageRect.top;
      setFlowLayout({
        width: stageRect.width,
        height: stageRect.height,
        brain: {
          leftX: brainRect.left - stageRect.left + brainRect.width * 0.27,
          rightX: brainRect.left - stageRect.left + brainRect.width * 0.73,
          centerY: brainCenterY,
        },
        inputs: RECENT_PAGES.map((item) => pointFor(inputRefs.current.get(item.title), 'right')).filter(Boolean),
        outputs: NEXT_TASKS.map((item) => pointFor(taskRefs.current.get(item.title), 'left')).filter(Boolean),
      });
    }

    const frame = window.requestAnimationFrame(measureFlow);
    const observed = [stageRef.current, brainRef.current, ...inputRefs.current.values(), ...taskRefs.current.values()].filter(Boolean);
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measureFlow);
    observed.forEach((node) => observer?.observe(node));
    window.addEventListener('resize', measureFlow);
    return () => {
      window.cancelAnimationFrame(frame);
      observer?.disconnect();
      window.removeEventListener('resize', measureFlow);
    };
  }, []);

  return (
    <div className="concept-view concept-view-schema-flow" ref={stageRef}>
      <SchemaFlowNetwork layout={flowLayout} />
      <div className="schema-flow-foreground">
        <aside className="schema-flow-column schema-flow-input-column">
          <ColumnLabel index="01" label="Recently updated pages" meta="5 incoming" />
          <div className="schema-page-list">
            {RECENT_PAGES.map((item, index) => (
              <RecentPageCard
                key={item.title}
                item={item}
                index={index}
                innerRef={(node) => node ? inputRefs.current.set(item.title, node) : inputRefs.current.delete(item.title)}
              />
            ))}
          </div>
        </aside>
        <section className="schema-flow-brain-panel">
          <div className="schema-flow-process"><span className="active">pages</span><b>→</b><span>brain</span><b>→</b><span>tasks</span></div>
          <SchemaBrainConstellation innerRef={brainRef} />
          <div className="schema-flow-brain-caption"><strong>BigBrain</strong><span>the middle layer that remembers what each page means</span></div>
          <div className="schema-flow-status"><i /> connecting recent context <span>1,192 pages · 3,448 links</span></div>
        </section>
        <aside className="schema-flow-column schema-flow-task-column">
          <ColumnLabel index="03" label="Next tasks" meta="4 outgoing" />
          <div className="schema-task-list">
            {NEXT_TASKS.map((item, index) => (
              <NextTaskCard
                key={item.title}
                item={item}
                index={index}
                innerRef={(node) => node ? taskRefs.current.set(item.title, node) : taskRefs.current.delete(item.title)}
              />
            ))}
          </div>
        </aside>
        <div className="schema-flow-footer-label schema-flow-footer-left">new context enters</div>
        <div className="schema-flow-footer-label schema-flow-footer-right">action leaves with memory</div>
      </div>
    </div>
  );
}

function RecentPageCard({ item, index, innerRef }) {
  return (
    <div ref={innerRef} className={`schema-page-card schema-tone-${item.tone}`} style={{ '--schema-delay': `${index * 520}ms` }}>
      <span className="schema-page-type">{item.type.slice(0, 1).toUpperCase()}</span>
      <div><strong>{item.title}</strong><small>{item.meta}</small></div>
      <i />
    </div>
  );
}

function NextTaskCard({ item, index, innerRef }) {
  return (
    <div ref={innerRef} className={`schema-task-card schema-tone-${item.tone}`} style={{ '--schema-delay': `${index * 640}ms` }}>
      <span className="schema-task-check">{item.status === 'ready' ? '✓' : item.status === 'review' ? '!' : '→'}</span>
      <div><strong>{item.title}</strong><small>{item.meta}</small></div>
      <span className="schema-task-status">{item.status}</span>
    </div>
  );
}

function SchemaFlowNetwork({ layout }) {
  if (!layout) return null;
  const inbound = layout.inputs.map((source, index) => ({
    d: inboundFlowPath(source, layout.brain),
    delay: `${[-0.1, -1.7, -3.1, -0.9, -2.5][index] || 0}s`,
    duration: `${[4.8, 5.7, 4.3, 5.4, 6.1][index] || 5}s`,
  }));
  const outbound = layout.outputs.map((target, index) => ({
    d: outboundFlowPath(target, layout.brain),
    delay: `${[-2.2, -0.4, -3.6, -1.2][index] || 0}s`,
    duration: `${[5.5, 4.7, 5.9, 6.4][index] || 5.5}s`,
  }));

  return (
    <div className="schema-flow-network" aria-hidden="true">
      <svg viewBox={`0 0 ${layout.width} ${layout.height}`} preserveAspectRatio="none">
        <defs>
          <linearGradient id="schema-flow-in-gradient" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0" stopColor="#6ce3ff" stopOpacity="0.12" />
            <stop offset="0.7" stopColor="#8eaaff" stopOpacity="0.43" />
            <stop offset="1" stopColor="#bd9cff" stopOpacity="0.72" />
          </linearGradient>
          <linearGradient id="schema-flow-out-gradient" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0" stopColor="#bd9cff" stopOpacity="0.72" />
            <stop offset="0.45" stopColor="#8eaaff" stopOpacity="0.42" />
            <stop offset="1" stopColor="#75efb8" stopOpacity="0.15" />
          </linearGradient>
          <linearGradient id="schema-flow-pulse-in" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0" stopColor="#6ce3ff" stopOpacity="0" />
            <stop offset="0.45" stopColor="#c8f5ff" stopOpacity="0.95" />
            <stop offset="0.72" stopColor="#9f8cff" stopOpacity="0.8" />
            <stop offset="1" stopColor="#bd9cff" stopOpacity="0" />
          </linearGradient>
          <linearGradient id="schema-flow-pulse-out" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0" stopColor="#bd9cff" stopOpacity="0" />
            <stop offset="0.34" stopColor="#bd9cff" stopOpacity="0.85" />
            <stop offset="0.68" stopColor="#bfffe0" stopOpacity="0.95" />
            <stop offset="1" stopColor="#75efb8" stopOpacity="0" />
          </linearGradient>
          <filter id="schema-flow-pulse-blur" x="-80%" y="-80%" width="260%" height="260%">
            <feGaussianBlur stdDeviation="0.9" />
          </filter>
        </defs>
        {inbound.map((arc, index) => (
          <React.Fragment key={`in-${index}`}>
            <path d={arc.d} className="schema-flow-arc schema-flow-arc-in" />
            <path d={arc.d} className="schema-flow-energy-glow schema-flow-energy-glow-in" style={{ animationDelay: arc.delay, animationDuration: arc.duration }} />
            <path d={arc.d} className="schema-flow-energy-arc schema-flow-energy-arc-in" style={{ animationDelay: arc.delay, animationDuration: arc.duration }} />
          </React.Fragment>
        ))}
        {outbound.map((arc, index) => (
          <React.Fragment key={`out-${index}`}>
            <path d={arc.d} className="schema-flow-arc schema-flow-arc-out" />
            <path d={arc.d} className="schema-flow-energy-glow schema-flow-energy-glow-out" style={{ animationDelay: arc.delay, animationDuration: arc.duration }} />
            <path d={arc.d} className="schema-flow-energy-arc schema-flow-energy-arc-out" style={{ animationDelay: arc.delay, animationDuration: arc.duration }} />
          </React.Fragment>
        ))}
      </svg>
    </div>
  );
}

function inboundFlowPath(source, brain) {
  const span = brain.leftX - source.x;
  const targetY = brain.centerY + (source.y - brain.centerY) * 0.12;
  return `M ${source.x} ${source.y} C ${source.x + span * 0.46} ${source.y}, ${brain.leftX - span * 0.24} ${targetY}, ${brain.leftX} ${targetY}`;
}

function outboundFlowPath(target, brain) {
  const span = target.x - brain.rightX;
  const sourceY = brain.centerY + (target.y - brain.centerY) * 0.12;
  return `M ${brain.rightX} ${sourceY} C ${brain.rightX + span * 0.24} ${sourceY}, ${target.x - span * 0.46} ${target.y}, ${target.x} ${target.y}`;
}

function SchemaBrainConstellation({ innerRef }) {
  const nodes = [
    [18, 26, 1.6, 'cyan'], [28, 18, 1.1, 'violet'], [35, 33, 2, 'green'],
    [24, 48, 1.1, 'amber'], [32, 63, 1.6, 'cyan'], [44, 24, 1.2, 'violet'],
    [56, 22, 1.5, 'green'], [66, 31, 1.2, 'cyan'], [76, 25, 1.7, 'violet'],
    [66, 49, 1.8, 'amber'], [76, 62, 1.2, 'green'], [59, 67, 1.4, 'cyan'],
    [44, 71, 1.1, 'violet'], [22, 71, 1, 'green'], [82, 45, 1, 'amber'],
  ];
  const links = [[18,26,28,18],[18,26,35,33],[35,33,44,24],[35,33,24,48],[24,48,32,63],[44,24,56,22],[56,22,66,31],[66,31,76,25],[66,31,66,49],[66,49,76,62],[66,49,59,67],[59,67,44,71],[44,71,32,63],[76,25,82,45],[24,48,22,71]];

  return (
    <div ref={innerRef} className="schema-brain-constellation">
      <svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
        {links.map(([x1, y1, x2, y2], index) => <line key={index} x1={x1} y1={y1} x2={x2} y2={y2} />)}
        {nodes.map(([x, y, radius, tone], index) => <circle key={index} cx={x} cy={y} r={radius} className={`schema-node-${tone}`} />)}
      </svg>
      <div className="schema-brain-core"><BrainCore mode="loop" /></div>
    </div>
  );
}

function ReactorView() {
  return (
    <div className="concept-view concept-view-reactor">
      <div className="reactor-orbit-label reactor-orbit-label-top"><span>01</span> MULTIPLE SOURCES</div>
      <div className="reactor-orbit-label reactor-orbit-label-bottom"><span>03</span> OUTPUT WITH CONTEXT</div>
      <div className="reactor-stage-copy reactor-stage-copy-left"><strong>Pull in</strong><span>signals arrive continuously</span></div>
      <div className="reactor-stage-copy reactor-stage-copy-right"><strong>Push out</strong><span>decisions leave with memory</span></div>
      <div className="reactor-orbit reactor-orbit-one" />
      <div className="reactor-orbit reactor-orbit-two" />
      <div className="reactor-orbit reactor-orbit-three" />
      {INPUTS.map((item, index) => <OrbitSource key={item.id} item={item} index={index} />)}
      {OUTPUTS.map((item, index) => <OrbitOutput key={item.name} item={item} index={index} />)}
      <div className="reactor-core-wrap">
        <div className="reactor-core-scan" />
        <BrainCore mode="reactor" />
        <div className="reactor-state"><span>KNOWLEDGE ENGINE</span><strong>Resolving context</strong><small><i /> 08 signals converging</small></div>
      </div>
      <div className="reactor-side-panel">
        <div className="reactor-panel-head"><span>Knowledge state</span><strong>LIVE</strong></div>
        <div className="reactor-metric"><strong>+18</strong><span>facts resolved</span></div>
        <div className="reactor-metric"><strong>06</strong><span>threads connected</span></div>
        <div className="reactor-metric"><strong>03</strong><span>actions prepared</span></div>
        <div className="reactor-panel-footer"><i /> last pulse 04:26:18</div>
      </div>
    </div>
  );
}

function ControlRoomView() {
  return (
    <div className="concept-view concept-view-control">
      <aside className="control-panel control-feed-panel">
        <ColumnLabel index="01" label="Incoming" meta="live queue" />
        <div className="control-panel-status"><i /> Listening across 6 sources</div>
        <div className="control-event-list">
          {CONTROL_EVENTS.map((item, index) => (
            <div className={`control-event control-tone-${item.tone}`} key={item.time}>
              <span className="control-event-time">{item.time}</span>
              <strong>{item.title}</strong>
              <small>{item.detail}</small>
              {index === 0 ? <em>processing</em> : null}
            </div>
          ))}
        </div>
      </aside>
      <section className="control-graph-panel">
        <div className="control-graph-head"><span>02 / Connected knowledge</span><span>20 entities · 23 links</span></div>
        <div className="control-graph-canvas">
          <ControlGraph />
          <BrainCore mode="control" />
          <div className="control-graph-label label-people">People <b>08</b></div>
          <div className="control-graph-label label-deals">Deals <b>04</b></div>
          <div className="control-graph-label label-tasks">Tasks <b>06</b></div>
          <div className="control-graph-label label-ideas">Ideas <b>02</b></div>
          <div className="control-graph-pulse pulse-one" /><div className="control-graph-pulse pulse-two" />
        </div>
        <div className="control-graph-foot"><span><i /> Relationship map updating</span><span>context window 100%</span></div>
      </section>
      <aside className="control-panel control-actions-panel">
        <ColumnLabel index="03" label="Outgoing" meta="action queue" />
        <div className="action-queue">
          {OUTPUTS.map((item, index) => (
            <div className={`action-queue-card action-queue-${item.tone}`} key={item.name}>
              <div className="action-queue-icon">{item.icon}</div>
              <div><strong>{item.name}</strong><small>{item.detail}</small></div>
              <span>{index === 0 ? 'ready' : 'next'}</span>
            </div>
          ))}
        </div>
        <div className="action-queue-note"><i /> BigBrain is not just storing context. It is preparing the next move.</div>
      </aside>
    </div>
  );
}

function ColumnLabel({ index, label, meta }) {
  return <div className="concept-column-label"><span>{index}</span><strong>{label}</strong><small>{meta}</small></div>;
}

function SignalCard({ item, index }) {
  return (
    <div className={`signal-card signal-tone-${item.tone}`} style={{ '--signal-delay': `${index * 420}ms` }}>
      <div className="signal-card-icon">{item.icon}</div>
      <div><strong>{item.name}</strong><small>{item.detail}</small></div>
      <span className="signal-card-dot" />
    </div>
  );
}

function OutputCard({ item, index }) {
  return (
    <div className={`output-card output-tone-${item.tone}`} style={{ '--signal-delay': `${index * 520}ms` }}>
      <div className="output-card-icon">{item.icon}</div>
      <div><strong>{item.name}</strong><small>{item.detail}</small></div>
      <span className="output-card-arrow">↗</span>
    </div>
  );
}

function BrainCore({ mode }) {
  return (
    <div className={`brain-core brain-core-${mode}`}>
      <div className="brain-core-rings"><i /><i /><i /></div>
      <div className="brain-core-orb"><span>BB</span><b /></div>
      <div className="brain-core-name">BIGBRAIN</div>
    </div>
  );
}

function FlowNetwork({ theme }) {
  return (
    <div className={`flow-network flow-network-${theme}`} aria-hidden="true">
      <svg viewBox="0 0 100 100" preserveAspectRatio="none">
        <path d="M 20 28 C 31 28, 35 42, 47 44" />
        <path d="M 20 42 C 31 42, 36 46, 47 47" />
        <path d="M 20 56 C 31 56, 35 50, 47 49" />
        <path d="M 20 70 C 31 70, 36 54, 47 52" />
        <path d="M 53 46 C 65 42, 70 28, 80 28" />
        <path d="M 53 48 C 65 45, 70 42, 80 42" />
        <path d="M 53 50 C 65 54, 70 56, 80 56" />
      </svg>
      <i className="flow-packet packet-a" /><i className="flow-packet packet-b" /><i className="flow-packet packet-c" /><i className="flow-packet packet-d" />
    </div>
  );
}

function OrbitSource({ item, index }) {
  return <div className={`orbit-source orbit-source-${index + 1} signal-tone-${item.tone}`}><span>{item.icon}</span><strong>{item.name}</strong><small>{item.detail}</small></div>;
}

function OrbitOutput({ item, index }) {
  return <div className={`orbit-output orbit-output-${index + 1} output-tone-${item.tone}`}><span>{item.icon}</span><strong>{item.name}</strong></div>;
}

function ControlGraph() {
  return (
    <svg className="control-graph-svg" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
      <defs>
        <linearGradient id="control-link-gradient" x1="0" x2="1">
          <stop offset="0" stopColor="#64d9ff" stopOpacity="0.2" />
          <stop offset="0.5" stopColor="#9d7bff" stopOpacity="0.7" />
          <stop offset="1" stopColor="#76edba" stopOpacity="0.2" />
        </linearGradient>
      </defs>
      <path d="M 8 20 C 28 20, 33 44, 47 48 S 70 22, 91 20" />
      <path d="M 8 80 C 28 80, 34 56, 47 51 S 70 78, 91 80" />
      <path d="M 17 44 C 29 42, 36 48, 46 49 S 67 45, 83 43" />
      <path d="M 17 56 C 30 59, 36 52, 46 51 S 69 57, 83 58" />
      <circle cx="16" cy="20" r="2.2" /><circle cx="12" cy="80" r="2.2" />
      <circle cx="84" cy="20" r="2.2" /><circle cx="88" cy="80" r="2.2" />
      <circle cx="25" cy="43" r="1.5" /><circle cx="73" cy="58" r="1.5" />
    </svg>
  );
}
