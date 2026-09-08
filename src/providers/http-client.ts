import type { ProviderFailure } from './contracts.js';

export interface ProviderJsonResponse {
  status: number;
  headers: {
    get(name: string): string | null;
  };
  json(): Promise<unknown>;
  cancelBody?: () => Promise<void> | void;
}

export interface ProviderFetchInit {
  signal: AbortSignal;
  headers: Readonly<Record<string, string>>;
}

export type ProviderFetcher = (
  input: URL,
  init: ProviderFetchInit,
) => Promise<ProviderJsonResponse>;

export interface ProviderHttpClientOptions {
  fetcher?: ProviderFetcher;
  headers?: Readonly<Record<string, string>>;
  timeoutMs?: number;
}

export type ProviderHttpResult =
  | {
      ok: true;
      status: number;
      value: unknown;
    }
  | {
      ok: false;
      failure: ProviderFailure;
    };

export interface ProviderHttpClient {
  getJson(url: URL): Promise<ProviderHttpResult>;
}

const defaultTimeoutMs = 5_000;

export function createProviderHttpClient(
  options: ProviderHttpClientOptions = {},
): ProviderHttpClient {
  const timeoutMs = options.timeoutMs ?? defaultTimeoutMs;
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1) {
    throw new Error('timeoutMs must be a positive integer');
  }

  const fetcher = options.fetcher ?? defaultProviderFetcher;
  const headers = { ...options.headers };

  return {
    async getJson(url: URL) {
      const controller = new AbortController();
      let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
      let response: ProviderJsonResponse | undefined;
      let bodyConsumed = false;
      const timeoutPromise = new Promise<never>((_, reject) => {
        timeoutHandle = setTimeout(() => {
          controller.abort();
          reject(new ProviderTimeoutError());
        }, timeoutMs);
      });

      try {
        response = await Promise.race([
          fetcher(url, { signal: controller.signal, headers }),
          timeoutPromise,
        ]);

        if (response.status === 429) {
          return providerFailure(
            'PROVIDER_RATE_LIMITED',
            'Provider rate limit response.',
          );
        }
        if (response.status < 200 || response.status >= 300) {
          return providerFailure(
            'PROVIDER_UNAVAILABLE',
            'Provider rejected the request.',
          );
        }

        const contentType = response.headers.get('content-type');
        if (contentType !== null && !/\bjson\b/i.test(contentType)) {
          return providerFailure(
            'PROVIDER_UNAVAILABLE',
            'Provider returned a non-JSON response.',
          );
        }

        const value = await Promise.race([response.json(), timeoutPromise]);
        bodyConsumed = true;
        return { ok: true, status: response.status, value };
      } catch (error) {
        return providerFailure(
          'PROVIDER_UNAVAILABLE',
          error instanceof ProviderTimeoutError || controller.signal.aborted
            ? 'Provider request timed out.'
            : 'Provider request failed.',
        );
      } finally {
        if (timeoutHandle !== undefined) {
          clearTimeout(timeoutHandle);
        }
        if (response !== undefined && !bodyConsumed) {
          controller.abort();
          cancelResponseBody(response);
        }
      }
    },
  };
}

async function defaultProviderFetcher(
  input: URL,
  init: ProviderFetchInit,
): Promise<ProviderJsonResponse> {
  const response = await fetch(input, init);
  const providerResponse: ProviderJsonResponse = {
    status: response.status,
    headers: response.headers,
    json: () => response.json(),
  };
  const body = response.body;
  if (body !== null) {
    providerResponse.cancelBody = () => body.cancel();
  }
  return providerResponse;
}

function providerFailure(
  code: ProviderFailure['code'],
  message: string,
): ProviderHttpResult {
  return { ok: false, failure: { code, message } };
}

function cancelResponseBody(response: ProviderJsonResponse): void {
  try {
    const cancellation = response.cancelBody?.();
    if (cancellation !== undefined) {
      void Promise.resolve(cancellation).catch(() => {
        // Cleanup failures must not replace the safe provider failure.
      });
    }
  } catch {
    // Cleanup must not replace the safe provider failure being returned.
  }
}

class ProviderTimeoutError extends Error {
  constructor() {
    super('Provider request timed out');
  }
}
