const { ipcRenderer } = require('electron');

const SELECTOR_HOST_ATTRIBUTE = 'data-bigbrain-desktop-selector';
const UPDATE_HOST_ATTRIBUTE = 'data-bigbrain-desktop-update';

if (typeof window !== 'undefined') {
  window.addEventListener('DOMContentLoaded', () => {
    document.documentElement.classList.add('bigbrain-desktop');
    const observer = new MutationObserver(() => {
      const brand = document.querySelector('.topline-brand');
      const actions = document.querySelector('.topline-actions');
      if (!brand || !actions) return;
      mountBrainSelector(brand);
      mountUpdateStatus(actions);
    });
    observer.observe(document.documentElement, { childList: true, subtree: true });
  });
}

async function mountBrainSelector(container) {
  if (container.querySelector(`[${SELECTOR_HOST_ATTRIBUTE}]`)) return;
  const host = document.createElement('div');
  host.setAttribute(SELECTOR_HOST_ATTRIBUTE, '');
  host.style.webkitAppRegion = 'no-drag';
  container.append(host);

  const root = host.attachShadow({ mode: 'closed' });
  const style = document.createElement('style');
  style.textContent = `
    :host { display: block; width: min(190px, 100%); color: #fafafa; font: 13px ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
    * { box-sizing: border-box; }
    .wrap { position: relative; }
    button { font: inherit; cursor: pointer; -webkit-app-region: no-drag; }
    .trigger { width: 100%; height: 42px; display: flex; align-items: center; justify-content: space-between; gap: 12px; border: 1px solid rgba(255,255,255,.16); border-radius: 999px; background: rgba(255,255,255,.05); color: #fafafa; padding: 0 14px; font-weight: 650; box-shadow: 0 6px 18px rgba(0,0,0,.12); outline: none; }
    .trigger:hover, .trigger[aria-expanded="true"] { border-color: rgba(255,255,255,.28); background: rgba(255,255,255,.09); }
    .trigger:focus-visible { box-shadow: 0 0 0 2px rgba(255,255,255,.18); }
    .label { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .chevron { flex: 0 0 auto; width: 7px; height: 7px; border-right: 1.5px solid #a1a1aa; border-bottom: 1.5px solid #a1a1aa; transform: translateY(-2px) rotate(45deg); }
    .menu { position: absolute; z-index: 1000; top: 48px; left: 0; width: 224px; padding: 5px; border: 1px solid rgba(255,255,255,.14); border-radius: 10px; background: #27272a; box-shadow: 0 18px 45px rgba(0,0,0,.48); }
    .menu[hidden] { display: none; }
    .menu button { width: 100%; min-height: 42px; display: flex; align-items: center; justify-content: space-between; gap: 12px; border: 0; border-radius: 6px; background: transparent; color: #f4f4f5; padding: 7px 9px; text-align: left; outline: none; }
    .menu button:hover, .menu button:focus-visible { background: rgba(255,255,255,.09); }
    .brain-copy { min-width: 0; display: grid; gap: 3px; }
    .brain-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .brain-meta { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: #a1a1aa; font-size: 11px; }
    .check { color: #d4d4d8; }
    .separator { height: 1px; margin: 5px -1px; background: rgba(255,255,255,.1); }
  `;
  root.append(style);

  let state;
  try {
    state = await ipcRenderer.invoke('desktop:state');
  } catch {
    host.remove();
    return;
  }

  const active = state.brains.find((brain) => brain.id === state.activeBrainId);
  const wrap = document.createElement('div');
  wrap.className = 'wrap';
  const trigger = document.createElement('button');
  trigger.className = 'trigger';
  trigger.type = 'button';
  trigger.setAttribute('aria-haspopup', 'menu');
  trigger.setAttribute('aria-expanded', 'false');
  const label = document.createElement('span');
  label.className = 'label';
  label.textContent = active?.name || 'Choose brain';
  const chevron = document.createElement('span');
  chevron.className = 'chevron';
  chevron.setAttribute('aria-hidden', 'true');
  trigger.append(label, chevron);

  const menu = document.createElement('div');
  menu.className = 'menu';
  menu.setAttribute('role', 'menu');
  menu.hidden = true;
  for (const brain of state.brains) {
    const item = document.createElement('button');
    item.type = 'button';
    item.setAttribute('role', 'menuitemradio');
    item.setAttribute('aria-checked', String(brain.id === state.activeBrainId));
    const copy = document.createElement('span');
    copy.className = 'brain-copy';
    const name = document.createElement('span');
    name.className = 'brain-name';
    name.textContent = brain.name;
    const meta = document.createElement('span');
    meta.className = 'brain-meta';
    meta.textContent = mcpStatusLabel(brain, state.desktop?.supported_mcp);
    copy.append(name, meta);
    const check = document.createElement('span');
    check.className = 'check';
    check.textContent = brain.id === state.activeBrainId ? '✓' : '';
    item.append(copy, check);
    item.addEventListener('click', async () => {
      close();
      await ipcRenderer.invoke('desktop:open-brain', brain.id);
    });
    menu.append(item);
  }
  const separator = document.createElement('div');
  separator.className = 'separator';
  const add = document.createElement('button');
  add.type = 'button';
  add.setAttribute('role', 'menuitem');
  add.textContent = '＋ Add brain…';
  add.addEventListener('click', async () => {
    close();
    await ipcRenderer.invoke('desktop:show-setup');
  });
  menu.append(separator, add);
  wrap.append(trigger, menu);
  root.append(wrap);

  const close = () => {
    menu.hidden = true;
    trigger.setAttribute('aria-expanded', 'false');
  };
  trigger.addEventListener('click', () => {
    const opening = menu.hidden;
    menu.hidden = !opening;
    trigger.setAttribute('aria-expanded', String(opening));
  });
  window.addEventListener('pointerdown', (event) => {
    if (!event.composedPath().includes(host)) close();
  });
}

function mcpStatusLabel(brain, supported = null) {
  const compatibility = brain.mcpCompatibility;
  if (compatibility?.serverVersion && compatibility.state) {
    return `MCP ${compatibility.serverVersion} · ${compatibility.state}`;
  }
  if (compatibility?.state === 'incompatible') return 'MCP compatibility needs attention';
  if (supported?.api_contract?.minimum) {
    const range = supported.api_contract.minimum === supported.api_contract.maximum
      ? String(supported.api_contract.minimum)
      : `${supported.api_contract.minimum}-${supported.api_contract.maximum}`;
    return `MCP version not checked · supports API ${range}`;
  }
  return 'MCP version not checked';
}

async function mountUpdateStatus(actions) {
  if (actions.querySelector(`[${UPDATE_HOST_ATTRIBUTE}]`)) return;
  const host = document.createElement('div');
  host.setAttribute(UPDATE_HOST_ATTRIBUTE, '');
  actions.prepend(host);
  const root = host.attachShadow({ mode: 'closed' });

  let updateState;
  let localState;
  try {
    [updateState, localState] = await Promise.all([
      ipcRenderer.invoke('desktop:update-state'),
      ipcRenderer.invoke('desktop:local-service-update-state'),
    ]);
  } catch {
    host.remove();
    return;
  }

  const style = document.createElement('style');
  style.textContent = `
    :host { position: relative; display: block; color: #fafafa; font: 12px ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; -webkit-app-region: no-drag; }
    * { box-sizing: border-box; }
    [hidden] { display: none !important; }
    button { font: inherit; cursor: pointer; -webkit-app-region: no-drag; }
    .wrap { position: relative; display: flex; align-items: center; gap: 8px; }
    .version { color: #a1a1aa; font: 650 11px/1 ui-monospace, SFMono-Regular, Menlo, monospace; letter-spacing: .01em; white-space: nowrap; }
    .trigger { position: relative; width: 38px; height: 38px; display: inline-grid; place-items: center; border: 1px solid rgba(96,165,250,.5); border-radius: 999px; background: rgba(59,130,246,.18); color: #bfdbfe; font-weight: 800; outline: none; }
    .trigger:hover, .trigger[aria-expanded="true"] { border-color: rgba(147,197,253,.82); background: rgba(59,130,246,.3); }
    .trigger:focus-visible { box-shadow: 0 0 0 2px rgba(96,165,250,.32); }
    .trigger[data-tone="error"] { border-color: rgba(251,191,36,.42); background: rgba(251,191,36,.1); color: #fde68a; }
    .trigger[data-tone="error"]:hover, .trigger[data-tone="error"][aria-expanded="true"] { border-color: rgba(251,191,36,.68); background: rgba(251,191,36,.18); }
    .icon { font-size: 13px; line-height: 1; }
    .icon.progress-label { font-size: 9px; letter-spacing: -.04em; }
    .dot { position: absolute; top: 2px; right: 2px; width: 7px; height: 7px; border-radius: 999px; background: #60a5fa; box-shadow: 0 0 0 2px #18181b; }
    .trigger[data-tone="error"] .dot { background: #fbbf24; }
    .popover { position: absolute; z-index: 1000; top: 48px; right: 0; width: min(300px, calc(100vw - 40px)); padding: 14px; border: 1px solid rgba(255,255,255,.14); border-radius: 14px; background: #27272a; box-shadow: 0 18px 45px rgba(0,0,0,.48); }
    .popover[hidden] { display: none; }
    strong, small { display: block; }
    strong { font-size: 13px; }
    small { margin-top: 5px; color: #a1a1aa; line-height: 1.4; }
    .progress { height: 4px; margin-top: 10px; overflow: hidden; border-radius: 999px; background: rgba(255,255,255,.1); }
    .progress-bar { height: 100%; width: 0; border-radius: inherit; background: #60a5fa; transition: width 160ms ease; }
    .action { width: 100%; margin-top: 12px; border: 1px solid rgba(255,255,255,.22); border-radius: 8px; background: rgba(255,255,255,.08); color: #fafafa; padding: 8px 10px; }
    .action:hover { background: rgba(255,255,255,.13); }
    .action:disabled { opacity: .55; cursor: default; }
  `;
  const wrap = document.createElement('div');
  wrap.className = 'wrap';
  const version = document.createElement('span');
  version.className = 'version';
  const trigger = document.createElement('button');
  trigger.className = 'trigger';
  trigger.type = 'button';
  trigger.setAttribute('aria-haspopup', 'dialog');
  trigger.setAttribute('aria-controls', 'bigbrain-update-popover');
  trigger.setAttribute('aria-expanded', 'false');
  const icon = document.createElement('span');
  icon.className = 'icon';
  icon.setAttribute('aria-hidden', 'true');
  const dot = document.createElement('span');
  dot.className = 'dot';
  dot.setAttribute('aria-hidden', 'true');
  trigger.append(icon, dot);

  const popover = document.createElement('div');
  popover.className = 'popover';
  popover.id = 'bigbrain-update-popover';
  popover.setAttribute('role', 'dialog');
  popover.setAttribute('aria-label', 'BigBrain updates');
  popover.hidden = true;
  const title = document.createElement('strong');
  const message = document.createElement('small');
  message.setAttribute('role', 'status');
  message.setAttribute('aria-live', 'polite');
  const local = document.createElement('small');
  local.textContent = `${localState?.message || 'Local MCP services are managed by the desktop app.'} Remote services update separately.`;
  const progress = document.createElement('div');
  progress.className = 'progress';
  progress.setAttribute('role', 'progressbar');
  progress.setAttribute('aria-valuemin', '0');
  progress.setAttribute('aria-valuemax', '100');
  const progressBar = document.createElement('div');
  progressBar.className = 'progress-bar';
  progress.append(progressBar);
  const action = document.createElement('button');
  action.className = 'action';
  action.type = 'button';
  action.addEventListener('click', async () => {
    action.disabled = true;
    action.textContent = updateState.canRestart ? 'Restarting BigBrain…' : 'Checking for updates…';
    if (updateState.canRestart) {
      await ipcRenderer.invoke('desktop:restart-to-update');
      return;
    }
    try {
      updateState = await ipcRenderer.invoke('desktop:check-for-updates');
    } catch {
      updateState = {
        ...updateState,
        phase: 'error',
        message: 'BigBrain could not check for updates. Try again later.',
        canRestart: false,
      };
    }
    renderState();
  });
  popover.append(title, message, local, progress, action);
  wrap.append(version, trigger, popover);
  root.append(style, wrap);

  const close = () => {
    popover.hidden = true;
    trigger.setAttribute('aria-expanded', 'false');
  };
  trigger.addEventListener('click', () => {
    const opening = popover.hidden;
    popover.hidden = !opening;
    trigger.setAttribute('aria-expanded', String(opening));
  });
  window.addEventListener('pointerdown', (event) => {
    if (!event.composedPath().includes(host)) close();
  });
  window.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape' || popover.hidden) return;
    close();
    trigger.focus();
  });
  ipcRenderer.on('desktop:update-state', (_event, nextState) => {
    updateState = nextState;
    renderState();
  });

  function renderState() {
    const presentation = updatePresentation(updateState);
    version.textContent = `v${presentation.currentVersion}`;
    version.title = `BigBrain ${presentation.currentVersion}`;
    version.setAttribute('aria-label', `BigBrain version ${presentation.currentVersion}`);
    trigger.hidden = !presentation.controlVisible;
    trigger.dataset.tone = presentation.tone;
    trigger.setAttribute('aria-label', presentation.triggerLabel);
    icon.textContent = presentation.icon;
    icon.classList.toggle('progress-label', presentation.progressVisible);
    title.textContent = `BigBrain ${presentation.currentVersion}`;
    message.textContent = updateState.message;
    progress.hidden = !presentation.progressVisible;
    if (presentation.progressVisible) {
      progress.setAttribute('aria-valuenow', String(presentation.progressPercent));
      progress.setAttribute('aria-label', `Update download ${presentation.progressPercent}% complete`);
      progressBar.style.width = `${presentation.progressPercent}%`;
    } else {
      progress.removeAttribute('aria-valuenow');
      progress.removeAttribute('aria-label');
      progressBar.style.width = '0%';
    }
    action.disabled = presentation.actionDisabled;
    action.textContent = presentation.actionLabel;
    if (!presentation.controlVisible) close();
  }

  renderState();
}

function updatePresentation(updateState = {}) {
  const phase = String(updateState.phase || 'idle');
  const currentVersion = String(updateState.version || 'unknown');
  const updateVersion = updateState.updateVersion ? String(updateState.updateVersion) : null;
  const target = updateVersion ? `BigBrain ${updateVersion}` : 'The BigBrain update';
  const progressPercent = normalizeProgressPercent(updateState.downloadPercent);

  if (phase === 'error') {
    return {
      currentVersion,
      controlVisible: true,
      tone: 'error',
      icon: '!',
      triggerLabel: `BigBrain update needs attention: ${updateState.message || 'Try checking again.'}`,
      actionLabel: 'Try update check again',
      actionDisabled: false,
      progressVisible: false,
      progressPercent: null,
    };
  }

  if (phase === 'downloaded' || updateState.canRestart) {
    return {
      currentVersion,
      controlVisible: true,
      tone: 'update',
      icon: '↻',
      triggerLabel: `${target} is ready to install.`,
      actionLabel: updateVersion ? `Restart to install BigBrain ${updateVersion}` : 'Restart to install update',
      actionDisabled: false,
      progressVisible: false,
      progressPercent: 100,
    };
  }

  if (phase === 'installing') {
    return {
      currentVersion,
      controlVisible: true,
      tone: 'update',
      icon: '↻',
      triggerLabel: updateState.message || 'Restarting BigBrain to install the update.',
      actionLabel: 'Restarting BigBrain…',
      actionDisabled: true,
      progressVisible: false,
      progressPercent: 100,
    };
  }

  if (phase === 'available' || phase === 'downloading') {
    const hasProgress = progressPercent !== null && phase === 'downloading';
    const progressDetail = hasProgress ? ` ${progressPercent}% complete.` : ' Download starting.';
    return {
      currentVersion,
      controlVisible: true,
      tone: 'update',
      icon: hasProgress ? `${progressPercent}%` : '↓',
      triggerLabel: `${target} is downloading.${progressDetail}`,
      actionLabel: hasProgress ? `Downloading update… ${progressPercent}%` : 'Downloading update…',
      actionDisabled: true,
      progressVisible: hasProgress,
      progressPercent,
    };
  }

  return {
    currentVersion,
    controlVisible: false,
    tone: 'update',
    icon: '↓',
    triggerLabel: 'BigBrain updates',
    actionLabel: 'Check for updates',
    actionDisabled: phase === 'checking',
    progressVisible: false,
    progressPercent: null,
  };
}

function normalizeProgressPercent(value) {
  if (!Number.isFinite(value)) return null;
  return Math.max(0, Math.min(100, Math.round(value)));
}

module.exports = { updatePresentation };
