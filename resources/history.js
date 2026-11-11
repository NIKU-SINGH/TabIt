const vscode = acquireVsCodeApi();
const historyList = document.getElementById('history');
const status = document.getElementById('history-status');

function element(tag, text, className) {
  const node = document.createElement(tag);
  if (text) node.textContent = text;
  if (className) node.className = className;
  return node;
}

window.addEventListener('message', ({ data: { revision, groups, error } }) => {
  const content = document.createDocumentFragment();
  for (const group of groups) {
    const section = element('section');
    const entries = element('ul');
    section.append(element('h2', group.date), entries);
    for (const row of group.rows) {
      const item = element('li');
      const button = element('button');
      button.type = 'button';
      const preview = row.preview ? element('code', row.preview) : element('span', 'No insertion returned', 'no-insertion');
      const metadata = element('span', '', 'metadata');
      metadata.append(element('span', row.time), element('span', row.tokens));
      button.append(preview, metadata);
      button.addEventListener('click', () => vscode.postMessage({ action: 'open', revision, index: row.index }));
      item.append(button);
      entries.append(item);
    }
    content.append(section);
  }
  historyList.replaceChildren(content);
  status.textContent = error || (groups.length ? '' : 'No completions yet.');
  status.hidden = !status.textContent;
});

vscode.postMessage({ action: 'ready' });
