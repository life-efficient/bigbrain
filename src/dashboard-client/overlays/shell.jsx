import React, { useEffect, useState } from 'react';

import { ComprehensionPanel } from './comprehension.jsx';
import { KeepInTouchPanel } from './keep-in-touch.jsx';
import { OVERLAYS, overlayById } from './registry.js';

const OVERLAY_STORAGE_PREFIX = 'bigbrain:overlays:';

export function OverlaysController({
  brainId,
  brainName,
  activeView,
  onActiveViewChange,
  onOpenPage,
  onBeforeToggle,
  children,
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [enabledOverlays, setEnabledOverlays] = useState([]);
  const [actionError, setActionError] = useState('');
  const [workingId, setWorkingId] = useState('');

  useEffect(() => {
    let cancelled = false;
    const savedOverlays = loadEnabledOverlays(brainId);
    setEnabledOverlays(savedOverlays);
    setActionError('');

    async function hydrate() {
      const remoteDefinitions = OVERLAYS.filter((overlay) => overlay.dataEndpoint);
      const remoteStates = await Promise.all(remoteDefinitions.map(async (overlay) => {
        try {
          const data = await fetchJson(overlay.dataEndpoint);
          return { id: overlay.id, enabled: data?.overlay?.enabled };
        } catch {
          return { id: overlay.id, enabled: undefined };
        }
      }));
      if (cancelled) return;

      const nextOverlays = remoteStates.reduce((current, state) => {
        if (typeof state.enabled !== 'boolean') return current;
        return state.enabled
          ? [...new Set([...current, state.id])]
          : current.filter((id) => id !== state.id);
      }, savedOverlays);
      setEnabledOverlays(nextOverlays);
      saveEnabledOverlays(brainId, nextOverlays);
    }

    hydrate();
    return () => {
      cancelled = true;
    };
  }, [brainId]);

  useEffect(() => {
    function handlePointerDown(event) {
      if (!event.target.closest?.('.overlays-menu')) setMenuOpen(false);
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

      const overlay = OVERLAYS.find((candidate) => (
        candidate.shortcut.toLowerCase() === event.key.toLowerCase()
        && enabledOverlays.includes(candidate.id)
      ));
      if (!overlay) return;
      event.preventDefault();
      onActiveViewChange(overlay.id);
    }

    window.addEventListener('keydown', handleShortcut);
    return () => window.removeEventListener('keydown', handleShortcut);
  }, [enabledOverlays, onActiveViewChange]);

  function setOverlayEnabled(overlayId, enabled) {
    const definition = overlayById(overlayId);
    if (!definition) return;

    const previous = enabledOverlays;
    const next = enabled
      ? [...new Set([...previous, overlayId])]
      : previous.filter((id) => id !== overlayId);
    setEnabledOverlays(next);
    saveEnabledOverlays(brainId, next);
    setActionError('');
    if (!enabled && activeView === overlayId) onActiveViewChange('graph');
    if (!definition.enabledEndpoint) return;

    setWorkingId(overlayId);
    fetchJson(definition.enabledEndpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ enabled }),
    }).catch((error) => {
      setEnabledOverlays(previous);
      saveEnabledOverlays(brainId, previous);
      setActionError(`${definition.label} setting failed: ${error instanceof Error ? error.message : String(error)}`);
    }).finally(() => setWorkingId(''));
  }

  function openOverlay(overlayId) {
    if (!enabledOverlays.includes(overlayId)) setOverlayEnabled(overlayId, true);
    setMenuOpen(false);
    onActiveViewChange(overlayId);
  }

  const menu = (
    <div className="overlays-menu">
      <button
        type="button"
        className={`overlays-button ${menuOpen ? 'open' : ''}`}
        aria-expanded={menuOpen}
        onClick={() => {
          onBeforeToggle?.();
          setMenuOpen((value) => !value);
        }}
      >
        Overlays
        {enabledOverlays.length ? <span className="overlays-live-dot" aria-label="Overlay enabled" /> : null}
      </button>
      {menuOpen ? (
        <OverlayLauncher
          brainName={brainName}
          enabledOverlays={enabledOverlays}
          actionError={actionError}
          workingId={workingId}
          onEnable={(overlayId) => setOverlayEnabled(overlayId, true)}
          onDisable={(overlayId) => setOverlayEnabled(overlayId, false)}
          onOpen={openOverlay}
        />
      ) : null}
    </div>
  );

  const content = (
    <OverlayOutlet
      activeView={activeView}
      enabledOverlays={enabledOverlays}
      onOpenPage={onOpenPage}
    />
  );

  return children({ menu, content, menuOpen });
}

function OverlayLauncher({
  brainName,
  enabledOverlays,
  actionError,
  workingId,
  onEnable,
  onDisable,
  onOpen,
}) {
  return (
    <div className="overlays-dropdown" role="menu">
      <div className="overlays-dropdown-head">
        <strong>Overlays</strong>
        <span className="meta">{brainName || 'Selected Brain'}</span>
      </div>
      {OVERLAYS.map((overlay) => {
        const enabled = enabledOverlays.includes(overlay.id);
        const working = workingId === overlay.id;
        return (
          <div className="overlay-launcher-item" key={overlay.id}>
            <div className="overlay-launcher-copy">
              <strong>{overlay.label}</strong>
              <span>{overlay.description}</span>
            </div>
            {enabled ? (
              <div className="overlay-launcher-actions">
                <button type="button" className="settings-link selected" onClick={() => onOpen(overlay.id)} disabled={working}>
                  Open <span className="meta">{overlay.shortcut}</span>
                </button>
                <button type="button" className="overlay-text-button" onClick={() => onDisable(overlay.id)} disabled={working}>Disable</button>
              </div>
            ) : (
              <button type="button" className="settings-link" onClick={() => onEnable(overlay.id)} disabled={working}>Enable</button>
            )}
          </div>
        );
      })}
      {actionError ? <div className="overlay-inline-error" role="alert">{actionError}</div> : null}
      <div className="overlays-dropdown-foot">Overlays are enabled separately for each Brain.</div>
    </div>
  );
}

function OverlayOutlet({ activeView, enabledOverlays, onOpenPage }) {
  if (!enabledOverlays.includes(activeView)) return null;
  if (activeView === 'keep-in-touch') return <KeepInTouchPanel onOpenPerson={onOpenPage} />;
  if (activeView === 'comprehension') return <ComprehensionPanel onOpenPage={onOpenPage} />;
  return null;
}

function loadEnabledOverlays(brainId) {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(overlayPreferenceKey(brainId))
      || window.localStorage.getItem(`bigbrain:playbooks:${brainId || 'current'}`)
      || '[]');
    return Array.isArray(parsed) ? parsed.filter((id) => typeof id === 'string') : [];
  } catch {
    return [];
  }
}

function saveEnabledOverlays(brainId, overlays) {
  try {
    window.localStorage.setItem(overlayPreferenceKey(brainId), JSON.stringify(overlays));
  } catch {
    // Local storage can be unavailable; the current session still works.
  }
}

function overlayPreferenceKey(brainId) {
  return `${OVERLAY_STORAGE_PREFIX}${brainId || 'current'}`;
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
