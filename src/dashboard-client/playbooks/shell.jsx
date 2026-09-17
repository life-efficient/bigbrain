import React, { useEffect, useState } from 'react';

import { ComprehensionPanel } from './comprehension.jsx';
import { KeepInTouchPanel } from './keep-in-touch.jsx';
import { PLAYBOOKS, playbookById } from './registry.js';

const PLAYBOOK_STORAGE_PREFIX = 'bigbrain:playbooks:';

export function PlaybooksController({
  brainId,
  brainName,
  activeView,
  onActiveViewChange,
  onOpenPage,
  onBeforeToggle,
  children,
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [enabledPlaybooks, setEnabledPlaybooks] = useState([]);
  const [actionError, setActionError] = useState('');
  const [workingId, setWorkingId] = useState('');

  useEffect(() => {
    let cancelled = false;
    const savedPlaybooks = loadEnabledPlaybooks(brainId);
    setEnabledPlaybooks(savedPlaybooks);
    setActionError('');

    async function hydrate() {
      const remoteDefinitions = PLAYBOOKS.filter((playbook) => playbook.dataEndpoint);
      const remoteStates = await Promise.all(remoteDefinitions.map(async (playbook) => {
        try {
          const data = await fetchJson(playbook.dataEndpoint);
          return { id: playbook.id, enabled: data?.playbook?.enabled };
        } catch {
          return { id: playbook.id, enabled: undefined };
        }
      }));
      if (cancelled) return;

      const nextPlaybooks = remoteStates.reduce((current, state) => {
        if (typeof state.enabled !== 'boolean') return current;
        return state.enabled
          ? [...new Set([...current, state.id])]
          : current.filter((id) => id !== state.id);
      }, savedPlaybooks);
      setEnabledPlaybooks(nextPlaybooks);
      saveEnabledPlaybooks(brainId, nextPlaybooks);
    }

    hydrate();
    return () => {
      cancelled = true;
    };
  }, [brainId]);

  useEffect(() => {
    function handlePointerDown(event) {
      if (!event.target.closest?.('.playbooks-menu')) setMenuOpen(false);
    }

    function handleEscape(event) {
      if (event.key === 'Escape') setMenuOpen(false);
    }

    document.addEventListener('pointerdown', handlePointerDown);
    window.addEventListener('keydown', handleEscape);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
      window.removeEventListener('keydown', handleEscape);
    };
  }, []);

  useEffect(() => {
    function handleShortcut(event) {
      if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey || event.repeat || event.isComposing) return;
      if (isTypingTarget(event.target)) return;

      const playbook = PLAYBOOKS.find((candidate) => (
        candidate.shortcut.toLowerCase() === event.key.toLowerCase()
        && enabledPlaybooks.includes(candidate.id)
      ));
      if (!playbook) return;
      event.preventDefault();
      onActiveViewChange(playbook.id);
    }

    window.addEventListener('keydown', handleShortcut);
    return () => window.removeEventListener('keydown', handleShortcut);
  }, [enabledPlaybooks, onActiveViewChange]);

  function setPlaybookEnabled(playbookId, enabled) {
    const definition = playbookById(playbookId);
    if (!definition) return;

    const previous = enabledPlaybooks;
    const next = enabled
      ? [...new Set([...previous, playbookId])]
      : previous.filter((id) => id !== playbookId);
    setEnabledPlaybooks(next);
    saveEnabledPlaybooks(brainId, next);
    setActionError('');
    if (!enabled && activeView === playbookId) onActiveViewChange('graph');
    if (!definition.enabledEndpoint) return;

    setWorkingId(playbookId);
    fetchJson(definition.enabledEndpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ enabled }),
    }).catch((error) => {
      setEnabledPlaybooks(previous);
      saveEnabledPlaybooks(brainId, previous);
      setActionError(`${definition.label} setting failed: ${error instanceof Error ? error.message : String(error)}`);
    }).finally(() => setWorkingId(''));
  }

  function openPlaybook(playbookId) {
    if (!enabledPlaybooks.includes(playbookId)) setPlaybookEnabled(playbookId, true);
    setMenuOpen(false);
    onActiveViewChange(playbookId);
  }

  const menu = (
    <div className="playbooks-menu">
      <button
        type="button"
        className={`playbooks-button ${menuOpen ? 'open' : ''}`}
        aria-expanded={menuOpen}
        onClick={() => {
          onBeforeToggle?.();
          setMenuOpen((value) => !value);
        }}
      >
        Playbooks
        {enabledPlaybooks.length ? <span className="playbooks-live-dot" aria-label="Playbook enabled" /> : null}
      </button>
      {menuOpen ? (
        <PlaybookLauncher
          brainName={brainName}
          enabledPlaybooks={enabledPlaybooks}
          actionError={actionError}
          workingId={workingId}
          onEnable={(playbookId) => setPlaybookEnabled(playbookId, true)}
          onDisable={(playbookId) => setPlaybookEnabled(playbookId, false)}
          onOpen={openPlaybook}
        />
      ) : null}
    </div>
  );

  const content = (
    <PlaybookOutlet
      activeView={activeView}
      enabledPlaybooks={enabledPlaybooks}
      onOpenPage={onOpenPage}
    />
  );

  return children({ menu, content, menuOpen });
}

function PlaybookLauncher({
  brainName,
  enabledPlaybooks,
  actionError,
  workingId,
  onEnable,
  onDisable,
  onOpen,
}) {
  return (
    <div className="playbooks-dropdown" role="menu">
      <div className="playbooks-dropdown-head">
        <strong>Playbooks</strong>
        <span className="meta">{brainName || 'Selected Brain'}</span>
      </div>
      {PLAYBOOKS.map((playbook) => {
        const enabled = enabledPlaybooks.includes(playbook.id);
        const working = workingId === playbook.id;
        return (
          <div className="playbook-launcher-item" key={playbook.id}>
            <div className="playbook-launcher-copy">
              <strong>{playbook.label}</strong>
              <span>{playbook.description}</span>
            </div>
            {enabled ? (
              <div className="playbook-launcher-actions">
                <button type="button" className="settings-link selected" onClick={() => onOpen(playbook.id)} disabled={working}>
                  Open <span className="meta">{playbook.shortcut}</span>
                </button>
                <button type="button" className="playbook-text-button" onClick={() => onDisable(playbook.id)} disabled={working}>Disable</button>
              </div>
            ) : (
              <button type="button" className="settings-link" onClick={() => onEnable(playbook.id)} disabled={working}>Enable</button>
            )}
          </div>
        );
      })}
      {actionError ? <div className="playbook-inline-error" role="alert">{actionError}</div> : null}
      <div className="playbooks-dropdown-foot">Playbooks are enabled separately for each Brain.</div>
    </div>
  );
}

function PlaybookOutlet({ activeView, enabledPlaybooks, onOpenPage }) {
  if (!enabledPlaybooks.includes(activeView)) return null;
  if (activeView === 'keep-in-touch') return <KeepInTouchPanel onOpenPerson={onOpenPage} />;
  if (activeView === 'comprehension') return <ComprehensionPanel onOpenPage={onOpenPage} />;
  return null;
}

function loadEnabledPlaybooks(brainId) {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(playbookPreferenceKey(brainId)) || '[]');
    return Array.isArray(parsed) ? parsed.filter((id) => typeof id === 'string') : [];
  } catch {
    return [];
  }
}

function saveEnabledPlaybooks(brainId, playbooks) {
  try {
    window.localStorage.setItem(playbookPreferenceKey(brainId), JSON.stringify(playbooks));
  } catch {
    // Local storage can be unavailable; the current session still works.
  }
}

function playbookPreferenceKey(brainId) {
  return `${PLAYBOOK_STORAGE_PREFIX}${brainId || 'current'}`;
}

function isTypingTarget(target) {
  return target instanceof HTMLElement && (
    target.isContentEditable
    || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)
  );
}

async function fetchJson(url, options) {
  const response = await fetch(url, options);
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || `${url} failed with ${response.status}`);
  return body;
}
