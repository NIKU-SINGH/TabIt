const test = require('node:test');
const assert = require('node:assert/strict');
const { presentHistory } = require('../../dist/history/presentation');

test('history groups newest entries by local date and exposes previews and token usage', () => {
  const entry = (day, text, totalTokens) => ({
    timestamp: new Date(2026, 10, day, 23, 46).toISOString(), text, totalTokens,
  });
  const groups = presentHistory([
    entry(11, '\n  return mergedArray;\n}', 281),
    entry(11, '', 0),
    entry(10, '  const result = [];', null),
  ]);
  assert.equal(groups.length, 2);
  assert.deepEqual(groups[0].rows.map(({ index, preview, tokens }) => [index, preview, tokens]), [
    [0, 'return mergedArray;', '281 tokens'],
    [1, '', '0 tokens'],
  ]);
  assert.equal(groups[1].rows[0].tokens, 'Tokens unavailable');
  assert.ok(groups[0].rows[0].time);
});
