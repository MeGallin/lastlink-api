import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  createProviderHttpClient,
  type ProviderJsonResponse,
} from '../src/providers/http-client.js';

const providerUrl = new URL('https://provider.test/journey');

function jsonResponse(
  value: unknown,
  status = 200,
  contentType = 'application/json',
  cancelBody?: () => Promise<void> | void,
): ProviderJsonResponse {
  const response: ProviderJsonResponse = {
    status,
    headers: {
      get(name) {
        return name.toLowerCase() === 'content-type' ? contentType : null;
      },
    },
    async json() {
      return value;
    },
  };
  if (cancelBody !== undefined) {
    response.cancelBody = cancelBody;
  }
  return response;
}

await test('HTTP client returns parsed JSON for a successful response', async () => {
  const client = createProviderHttpClient({
    fetcher: async (url, init) => {
      assert.equal(url.toString(), providerUrl.toString());
      assert.equal(init.headers.Authorization, 'Bearer synthetic-token');
      assert.equal(init.signal.aborted, false);
      return jsonResponse({ journeys: [] });
    },
    headers: { Authorization: 'Bearer synthetic-token' },
  });

  const result = await client.getJson(providerUrl);
  assert.deepEqual(result, { ok: true, status: 200, value: { journeys: [] } });
});

await test('HTTP client maps a 429 response to a rate-limit failure', async () => {
  const client = createProviderHttpClient({
    fetcher: async () => jsonResponse({ message: 'synthetic body' }, 429),
  });

  assert.deepEqual(await client.getJson(providerUrl), {
    ok: false,
    failure: {
      code: 'PROVIDER_RATE_LIMITED',
      message: 'Provider rate limit response.',
    },
  });
});

await test('HTTP client maps other non-success responses safely', async () => {
  const client = createProviderHttpClient({
    fetcher: async () => jsonResponse({ detail: 'synthetic body' }, 401),
  });

  assert.deepEqual(await client.getJson(providerUrl), {
    ok: false,
    failure: {
      code: 'PROVIDER_UNAVAILABLE',
      message: 'Provider rejected the request.',
    },
  });
});

await test('HTTP client rejects non-JSON success responses', async () => {
  const client = createProviderHttpClient({
    fetcher: async () => jsonResponse('synthetic text', 200, 'text/plain'),
  });

  assert.deepEqual(await client.getJson(providerUrl), {
    ok: false,
    failure: {
      code: 'PROVIDER_UNAVAILABLE',
      message: 'Provider returned a non-JSON response.',
    },
  });
});

await test('HTTP client does not expose fetch or JSON errors', async () => {
  const client = createProviderHttpClient({
    fetcher: async () => {
      throw new Error('synthetic-upstream-secret');
    },
  });

  const result = await client.getJson(providerUrl);
  assert.deepEqual(result, {
    ok: false,
    failure: {
      code: 'PROVIDER_UNAVAILABLE',
      message: 'Provider request failed.',
    },
  });
  assert.equal(
    JSON.stringify(result).includes('synthetic-upstream-secret'),
    false,
  );
});

await test('HTTP client maps JSON parsing failures safely', async () => {
  const client = createProviderHttpClient({
    fetcher: async () => ({
      ...jsonResponse(null),
      json: async () => {
        throw new Error('synthetic-upstream-body');
      },
    }),
  });

  assert.deepEqual(await client.getJson(providerUrl), {
    ok: false,
    failure: {
      code: 'PROVIDER_UNAVAILABLE',
      message: 'Provider request failed.',
    },
  });
});

for (const [label, response] of [
  ['rate-limit', jsonResponse({ message: 'synthetic body' }, 429)],
  ['rejected', jsonResponse({ detail: 'synthetic body' }, 401)],
  ['non-JSON', jsonResponse('synthetic text', 200, 'text/plain')],
] as const) {
  await test(`HTTP client cleans up ${label} response bodies`, async () => {
    let cancelled = false;
    const client = createProviderHttpClient({
      fetcher: async () => ({
        ...response,
        cancelBody: () => {
          cancelled = true;
        },
      }),
    });

    await client.getJson(providerUrl);
    assert.equal(cancelled, true);
  });
}

await test('HTTP client aborts and maps a timeout safely', async () => {
  const client = createProviderHttpClient({
    timeoutMs: 1,
    fetcher: async (_url, init) =>
      new Promise<ProviderJsonResponse>((_, reject) => {
        init.signal.addEventListener('abort', () => {
          reject(new Error('synthetic abort'));
        });
      }),
  });

  assert.deepEqual(await client.getJson(providerUrl), {
    ok: false,
    failure: {
      code: 'PROVIDER_UNAVAILABLE',
      message: 'Provider request timed out.',
    },
  });
});

await test('HTTP client times out a hanging JSON body and cleans it up', async () => {
  let cancelled = false;
  const client = createProviderHttpClient({
    timeoutMs: 1,
    fetcher: async () => ({
      ...jsonResponse(null),
      json: () => new Promise<never>(() => {}),
      cancelBody: () => {
        cancelled = true;
      },
    }),
  });

  assert.deepEqual(await client.getJson(providerUrl), {
    ok: false,
    failure: {
      code: 'PROVIDER_UNAVAILABLE',
      message: 'Provider request timed out.',
    },
  });
  assert.equal(cancelled, true);
});

await test('HTTP client does not wait for a hanging cancellation', async () => {
  let cancellationStarted = false;
  const client = createProviderHttpClient({
    fetcher: async () => ({
      ...jsonResponse('synthetic text', 200, 'text/plain'),
      cancelBody: () => {
        cancellationStarted = true;
        return new Promise<void>(() => {});
      },
    }),
  });

  const result = await Promise.race([
    client.getJson(providerUrl),
    new Promise<'timed-out'>((resolve) => {
      setTimeout(() => resolve('timed-out'), 100);
    }),
  ]);

  assert.notEqual(result, 'timed-out');
  assert.deepEqual(result, {
    ok: false,
    failure: {
      code: 'PROVIDER_UNAVAILABLE',
      message: 'Provider returned a non-JSON response.',
    },
  });
  assert.equal(cancellationStarted, true);
});

for (const timeoutMs of [0, -1, 1.5]) {
  await test(`HTTP client rejects invalid timeout ${timeoutMs}`, () => {
    assert.throws(
      () => createProviderHttpClient({ timeoutMs }),
      /timeoutMs must be a positive integer/,
    );
  });
}
