const vscode = acquireVsCodeApi();
const modelPopover = document.getElementById('models');
const search = document.getElementById('model-search');
const list = document.getElementById('model-list');
const modelStatus = document.getElementById('model-status');
let modelGroups = [];
let currentModel;
let catalogError = false;
let loading = false;

function label(tag, className, text) {
  const element = document.createElement(tag);
  element.className = className;
  element.textContent = text;
  return element;
}

function logo(source, className, monochrome) {
  if (monochrome) {
    const icon = document.createElement('span');
    icon.className = `${className} monochrome`;
    icon.setAttribute('aria-hidden', 'true');
    icon.style.setProperty('--family-icon', `url("${source}")`);
    return icon;
  }
  const icon = document.createElement('img');
  icon.src = source;
  icon.alt = '';
  icon.width = 16;
  icon.height = 16;
  icon.className = className;
  return icon;
}

function renderModels() {
  if (!list || !search || !modelStatus) return;
  const terms = search.value.toLowerCase().trim().split(/\s+/);
  const groups = modelGroups.map((group) => ({
    ...group,
    models: group.models.filter(({ id, name }) => {
      const searchable = `${group.label} ${name} ${id}`.toLowerCase();
      return terms.every((term) => searchable.includes(term));
    }),
  })).filter((group) => group.models.length);
  const count = groups.reduce((total, group) => total + group.models.length, 0);
  const content = document.createDocumentFragment();
  if (count) {
    const header = label('h2', 'catalog-header', list.dataset.provider);
    header.prepend(logo(list.dataset.icon, 'provider-icon'));
    header.append(label('span', 'catalog-count', count.toLocaleString()));
    content.append(header);
  }
  for (const group of groups) {
    const family = document.createElement('div');
    family.className = 'model-family';
    const heading = label('h3', 'family-heading', group.label);
    if (group.icon) heading.prepend(logo(group.icon, 'family-icon', group.monochrome));
    const options = document.createElement('div');
    options.className = 'model-options';
    for (const { id, name } of group.models) {
      const button = label('button', 'option', name);
      button.type = 'button';
      button.dataset.action = 'model';
      button.dataset.value = id;
      if (id === currentModel) button.setAttribute('aria-current', 'true');
      options.append(button);
    }
    family.append(heading, options);
    content.append(family);
  }
  list.replaceChildren(content);
  list.scrollTop = 0;
  modelStatus.textContent = loading ? 'Loading models…'
    : catalogError ? 'Model catalog unavailable.'
    : !count ? 'No matching coding models.' : '';
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
    modelGroups = data.groups;
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
