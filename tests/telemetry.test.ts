import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { test } from 'node:test';
import type { Request, Response } from 'express';
import request from 'supertest';
import { createApp } from '../src/app.js';
import type { RequestTelemetryEvent } from '../src/http/telemetry.js';
import { createTelemetryMiddleware } from '../src/http/telemetry.js';
import { createFixtureAssessment } from '../src/journey/fixture-adapter.js';

await test('telemetry emits a redacted health event and request id', async () => {
  const events: RequestTelemetryEvent[] = [];
  let clockCalls = 0;
  const response = await request(
    createApp(undefined, undefined, undefined, undefined, {
      now: () => 10_000 + 17 * clockCalls++,
      requestId: () => 'request-test-1',
      logger: (event) => events.push(event),
    }),
  )
    .get('/health?name=private-value')
    .expect(200);
  assert.equal(response.headers['x-request-id'], 'request-test-1');
  assert.deepEqual(events, [
    {
      event: 'http_request',
      requestId: 'request-test-1',
      method: 'GET',
      route: '/health',
      status: 200,
      durationMs: 17,
      outcome: 'success',
    },
  ]);
});

await test('telemetry classifies rate limits without logging request data', async () => {
  const events: RequestTelemetryEvent[] = [];
  const app = createApp(
    undefined,
    undefined,
    {
      windowMs: 60_000,
      maxRequests: 1,
      maxEntries: 10,
    },
    undefined,
    { logger: (event) => events.push(event) },
  );
  const body = {
    origin: { name: 'Stratford', tflStopPointId: '940GZZLUSTD' },
    destination: { name: 'Waterloo', tflStopPointId: '940GZZLUWLO' },
    arriveBy: '2026-09-07T00:25:00+01:00',
    safetyBufferMinutes: 5,
  };

  await request(app).post('/api/v1/journey-check').send(body).expect(200);
  await request(app).post('/api/v1/journey-check').send(body).expect(429);

  assert.equal(events.at(-1)?.status, 429);
  assert.equal(events.at(-1)?.route, '/api/v1/journey-check');
  assert.equal(events.at(-1)?.outcome, 'rate_limited');
  assert.equal('body' in (events.at(-1) ?? {}), false);
});

await test('telemetry marks live provider verification failures as degraded', async () => {
  const events: RequestTelemetryEvent[] = [];
  const assessment = async (
    request: Parameters<typeof createFixtureAssessment>[0],
  ) => ({
    ...(await createFixtureAssessment(request)),
    dataMode: 'live' as const,
    route: null,
    evidence: [],
    providerIssues: [
      {
        code: 'PROVIDER_UNAVAILABLE' as const,
        message: 'Journey provider could not verify this request.',
      },
    ],
    providerWarnings: [],
  });
  const app = createApp(assessment, undefined, undefined, 'live', {
    logger: (event) => events.push(event),
  });

  await request(app)
    .post('/api/v1/journey-check')
    .send({
      origin: { name: 'Stratford', tflStopPointId: '940GZZLUSTD' },
      destination: { name: 'Waterloo', tflStopPointId: '940GZZLUWLO' },
      arriveBy: '2026-09-07T00:25:00+01:00',
      safetyBufferMinutes: 5,
    })
    .expect(200);

  assert.equal(events.at(-1)?.providerOutcome, 'degraded');
});

await test('telemetry emits exactly once for completed and aborted responses', () => {
  const events: RequestTelemetryEvent[] = [];
  let now = 1_000;
  const middleware = createTelemetryMiddleware({
    now: () => now,
    requestId: () => 'request-lifecycle-test',
    logger: (event) => events.push(event),
  });
  const request = {
    method: 'GET',
    baseUrl: '',
    path: '/health',
  } as Request;

  class TestResponse extends EventEmitter {
    locals: Record<string, unknown> = {};
    statusCode = 200;
    headersSent = false;
    writableFinished = false;

    set() {
      return this;
    }
  }

  const responseState = new TestResponse();
  const response = responseState as unknown as Response & EventEmitter;
  middleware(request, response, () => undefined);
  now = 1_025;
  responseState.headersSent = true;
  responseState.writableFinished = true;
  response.emit('finish');
  response.emit('close');

  now = 2_000;
  const abortedResponse = new TestResponse() as unknown as Response &
    EventEmitter;
  middleware(request, abortedResponse, () => undefined);
  now = 2_042;
  abortedResponse.emit('close');
  abortedResponse.emit('finish');

  now = 3_000;
  const partialResponseState = new TestResponse();
  const partialResponse = partialResponseState as unknown as Response &
    EventEmitter;
  middleware(request, partialResponse, () => undefined);
  partialResponseState.statusCode = 206;
  partialResponseState.headersSent = true;
  now = 3_042;
  partialResponse.emit('close');
  partialResponse.emit('finish');

  assert.deepEqual(events, [
    {
      event: 'http_request',
      requestId: 'request-lifecycle-test',
      method: 'GET',
      route: '/health',
      status: 200,
      durationMs: 25,
      outcome: 'success',
    },
    {
      event: 'http_request',
      requestId: 'request-lifecycle-test',
      method: 'GET',
      route: '/health',
      status: null,
      durationMs: 42,
      outcome: 'aborted',
    },
    {
      event: 'http_request',
      requestId: 'request-lifecycle-test',
      method: 'GET',
      route: '/health',
      status: 206,
      durationMs: 42,
      outcome: 'aborted',
    },
  ]);
});
