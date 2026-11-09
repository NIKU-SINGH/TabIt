const vscode = acquireVsCodeApi();
const modelPopover = document.getElementById('models');
const search = document.getElementById('model-search');
const list = document.getElementById('model-list');
const modelStatus = document.getElementById('model-status');
let models = [];
let currentModel;
let catalogError = false;
let loading = false;

function renderModels() {
  if (!list || !search || !modelStatus) return;
  const query = search.value.toLowerCase();
  const matches = models.filter(({ id, name }) => `${name} ${id}`.toLowerCase().includes(query));
  const buttons = matches.slice(0, 100).map(({ id, name }) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'option';
    button.dataset.action = 'model';
    button.dataset.value = id;
    const icon = document.createElement('img');
    icon.src = list.dataset.icon;
    icon.alt = '';
    icon.width = 16;
    icon.height = 16;
    icon.className = 'provider-icon';
    const title = document.createElement('span');
    title.textContent = name;
    button.append(icon, title);
    if (id === currentModel) button.setAttribute('aria-current', 'true');
    return button;
  });
  list.replaceChildren(...buttons);
  modelStatus.textContent = loading ? 'Loading models…'
    : catalogError ? 'You can enter a model ID manually.'
    : !matches.length ? 'No matching models. You can enter a model ID.'
    : matches.length > buttons.length ? 'Showing the first 100 matches. Search to narrow the list.' : '';
}

modelPopover?.addEventListener('toggle', (event) => {
  if (event.newState !== 'open' || loading) return;
  loading = true;
  renderModels();
  vscode.postMessage({ action: 'models' });
  search?.focus();
});
search?.addEventListener('input', renderModels);
document.getElementById('automatic')?.addEventListener('change', (event) => {
  vscode.postMessage({ action: 'automatic', value: event.target.checked });
});
document.addEventListener('click', (event) => {
  const button = event.target.closest('button.option[data-action]');
  if (!button) return;
  button.closest('[popover]')?.hidePopover();
  vscode.postMessage({ action: button.dataset.action, value: button.dataset.value });
});
for (const input of document.querySelectorAll('input[data-setting]')) {
  input.addEventListener('change', () => {
    vscode.postMessage({ action: 'number', key: input.dataset.setting, value: input.valueAsNumber });
  });
  input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') input.blur();
  });
}

const keyForm = document.querySelector('.key-form');
const keyInput = keyForm?.elements.value;
const saveKeyButton = keyForm?.querySelector('.save');
const removeKeyButton = keyForm?.querySelector('.remove');
let keyPending = false;

function updateKeyButtons() {
  if (!keyForm) return;
  saveKeyButton.disabled = keyPending || !keyInput.value.trim();
  removeKeyButton.disabled = keyPending;
}

keyInput?.addEventListener('input', updateKeyButtons);
keyForm?.closest('[popover]').addEventListener('toggle', (event) => {
  if (event.newState === 'open') vscode.postMessage({ action: 'keyStatus' });
});

document.addEventListener('submit', (event) => {
  const form = event.target;
  if (!form.dataset.action) return;
  event.preventDefault();
  const action = event.submitter?.value === 'removeKey' ? 'removeKey' : form.dataset.action;
  const value = action === 'removeKey' ? undefined : new FormData(form).get('value');
  if (form === keyForm) {
    if (keyPending || (action === 'key' && saveKeyButton.disabled)) return;
    keyPending = true;
    updateKeyButtons();
  } else {
    form.closest('[popover]')?.hidePopover();
  }
  vscode.postMessage({ action, value });
});
window.addEventListener('message', ({ data }) => {
  if (data.type === 'models') {
    loading = false;
    models = data.models;
    catalogError = data.unavailable;
    currentModel = data.current;
    renderModels();
  } else if (keyForm && (data.type === 'keyStatus' || data.type === 'keySaved' || data.type === 'keyFailed')) {
    if (data.type !== 'keyFailed') {
      keyInput.placeholder = data.preview || 'Paste API key';
      removeKeyButton.hidden = !data.preview;
    }
    if (data.type !== 'keyStatus') keyPending = false;
    if (data.type === 'keySaved') {
      keyForm.reset();
      const popover = keyForm.closest('[popover]');
      if (popover.matches(':popover-open')) popover.hidePopover();
    }
    updateKeyButtons();
  }
});
