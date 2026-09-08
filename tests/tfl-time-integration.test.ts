import assert from 'node:assert/strict';
import { test } from 'node:test';
import supertest from 'supertest';
import { createApp } from '../src/app.js';
import { createAssessmentService } from '../src/journey/assessment-service.js';
import { normalizeTflJourneyPlannerResponse } from '../src/providers/tfl/journey-response.js';

function payload(start: string, arrival: string, duration: number) {
  return {
    searchCriteria: { dateTime: arrival, dateTimeType: 'Arriving' },
    journeys: [
      {
        startDateTime: start,
        arrivalDateTime: arrival,
        legs: [
          {
            departureTime: start,
            arrivalTime: arrival,
            duration,
            departurePoint: { commonName: 'Stratford' },
            arrivalPoint: { commonName: 'Waterloo' },
            mode: { id: 'tube' },
          },
        ],
      },
    ],
  };
}

await test('offset-free route, legs and search normalize together across BST midnight', () => {
  const result = normalizeTflJourneyPlannerResponse(
    payload('2026-09-06T23:45:00', '2026-09-07T00:07:00', 22),
  );
  assert.ok(result.ok);
  assert.equal(result.value.searchDateTime, '2026-09-07T00:07:00+01:00');
  const route = result.value.candidates[0]?.route;
  assert.equal(route?.arrivalAt, '2026-09-07T00:07:00+01:00');
  assert.equal(route?.legs[0]?.departureAt, '2026-09-06T23:45:00+01:00');
  assert.equal(route?.legs[0]?.arrivalAt, route?.arrivalAt);
});

for (const [start, arrival, duration, deadline, clock, expected] of [
  [
    '2026-09-06T23:45:00',
    '2026-09-07T00:07:00',
    22,
    '2026-09-07T00:25:00+01:00',
    '2026-09-06T22:30:00Z',
    'viable',
  ],
  [
    '2026-03-29T00:50:00',
    '2026-03-29T02:10:00',
    20,
    '2026-03-29T02:25:00+01:00',
    '2026-03-29T00:30:00Z',
    'viable',
  ],
  [
    '2026-10-25T00:50:00',
    '2026-10-25T02:10:00',
    140,
    '2026-10-25T02:25:00Z',
    '2026-10-24T23:30:00Z',
    'viable',
  ],
  [
    '2026-03-29T01:10:00',
    '2026-03-29T02:10:00',
    60,
    '2026-03-29T02:25:00+01:00',
    '2026-03-29T00:30:00Z',
    'unable_to_verify',
  ],
  [
    '2026-10-25T01:10:00',
    '2026-10-25T02:10:00',
    60,
    '2026-10-25T02:25:00Z',
    '2026-10-24T23:30:00Z',
    'unable_to_verify',
  ],
] as const) {
  await test(`provider ${start} produces ${expected} at HTTP boundary`, async () => {
    const app = createApp(
      createAssessmentService(
        { mode: 'live', appKey: 'synthetic-key' },
        {
          async getJson() {
            return {
              ok: true,
              status: 200,
              value: payload(start, arrival, duration),
            };
          },
        },
        () => Date.parse(clock),
      ),
    );
    const response = await supertest(app)
      .post('/api/v1/journey-check')
      .send({
        origin: { name: 'Stratford' },
        destination: { name: 'Waterloo' },
        arriveBy: deadline,
        safetyBufferMinutes: 5,
      });
    assert.equal(response.status, 200);
    assert.equal(response.body.status, expected);
    assert.equal(response.body.dataMode, 'live');
    if (expected === 'viable') {
      assert.equal(response.body.route.legs[0].durationMinutes, duration);
      assert.equal(
        Date.parse(response.body.route.legs[0].arrivalAt) -
          Date.parse(response.body.route.legs[0].departureAt),
        duration * 60_000,
      );
    } else {
      assert.equal(response.body.route, null);
      assert.ok(
        response.body.reasons.some(
          (reason: { code: string }) => reason.code === 'PROVIDER_UNAVAILABLE',
        ),
      );
    }
  });
}
