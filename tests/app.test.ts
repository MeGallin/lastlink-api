import assert from 'node:assert/strict';
import { test } from 'node:test';
import request from 'supertest';
import { createApp } from '../src/app.js';

await test('health reports process liveness without caching', async () => {
  const response = await request(createApp())
    .get('/health')
    .expect(200)
    .expect('Content-Type', /json/);
  assert.deepEqual(response.body, { status: 'ok', service: 'lastlink-api' });
  assert.equal(response.headers['cache-control'], 'no-store');
  assert.equal(response.headers['x-powered-by'], undefined);
});

await test('ready reports validated startup mode without provider calls', async () => {
  const fixtureResponse = await request(createApp())
    .get('/ready')
    .expect(200)
    .expect('Content-Type', /json/);
  assert.deepEqual(fixtureResponse.body, {
    status: 'ready',
    service: 'lastlink-api',
    dataMode: 'fixture',
  });
  assert.equal(fixtureResponse.headers['cache-control'], 'no-store');

  const liveResponse = await request(
    createApp(undefined, undefined, undefined, 'live'),
  )
    .get('/ready')
    .expect(200);
  assert.equal(liveResponse.body.dataMode, 'live');
});

await test('unknown routes return a JSON error', async () => {
  const response = await request(createApp()).get('/missing').expect(404);
  assert.deepEqual(response.body, {
    error: { code: 'NOT_FOUND', message: 'Route not found' },
  });
});

await test('unsupported health method does not report success', async () => {
  await request(createApp()).post('/health').expect(404);
});

await test('CORS allows an explicitly configured client origin', async () => {
  const origin = 'https://lastlink.livenotice.co.uk';
  const response = await request(createApp(undefined, [origin]))
    .get('/health')
    .set('Origin', origin)
    .expect(200);
  assert.equal(response.headers['access-control-allow-origin'], origin);
  assert.equal(response.headers.vary, 'Origin');
  assert.equal(
    response.headers['access-control-allow-methods'],
    'GET, POST, OPTIONS',
  );
  assert.equal(
    response.headers['access-control-allow-headers'],
    'Content-Type',
  );
  assert.equal(
    response.headers['access-control-expose-headers'],
    'RateLimit-Limit, RateLimit-Remaining, RateLimit-Reset, Retry-After, X-Request-Id',
  );
});

await test('CORS preflight returns the configured methods and headers', async () => {
  const origin = 'http://localhost:5173';
  const response = await request(createApp(undefined, [origin]))
    .options('/api/v1/journey-check')
    .set('Origin', origin)
    .set('Access-Control-Request-Method', 'POST')
    .set('Access-Control-Request-Headers', 'Content-Type')
    .expect(204);
  assert.equal(response.headers['access-control-allow-origin'], origin);
  assert.equal(response.headers['access-control-max-age'], '600');
});

await test('CORS rejects an origin outside the allowlist', async () => {
  const response = await request(
    createApp(undefined, ['https://lastlink.livenotice.co.uk']),
  )
    .get('/health')
    .set('Origin', 'https://example.test')
    .expect(403);
  assert.deepEqual(response.body, {
    error: { code: 'CORS_ORIGIN_NOT_ALLOWED', message: 'Origin not allowed' },
  });
});

const journeyRequest = {
  origin: { name: 'Stratford', tflStopPointId: '940GZZLUSTD' },
  destination: { name: 'Waterloo', tflStopPointId: '940GZZLUWLO' },
  arriveBy: '2026-09-07T00:25:00+01:00',
  safetyBufferMinutes: 5,
  constraints: { walkingMinutesLimit: 20, stepFreeRequired: false },
};

await test('journey-check evaluates the labelled fixture without claiming live data', async () => {
  const response = await request(createApp())
    .post('/api/v1/journey-check')
    .send(journeyRequest)
    .expect(200)
    .expect('Content-Type', /json/);
  assert.equal(response.body.status, 'viable');
  assert.equal(response.body.dataMode, 'fixture');
  assert.equal(response.body.stationOnly, true);
  assert.match(response.body.stationOnlyWarning, /station only/);
  assert.equal(response.body.margin.remainingAfterBufferMinutes, 13);
  assert.equal(response.body.deadline.source, 'user_input');
  assert.match(response.body.warnings[0], /Fixture data only/);
  assert.equal(response.headers['cache-control'], 'no-store');
});

await test('journey-check honours the requested buffer and walking limit', async () => {
  const tight = await request(createApp())
    .post('/api/v1/journey-check')
    .send({ ...journeyRequest, safetyBufferMinutes: 20 })
    .expect(200);
  assert.equal(tight.body.status, 'tight');
  assert.equal(tight.body.reasons[0].code, 'BUFFER_SHORTFALL');

  const walkingFailure = await request(createApp())
    .post('/api/v1/journey-check')
    .send({
      ...journeyRequest,
      constraints: { walkingMinutesLimit: 10, stepFreeRequired: false },
    })
    .expect(200);
  assert.equal(walkingFailure.body.status, 'not_viable');
  assert.equal(walkingFailure.body.reasons[0].code, 'NO_MATCHING_ROUTE');
});

await test('journey-check rate limiting protects bursts and preserves CORS', async () => {
  const origin = 'https://lastlink.livenotice.co.uk';
  const app = createApp(undefined, [origin], {
    windowMs: 1_000,
    maxRequests: 2,
    maxEntries: 10,
  });

  const first = await request(app)
    .post('/api/v1/journey-check')
    .set('Origin', origin)
    .send(journeyRequest)
    .expect(200);
  assert.equal(first.headers['ratelimit-limit'], '2');
  assert.equal(first.headers['ratelimit-remaining'], '1');

  await request(app)
    .post('/api/v1/journey-check')
    .set('Origin', origin)
    .send(journeyRequest)
    .expect(200);

  const limited = await request(app)
    .post('/api/v1/journey-check')
    .set('Origin', origin)
    .send(journeyRequest)
    .expect(429);
  assert.deepEqual(limited.body, {
    error: {
      code: 'RATE_LIMITED',
      message: 'Too many journey checks. Please wait a moment and try again.',
    },
  });
  assert.equal(limited.headers['access-control-allow-origin'], origin);
  assert.equal(limited.headers['cache-control'], 'no-store');
  assert.equal(limited.headers['ratelimit-remaining'], '0');
  assert.equal(limited.headers['retry-after'], '1');
});

await test('journey-check rate-limit window expires without a timer leak', async () => {
  let now = 10_000;
  const app = createApp(undefined, undefined, {
    windowMs: 1_000,
    maxRequests: 1,
    maxEntries: 10,
    now: () => now,
  });
  await request(app)
    .post('/api/v1/journey-check')
    .send(journeyRequest)
    .expect(200);
  await request(app)
    .post('/api/v1/journey-check')
    .send(journeyRequest)
    .expect(429);
  now += 1_000;
  await request(app)
    .post('/api/v1/journey-check')
    .send(journeyRequest)
    .expect(200);
});

await test('verified hosting client identities receive separate bounded buckets', async () => {
  const app = createApp(undefined, undefined, {
    windowMs: 60_000,
    maxRequests: 1,
    maxEntries: 2,
    clientIpHeader: 'cf-connecting-ip',
  });
  const asClient = (address: string) =>
    request(app)
      .post('/api/v1/journey-check')
      .set('CF-Connecting-IP', address)
      .set('X-Forwarded-For', '203.0.113.99')
      .send(journeyRequest);

  await asClient('198.51.100.10').expect(200);
  await asClient('198.51.100.11').expect(200);
  await asClient('198.51.100.10').expect(429);
  await asClient('198.51.100.12').expect(200);
  await asClient('198.51.100.10').expect(200);
});

await test('configured client header rejects spoofed or multi-value identities', async () => {
  const app = createApp(undefined, undefined, {
    windowMs: 60_000,
    maxRequests: 1,
    maxEntries: 10,
    clientIpHeader: 'cf-connecting-ip',
  });
  const body = (header: string) =>
    request(app)
      .post('/api/v1/journey-check')
      .set('CF-Connecting-IP', header)
      .send(journeyRequest);

  await body('198.51.100.20, 198.51.100.21').expect(200);
  await body('198.51.100.22, 198.51.100.23').expect(429);
});

await test('local mode ignores untrusted forwarding headers for rate-limit identity', async () => {
  const app = createApp(undefined, undefined, {
    windowMs: 60_000,
    maxRequests: 1,
    maxEntries: 10,
  });
  const body = (address: string) =>
    request(app)
      .post('/api/v1/journey-check')
      .set('X-Forwarded-For', address)
      .send(journeyRequest);

  await body('198.51.100.30').expect(200);
  await body('198.51.100.31').expect(429);
});

await test('journey-check returns a conservative result when no fixture matches', async () => {
  const response = await request(createApp())
    .post('/api/v1/journey-check')
    .send({
      ...journeyRequest,
      destination: { name: 'Victoria', tflStopPointId: '940GZZLUVIC' },
    })
    .expect(200);
  assert.equal(response.body.status, 'unable_to_verify');
  assert.equal(response.body.reasons[0].code, 'EVIDENCE_INCOMPLETE');
  assert.equal(response.body.route, null);
});

await test('journey-check rejects invalid input and non-JSON bodies', async () => {
  const invalid = await request(createApp())
    .post('/api/v1/journey-check')
    .send({ ...journeyRequest, safetyBufferMinutes: '5' })
    .expect(400);
  assert.equal(invalid.body.error.code, 'INVALID_INPUT');

  const unsupported = await request(createApp())
    .post('/api/v1/journey-check')
    .set('Content-Type', 'text/plain')
    .send('hello')
    .expect(415);
  assert.equal(unsupported.body.error.code, 'UNSUPPORTED_MEDIA_TYPE');
});

await test('journey-check handles malformed and oversized JSON safely', async () => {
  const malformed = await request(createApp())
    .post('/api/v1/journey-check')
    .set('Content-Type', 'application/json')
    .send('{"origin":')
    .expect(400);
  assert.deepEqual(malformed.body, {
    error: { code: 'INVALID_JSON', message: 'Invalid JSON body' },
  });

  const oversized = await request(createApp())
    .post('/api/v1/journey-check')
    .send({ ...journeyRequest, origin: { name: 'x'.repeat(9000) } })
    .expect(413);
  assert.equal(oversized.body.error.code, 'PAYLOAD_TOO_LARGE');
});
