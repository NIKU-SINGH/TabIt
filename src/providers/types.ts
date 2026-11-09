import type { ApiClient } from './api-client';
import type { CodeContext, CompletionMode } from '../completion/infill';

export enum ProviderId {
  OpenAI = 'openai',
  Anthropic = 'anthropic',
  OpenRouter = 'openrouter',
  Together = 'together',
}

export interface Selection {
  readonly provider: ProviderId;
  readonly model: string;
  readonly mode: CompletionMode;
}

export interface Model {
  readonly id: string;
  readonly name: string;
}

export interface CompletionRequest {
  readonly model: string;
  readonly context: CodeContext;
  readonly maxTokens: number;
}

export interface CompletionResult {
  readonly text: string;
  readonly totalTokens: number | null;
}

export type CompletionHandler = (api: ApiClient, request: CompletionRequest) => Promise<CompletionResult>;

export interface ProviderAdapter {
  readonly label: string;
  readonly baseUrl: string;
  readonly authHeaders?: (key: string) => Readonly<Record<string, string>>;
  readonly listModels: (api: ApiClient) => Promise<readonly Model[]>;
  readonly inference: Readonly<Partial<Record<CompletionMode, CompletionHandler>>>;
}

export type ProviderRegistry = Readonly<Record<ProviderId, ProviderAdapter>>;
