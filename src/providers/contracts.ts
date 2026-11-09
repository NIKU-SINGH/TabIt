// Wire contracts cover the fields the extension sends or consumes.
interface ModelRequest {
  readonly model: string;
}

export interface OpenAIResponseRequestDto extends ModelRequest {
  readonly input: string;
  readonly instructions: string;
  readonly max_output_tokens: number;
  readonly store: false;
}

interface UserMessageDto {
  readonly role: 'user';
  readonly content: string;
}

export interface AnthropicMessageRequestDto extends ModelRequest {
  readonly system: string;
  readonly messages: readonly [UserMessageDto];
  readonly max_tokens: number;
}

export interface ChatCompletionRequestDto extends ModelRequest {
  readonly messages: readonly [
    { readonly role: 'system'; readonly content: string },
    UserMessageDto,
  ];
  readonly max_tokens: number;
}

export interface TextCompletionRequestDto extends ModelRequest {
  readonly prompt: string;
  readonly stop: readonly string[];
  readonly max_tokens: number;
  readonly temperature: number;
}

interface OpenAIResponseDto {
  readonly totalTokens: number | null;
  readonly output: readonly { readonly content: readonly { readonly text: string }[] }[];
}

interface AnthropicMessageDto {
  readonly totalTokens: number | null;
  readonly content: readonly { readonly text: string }[];
}

interface ChatCompletionDto {
  readonly totalTokens: number | null;
  readonly choices: readonly { readonly message: { readonly content: string | null } }[];
}

interface TextCompletionDto {
  readonly totalTokens: number | null;
  readonly choices: readonly { readonly text: string }[];
}

interface CatalogModelDto {
  readonly id: string;
  readonly display_name?: string;
  readonly name?: string;
  readonly type?: string;
}

interface ModelCatalogDto {
  readonly data: readonly CatalogModelDto[];
  readonly nextCursor?: string;
}

type JsonObject = Record<string, unknown>;

export function isObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export class InvalidProviderPayload extends Error {}

function object(value: unknown): JsonObject {
  if (!isObject(value)) throw new InvalidProviderPayload();
  return value;
}

function list(value: unknown): readonly unknown[] {
  if (!Array.isArray(value)) throw new InvalidProviderPayload();
  return value;
}

function text(value: unknown): string {
  if (typeof value !== 'string') throw new InvalidProviderPayload();
  return value;
}

function textBlocks(value: unknown, textType: string): readonly { text: string }[] {
  return list(value).map(object)
    .filter((block) => text(block.type) === textType)
    .map((block) => ({ text: text(block.text) }));
}

function tokenCount(value: unknown): number | null {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : null;
}

function usageTotal(value: unknown, format: 'responses' | 'messages' | 'completions'): number | null {
  if (!isObject(value)) return null;
  const reported = tokenCount(value.total_tokens);
  if (reported !== null) return reported;
  const input = tokenCount(format === 'completions' ? value.prompt_tokens : value.input_tokens);
  const output = tokenCount(format === 'completions' ? value.completion_tokens : value.output_tokens);
  if (input === null || output === null) return null;
  const cached = format === 'messages'
    ? (tokenCount(value.cache_read_input_tokens) ?? 0) + (tokenCount(value.cache_creation_input_tokens) ?? 0)
    : 0;
  return tokenCount(input + output + cached);
}

export function decodeOpenAIResponse(value: unknown): OpenAIResponseDto {
  const response = object(value);
  return {
    totalTokens: usageTotal(response.usage, 'responses'),
    output: list(response.output).map(object)
      .filter((item) => text(item.type) === 'message')
      .map((item) => ({ content: textBlocks(item.content, 'output_text') })),
  };
}

export function decodeAnthropicMessage(value: unknown): AnthropicMessageDto {
  const response = object(value);
  return { content: textBlocks(response.content, 'text'), totalTokens: usageTotal(response.usage, 'messages') };
}

export function decodeChatCompletion(value: unknown): ChatCompletionDto {
  const response = object(value);
  return {
    totalTokens: usageTotal(response.usage, 'completions'),
    choices: list(response.choices).map((item) => {
      const choice = object(item);
      if (choice.error || choice.finish_reason === 'error') throw new InvalidProviderPayload();
      const { content } = object(choice.message);
      return { message: { content: content === null ? null : text(content) } };
    }),
  };
}

export function decodeTextCompletion(value: unknown): TextCompletionDto {
  const response = object(value);
  return {
    totalTokens: usageTotal(response.usage, 'completions'),
    choices: list(response.choices).map((item) => {
      const choice = object(item);
      if (choice.error || choice.finish_reason === 'error') throw new InvalidProviderPayload();
      return { text: text(choice.text) };
    }),
  };
}

export function decodeModelCatalog(value: unknown, paginated: boolean): ModelCatalogDto {
  const envelope = Array.isArray(value) ? undefined : object(value);
  const data = list(envelope ? envelope.data : value).map((entry): CatalogModelDto => {
    const model = object(entry);
    const id = text(model.id);
    if (!id.trim()) throw new InvalidProviderPayload();
    const { display_name, name, type } = model;
    return {
      id,
      ...(typeof display_name === 'string' && { display_name }),
      ...(typeof name === 'string' && { name }),
      ...(typeof type === 'string' && { type }),
    };
  });
  if (!paginated || envelope?.has_more !== true) return { data };
  const nextCursor = text(envelope.last_id);
  if (!nextCursor) throw new InvalidProviderPayload();
  return { data, nextCursor };
}
