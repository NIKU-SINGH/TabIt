const assert = require('node:assert/strict');
const Module = require('node:module');
const { test } = require('node:test');

const vscode = { window: {}, commands: {} };
const load = Module._load;
let EditorCompletionTrigger;
try {
  Module._load = function (name, ...args) {
    return name === 'vscode' ? vscode : load.call(this, name, ...args);
  };
  ({ EditorCompletionTrigger } = require('../../dist/completion/editor-trigger.js'));
} finally {
  Module._load = load;
}

test('editor trigger debounces edits and respects automatic opt-out', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const position = (column) => ({ column, isEqual: (other) => other.column === column });
  const selection = { active: position(1), isEmpty: true };
  const editor = { document: { version: 1, uri: { scheme: 'file' } }, selection, selections: [selection] };
  vscode.window.activeTextEditor = editor;
  let enabled = true;
  const invocations = [];
  const trigger = new EditorCompletionTrigger(() => enabled, () => 300, () => assert.fail('trigger failed'));
  vscode.commands.executeCommand = async (id) => {
    invocations.push([id, selection.active.column, trigger.isScheduled(editor.document, selection.active)]);
  };

  trigger.schedule(editor);
  t.mock.timers.tick(200);
  editor.document.version++;
  selection.active = position(2);
  trigger.schedule(editor);
  t.mock.timers.tick(299);
  assert.deepEqual(invocations, []);
  t.mock.timers.tick(1);
  assert.deepEqual(invocations, [['editor.action.inlineSuggest.trigger', 2, true]]);

  trigger.schedule(editor);
  enabled = false;
  t.mock.timers.tick(400);
  assert.equal(invocations.length, 1);
  trigger.dispose();
});

test('a typing burst dispatches once after the full quiet period and stays idle', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const position = { isEqual: (other) => other === position };
  const selection = { active: position, isEmpty: true };
  const editor = { document: { version: 1, uri: { scheme: 'file' } }, selection, selections: [selection] };
  vscode.window.activeTextEditor = editor;
  let calls = 0;
  vscode.commands.executeCommand = async () => { calls++; };
  const trigger = new EditorCompletionTrigger(() => true, () => 300, () => assert.fail('trigger failed'));

  for (let i = 0; i < 25; i++) {
    editor.document.version++;
    trigger.schedule(editor);
    if (i < 24) t.mock.timers.tick(75);
  }
  assert.equal(calls, 0);
  t.mock.timers.tick(299);
  assert.equal(calls, 0);
  t.mock.timers.tick(1);
  assert.equal(calls, 1);
  t.mock.timers.tick(5_000);
  assert.equal(calls, 1);
  trigger.dispose();
});
