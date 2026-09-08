import assert from 'node:assert/strict';
import { test } from 'node:test';
import type {
  ProviderHttpClient,
  ProviderHttpResult,
} from '../src/providers/http-client.js';
import { createTflJourneyPlannerAdapter } from '../src/providers/tfl/journey-adapter.js';
import { validateJourneyCheckRequest } from '../src/journey/validation.js';
import type { ValidatedJourneyCheckRequest } from '../src/journey/types.js';

function validatedRequest(): ValidatedJourneyCheckRequest {
  const result = validateJourneyCheckRequest({
    origin: { name: 'Stratford', tflStopPointId: '940GZZLUSFD' },
    destination: { name: 'Waterloo', tflStopPointId: '940GZZLUWLO' },
    arriveBy: '2026-09-07T00:35:00+01:00',
    safetyBufferMinutes: 5,
    constraints: { walkingMinutesLimit: 20, stepFreeRequired: true },
  });
  if (!result.ok) throw new Error(result.issues.join('; '));
  return result.value;
}

function successfulPayload() {
  return {
    journeys: [
      {
        startDateTime: '2026-09-06T23:45:00+01:00',
        arrivalDateTime: '2026-09-07T00:20:00+01:00',
        alternativeRoute: false,
        legs: [
          {
            duration: 35,
            departureTime: '2026-09-06T23:45:00+01:00',
            arrivalTime: '2026-09-07T00:20:00+01:00',
            departurePoint: { commonName: 'Stratford' },
            arrivalPoint: { commonName: 'Waterloo' },
            mode: { id: 'tube' },
          },
        ],
      },
      {
        startDateTime: '2026-09-06T23:40:00+01:00',
        arrivalDateTime: '2026-09-07T00:07:00+01:00',
        alternativeRoute: true,
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
  };
}

function walkingConstraintPayload() {
  return {
    journeys: [
      {
        startDateTime: '2026-09-06T23:45:00+01:00',
        arrivalDateTime: '2026-09-07T00:15:00+01:00',
        alternativeRoute: false,
        legs: [
          {
            duration: 5,
            departureTime: '2026-09-06T23:45:00+01:00',
            arrivalTime: '2026-09-06T23:50:00+01:00',
            departurePoint: { commonName: 'Stratford' },
            arrivalPoint: { commonName: 'Waterloo' },
            mode: { id: 'tube' },
          },
          {
            duration: 25,
            departureTime: '2026-09-06T23:50:00+01:00',
            arrivalTime: '2026-09-07T00:15:00+01:00',
            departurePoint: { commonName: 'Waterloo' },
            arrivalPoint: { commonName: 'Waterloo' },
            mode: { id: 'walking' },
          },
        ],
      },
      {
        startDateTime: '2026-09-06T23:40:00+01:00',
        arrivalDateTime: '2026-09-07T00:20:00+01:00',
        alternativeRoute: true,
        legs: [
          {
            duration: 35,
            departureTime: '2026-09-06T23:40:00+01:00',
            arrivalTime: '2026-09-07T00:20:00+01:00',
            departurePoint: { commonName: 'Stratford' },
            arrivalPoint: { commonName: 'Waterloo' },
            mode: { id: 'tube' },
          },
        ],
      },
    ],
  };
}

function clientReturning(
  value: unknown,
  captureUrl: (url: URL) => void,
): ProviderHttpClient {
  return {
    async getJson(url): Promise<ProviderHttpResult> {
      captureUrl(url);
      return { ok: true, status: 200, value };
    },
  };
}

await test('adapter composes request, normalization and explicit ranking policy', async () => {
  let capturedUrl: URL | undefined;
  const adapter = createTflJourneyPlannerAdapter({
    baseUrl: new URL('https://api.tfl.gov.uk'),
    appKey: 'synthetic-app-key',
    client: clientReturning(successfulPayload(), (url) => {
      capturedUrl = url;
    }),
    transferMinutes: 10,
    readClock: () => Date.parse('2026-09-06T22:30:42Z'),
  });

  const snapshot = await adapter.getPlan(validatedRequest());

  assert.equal(snapshot.dataMode, 'live');
  assert.equal(snapshot.failure, undefined);
  assert.equal(snapshot.value?.transferMinutes, 10);
  assert.equal(snapshot.value?.route?.arrivalAt, '2026-09-07T00:07:00+01:00');
  assert.deepEqual(snapshot.evidence, [
    {
      source: 'tfl_journey_planner',
      kind: 'journey_plan',
      capturedAt: '2026-09-06T22:30:42.000Z',
      completeness: 'sufficient',
      reference: 'tfl:journey-planner',
    },
  ]);
  assert.equal(capturedUrl?.searchParams.get('app_key'), 'synthetic-app-key');
  assert.equal(capturedUrl?.searchParams.get('timeIs'), 'Arriving');
});

await test('adapter skips departed top-ranked candidates', async () => {
  const adapter = createTflJourneyPlannerAdapter({
    baseUrl: new URL('https://api.tfl.gov.uk'),
    client: clientReturning(successfulPayload(), () => undefined),
    transferMinutes: 10,
    readClock: () => Date.parse('2026-09-06T22:42:00Z'),
  });

  const snapshot = await adapter.getPlan(validatedRequest());

  assert.equal(snapshot.failure, undefined);
  assert.equal(snapshot.value?.route?.arrivalAt, '2026-09-07T00:20:00+01:00');
});

await test('adapter skips a top-ranked candidate over the walking limit', async () => {
  const adapter = createTflJourneyPlannerAdapter({
    baseUrl: new URL('https://api.tfl.gov.uk'),
    client: clientReturning(walkingConstraintPayload(), () => undefined),
    transferMinutes: 10,
    readClock: () => Date.parse('2026-09-06T22:30:00Z'),
  });

  const snapshot = await adapter.getPlan(validatedRequest());

  assert.equal(snapshot.failure, undefined);
  assert.equal(snapshot.value?.route?.arrivalAt, '2026-09-07T00:20:00+01:00');
});

await test('adapter maps no journeys to a partial route snapshot', async () => {
  const adapter = createTflJourneyPlannerAdapter({
    baseUrl: new URL('https://api.tfl.gov.uk'),
    client: clientReturning({ journeys: [] }, () => undefined),
    transferMinutes: 10,
    readClock: () => Date.parse('2026-09-06T22:30:42Z'),
  });

  const snapshot = await adapter.getPlan(validatedRequest());

  assert.equal(snapshot.failure, undefined);
  assert.deepEqual(snapshot.value, { route: null, transferMinutes: 10 });
  assert.equal(snapshot.evidence[0]?.completeness, 'partial');
});

await test('adapter maps malformed provider payloads safely', async () => {
  const adapter = createTflJourneyPlannerAdapter({
    baseUrl: new URL('https://api.tfl.gov.uk'),
    client: clientReturning({ journeys: [{ invalid: true }] }, () => undefined),
    transferMinutes: 10,
    readClock: () => Date.parse('2026-09-06T22:30:42Z'),
  });

  const snapshot = await adapter.getPlan(validatedRequest());

  assert.equal(snapshot.value, null);
  assert.deepEqual(snapshot.failure, {
    code: 'PROVIDER_UNAVAILABLE',
    message: 'Provider returned an invalid journey result.',
  });
  assert.equal(snapshot.evidence[0]?.completeness, 'partial');
});

await test('adapter preserves transport failures without exposing provider payloads', async () => {
  const client: ProviderHttpClient = {
    async getJson() {
      return {
        ok: false,
        failure: {
          code: 'PROVIDER_RATE_LIMITED',
          message: 'Provider rate limit response.',
        },
      };
    },
  };
  const adapter = createTflJourneyPlannerAdapter({
    baseUrl: new URL('https://api.tfl.gov.uk'),
    client,
    transferMinutes: 10,
  });

  const snapshot = await adapter.getPlan(validatedRequest());

  assert.equal(snapshot.value, null);
  assert.deepEqual(snapshot.failure, {
    code: 'PROVIDER_RATE_LIMITED',
    message: 'Provider rate limit response.',
  });
  assert.deepEqual(snapshot.evidence, []);
});

await test('adapter requires an explicit bounded transfer policy', () => {
  assert.throws(
    () =>
      createTflJourneyPlannerAdapter({
        baseUrl: new URL('https://api.tfl.gov.uk'),
        client: clientReturning({ journeys: [] }, () => undefined),
        transferMinutes: -1,
      }),
    /transferMinutes must be an integer from 0 through 180/,
  );
});
