import assert from 'node:assert/strict';
import { test } from 'node:test';
import { normalizeTflJourneyPlannerResponse } from '../src/providers/tfl/journey-response.js';

const validResponse = {
  recommendedMaxAgeMinutes: 2,
  searchCriteria: {
    dateTime: '2026-09-06T23:35:00+01:00',
    dateTimeType: 'Arriving',
  },
  journeys: [
    {
      startDateTime: '2026-09-06T23:45:00+01:00',
      arrivalDateTime: '2026-09-07T00:07:00+01:00',
      alternativeRoute: false,
      legs: [
        {
          duration: 18,
          departureTime: '2026-09-06T23:45:00+01:00',
          arrivalTime: '2026-09-07T00:03:00+01:00',
          departurePoint: { commonName: 'Stratford' },
          arrivalPoint: { commonName: 'Waterloo' },
          mode: { id: 'tube', name: 'Tube' },
          routeOptions: [{ name: 'Jubilee' }],
        },
        {
          duration: 4,
          departureTime: '2026-09-07T00:03:00+01:00',
          arrivalTime: '2026-09-07T00:07:00+01:00',
          departurePoint: { commonName: 'Waterloo' },
          arrivalPoint: { commonName: 'Waterloo National Rail' },
          mode: { id: 'walking', name: 'Walking' },
        },
      ],
    },
    {
      startDateTime: '2026-09-06T23:40:00+01:00',
      arrivalDateTime: '2026-09-07T00:10:00+01:00',
      alternativeRoute: true,
      legs: [
        {
          duration: 30,
          departureTime: '2026-09-06T23:40:00+01:00',
          arrivalTime: '2026-09-07T00:10:00+01:00',
          departurePoint: { name: 'Stratford' },
          arrivalPoint: { stationName: 'Waterloo' },
          mode: { motType: 'train' },
        },
      ],
    },
  ],
};

await test('normalizes TfL journeys without choosing between alternatives', () => {
  const result = normalizeTflJourneyPlannerResponse(validResponse);

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.value.candidates.length, 2);
  assert.equal(result.value.recommendedMaxAgeMinutes, 2);
  assert.equal(result.value.searchDateTimeType, 'Arriving');
  assert.equal(
    result.value.candidates[0]?.route.arrivalAt,
    '2026-09-07T00:07:00+01:00',
  );
  assert.equal(result.value.candidates[0]?.route.walkingMinutes, 4);
  assert.equal(result.value.candidates[0]?.route.legs[0]?.mode, 'tube');
  assert.equal(result.value.candidates[0]?.route.legs[0]?.lineName, 'Jubilee');
  assert.equal(result.value.candidates[0]?.route.legs[1]?.mode, 'walk');
  assert.equal(result.value.candidates[1]?.alternativeRoute, true);
  assert.equal(result.value.candidates[1]?.route.walkingMinutes, 0);
  assert.equal(result.value.candidates[1]?.route.legs[0]?.mode, 'rail');
});

await test('normalizer preserves explicit provider timestamps in the route', () => {
  const result = normalizeTflJourneyPlannerResponse({
    journeys: [
      {
        startDateTime: '2026-12-07T00:00:00Z',
        arrivalDateTime: '2026-12-07T00:15:00Z',
        legs: [
          {
            duration: 15,
            departureTime: '2026-12-07T00:00:00Z',
            arrivalTime: '2026-12-07T00:15:00Z',
            departurePoint: { commonName: 'A' },
            arrivalPoint: { commonName: 'B' },
            mode: { id: 'bus' },
          },
        ],
      },
    ],
  });

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(
    result.value.candidates[0]?.route.legs[0]?.departureAt,
    '2026-12-07T00:00:00Z',
  );
});

await test('normalizer rejects empty or malformed journey collections', () => {
  const empty = normalizeTflJourneyPlannerResponse({ journeys: [] });
  assert.deepEqual(empty, {
    ok: false,
    code: 'NO_JOURNEYS',
    message: 'TfL returned no journeys',
  });

  const malformed = normalizeTflJourneyPlannerResponse({
    journeys: 'not-an-array',
  });
  assert.deepEqual(malformed, {
    ok: false,
    code: 'INVALID_RESPONSE',
    message: 'response must contain a journeys array',
  });
});

await test('normalizer rejects invalid provider freshness metadata', () => {
  const negativeAge = normalizeTflJourneyPlannerResponse({
    recommendedMaxAgeMinutes: -1,
    journeys: validResponse.journeys,
  });
  assert.deepEqual(negativeAge, {
    ok: false,
    code: 'INVALID_RESPONSE',
    message: 'recommendedMaxAgeMinutes must be non-negative',
  });

  const offsetFreeSearchTime = normalizeTflJourneyPlannerResponse({
    searchCriteria: { dateTime: '2026-10-25T01:35:00' },
    journeys: validResponse.journeys,
  });
  assert.deepEqual(offsetFreeSearchTime, {
    ok: false,
    code: 'INVALID_RESPONSE',
    message: 'search criteria date/time must resolve to an unambiguous instant',
  });
});

await test('normalizer resolves offset-free London times consistently with explicit legs', () => {
  const result = normalizeTflJourneyPlannerResponse({
    journeys: [
      {
        startDateTime: '2026-09-06T23:45:00',
        arrivalDateTime: '2026-09-07T00:07:00',
        legs: [
          {
            duration: 22,
            departureTime: '2026-09-06T23:45:00+01:00',
            arrivalTime: '2026-09-07T00:07:00+01:00',
            departurePoint: { commonName: 'A' },
            arrivalPoint: { commonName: 'B' },
            mode: { id: 'tube' },
          },
        ],
      },
    ],
  });

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(
    result.value.candidates[0]?.route.arrivalAt,
    '2026-09-07T00:07:00+01:00',
  );
});

await test('normalizer rejects inconsistent leg chronology and endpoint timing', () => {
  const backwards = normalizeTflJourneyPlannerResponse({
    journeys: [
      {
        startDateTime: '2026-09-06T23:45:00+01:00',
        arrivalDateTime: '2026-09-07T00:07:00+01:00',
        legs: [
          {
            duration: 18,
            departureTime: '2026-09-06T23:45:00+01:00',
            arrivalTime: '2026-09-07T00:03:00+01:00',
            departurePoint: { commonName: 'A' },
            arrivalPoint: { commonName: 'B' },
            mode: { id: 'tube' },
          },
          {
            duration: 4,
            departureTime: '2026-09-07T00:02:00+01:00',
            arrivalTime: '2026-09-07T00:07:00+01:00',
            departurePoint: { commonName: 'B' },
            arrivalPoint: { commonName: 'C' },
            mode: { id: 'walking' },
          },
        ],
      },
    ],
  });
  assert.deepEqual(backwards, {
    ok: false,
    code: 'INVALID_RESPONSE',
    message: 'journey legs must be in chronological order',
  });

  const mismatchedArrival = normalizeTflJourneyPlannerResponse({
    journeys: [
      {
        startDateTime: '2026-09-06T23:45:00+01:00',
        arrivalDateTime: '2026-09-07T00:07:00+01:00',
        legs: [
          {
            duration: 17,
            departureTime: '2026-09-06T23:45:00+01:00',
            arrivalTime: '2026-09-07T00:02:00+01:00',
            departurePoint: { commonName: 'A' },
            arrivalPoint: { commonName: 'B' },
            mode: { id: 'tube' },
          },
        ],
      },
    ],
  });
  assert.deepEqual(mismatchedArrival, {
    ok: false,
    code: 'INVALID_RESPONSE',
    message: 'journey arrival must match the final leg arrival',
  });

  const mismatchedStart = normalizeTflJourneyPlannerResponse({
    journeys: [
      {
        startDateTime: '2026-09-06T23:44:00+01:00',
        arrivalDateTime: '2026-09-07T00:02:00+01:00',
        legs: [
          {
            duration: 17,
            departureTime: '2026-09-06T23:45:00+01:00',
            arrivalTime: '2026-09-07T00:02:00+01:00',
            departurePoint: { commonName: 'A' },
            arrivalPoint: { commonName: 'B' },
            mode: { id: 'tube' },
          },
        ],
      },
    ],
  });
  assert.deepEqual(mismatchedStart, {
    ok: false,
    code: 'INVALID_RESPONSE',
    message: 'journey start must match the first leg departure',
  });
});
