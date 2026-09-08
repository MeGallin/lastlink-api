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

await test('unknown routes return a JSON error', async () => {
  const response = await request(createApp()).get('/missing').expect(404);
  assert.deepEqual(response.body, {
    error: { code: 'NOT_FOUND', message: 'Route not found' },
  });
});

await test('unsupported health method does not report success', async () => {
  await request(createApp()).post('/health').expect(404);
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
