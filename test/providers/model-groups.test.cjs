const test = require('node:test');
const assert = require('node:assert/strict');
const { groupModels, isCodingModel } = require('../../dist/providers/model-catalog');

test('groups routed models by family and keeps their original selection IDs', () => {
  const models = groupModels([
    { id: 'anthropic/claude-sonnet-5', name: 'Anthropic: Claude Sonnet 5' },
    { id: 'deepseek-ai/DeepSeek-V4-Flash', name: 'DeepSeek: DeepSeek V4 Flash' },
    { id: 'deepseek/deepseek-v4', name: 'DeepSeek V4' },
    { id: 'z-ai/glm-5.3', name: 'Z.AI: GLM 5.3' },
    { id: 'moonshotai/kimi-k3', name: 'Moonshot AI: Kimi K3' },
    { id: 'minimax/minimax-m3', name: 'MiniMax: MiniMax M3' },
    { id: 'openai/gpt-5', name: 'OpenAI: GPT-5' },
    { id: 'new-lab/future-coder', name: 'New Lab: Future Coder' },
  ]);
  assert.deepEqual(models.map(({ label, icon, models }) => [label, icon, models.map(({ name }) => name)]), [
    ['Claude', 'claude-color', ['Claude Sonnet 5']],
    ['DeepSeek', 'deepseek-color', ['DeepSeek V4 Flash', 'DeepSeek V4']],
    ['GLM', 'zai', ['GLM 5.3']],
    ['Kimi', 'kimi-color', ['Kimi K3']],
    ['MiniMax', 'minimax-color', ['MiniMax M3']],
    ['New Lab', undefined, ['Future Coder']],
    ['OpenAI', 'openai', ['GPT-5']],
  ]);
  assert.equal(models[1].models[0].id, 'deepseek-ai/DeepSeek-V4-Flash');
});

test('includes interactive coding families and filters batch-only variants', () => {
  assert.equal(isCodingModel('moonshotai/kimi-k3'), true);
  assert.equal(isCodingModel('minimax/minimax-m3'), true);
  assert.equal(isCodingModel('anthropic/claude-fable-5:batch'), false);
});
