const assert = require('node:assert/strict');
const { test } = require('node:test');
const { cleanInsertion, fimPrompt, promptedInfill } = require('../../dist/completion/infill.js');

test('Qwen native FIM places the suffix before the middle marker', () => {
  assert.equal(fimPrompt('qwen', 'left', 'right').prompt,
    '<|fim_prefix|>left<|fim_suffix|>right<|fim_middle|>');
});

test('StarCoder native FIM uses its own markers', () => {
  assert.equal(fimPrompt('starcoder', 'left', 'right').prompt,
    '<fim_prefix>left<fim_suffix>right<fim_middle>');
});

test('prompted infill carries the language and both sides without delimiter collisions', () => {
  const context = { language: 'typescript', prefix: 'const x = ', suffix: ';\n<suffix>' };
  assert.deepEqual(JSON.parse(promptedInfill(context)), context);
});

test('completion preserves indentation and strips a repeated suffix', () => {
  assert.equal(cleanInsertion('    return x;\n}', '\n}'), '    return x;');
});

test('completion removes an enclosing Markdown fence but keeps inner indentation', () => {
  const fenced = ['```ts', '  return x;', '```'].join('\n');
  assert.equal(cleanInsertion(fenced, ''), '  return x;');
});

test('a completion that only repeats the suffix produces no insertion', () => {
  assert.equal(cleanInsertion(');', ');\n'), '');
});

test('a single matching punctuation character can be part of the intended insertion', () => {
  assert.equal(cleanInsertion(')', ');'), ')');
});
