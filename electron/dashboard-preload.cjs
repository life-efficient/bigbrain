const { ipcRenderer } = require('electron');

const SELECTOR_HOST_ATTRIBUTE = 'data-bigbrain-desktop-selector';
const UPDATE_HOST_ATTRIBUTE = 'data-bigbrain-desktop-update';

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
    .menu button { width: 100%; min-height: 34px; display: flex; align-items: center; justify-content: space-between; gap: 12px; border: 0; border-radius: 6px; background: transparent; color: #f4f4f5; padding: 8px 9px; text-align: left; outline: none; }
    .menu button:hover, .menu button:focus-visible { background: rgba(255,255,255,.09); }
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
    const name = document.createElement('span');
    name.textContent = brain.name;
    const check = document.createElement('span');
    check.className = 'check';
    check.textContent = brain.id === state.activeBrainId ? '✓' : '';
    item.append(name, check);
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
    await ipcRenderer.invoke('desktop:show-selector');
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
    :host { position: relative; display: block; color: #fafafa; font: 12px ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
    * { box-sizing: border-box; }
    button { font: inherit; cursor: pointer; -webkit-app-region: no-drag; }
    .trigger { position: relative; width: 38px; height: 38px; display: inline-grid; place-items: center; border: 1px solid rgba(251,191,36,.28); border-radius: 999px; background: rgba(251,191,36,.08); color: #f5d78e; font-weight: 800; outline: none; }
    .trigger:hover, .trigger[aria-expanded="true"] { border-color: rgba(251,191,36,.48); background: rgba(251,191,36,.14); }
    .trigger:focus-visible { box-shadow: 0 0 0 2px rgba(251,191,36,.2); }
    .dot { position: absolute; top: 2px; right: 2px; width: 7px; height: 7px; border-radius: 999px; background: #fbbf24; box-shadow: 0 0 0 2px #18181b; }
    .popover { position: absolute; z-index: 1000; top: 48px; right: 0; width: min(300px, calc(100vw - 40px)); padding: 14px; border: 1px solid rgba(255,255,255,.14); border-radius: 14px; background: #27272a; box-shadow: 0 18px 45px rgba(0,0,0,.48); }
    .popover[hidden] { display: none; }
    strong, small { display: block; }
    strong { font-size: 13px; }
    small { margin-top: 5px; color: #a1a1aa; line-height: 1.4; }
    .action { width: 100%; margin-top: 12px; border: 1px solid rgba(255,255,255,.22); border-radius: 8px; background: rgba(255,255,255,.08); color: #fafafa; padding: 8px 10px; }
    .action:hover { background: rgba(255,255,255,.13); }
    .action:disabled { opacity: .55; cursor: default; }
  `;
  const trigger = document.createElement('button');
  trigger.className = 'trigger';
  trigger.type = 'button';
  trigger.setAttribute('aria-expanded', 'false');
  const icon = document.createElement('span');
  const dot = document.createElement('span');
  dot.className = 'dot';
  dot.setAttribute('aria-hidden', 'true');
  trigger.append(icon, dot);

  const popover = document.createElement('div');
  popover.className = 'popover';
  popover.hidden = true;
  const title = document.createElement('strong');
  title.textContent = `BigBrain ${updateState.version}`;
  const message = document.createElement('small');
  message.textContent = updateState.message;
  const local = document.createElement('small');
  local.textContent = `${localState?.message || 'Local MCP services are managed by the desktop app.'} Remote services update separately.`;
  const action = document.createElement('button');
  action.className = 'action';
  action.type = 'button';
  action.addEventListener('click', async () => {
    action.disabled = true;
    action.textContent = updateState.canRestart ? 'Restarting…' : 'Checking…';
    if (updateState.canRestart) {
      await ipcRenderer.invoke('desktop:restart-to-update');
      return;
    }
    updateState = await ipcRenderer.invoke('desktop:check-for-updates');
    renderState();
  });
  popover.append(title, message, local, action);
  root.append(style, trigger, popover);

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
  ipcRenderer.on('desktop:update-state', (_event, nextState) => {
    updateState = nextState;
    renderState();
  });

  function renderState() {
    const visible = updateState.phase === 'error'
      || updateState.canRestart
      || ['available', 'downloading'].includes(updateState.phase);
    host.style.display = visible ? 'block' : 'none';
    icon.textContent = updateState.canRestart ? '↑' : '!';
    trigger.setAttribute('aria-label', `BigBrain update: ${updateState.message}`);
    title.textContent = `BigBrain ${updateState.version}`;
    message.textContent = updateState.message;
    const busy = ['checking', 'available', 'downloading'].includes(updateState.phase);
    action.disabled = busy;
    action.textContent = updateState.canRestart ? 'Restart to update' : 'Check for updates';
  }

  renderState();
}
