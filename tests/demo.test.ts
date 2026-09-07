import assert from 'node:assert/strict';
import { test } from 'node:test';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { assessDemoMargin } from '../src/demo/margin.js';

const endpoint = '/api/v1/demo/journey-check';
const validBody = {
  scenarioId: 'stratford-waterloo-demo',
  safetyBufferMinutes: 5,
};

await test('scenario list is explicitly fictional and not cached', async () => {
  const result = await request(createApp())
    .get('/api/v1/demo/scenarios')
    .expect(200);
  assert.equal(result.body.dataMode, 'fixture');
  assert.match(result.body.warning, /Do not use for travel/);
  assert.equal(result.body.scenarios.length, 1);
  assert.equal(result.body.scenarios[0].id, validBody.scenarioId);
  assert.equal(result.headers['cache-control'], 'no-store');
});

for (const [buffer, outcome, remaining] of [
  [0, 'buffer_met', 5],
  [5, 'buffer_met', 0],
  [6, 'buffer_not_met', -1],
  [60, 'buffer_not_met', -55],
] as const) {
  await test(`demo calculates buffer ${buffer} from fixture inputs`, async () => {
    const result = await request(createApp())
      .post(endpoint)
      .send({ ...validBody, safetyBufferMinutes: buffer })
      .expect(200);
    assert.equal(result.body.dataMode, 'fixture');
    assert.equal(result.body.liveJourneyVerified, false);
    assert.match(result.body.warning, /Fictional/);
    assert.equal(result.body.simulation.outcome, outcome);
    assert.equal(result.body.simulation.connectionMarginMinutes, 5);
    assert.equal(result.body.simulation.remainingAfterBufferMinutes, remaining);
    assert.equal(result.headers['cache-control'], 'no-store');
  });
}

for (const body of [
  {},
  [],
  null,
  { scenarioId: validBody.scenarioId },
  { ...validBody, safetyBufferMinutes: '5' },
  { ...validBody, safetyBufferMinutes: -1 },
  { ...validBody, safetyBufferMinutes: 61 },
  { ...validBody, safetyBufferMinutes: 0.5 },
  { ...validBody, scenarioId: '' },
  { ...validBody, origin: 'unrecognised' },
]) {
  await test(`reject invalid JSON input ${JSON.stringify(body)}`, async () => {
    await request(createApp())
      .post(endpoint)
      .set('Content-Type', 'application/json')
      .send(JSON.stringify(body))
      .expect(400)
      .expect('Content-Type', /json/);
  });
}

await test('unknown demo scenario is a 404, not a fallback journey', async () => {
  const result = await request(createApp())
    .post(endpoint)
    .send({ ...validBody, scenarioId: 'missing' })
    .expect(404);
  assert.equal(result.body.error.code, 'SCENARIO_NOT_FOUND');
});
await test('requires JSON content type', async () => {
  const result = await request(createApp())
    .post(endpoint)
    .send('hello')
    .expect(415);
  assert.equal(result.body.error.code, 'UNSUPPORTED_MEDIA_TYPE');
});
await test('malformed JSON returns safe JSON error', async () => {
  const result = await request(createApp())
    .post(endpoint)
    .set('Content-Type', 'application/json')
    .send('{"secret":')
    .expect(400);
  assert.deepEqual(result.body, {
    error: { code: 'INVALID_JSON', message: 'Invalid JSON body' },
  });
});
await test('oversized body returns JSON 413', async () => {
  const result = await request(createApp())
    .post(endpoint)
    .send({ scenarioId: 'x'.repeat(5000), safetyBufferMinutes: 5 })
    .expect(413);
  assert.equal(result.body.error.code, 'PAYLOAD_TOO_LARGE');
});
await test('unsupported demo method stays 404', async () => {
  await request(createApp()).put(endpoint).send(validBody).expect(404);
});

await test('margin evaluator varies arrival and transfer, independent of fixture IDs', () => {
  const base = {
    arrivalMs: 0,
    departureMs: 15 * 60000,
    additionalTransferMinutes: 10,
    safetyBufferMinutes: 5,
  };
  assert.equal(assessDemoMargin(base).outcome, 'buffer_met');
  assert.equal(
    assessDemoMargin({ ...base, arrivalMs: 60000 }).outcome,
    'buffer_not_met',
  );
  assert.equal(
    assessDemoMargin({ ...base, additionalTransferMinutes: 15 }).outcome,
    'connection_missed',
  );
  assert.equal(
    assessDemoMargin({ ...base, arrivalMs: 16 * 60000 })
      .connectionMarginMinutes,
    -11,
  );
  assert.throws(
    () => assessDemoMargin({ ...base, arrivalMs: NaN }),
    /Invalid margin/,
  );
  assert.throws(
    () => assessDemoMargin({ ...base, safetyBufferMinutes: -1 }),
    /Invalid margin/,
  );
});

await test('margin arithmetic crosses midnight using explicit offsets', () => {
  const result = assessDemoMargin({
    arrivalMs: Date.parse('2026-09-06T23:55:00+01:00'),
    departureMs: Date.parse('2026-09-07T00:35:00+01:00'),
    additionalTransferMinutes: 10,
    safetyBufferMinutes: 5,
  });
  assert.equal(result.connectionMarginMinutes, 30);
  assert.equal(result.remainingAfterBufferMinutes, 25);
});
