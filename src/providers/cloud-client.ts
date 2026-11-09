import axios from 'axios';
import type { AxiosInstance } from 'axios';
import { ApiClient } from './api-client';
import type { CodeContext, CompletionMode } from '../completion/infill';
import { PROVIDERS } from './adapters';
import { isObject } from './contracts';
import { ProviderId } from './types';
import type { CompletionResult, Model, ProviderRegistry, Selection } from './types';

export { CloudError, CloudProtocolError } from './api-client';
export { PROVIDERS } from './adapters';
export { ProviderId } from './types';

export function createSelection(provider: ProviderId, model: string, mode: CompletionMode): Selection | undefined {
  return model.trim() && PROVIDERS[provider].inference[mode] ? { provider, model, mode } : undefined;
}

export function restoreSelection(value: unknown): Selection | undefined {
  if (!isObject(value)) return undefined;
  const { provider, model, mode } = value;
  const providerId = Object.values(ProviderId).find((id) => id === provider);
  if (providerId === undefined || typeof model !== 'string'
    || (mode !== 'prompted' && mode !== 'qwen' && mode !== 'starcoder')) return undefined;
  return createSelection(providerId, model, mode);
}

export class CloudClient {
  constructor(
    private readonly http: AxiosInstance = axios.create(),
    private readonly providers: ProviderRegistry = PROVIDERS,
  ) {}

  listModels(provider: ProviderId, key: string, signal: AbortSignal): Promise<readonly Model[]> {
    return this.providers[provider].listModels(this.connection(provider, key, signal));
  }

  async complete(
    { provider, model, mode }: Selection,
    key: string,
    context: CodeContext,
    maxTokens: number,
    signal: AbortSignal,
  ): Promise<CompletionResult> {
    const handler = this.providers[provider].inference[mode];
    if (!handler) throw new Error('The selected provider does not support this completion mode.');
    return handler(this.connection(provider, key, signal), { model, context, maxTokens });
  }

  private connection(provider: ProviderId, key: string, signal: AbortSignal): ApiClient {
    const { baseUrl, authHeaders, label } = this.providers[provider];
    const headers = authHeaders?.(key) ?? { authorization: `Bearer ${key}` };
    return new ApiClient(this.http, { provider, label, baseUrl, headers, signal });
  }
}
