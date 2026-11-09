import type { AxiosInstance } from 'axios';
import { InvalidProviderPayload, isObject } from './contracts';
import type { ProviderId } from './types';

type Operation = 'completion' | 'model catalog';
type Decoder<T> = (payload: unknown) => T;
type ApiPath = `/${string}`;

interface ApiConnection {
  readonly provider: ProviderId;
  readonly label: string;
  readonly baseUrl: string;
  readonly headers: Readonly<Record<string, string>>;
  readonly signal: AbortSignal;
}

export class CloudError extends Error {
  override readonly name = 'CloudError';

  constructor(readonly provider: ProviderId, label: string, readonly status: number) {
    super(`${label} returned HTTP ${status}.`);
  }
}

export class CloudProtocolError extends Error {
  override readonly name = 'CloudProtocolError';

  constructor(readonly provider: ProviderId, label: string, readonly operation: Operation) {
    super(`${label} returned an invalid ${operation} response.`);
  }
}

export class ApiClient {
  constructor(private readonly http: AxiosInstance, private readonly connection: ApiConnection) {}

  get<T>(path: ApiPath, decode: Decoder<T>): Promise<T> {
    return this.request('model catalog', path, decode);
  }

  post<T>(path: ApiPath, body: object, decode: Decoder<T>): Promise<T> {
    return this.request('completion', path, decode, body);
  }

  invalidCatalog(): CloudProtocolError {
    return new CloudProtocolError(this.connection.provider, this.connection.label, 'model catalog');
  }

  private async request<T>(
    operation: Operation,
    path: ApiPath,
    decode: Decoder<T>,
    data?: object,
  ): Promise<T> {
    const { provider, label, baseUrl, headers, signal } = this.connection;
    signal.throwIfAborted();

    let status: number;
    let raw: unknown;
    try {
      ({ status, data: raw } = await this.http.request<unknown>({
        url: baseUrl + path,
        method: data === undefined ? 'GET' : 'POST',
        headers: {
          ...headers,
          ...(data !== undefined && { 'content-type': 'application/json' }),
        },
        ...(data !== undefined && { data }),
        signal,
        maxRedirects: 0,
        maxContentLength: 4 * 1024 * 1024,
        validateStatus: () => true,
        responseType: 'text',
        transformResponse: [(value: unknown) => value],
      }));
    } catch {
      signal.throwIfAborted();
      // Axios errors can contain the Authorization header and request body.
      throw new Error(`${label} could not be reached.`);
    }

    signal.throwIfAborted();
    if (status < 200 || status >= 300) throw new CloudError(provider, label, status);
    try {
      if (typeof raw !== 'string') throw new InvalidProviderPayload();
      const payload: unknown = JSON.parse(raw);
      if (isObject(payload) && (payload.error || payload.status === 'failed')) {
        throw new InvalidProviderPayload();
      }
      return decode(payload);
    } catch (error) {
      if (error instanceof SyntaxError || error instanceof InvalidProviderPayload) {
        throw new CloudProtocolError(provider, label, operation);
      }
      throw error;
    }
  }
}
