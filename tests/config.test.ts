import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readConfig } from '../src/config.js';

await test('configuration uses local defaults', () => {
  assert.deepEqual(readConfig({}), {
    port: 3000,
    nodeEnv: 'development',
    journeyProvider: { mode: 'fixture' },
    corsOrigins: [
      'http://localhost:5173',
      'http://127.0.0.1:5173',
      'http://localhost:4173',
      'http://127.0.0.1:4173',
    ],
    journeyRateLimit: {
      windowMs: 60_000,
      maxRequests: 30,
      maxEntries: 10_000,
    },
  });
});

await test('configuration accepts valid deployment values', () => {
  assert.deepEqual(readConfig({ PORT: '10000', NODE_ENV: 'production' }), {
    port: 10000,
    nodeEnv: 'production',
    journeyProvider: { mode: 'fixture' },
    corsOrigins: [
      'http://localhost:5173',
      'http://127.0.0.1:5173',
      'http://localhost:4173',
      'http://127.0.0.1:4173',
    ],
    journeyRateLimit: {
      windowMs: 60_000,
      maxRequests: 30,
      maxEntries: 10_000,
    },
  });
  assert.equal(readConfig({ PORT: '1' }).port, 1);
  assert.equal(readConfig({ PORT: '65535' }).port, 65535);
});

await test('configuration accepts and de-duplicates explicit CORS origins', () => {
  assert.deepEqual(
    readConfig({
      CORS_ORIGINS:
        'https://lastlink.livenotice.co.uk, http://localhost:5173, https://lastlink.livenotice.co.uk',
    }).corsOrigins,
    ['https://lastlink.livenotice.co.uk', 'http://localhost:5173'],
  );
});

await test('configuration accepts journey rate-limit overrides', () => {
  assert.deepEqual(
    readConfig({
      JOURNEY_RATE_LIMIT_WINDOW_MS: '5000',
      JOURNEY_RATE_LIMIT_MAX_REQUESTS: '4',
    }).journeyRateLimit,
    { windowMs: 5000, maxRequests: 4, maxEntries: 10_000 },
  );
});

await test('configuration accepts the verified Render client address header', () => {
  assert.equal(
    readConfig({ RATE_LIMIT_CLIENT_IP_HEADER: 'CF-Connecting-IP' })
      .journeyRateLimit.clientIpHeader,
    'cf-connecting-ip',
  );
});

for (const [name, value] of [
  ['JOURNEY_RATE_LIMIT_WINDOW_MS', ''],
  ['JOURNEY_RATE_LIMIT_WINDOW_MS', '0'],
  ['JOURNEY_RATE_LIMIT_WINDOW_MS', '1.5'],
  ['JOURNEY_RATE_LIMIT_MAX_REQUESTS', 'nope'],
  ['JOURNEY_RATE_LIMIT_MAX_REQUESTS', '0'],
  ['RATE_LIMIT_CLIENT_IP_HEADER', 'x-forwarded-for'],
] as const) {
  await test(`configuration rejects invalid ${name} value "${value}"`, () => {
    assert.throws(
      () => readConfig({ [name]: value }),
      new RegExp(`${name} must be`),
    );
  });
}

for (const origins of [
  '',
  'lastlink.livenotice.co.uk',
  'https://lastlink.livenotice.co.uk/',
  'ftp://lastlink.livenotice.co.uk',
  'https://lastlink.livenotice.co.uk,',
]) {
  await test(`configuration rejects invalid CORS origins "${origins}"`, () => {
    assert.throws(
      () => readConfig({ CORS_ORIGINS: origins }),
      /CORS_ORIGINS must contain/,
    );
  });
}

for (const port of [
  '',
  '0',
  '-1',
  '65536',
  '1.5',
  'abc',
  '3000abc',
  '1e3',
  ' 3000 ',
]) {
  await test(`configuration rejects invalid port "${port}"`, () => {
    assert.throws(() => readConfig({ PORT: port }), /PORT must/);
  });
}

await test('configuration rejects unknown environment', () => {
  assert.throws(() => readConfig({ NODE_ENV: 'prod' }), /NODE_ENV must/);
});
