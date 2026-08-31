const api = window.bigbrainDesktop;

api.onDashboardVisibility((visible) => {
  document.documentElement.classList.toggle('dashboard-visible', visible);
});

let step = 1;
let form = emptyForm();
let state;
let credentialOptions = [];
let credentialOptionsLoading = false;
let credentialOptionsError = '';
let discoveredBrains = [];
let discoveryLoading = false;
let discoveryError = '';

const content = document.querySelector('#step-content');
const steps = [...document.querySelectorAll('.step')];

function render() {
  steps.forEach((element, index) => {
    element.classList.toggle('active', index === step - 1);
    element.classList.toggle('done', index < step - 1);
  });

  const localPages = {
    1: `<h1>Name your brain</h1><p>Give this private knowledge space a clear identity. The description helps you and your agents understand what belongs here.</p>${field('name', 'Brain name', 'AI Infrastructure Atlas')}${textarea('description', 'Description', 'AI infrastructure, data centers, terminology, companies, narratives, and finance.')}${stepError()}${actions(false)}`,
    2: `<h1>Where should it run?</h1><p>This first setup will create a private brain on this Mac. Hosted setup is shown here so the choice is explicit, but it is not part of this local-first test yet.</p><button class="choice choice-option selected" type="button" data-mode="local"><strong>Run locally on this device</strong><p>Files and the service stay on this Mac.</p></button><button class="choice choice-option" type="button" disabled><strong>Run in a hosted BigBrain</strong><p>Hosted setup will be available in a later flow.</p></button>${actions(true)}`,
    3: `<h1>Privacy and backup</h1><p>This brain is private by default. Choose whether BigBrain should keep Git backup enabled for the local service.</p><button class="choice choice-option selected" type="button" disabled><strong>Private brain</strong><p>Only this local setup and agents you explicitly connect can use it.</p></button><button class="choice choice-option" type="button" disabled><strong>Public or shared brain</strong><p>Not available in this local-first setup.</p></button><fieldset class="credential-options" role="radiogroup"><legend>Git backup</legend><button type="button" class="credential-option${form.gitBackup ? ' selected' : ''}" data-backup="github" role="radio" aria-checked="${form.gitBackup}"><span><strong>Back up to a private GitHub repository</strong><small>Recommended for a local brain.</small></span></button><button type="button" class="credential-option${!form.gitBackup ? ' selected' : ''}" data-backup="none" role="radio" aria-checked="${!form.gitBackup}"><span><strong>Keep it only on this Mac</strong><small>You can add a backup later.</small></span></button></fieldset><div class="warning"><strong>STRONGLY RECOMMENDED:</strong> everything in your brain could be lost if you delete the folder or lose access to your device.</div>${actions(true)}`,
    4: `<h1>Who will use this brain?</h1><p>Your identity stays on this Mac and helps BigBrain recognize your work.</p>${field('ownerName', 'Your name', 'Your name')}${field('ownerEmail', 'Email', 'you@example.com', 'email')}${actions(true)}`,
    5: localBrainHomePage(),
    6: `<h1>Connect AI</h1><p>Choose a detected OpenAI API key or enter a different one. It is validated once and stored securely in macOS Keychain, not in your brain or logs.</p>${credentialPicker()}<div id="error"></div>${actions(true, 'Run BigBrain')}`,
  };
  const servicePages = {
    2: `<h1>Connect to an existing BigBrain</h1><p>Enter the address of BigBrain already running on this machine, your organization’s network, or online.</p>${field('serviceUrl', 'BigBrain service address', 'https://brain.example.com', 'url')}${actions(true)}`,
    3: `<h1>Check the connection</h1><p>The desktop app will verify the BigBrain service and save this connection on this Mac.</p><div class="existing-box"><strong>BigBrain service</strong><small>${escapeHtml(form.serviceUrl || 'Enter a service address in the previous step.')}</small></div>${actions(true)}`,
    4: `<h1>Ready to connect</h1><p>If this BigBrain requires sign-in, you’ll be asked to sign in when its dashboard opens.</p><div id="error"></div>${actions(true, 'Connect BigBrain')}`,
  };
  const pages = {
    1: `<h1>Give your AI persistent memory</h1><p>Choose where BigBrain runs. A private local brain stays in the folder you select on this Mac. You can change between connected brains later.</p>${discoveredBrainPicker()}<button class="choice choice-option" data-mode="local"><strong>Run a private brain on this device</strong><p>Choose a folder, initialize it, and install one clearly labelled local service.</p></button><button class="choice choice-option" data-mode="service"><strong>Connect using an address</strong><p>Use a BigBrain service on your organization’s network or online.</p></button>`,
    ...(form.mode === 'service' ? servicePages : localPages),
  };

  content.innerHTML = pages[step] || pages[1];
  content.querySelectorAll('input,textarea').forEach((element) => {
    element.value = form[element.name] || '';
    element.oninput = () => {
      form[element.name] = element.value;
      if (element.name === 'apiKey') form.apiKeySource = 'manual';
    };
  });
  content.querySelectorAll('[data-key-source]').forEach((element) => element.addEventListener('click', () => {
    form.apiKeySource = element.dataset.keySource;
    render();
  }));
  content.querySelectorAll('[data-backup]').forEach((element) => element.addEventListener('click', () => {
    form.gitBackup = element.dataset.backup === 'github';
    render();
  }));
  content.querySelectorAll('[data-discovered-index]').forEach((element) => element.addEventListener('click', () => {
    selectDiscoveredBrain(Number(element.dataset.discoveredIndex));
  }));
  content.querySelectorAll('[data-mode]').forEach((element) => element.addEventListener('click', () => {
    form.mode = element.dataset.mode;
    step = 3;
    render();
  }));
  content.querySelector('[data-next]')?.addEventListener('click', next);
  content.querySelector('[data-back]')?.addEventListener('click', () => {
    step -= 1;
    render();
  });
  content.querySelector('#choose-existing')?.addEventListener('click', chooseExisting);
  content.querySelector('#choose-new-home')?.addEventListener('click', chooseNewHome);
  content.querySelector('#clear-existing')?.addEventListener('click', () => {
    form.existingHome = '';
    render();
  });
  content.querySelector('#clear-new-home')?.addEventListener('click', () => {
    form.newHome = '';
    render();
  });
}

function stepError() {
  return '<div id="error"></div>';
}

function localBrainHomePage() {
  if (form.existingHome) {
    return `<h1>Choose the brain folder</h1><p>BigBrain will use this existing folder without moving its files, then install a uniquely labelled local service for it.</p><div class="existing-box"><strong>${escapeHtml(form.name)}</strong><small>${escapeHtml(form.existingHome)}</small></div><p><button class="secondary" id="clear-existing">Create a new brain instead</button></p>${actions(true)}`;
  }
  if (form.newHome) {
    return `<h1>Choose the brain folder</h1><p>BigBrain will initialize this folder, install a uniquely labelled local service, and verify the service before finishing.</p><div class="existing-box"><strong>${escapeHtml(form.name)}</strong><small>New brain folder: ${escapeHtml(form.newHome)}</small></div><p><button class="secondary" id="clear-new-home">Choose a different folder</button></p>${actions(true)}`;
  }
  return `<h1>Choose the brain folder</h1><p>BigBrain keeps this brain on your Mac. Choose a folder where it should initialize the private local brain.</p><p><button class="secondary" id="choose-new-home">Choose a folder for a new private brain…</button></p><p><button class="secondary" id="choose-existing">Use an existing brain folder…</button></p>${actions(true)}`;
}

function discoveredBrainPicker() {
  if (discoveryLoading) return '<div class="credential-status" role="status">Looking for existing brains on this Mac…</div>';
  if (discoveredBrains.length) {
    return `<fieldset class="credential-options"><legend>Found on this Mac</legend>${discoveredBrains.map((brain, index) => `<button type="button" class="choice choice-option" data-discovered-index="${index}"><strong>${escapeHtml(brain.name)}</strong><p>${escapeHtml(brain.status === 'running' ? 'Running on this Mac' : brain.home || 'Available on this Mac')}</p></button>`).join('')}</fieldset>`;
  }
  if (discoveryError) return `<div class="credential-note">${escapeHtml(discoveryError)} You can still choose a folder or enter an address.</div>`;
  return '';
}

function selectDiscoveredBrain(index) {
  const brain = discoveredBrains[index];
  if (!brain) return;
  form.name = brain.name || 'My Brain';
  if (brain.status === 'running' && brain.serviceUrl) {
    form.mode = 'service';
    form.serviceUrl = brain.serviceUrl;
    step = 3;
  } else {
    form.mode = 'local';
    form.existingHome = brain.home || '';
    step = 5;
  }
  render();
}

async function loadDiscoveredBrains() {
  discoveryLoading = true;
  discoveryError = '';
  render();
  try {
    discoveredBrains = await api.discoverBrains();
  } catch (error) {
    discoveredBrains = [];
    discoveryError = error.message;
  } finally {
    discoveryLoading = false;
    render();
  }
}

async function chooseExisting() {
  try {
    const existing = await api.chooseExistingBrain();
    if (!existing) return;
    form.existingHome = existing.home;
    form.newHome = '';
    form.name = existing.name || form.name;
    render();
  } catch (error) {
    content.insertAdjacentHTML('beforeend', `<div class="error">${escapeHtml(error.message)}</div>`);
  }
}

async function chooseNewHome() {
  try {
    const selected = await api.chooseBrainHome();
    if (!selected) return;
    form.newHome = selected.home;
    form.existingHome = '';
    render();
  } catch (error) {
    content.insertAdjacentHTML('beforeend', `<div class="error">${escapeHtml(error.message)}</div>`);
  }
}

function field(name, label, placeholder, type = 'text') {
  return `<div class="field"><label for="${name}">${label}</label><input id="${name}" name="${name}" type="${type}" placeholder="${placeholder}" autocomplete="off"></div>`;
}

function textarea(name, label, placeholder) {
  return `<div class="field"><label for="${name}">${label}</label><textarea id="${name}" name="${name}" placeholder="${placeholder}"></textarea></div>`;
}

function actions(back, label = 'Continue') {
  return `<div class="actions">${back ? '<button class="secondary" data-back>Back</button>' : '<span></span>'}<button class="primary" data-next>${label}</button></div>`;
}

function credentialPicker() {
  if (credentialOptionsLoading) return '<div class="credential-status" role="status">Looking for existing API keys…</div>';
  const detected = credentialOptions.length
    ? `<fieldset class="credential-options" role="radiogroup"><legend>Detected on this Mac</legend>${credentialOptions.map((option) => `<button type="button" class="credential-option${form.apiKeySource === option.id ? ' selected' : ''}" data-key-source="${escapeHtml(option.id)}" role="radio" aria-checked="${form.apiKeySource === option.id}"><span><strong>${escapeHtml(option.label)}</strong><small>${escapeHtml(option.detail)}</small></span><span class="credential-mask">${escapeHtml(option.masked)}</span></button>`).join('')}</fieldset>`
    : '';
  const manualSelected = form.apiKeySource === 'manual';
  return `${detected}<fieldset class="credential-options" role="radiogroup"><legend>${credentialOptions.length ? 'Or enter a different key' : 'Enter your API key'}</legend><button type="button" class="credential-option${manualSelected ? ' selected' : ''}" data-key-source="manual" role="radio" aria-checked="${manualSelected}"><span><strong>Enter a different API key</strong><small>The key stays in this setup window until it is saved to Keychain.</small></span></button>${manualSelected ? field('apiKey', 'OpenAI API key', 'sk-…', 'password') : ''}</fieldset>${credentialOptionsError ? `<div class="credential-note">${escapeHtml(credentialOptionsError)} You can still enter a key directly.</div>` : ''}`;
}

async function loadApiKeyOptions() {
  credentialOptionsLoading = true;
  credentialOptionsError = '';
  render();
  try {
    credentialOptions = await api.apiKeyOptions({ existingHome: form.existingHome || null });
    if (credentialOptions.length && !form.apiKey) form.apiKeySource = credentialOptions[0].id;
  } catch (error) {
    credentialOptions = [];
    credentialOptionsError = error.message;
  } finally {
    credentialOptionsLoading = false;
    render();
  }
}

async function next() {
  const finalStep = form.mode === 'service' ? 4 : 6;
  if (step < finalStep) {
    if (!validateStep()) return;
    step += 1;
    if (step === 6 && form.mode === 'local') await loadApiKeyOptions();
    else render();
    return;
  }

  const button = content.querySelector('[data-next]');
  button.disabled = true;
  const service = form.mode === 'service';
  button.textContent = service ? 'Checking and connecting…' : 'Creating and checking your brain…';
  try {
    if (service) {
      const brain = await api.connectService({ serviceUrl: form.serviceUrl });
      showServiceConnection(brain);
    } else {
      const result = await api.createBrain(form);
      form.apiKey = '';
      showConnection(result);
    }
  } catch (error) {
    content.querySelector('#error').innerHTML = `<div class="error">${escapeHtml(error.message)}</div>`;
    button.disabled = false;
    button.textContent = service ? 'Connect BigBrain' : 'Run BigBrain';
  }
}

function validateStep() {
  if (form.mode === 'local' && step === 1) {
    if (!form.name?.trim()) return showStepError('Give this brain a name before continuing.');
    if (!form.description?.trim()) return showStepError('Add a short description so this brain has a clear scope.');
  }
  if (form.mode === 'local' && step === 5 && !form.newHome && !form.existingHome) {
    return showStepError('Choose a folder for this private local brain.');
  }
  if (step === 4 && (!form.ownerName?.trim() || !form.ownerEmail?.includes('@'))) {
    return showStepError('Enter your name and a valid email address.');
  }
  return true;
}

function showStepError(message) {
  const error = content.querySelector('#error');
  if (error) error.innerHTML = `<div class="error">${escapeHtml(message)}</div>`;
  return false;
}

function showServiceConnection(brain) {
  step = 5;
  steps.forEach((element, index) => {
    element.classList.toggle('active', index === 4);
    element.classList.toggle('done', index < 4);
  });
  content.innerHTML = `<h1>BigBrain connected</h1><p>${escapeHtml(brain?.name || 'This service')} is saved on this Mac. Open BigBrain to use its dashboard.</p><div class="actions"><span></span><button class="primary" id="open">Open BigBrain</button></div>`;
  document.querySelector('#open').onclick = loadApp;
}

function showConnection(result) {
  step = 7;
  steps.forEach((element, index) => {
    element.classList.toggle('active', index === 6);
    element.classList.toggle('done', index < 6);
  });
  const instructions = result.instructions;
  const backupMessage = result.backupPreference === 'none'
    ? 'GitHub backup was not selected. This brain currently stays only on this Mac.'
    : 'GitHub backup was selected. The private repository backup can be completed after this local setup is verified.';
  content.innerHTML = `<h1>Your brain is ready</h1><p>BigBrain initialized the folder, invoked the local service setup, and verified the private local endpoint.</p><h2>Pass this to your agent</h2><div class="copybox" id="handoff">${escapeHtml(instructions.handoff)}</div><p><button class="secondary" id="copy-handoff">Copy agent handoff</button></p><details><summary>Codex CLI</summary><div class="copybox">${escapeHtml(instructions.codex)}</div></details><details><summary>Claude CLI</summary><div class="copybox">${escapeHtml(instructions.claude)}</div></details><details><summary>Generic MCP setup</summary><div class="copybox">${escapeHtml(instructions.generic)}</div></details><div class="warning"><strong>${escapeHtml(backupMessage)}</strong></div><div class="actions"><span></span><button class="primary" id="open">Open BigBrain</button></div>`;
  document.querySelector('#copy-handoff').onclick = () => navigator.clipboard.writeText(instructions.handoff);
  document.querySelector('#open').onclick = loadApp;
}

async function loadApp(skipActive = false) {
  state = await api.state();
  document.querySelector('#onboarding').classList.add('hidden');
  document.querySelector('#app').classList.remove('hidden');
  renderBrainSelector();
  if (skipActive) {
    document.querySelector('#content').innerHTML = '<div class="empty">Choose a brain, or add another one.</div>';
    void api.setDashboardVisible(false).catch(() => {});
  } else {
    showActiveBrain();
  }
}

function renderBrainSelector() {
  const tabs = document.querySelector('#tabs');
  const active = state.brains.find((brain) => brain.id === state.activeBrainId);
  tabs.innerHTML = `<div class="brain-select-wrap"><button class="brain-trigger" id="brain-trigger" type="button" aria-haspopup="menu" aria-expanded="false"><span>${escapeHtml(active?.name || 'Choose brain')}</span><span class="select-chevron" aria-hidden="true"></span></button><div class="brain-menu hidden" id="brain-menu" role="menu">${state.brains.map((brain) => `<button type="button" role="menuitemradio" aria-checked="${brain.id === state.activeBrainId}" data-brain-id="${escapeHtml(brain.id)}"><span>${escapeHtml(brain.name)}</span><span class="menu-check">${brain.id === state.activeBrainId ? '✓' : ''}</span></button>`).join('')}<div class="menu-separator"></div><button type="button" role="menuitem" data-new-brain><span>＋ Add brain…</span></button></div></div>`;
  const trigger = tabs.querySelector('#brain-trigger');
  const menu = tabs.querySelector('#brain-menu');
  const close = (restoreDashboard = true) => {
    menu.classList.add('hidden');
    trigger.setAttribute('aria-expanded', 'false');
    if (restoreDashboard) void api.setDashboardVisible(true);
  };
  trigger.onclick = () => {
    const opening = menu.classList.contains('hidden');
    menu.classList.toggle('hidden');
    trigger.setAttribute('aria-expanded', String(opening));
    void api.setDashboardVisible(!opening);
    if (opening) menu.querySelector('button')?.focus();
  };
  menu.querySelectorAll('[data-brain-id]').forEach((item) => {
    item.onclick = async () => {
      const id = item.dataset.brainId;
      close(false);
      state.activeBrainId = id;
      renderBrainSelector();
      await showActiveBrain();
    };
  });
  menu.querySelector('[data-new-brain]').onclick = () => {
    close(false);
    void startOnboarding();
  };
  menu.onkeydown = (event) => {
    const items = [...menu.querySelectorAll('button')];
    const index = items.indexOf(document.activeElement);
    if (event.key === 'Escape') {
      close();
      trigger.focus();
    } else if (event.key === 'ArrowDown') {
      event.preventDefault();
      items[(index + 1) % items.length]?.focus();
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      items[(index - 1 + items.length) % items.length]?.focus();
    }
  };
  setTimeout(() => document.addEventListener('pointerdown', (event) => {
    if (!tabs.contains(event.target)) close();
  }, { once: true }), 0);
}

function startOnboarding() {
  void api.setDashboardVisible(false).catch(() => {});
  document.querySelector('#app').classList.add('hidden');
  document.querySelector('#onboarding').classList.remove('hidden');
  step = 1;
  form = emptyForm();
  credentialOptions = [];
  credentialOptionsLoading = false;
  credentialOptionsError = '';
  discoveredBrains = [];
  discoveryError = '';
  render();
  void loadDiscoveredBrains();
}

async function showActiveBrain() {
  const brain = state.brains.find((candidate) => candidate.id === state.activeBrainId);
  const region = document.querySelector('#content');
  if (!brain) {
    await api.setDashboardVisible(false);
    region.innerHTML = '<div class="empty">Run BigBrain here or connect to an existing BigBrain.</div>';
    return;
  }
  region.innerHTML = '<div class="empty"><div class="startup-status" role="status"><span class="startup-spinner" aria-hidden="true"></span><strong>Starting BigBrain…</strong><small>Checking the local service before opening your dashboard.</small></div></div>';
  try {
    await api.openBrain(brain.id);
    region.innerHTML = '';
  } catch (error) {
    console.error('BigBrain dashboard startup failed', error);
    await api.setDashboardVisible(false);
    region.innerHTML = '<div class="empty"><div class="startup-card"><strong>BigBrain is taking longer than expected to start.</strong><p>Try opening it again in a moment.</p><button class="secondary" id="retry-open" type="button">Try again</button></div></div>';
    region.querySelector('#retry-open').onclick = showActiveBrain;
  }
}

function emptyForm() {
  return {
    ownerName: '',
    ownerEmail: '',
    name: 'AI Infrastructure Atlas',
    description: '',
    mode: 'local',
    hosting: 'local',
    visibility: 'private',
    gitBackup: true,
    apiKey: '',
    apiKeySource: 'manual',
    existingHome: '',
    newHome: '',
    serviceUrl: '',
  };
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]));
}

(async () => {
  state = await api.state();
  if (state.brains.some((brain) => brain.onboarding?.completed)) loadApp(new URLSearchParams(location.search).has('select'));
  else await loadDiscoveredBrains();
})().catch((error) => {
  content.innerHTML = `<div class="error">${escapeHtml(error.message)}</div>`;
});
