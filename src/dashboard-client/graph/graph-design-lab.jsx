import React, { useEffect, useState } from 'react';

const CONCEPTS = [
  {
    id: 'loop',
    index: '01',
    name: 'Living Loop',
    description: 'A continuous system: many sources in, connected memory in the middle, useful action out.',
    label: 'SOURCE TO ACTION',
  },
  {
    id: 'reactor',
    index: '02',
    name: 'Reactor',
    description: 'A living knowledge engine that pulls signals inward and emits decisions with momentum.',
    label: 'KNOWLEDGE ENGINE',
  },
  {
    id: 'control',
    index: '03',
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

export function GraphDesignLabApp() {
  const [conceptId, setConceptId] = useState('loop');
  const concept = CONCEPTS.find((item) => item.id === conceptId) || CONCEPTS[0];

  useEffect(() => {
    function onKeyDown(event) {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if (event.key === '1') setConceptId('loop');
      if (event.key === '2') setConceptId('reactor');
      if (event.key === '3') setConceptId('control');
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
          <p>Three ways to make BigBrain feel alive: input, understanding, and output in one visible system.</p>
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
        {conceptId === 'loop' ? <LivingLoopView /> : null}
        {conceptId === 'reactor' ? <ReactorView /> : null}
        {conceptId === 'control' ? <ControlRoomView /> : null}
      </section>

      <footer className="design-lab-foot">
        <span>1 / 2 / 3 switch direction</span>
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
