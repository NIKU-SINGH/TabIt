const assert = require('node:assert/strict');
const { test } = require('node:test');
const axios = require('axios');
const { CloudClient, CloudError, PROVIDERS, ProviderId } = require('../../dist/providers/cloud-client.js');

function mockClient(respond, registry) {
  const http = axios.create({
    adapter: async (config) => {
      const response = await respond(config);
      return { data: await response.text(), status: response.status,
        statusText: response.statusText, headers: {}, config };
    },
  });
  return new CloudClient(http, registry);
}

const context = { language: 'typescript', prefix: 'const x = ', suffix: ';' };

const cases = [
  ['openai', 'prompted', 'https://api.openai.com/v1/responses', { output: [
    { type: 'reasoning', summary: [] },
    { type: 'message', content: [{ type: 'output_text', text: '42' }] },
  ] }],
  ['anthropic', 'prompted', 'https://api.anthropic.com/v1/messages', { content: [
    { type: 'thinking', thinking: 'private' }, { type: 'text', text: '42' },
  ] }],
  ['openrouter', 'prompted', 'https://openrouter.ai/api/v1/chat/completions',
    { choices: [{ message: { content: '42' } }] }],
  ['together', 'prompted', 'https://api.together.ai/v1/chat/completions',
    { choices: [{ message: { content: '42' } }] }],
  ['together', 'qwen', 'https://api.together.ai/v1/completions', { choices: [{ text: '42' }] }],
  ['openrouter', 'starcoder', 'https://openrouter.ai/api/v1/completions',
    { choices: [{ text: '42' }] }],
];

for (const [provider, mode, endpoint, response] of cases) {
  test(`${provider} ${mode} sends the correct request and extracts insertion text`, async () => {
    const signal = new AbortController().signal;
    const client = mockClient(async (config) => {
      assert.equal(config.url, endpoint);
      assert.equal(config.method, 'post');
      assert.equal(config.maxRedirects, 0);
      assert.equal(config.signal, signal);
      const headers = config.headers;
      assert.equal(headers.get('authorization'), 'Bearer fake-key');
      const body = JSON.parse(config.data);
      assert.equal(body.model, 'model-id');
      if (mode === 'prompted') {
        assert.deepEqual(JSON.parse(body.input ?? body.messages.at(-1).content), context);
        if (provider === 'openai') assert.equal(body.store, false);
      } else {
        assert.ok(body.prompt.includes(context.prefix));
        assert.ok(body.prompt.includes(context.suffix));
        assert.ok(body.stop.length > 0);
      }
      return Response.json({ ...response, usage: { total_tokens: 17 } });
    });
    assert.deepEqual(await client.complete({ provider, model: 'model-id', mode },
      'fake-key', context, 256, signal), { text: '42', totalTokens: 17 });
  });
}

test('Together AI model discovery excludes embedding models', async () => {
  const client = mockClient(async () => Response.json([
    { id: 'embed', type: 'embedding' }, { id: 'coder', type: 'code' },
    { id: 'chat', display_name: 'Chat', type: 'chat' },
    { id: 'Qwen/Qwen3-Coder', display_name: 'Qwen3 Coder', type: 'chat' },
  ]));
  assert.deepEqual(await client.listModels('together', 'fake-key', AbortSignal.timeout(1000)),
    [{ id: 'coder', name: 'Coder' }, { id: 'Qwen/Qwen3-Coder', name: 'Qwen3 Coder' }]);
});

test('API failures surface HTTP status without exposing the response body', async () => {
  const client = mockClient(async () => Response.json({ error: 'secret source' }, { status: 429 }));
  await assert.rejects(client.listModels('openai', 'fake-key', AbortSignal.timeout(1000)),
    (error) => error instanceof CloudError && error.status === 429 && !error.message.includes('secret'));
});

test('a malformed success response reports a sanitized protocol error', async () => {
  const client = mockClient(async () => Response.json({
    output: [{ type: 'message', content: [{ type: 'output_text', text: { private: 'source code' } }] }],
  }));
  await assert.rejects(client.complete({ provider: 'openai', model: 'model-id', mode: 'prompted' },
    'fake-key', context, 256, AbortSignal.timeout(1000)), {
    name: 'CloudProtocolError', message: 'OpenAI Cloud returned an invalid completion response.',
  });
});

test('a chat response with no visible text is a valid empty completion', async () => {
  const client = mockClient(async () => Response.json({
    choices: [{ message: { content: null, reasoning: 'hidden' } }],
  }));
  assert.deepEqual(await client.complete({ provider: 'openrouter', model: 'model-id', mode: 'prompted' },
    'fake-key', context, 256, AbortSignal.timeout(1000)), { text: '', totalTokens: null });
});

test('a broken model catalog fails instead of looking empty', async () => {
  const client = mockClient(async () => Response.json({ data: 'not a list' }));
  await assert.rejects(client.listModels('anthropic', 'fake-key', AbortSignal.timeout(1000)), {
    name: 'CloudProtocolError', message: 'Anthropic returned an invalid model catalog response.',
  });
});

test('a repeated catalog cursor fails promptly', async () => {
  let requests = 0;
  const client = mockClient(async () => {
    requests++;
    return Response.json({ data: [], has_more: true, last_id: 'repeated' });
  });
  await assert.rejects(client.listModels('anthropic', 'fake-key', AbortSignal.timeout(1000)), {
    name: 'CloudProtocolError',
  });
  assert.equal(requests, 2);
});

test('Anthropic catalog follows the cursor and deduplicates overlapping pages', async () => {
  const paths = [];
  const client = mockClient(async (config) => {
    paths.push(new URL(config.url).search);
    assert.equal(config.headers.get('anthropic-version'), '2026-10-21');
    return Response.json(paths.length === 1
      ? { data: [{ id: 'claude-sonnet-a', display_name: 'A' }], has_more: true, last_id: 'a+b' }
      : { data: [{ id: 'claude-sonnet-a', display_name: 'A' }, { id: 'claude-opus-b', display_name: 'B' }], has_more: false });
  });
  assert.deepEqual(await client.listModels('anthropic', 'fake-key', AbortSignal.timeout(1000)),
    [{ id: 'claude-sonnet-a', name: 'A' }, { id: 'claude-opus-b', name: 'B' }]);
  assert.deepEqual(paths, ['', '?after_id=a%2Bb']);
});

test('stored selections preserve supported modes and reject incompatible or unknown values', () => {
  const { restoreSelection } = require('../../dist/providers/cloud-client.js');
  const selection = { provider: 'together', model: 'coder', mode: 'qwen' };
  assert.deepEqual(restoreSelection(selection), selection);
  assert.equal(restoreSelection({ ...selection, provider: 'openai' }), undefined);
  assert.equal(restoreSelection({ ...selection, provider: 'constructor' }), undefined);
  assert.equal(restoreSelection({ ...selection, model: ' ' }), undefined);
});

test('the client dispatches discovery and completion through a registered adapter', async () => {
  const provider = ProviderId.OpenAI;
  const client = mockClient(async (config) => {
    assert.equal(config.url, 'https://test.invalid/v1/insert');
    assert.equal(config.headers.get('x-api-key'), 'fake-key');
    assert.equal(config.headers.has('authorization'), false);
    assert.deepEqual(JSON.parse(config.data), { left: 'const x = ', modelId: 'test-model' });
    return Response.json({ insertion: '42' });
  }, {
    ...PROVIDERS,
    [provider]: {
      label: 'Test provider',
      baseUrl: 'https://test.invalid/v1',
      authHeaders: (key) => ({ 'x-api-key': key }),
      listModels: async () => [{ id: 'test-model', name: 'Test Model' }],
      inference: {
        prompted: (api, request) => api.post('/insert', { left: request.context.prefix, modelId: request.model },
          (payload) => ({ text: payload.insertion, totalTokens: null })),
      },
    },
  });
  const signal = AbortSignal.timeout(1000);
  assert.deepEqual(await client.listModels(provider, 'fake-key', signal), [
    { id: 'test-model', name: 'Test Model' },
  ]);
  assert.deepEqual(await client.complete({ provider, model: 'test-model', mode: 'prompted' },
    'fake-key', context, 256, signal), { text: '42', totalTokens: null });
});

test('the API client preserves the caller’s abort reason', async () => {
  const abort = new AbortController();
  const reason = new DOMException('deadline', 'TimeoutError');
  const client = mockClient(async () => {
    abort.abort(reason);
    return Response.json({ data: [] });
  });
  await assert.rejects(client.listModels(ProviderId.OpenAI, 'fake-key', abort.signal),
    (error) => error === reason);
});

test('transport errors expose neither credentials nor request data', async () => {
  const client = mockClient(async () => {
    throw new Error('fake-key and private source');
  });
  await assert.rejects(client.listModels(ProviderId.OpenAI, 'fake-key', AbortSignal.timeout(1000)),
    (error) => error.message === 'OpenAI Cloud could not be reached.' && error.cause === undefined);
});

test('Anthropic usage includes cache reads and writes in the token total', async () => {
  const client = mockClient(async () => Response.json({
    content: [{ type: 'text', text: '42' }],
    usage: { input_tokens: 10, output_tokens: 2, cache_read_input_tokens: 20, cache_creation_input_tokens: 5 },
  }));
  assert.deepEqual(await client.complete({ provider: ProviderId.Anthropic, model: 'model', mode: 'prompted' },
    'fake-key', context, 256, AbortSignal.timeout(1000)), { text: '42', totalTokens: 37 });
});

test('OpenAI catalog returns titled coding models without non-code products or redundant snapshots', async () => {
  const ids = ['chat-latest', 'chatgpt-image-latest', 'gpt-4o-mini-tts', 'gpt-5.6-sol',
    'gpt-6.1-sol', 'gpt-6.1-sol-2026-11-01', 'gpt-6-luna'];
  const client = mockClient(async () => Response.json({ data: ids.map(id => ({ id })) }));
  const models = await client.listModels(ProviderId.OpenAI, 'fake-key', AbortSignal.timeout(1000));
  assert.deepEqual(models, [
    { id: 'gpt-5.6-sol', name: 'GPT-5.6 Sol' },
    { id: 'gpt-6-luna', name: 'GPT-6 Luna' },
    { id: 'gpt-6.1-sol', name: 'GPT-6.1 Sol' },
  ]);
});
