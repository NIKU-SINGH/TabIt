import { INFILL_INSTRUCTIONS, fimPrompt, promptedInfill } from '../completion/infill';
import type { FimFormat } from '../completion/infill';
import {
  type AnthropicMessageRequestDto,
  type ChatCompletionRequestDto,
  type OpenAIResponseRequestDto,
  type TextCompletionRequestDto,
  decodeAnthropicMessage,
  decodeChatCompletion,
  decodeModelCatalog,
  decodeOpenAIResponse,
  decodeTextCompletion,
} from './contracts';
import { hasModelAlias, isCodingModel, modelTitle } from './model-catalog';
import { ProviderId } from './types';
import type { CompletionHandler, Model, ProviderAdapter, ProviderRegistry } from './types';

interface CatalogOptions {
  readonly textOnly?: boolean;
  readonly paginated?: boolean;
  readonly include?: (model: { readonly id: string; readonly type?: string }) => boolean;
}

function modelCatalog(options: CatalogOptions = {}): ProviderAdapter['listModels'] {
  return async (api) => {
    const models = new Map<string, Model>();
    const seen = new Set<string>();
    let path: `/models${string}` = options.textOnly ? '/models?output_modalities=text' : '/models';
    const decodePage = (value: unknown): ReturnType<typeof decodeModelCatalog> =>
      decodeModelCatalog(value, options.paginated ?? false);

    while (true) {
      const page = await api.get(path, decodePage);
      for (const model of page.data) {
        if (!isCodingModel(model.id, model.type) || (options.include && !options.include(model))) continue;
        models.set(model.id, { id: model.id, name: modelTitle(model.id, model.display_name || model.name) });
      }

      const cursor = page.nextCursor;
      if (!cursor) break;
      if (seen.has(cursor)) throw api.invalidCatalog();
      seen.add(cursor);
      path = `/models?after_id=${encodeURIComponent(cursor)}`;
    }
    return [...models.values()]
      .filter(({ id }) => !hasModelAlias(id, models))
      .sort((left, right) => left.name.localeCompare(right.name, undefined, { numeric: true }));
  };
}

const openAICompletion: CompletionHandler = async (api, { model, context, maxTokens }) => {
  const result = await api.post('/responses', {
    model, input: promptedInfill(context), instructions: INFILL_INSTRUCTIONS,
    max_output_tokens: maxTokens, store: false,
  } satisfies OpenAIResponseRequestDto, decodeOpenAIResponse);
  return { text: result.output.flatMap((item) => item.content).map((block) => block.text).join(''), totalTokens: result.totalTokens };
};

const anthropicCompletion: CompletionHandler = async (api, { model, context, maxTokens }) => {
  const result = await api.post('/messages', {
    model, system: INFILL_INSTRUCTIONS, max_tokens: maxTokens,
    messages: [{ role: 'user', content: promptedInfill(context) }],
  } satisfies AnthropicMessageRequestDto, decodeAnthropicMessage);
  return { text: result.content.map((block) => block.text).join(''), totalTokens: result.totalTokens };
};

const chatCompletion: CompletionHandler = async (api, { model, context, maxTokens }) => {
  const result = await api.post('/chat/completions', {
    model, max_tokens: maxTokens,
    messages: [
      { role: 'system', content: INFILL_INSTRUCTIONS },
      { role: 'user', content: promptedInfill(context) },
    ],
  } satisfies ChatCompletionRequestDto, decodeChatCompletion);
  return { text: result.choices[0]?.message.content ?? '', totalTokens: result.totalTokens };
};

function nativeFim(format: FimFormat): CompletionHandler {
  return async (api, { model, context, maxTokens }) => {
    const { prompt, stop } = fimPrompt(format, context.prefix, context.suffix);
    const result = await api.post('/completions', {
      model, prompt, stop: stop.slice(0, 4), max_tokens: maxTokens, temperature: 0,
    } satisfies TextCompletionRequestDto, decodeTextCompletion);
    const text = result.choices[0]?.text ?? '';
    const stopIndex = stop.reduce((end, marker) => {
      const index = text.indexOf(marker);
      return index === -1 ? end : Math.min(end, index);
    }, text.length);
    return { text: text.slice(0, stopIndex), totalTokens: result.totalTokens };
  };
}

const chatAndFim = {
  prompted: chatCompletion,
  qwen: nativeFim('qwen'),
  starcoder: nativeFim('starcoder'),
};

export const PROVIDERS: ProviderRegistry = {
  [ProviderId.OpenAI]: {
    label: 'OpenAI Cloud',
    baseUrl: 'https://api.openai.com/v1',
    listModels: modelCatalog(),
    inference: { prompted: openAICompletion },
  },
  [ProviderId.Anthropic]: {
    label: 'Anthropic',
    baseUrl: 'https://api.anthropic.com/v1',
    authHeaders: (key) => ({ authorization: `Bearer ${key}`, 'anthropic-version': '2026-10-21' }),
    listModels: modelCatalog({ paginated: true }),
    inference: { prompted: anthropicCompletion },
  },
  [ProviderId.OpenRouter]: {
    label: 'OpenRouter',
    baseUrl: 'https://openrouter.ai/api/v1',
    listModels: modelCatalog({ textOnly: true }),
    inference: chatAndFim,
  },
  [ProviderId.Together]: {
    label: 'Together AI',
    baseUrl: 'https://api.together.ai/v1',
    listModels: modelCatalog({
      include: ({ type }) => !type || ['chat', 'language', 'code', 'text'].includes(type.toLowerCase()),
    }),
    inference: chatAndFim,
  },
};
