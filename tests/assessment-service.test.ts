import assert from 'node:assert/strict';
import { test } from 'node:test';
import supertest from 'supertest';
import { createApp } from '../src/app.js';
import { readConfig } from '../src/config.js';
import { createAssessmentService } from '../src/journey/assessment-service.js';
import { createProviderHttpClient } from '../src/providers/http-client.js';

const body = {
  origin: { name: 'Stratford', tflStopPointId: '940GZZLUSTD' },
  destination: { name: 'Waterloo', tflStopPointId: '940GZZLUWLO' },
  arriveBy: '2026-09-07T00:25:00+01:00',
  safetyBufferMinutes: 5,
};
const clock = () => Date.parse('2026-09-06T22:30:42Z');
const secret = 'synthetic-private-key';
const live = readConfig({
  JOURNEY_DATA_MODE: 'live',
  TFL_APP_KEY: secret,
}).journeyProvider;

await test('live timeout returns unable to verify without retries', async () => {
  let calls = 0;
  const client = createProviderHttpClient({
    timeoutMs: 5,
    fetcher: async () => {
      calls++;
      return new Promise(() => {});
    },
  });
  const response = await supertest(
    createApp(createAssessmentService(live, client, clock)),
  )
    .post('/api/v1/journey-check')
    .send(body);
  assert.equal(calls, 1);
  assert.equal(response.body.status, 'unable_to_verify');
  assert.equal(response.body.dataMode, 'live');
});

for (const payload of [{ journeys: [] }, { invalid: true }]) {
  await test('unusable live payload does not become a fixture or positive result', async () => {
    const response = await supertest(
      createApp(
        createAssessmentService(
          live,
          {
            async getJson() {
              return { ok: true, status: 200, value: payload };
            },
          },
          clock,
        ),
      ),
    )
      .post('/api/v1/journey-check')
      .send(body);
    assert.equal(response.status, 200);
    assert.equal(response.body.status, 'unable_to_verify');
    assert.equal(response.body.dataMode, 'live');
    assert.match(response.body.warnings.join(' '), /Internal validation only/);
  });
}

await test('ambiguous London query time fails safely before dispatch', async () => {
  let calls = 0;
  const response = await supertest(
    createApp(
      createAssessmentService(
        live,
        {
          async getJson() {
            calls++;
            assert.fail('ambiguous query must not dispatch');
          },
        },
        clock,
      ),
    ),
  )
    .post('/api/v1/journey-check')
    .send({
      ...body,
      arriveBy: '2026-10-25T01:30:00+01:00',
    });
  assert.equal(response.status, 200);
  assert.equal(response.body.status, 'unable_to_verify');
  assert.equal(calls, 0);
});

await test('live configuration requires a key; fixture ignores credentials', () => {
  for (const key of [undefined, '', ' ', 'key with space', 'key\n']) {
    assert.throws(
      () => readConfig({ JOURNEY_DATA_MODE: 'live', TFL_APP_KEY: key }),
      /TFL_APP_KEY/,
    );
  }
  assert.throws(
    () => readConfig({ JOURNEY_DATA_MODE: 'invalid' }),
    /JOURNEY_DATA_MODE/,
  );
  assert.deepEqual(readConfig({ TFL_APP_KEY: secret }).journeyProvider, {
    mode: 'fixture',
  });
});

await test('default mode never dispatches transport and stays labelled fixture', async () => {
  const service = createAssessmentService(readConfig({}).journeyProvider, {
    async getJson() {
      assert.fail('fixture must not dispatch');
    },
  });
  const response = await supertest(createApp(service))
    .post('/api/v1/journey-check')
    .send(body);
  assert.equal(response.status, 200);
  assert.equal(response.body.dataMode, 'fixture');
  assert.equal(response.body.status, 'viable');
});

for (const status of [401, 403, 429, 500]) {
  await test(`live HTTP ${status} is safe, isolated per evaluation and never retried`, async () => {
    let calls = 0;
    const capturedUrls: URL[] = [];
    const client = createProviderHttpClient({
      fetcher: async (url) => {
        calls++;
        capturedUrls.push(url);
        return {
          status,
          headers: { get: () => 'application/json' },
          json: async () => ({ secret }),
        };
      },
    });
    const app = createApp(createAssessmentService(live, client, clock));
    const responses = await Promise.all(
      [1, 2].map(() => supertest(app).post('/api/v1/journey-check').send(body)),
    );
    assert.equal(calls, 2);
    for (const url of capturedUrls) {
      assert.equal(url.origin, 'https://api.tfl.gov.uk');
      assert.equal(url.searchParams.get('app_key'), secret);
    }
    for (const response of responses) {
      assert.equal(response.status, 200);
      assert.equal(response.body.status, 'unable_to_verify');
      assert.equal(response.body.dataMode, 'live');
      assert.equal(response.body.stationOnly, true);
      assert.equal(response.text.includes(secret), false);
      assert.ok(
        response.body.reasons.some(
          (reason: { code: string }) =>
            reason.code ===
            (status === 429 ? 'PROVIDER_RATE_LIMITED' : 'PROVIDER_UNAVAILABLE'),
        ),
      );
    }
    await supertest(app).post('/api/v1/journey-check').send({}).expect(400);
    assert.equal(calls, 2);
  });
}

await test('unexpected transport exceptions are redacted without fixture fallback', async () => {
  const app = createApp(
    createAssessmentService(
      live,
      {
        async getJson() {
          throw new Error(secret);
        },
      },
      clock,
    ),
  );
  const response = await supertest(app)
    .post('/api/v1/journey-check')
    .send(body);
  assert.equal(response.body.status, 'unable_to_verify');
  assert.equal(response.body.dataMode, 'live');
  assert.equal(response.text.includes(secret), false);
});

await test('live journey response runs through the deterministic evaluator', async () => {
  const app = createApp(
    createAssessmentService(
      live,
      {
        async getJson() {
          return {
            ok: true,
            status: 200,
            value: {
              journeys: [
                {
                  startDateTime: '2026-09-06T23:40:00+01:00',
                  arrivalDateTime: '2026-09-07T00:07:00+01:00',
                  legs: [
                    {
                      duration: 27,
                      departureTime: '2026-09-06T23:40:00+01:00',
                      arrivalTime: '2026-09-07T00:07:00+01:00',
                      departurePoint: { commonName: 'Stratford' },
                      arrivalPoint: { commonName: 'Waterloo' },
                      mode: { id: 'tube' },
                    },
                  ],
                },
              ],
            },
          };
        },
      },
      clock,
    ),
  );
  const response = await supertest(app)
    .post('/api/v1/journey-check')
    .send(body);
  assert.equal(response.status, 200);
  assert.equal(response.body.dataMode, 'live');
  assert.equal(response.body.status, 'viable');
  assert.equal(response.body.margin.transferMinutes, 0);
  assert.equal(response.body.margin.remainingAfterBufferMinutes, 13);
});
