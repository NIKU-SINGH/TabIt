const assert = require('node:assert/strict');
const { mkdtemp, readdir, rm, writeFile } = require('node:fs/promises');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const { test } = require('node:test');
const { CompletionHistory } = require('../../dist/history/store.js');

test('history survives reopening and concurrent writes and reads newest entries first', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'fim-history-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const directory = join(root, 'code-completions');
  const history = new CompletionHistory(directory);
  assert.deepEqual(await history.recent(), []);
  const first = { timestamp: '2026-11-09T07:00:00.000Z', provider: 'openai',
    model: 'example', language: 'typescript', text: '42', totalTokens: 17 };
  const second = { ...first, timestamp: '2026-11-09T07:00:01.000Z', text: '', totalTokens: null };
  await Promise.all([history.record(first), new CompletionHistory(directory).record(second)]);
  assert.equal((await readdir(directory)).length, 2);
  const reopened = new CompletionHistory(directory);
  assert.deepEqual(await reopened.recent(), [second, first]);
  assert.deepEqual(await reopened.recent(1), [second]);
});

test('history skips malformed entries and interrupted temporary writes', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'fim-history-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const name = '1794207600000-00000000-0000-0000-0000-000000000000.json';
  await writeFile(join(directory, name), '{malformed');
  await writeFile(join(directory, name + '.tmp'), '{}');
  assert.deepEqual(await new CompletionHistory(directory).recent(), []);
});

test('history includes records stored under the previous extension ID', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'tabit-rename-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const previous = join(root, 'previous');
  const current = join(root, 'current');
  const oldEntry = { timestamp: '2026-11-09T07:00:00.000Z', provider: 'openai',
    model: 'example', language: 'typescript', text: 'old', totalTokens: 17 };
  const newEntry = { ...oldEntry, timestamp: '2026-11-09T07:00:01.000Z', text: 'new' };
  await new CompletionHistory(previous).record(oldEntry);
  const history = new CompletionHistory(current, previous);
  assert.deepEqual(await history.recent(), [oldEntry]);
  await history.record(newEntry);
  assert.deepEqual(await history.recent(), [newEntry, oldEntry]);
  assert.deepEqual(await new CompletionHistory(previous).recent(), [oldEntry]);
});
