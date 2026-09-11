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
          departurePoint: {
            commonName: 'Stratford',
            naptanId: '940GZZLUSTD',
            icsCode: '1000001',
          },
          arrivalPoint: {
            commonName: 'Waterloo',
            naptanId: '940GZZLUWLO',
            icsCode: '1000002',
          },
          mode: { id: 'tube', name: 'Tube' },
          routeOptions: [
            {
              name: 'Jubilee',
              directions: ['Towards Stanmore', 'Towards Stanmore'],
            },
          ],
          path: {
            stopPoints: [
              { id: '940GZZLUSWK', name: 'West Ham' },
              { id: '940GZZLUNHG', name: 'North Greenwich' },
              { id: '940GZZLUWLO', name: 'Waterloo' },
            ],
          },
          instruction: {
            summary: 'Take the Jubilee line',
            detailed: 'Take the Jubilee line towards Stanmore',
            steps: [
              { description: 'Follow signs to the Jubilee line platform' },
            ],
          },
          disruptions: [{ summary: 'Minor delays are reported on this leg.' }],
          plannedWorks: [
            {
              description: 'Planned platform works may affect the interchange.',
            },
          ],
          scheduledDepartureTime: '2026-09-06T23:44:00+01:00',
          scheduledArrivalTime: '2026-09-07T00:02:00+01:00',
        },
        {
          duration: 4,
          departureTime: '2026-09-07T00:03:00+01:00',
          arrivalTime: '2026-09-07T00:07:00+01:00',
          departurePoint: { commonName: 'Waterloo', naptanId: '940GZZLUWLO' },
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
  assert.equal(
    result.value.candidates[0]?.route.legs[0]?.fromTflStopPointId,
    '940GZZLUSTD',
  );
  assert.equal(
    result.value.candidates[0]?.route.legs[0]?.toTflStopPointId,
    '940GZZLUWLO',
  );
  assert.equal(
    result.value.candidates[0]?.route.legs[0]?.fromInterchangeId,
    '1000001',
  );
  assert.equal(
    result.value.candidates[0]?.route.legs[0]?.toInterchangeId,
    '1000002',
  );
  assert.equal(result.value.candidates[0]?.route.legs[0]?.lineName, 'Jubilee');
  assert.deepEqual(result.value.candidates[0]?.route.legs[0]?.directions, [
    'Towards Stanmore',
  ]);
  assert.equal(result.value.candidates[0]?.route.legs[0]?.stopCount, 3);
  assert.deepEqual(
    result.value.candidates[0]?.route.legs[0]?.intermediateStops,
    [
      { name: 'West Ham', tflStopPointId: '940GZZLUSWK' },
      { name: 'North Greenwich', tflStopPointId: '940GZZLUNHG' },
    ],
  );
  assert.deepEqual(result.value.candidates[0]?.route.legs[0]?.instructions, {
    summary: 'Take the Jubilee line',
    detailed: 'Take the Jubilee line towards Stanmore',
    steps: ['Follow signs to the Jubilee line platform'],
  });
  assert.deepEqual(result.value.candidates[0]?.route.legs[0]?.notices, [
    { kind: 'disruption', text: 'Minor delays are reported on this leg.' },
    {
      kind: 'planned_work',
      text: 'Planned platform works may affect the interchange.',
    },
  ]);
  assert.equal(
    result.value.candidates[0]?.route.legs[0]?.scheduledDepartureAt,
    '2026-09-06T23:44:00+01:00',
  );
  assert.equal(
    result.value.candidates[0]?.route.legs[0]?.scheduledArrivalAt,
    '2026-09-07T00:02:00+01:00',
  );
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

await test('normalizer ignores an empty StopPoint identity without losing the name', () => {
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
            departurePoint: { commonName: 'A', naptanId: '  ' },
            arrivalPoint: { commonName: 'B' },
            mode: { id: 'bus' },
          },
        ],
      },
    ],
  });

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.value.candidates[0]?.route.legs[0]?.from, 'A');
  assert.equal(
    result.value.candidates[0]?.route.legs[0]?.fromTflStopPointId,
    undefined,
  );
});

await test('normalizer omits an unsafe Tube station sequence', () => {
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
            departurePoint: { commonName: 'A', naptanId: 'A-ID' },
            arrivalPoint: { commonName: 'B', naptanId: 'B-ID' },
            mode: { id: 'tube' },
            routeOptions: [{ name: 'Northern', directions: ['Towards B'] }],
            path: {
              stopPoints: [
                { id: 'A-ID', name: 'A' },
                { id: 'D-ID', name: 'Duplicate' },
                { id: 'D-ID-2', name: 'Duplicate' },
                { id: 'B-ID', name: 'B' },
              ],
            },
          },
        ],
      },
    ],
  });

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.value.candidates[0]?.route.legs[0]?.stopCount, undefined);
  assert.equal(
    result.value.candidates[0]?.route.legs[0]?.intermediateStops,
    undefined,
  );
});

await test('normalizer omits a Tube sequence when endpoint identity conflicts', () => {
  const payload = structuredClone(validResponse);
  const leg = payload.journeys[0]?.legs[0];
  if (leg === undefined || !('path' in leg))
    throw new Error('Tube fixture shape changed');
  const destinationStop = leg.path.stopPoints[2];
  if (destinationStop === undefined)
    throw new Error('Tube fixture path changed');
  destinationStop.id = '940GZZLUOTHER';
  const result = normalizeTflJourneyPlannerResponse(payload);

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.value.candidates[0]?.route.legs[0]?.stopCount, undefined);
  assert.equal(
    result.value.candidates[0]?.route.legs[0]?.intermediateStops,
    undefined,
  );
});

await test('normalizer uses only trailing station descriptors for a Tube sequence', () => {
  const payload = structuredClone(validResponse);
  const leg = payload.journeys[0]?.legs[0];
  if (leg === undefined || !('path' in leg))
    throw new Error('Tube fixture shape changed');
  const destinationStop = leg.path.stopPoints[2];
  if (destinationStop === undefined)
    throw new Error('Tube fixture path changed');
  delete (leg.arrivalPoint as { naptanId?: string }).naptanId;
  destinationStop.name = 'Waterloo Station East';
  const result = normalizeTflJourneyPlannerResponse(payload);

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.value.candidates[0]?.route.legs[0]?.stopCount, undefined);
  assert.equal(
    result.value.candidates[0]?.route.legs[0]?.intermediateStops,
    undefined,
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

await test('normalizer rejects invalid optional scheduled timestamps', () => {
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
            scheduledDepartureTime: 'not-a-date',
            departurePoint: { commonName: 'A' },
            arrivalPoint: { commonName: 'B' },
            mode: { id: 'tube' },
          },
        ],
      },
    ],
  });
  assert.deepEqual(result, {
    ok: false,
    code: 'INVALID_RESPONSE',
    message: 'journey leg is missing required normalized fields',
  });
});

await test('normalizer bounds and deduplicates provider notices without trusting malformed entries', () => {
  const longText = 'x'.repeat(300);
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
            mode: { id: 'tube' },
            isDisrupted: true,
            disruptions: [
              { summary: 'A repeated notice' },
              { summary: 'A repeated notice' },
              { description: longText },
              { summary: '' },
              null,
              'not-an-object',
            ],
            plannedWorks: [
              { additionalInfo: 'Works are planned.' },
              { summary: 'A repeated notice' },
            ],
          },
        ],
      },
    ],
  });

  assert.equal(result.ok, true);
  if (!result.ok) return;
  const notices = result.value.candidates[0]?.route.legs[0]?.notices;
  assert.deepEqual(notices, [
    { kind: 'disruption', text: 'A repeated notice' },
    { kind: 'disruption', text: longText.slice(0, 240) },
    { kind: 'planned_work', text: 'Works are planned.' },
    { kind: 'planned_work', text: 'A repeated notice' },
  ]);
});

for (const plannedWorks of [[], [{ description: 'Platform works.' }]]) {
  await test(`normalizer preserves generic disruption with ${plannedWorks.length} planned-work notices`, () => {
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
              isDisrupted: true,
              plannedWorks,
            },
          ],
        },
      ],
    });

    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.deepEqual(result.value.candidates[0]?.route.legs[0]?.notices, [
      {
        kind: 'disruption',
        text: 'TfL marks this leg as disrupted; check current station information.',
      },
      ...plannedWorks.map(({ description }) => ({
        kind: 'planned_work',
        text: description,
      })),
    ]);
  });
}
