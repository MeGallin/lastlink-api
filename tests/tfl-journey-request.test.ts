import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildTflJourneyPlannerRequest } from '../src/providers/tfl/journey-request.js';
import { validateJourneyCheckRequest } from '../src/journey/validation.js';
import type { ValidatedJourneyCheckRequest } from '../src/journey/types.js';

function validatedRequest(
  overrides: Partial<ValidatedJourneyCheckRequest> = {},
  at = '2026-09-07T00:35:00+01:00',
): ValidatedJourneyCheckRequest {
  const result = validateJourneyCheckRequest({
    origin: { name: 'Stratford', tflStopPointId: '940GZZLUSFD' },
    destination: { name: 'Waterloo', tflStopPointId: '940GZZLUWLO' },
    arriveBy: at,
    safetyBufferMinutes: 5,
    constraints: {
      walkingMinutesLimit: 20,
      stepFreeRequired: true,
    },
  });
  if (!result.ok) throw new Error(result.issues.join('; '));
  return { ...result.value, ...overrides };
}

await test('TfL journey request uses the official arriving-search shape', () => {
  const result = buildTflJourneyPlannerRequest(validatedRequest(), {
    baseUrl: new URL('https://api.tfl.gov.uk'),
    appKey: 'synthetic-app-key',
  });

  assert.equal(
    result.url.origin + result.url.pathname,
    'https://api.tfl.gov.uk/Journey/JourneyResults/940GZZLUSFD/to/940GZZLUWLO',
  );
  assert.equal(result.url.searchParams.get('date'), '20260907');
  assert.equal(result.url.searchParams.get('time'), '0035');
  assert.equal(result.url.searchParams.get('timeIs'), 'Arriving');
  assert.equal(result.url.searchParams.get('journeyPreference'), 'LeastTime');
  assert.equal(result.url.searchParams.get('includeAlternativeRoutes'), 'true');
  assert.equal(result.url.searchParams.get('useRealTimeLiveArrivals'), 'true');
  assert.equal(result.url.searchParams.get('routeBetweenEntrances'), 'true');
  assert.equal(result.url.searchParams.get('combineTransferLegs'), 'true');
  assert.equal(result.url.searchParams.get('maxWalkingMinutes'), '20');
  assert.equal(
    result.url.searchParams.get('accessibilityPreference'),
    'StepFreeToPlatform',
  );
  assert.equal(result.url.searchParams.get('app_key'), 'synthetic-app-key');
  assert.equal(result.requestKey.includes('app_key'), false);
});

await test('TfL journey request encodes free-text locations and omits optional filters', () => {
  const request = validatedRequest({
    origin: { name: "King's Cross / St Pancras" },
    destination: { name: 'London Bridge' },
    constraints: { stepFreeRequired: false },
  });
  const result = buildTflJourneyPlannerRequest(request, {
    baseUrl: new URL('https://api.tfl.gov.uk/'),
  });

  assert.equal(
    decodeURIComponent(result.url.pathname),
    "/Journey/JourneyResults/King's Cross / St Pancras/to/London Bridge",
  );
  assert.equal(result.url.searchParams.has('app_key'), false);
  assert.equal(result.url.searchParams.has('maxWalkingMinutes'), false);
  assert.equal(result.url.searchParams.has('accessibilityPreference'), false);
});

await test('TfL journey request converts equivalent offsets to London time', () => {
  const bst = buildTflJourneyPlannerRequest(validatedRequest(), {
    baseUrl: new URL('https://api.tfl.gov.uk'),
  });
  const equivalentUtc = buildTflJourneyPlannerRequest(
    validatedRequest({}, '2026-09-06T23:35:00Z'),
    { baseUrl: new URL('https://api.tfl.gov.uk') },
  );

  assert.equal(bst.url.searchParams.get('date'), '20260907');
  assert.equal(bst.url.searchParams.get('time'), '0035');
  assert.equal(equivalentUtc.url.searchParams.get('date'), '20260907');
  assert.equal(equivalentUtc.url.searchParams.get('time'), '0035');
  assert.equal(equivalentUtc.requestKey, bst.requestKey);
});

await test('TfL journey request handles GMT/BST and midnight rollover', () => {
  const winter = buildTflJourneyPlannerRequest(
    validatedRequest({}, '2026-12-07T00:35:00Z'),
    { baseUrl: new URL('https://api.tfl.gov.uk') },
  );
  const rollover = buildTflJourneyPlannerRequest(
    validatedRequest({}, '2026-09-07T23:35:00Z'),
    { baseUrl: new URL('https://api.tfl.gov.uk') },
  );

  assert.equal(winter.url.searchParams.get('date'), '20261207');
  assert.equal(winter.url.searchParams.get('time'), '0035');
  assert.equal(rollover.url.searchParams.get('date'), '20260908');
  assert.equal(rollover.url.searchParams.get('time'), '0035');
});

await test('TfL journey request rejects an ambiguous repeated London hour', () => {
  assert.throws(
    () =>
      buildTflJourneyPlannerRequest(
        validatedRequest({}, '2026-10-25T00:30:00Z'),
        { baseUrl: new URL('https://api.tfl.gov.uk') },
      ),
    /local time is ambiguous/,
  );
});

for (const [label, baseUrl] of [
  ['HTTP', new URL('http://api.tfl.gov.uk')],
  ['embedded credentials', new URL('https://user:password@api.tfl.gov.uk')],
  ['query data', new URL('https://api.tfl.gov.uk?secret=synthetic')],
  ['fragment data', new URL('https://api.tfl.gov.uk#secret')],
] as const) {
  await test(`TfL journey request rejects ${label} base URLs`, () => {
    assert.throws(
      () =>
        buildTflJourneyPlannerRequest(validatedRequest(), {
          baseUrl,
        }),
      /baseUrl must/,
    );
  });
}

await test('TfL journey request rejects an empty app key', () => {
  assert.throws(
    () =>
      buildTflJourneyPlannerRequest(validatedRequest(), {
        baseUrl: new URL('https://api.tfl.gov.uk'),
        appKey: '  ',
      }),
    /appKey must be a non-empty string/,
  );
});
