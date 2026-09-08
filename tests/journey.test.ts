import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildJourneyAssessment } from '../src/journey/assessment.js';
import { createFixtureAssessment } from '../src/journey/fixture-adapter.js';
import { evaluateJourneyCheck } from '../src/journey/evaluator.js';
import { journeyFixtures } from '../src/journey/fixtures.js';
import { validateJourneyCheckRequest } from '../src/journey/validation.js';
import type {
  JourneyAssessmentInput,
  JourneyRoute,
  ValidatedJourneyCheckRequest,
} from '../src/journey/types.js';
import type { JourneyProviderAdapters } from '../src/providers/contracts.js';

const baseInput = {
  origin: { name: 'Stratford', tflStopPointId: '940GZZLUSTD' },
  destination: { name: 'Waterloo', tflStopPointId: '940GZZLUWLO' },
  arriveBy: '2026-09-07T00:25:00+01:00',
  safetyBufferMinutes: 5,
  constraints: { walkingMinutesLimit: 20, stepFreeRequired: false },
};

function validRequest(
  value: unknown = baseInput,
): ValidatedJourneyCheckRequest {
  const result = validateJourneyCheckRequest(value);
  if (!result.ok) throw new Error(result.issues.join('; '));
  return result.value;
}

function fixtureAssessmentInput(
  overrides: Partial<JourneyAssessmentInput> = {},
): JourneyAssessmentInput {
  const fixture = journeyFixtures[0];
  if (fixture === undefined) throw new Error('fixture missing');
  return {
    request: validRequest(fixture.request),
    checkedAtMs: fixture.checkedAtMs,
    dataMode: 'fixture',
    route: fixture.route,
    transferMinutes: fixture.transferMinutes,
    evidence: fixture.evidence,
    providerIssues: [],
    ...overrides,
  };
}

function oneLegRoute(overrides: Partial<JourneyRoute> = {}): JourneyRoute {
  const departureAt = '2026-09-06T23:45:00+01:00';
  const arrivalAt = '2026-09-07T00:07:00+01:00';
  return {
    arrivalAt,
    walkingMinutes: 12,
    stepFreeAvailable: true,
    legs: [
      {
        mode: 'tube',
        from: 'Stratford',
        to: 'Waterloo',
        departureAt,
        arrivalAt,
        durationMinutes: 22,
        providerReference: 'test-route',
      },
    ],
    ...overrides,
  };
}

await test('fixture catalogue evaluates through the TfL-only contract', async () => {
  for (const fixture of journeyFixtures) {
    const result = evaluateJourneyCheck(
      await createFixtureAssessment(validRequest(fixture.request)),
    );
    assert.equal(result.status, fixture.expectedStatus, fixture.id);
    assert.equal(result.reasons[0]?.code, fixture.expectedReason, fixture.id);
    assert.equal(result.dataMode, 'fixture');
    assert.equal(result.stationOnly, true);
    assert.match(result.stationOnlyWarning, /station only/);
    assert.equal(result.deadline.source, 'user_input');
    assert.match(result.warnings[0] ?? '', /Fixture data only/);
  }
});

await test('validation accepts a direct arrive-by deadline', () => {
  const result = validateJourneyCheckRequest(baseInput);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.value.deadline.source, 'user_input');
  assert.equal(result.value.deadline.arriveBy, baseInput.arriveBy);
});

await test('validation derives a station deadline from an onward departure', () => {
  const result = validateJourneyCheckRequest({
    ...baseInput,
    arriveBy: undefined,
    onwardDepartureAt: '2026-09-07T00:35:00+01:00',
    stationTransferMinutes: 10,
  });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.value.deadline.source, 'derived_from_onward_departure');
  assert.equal(
    result.value.deadline.arriveByAtMs,
    Date.parse('2026-09-07T00:25:00+01:00'),
  );
  assert.equal(
    result.value.deadline.onwardDepartureAt,
    '2026-09-07T00:35:00+01:00',
  );
  assert.equal(result.value.deadline.stationTransferMinutes, 10);
});

await test('derived deadlines preserve the instant across a local midnight rollover', () => {
  const result = validateJourneyCheckRequest({
    ...baseInput,
    arriveBy: undefined,
    onwardDepartureAt: '2026-09-07T00:05:00+01:00',
    stationTransferMinutes: 10,
  });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.value.deadline.arriveBy, '2026-09-06T22:55:00.000Z');
  assert.equal(
    result.value.deadline.arriveByAtMs,
    Date.parse('2026-09-06T23:55:00+01:00'),
  );
});

for (const [label, value, expected] of [
  [
    'offset-free arriveBy',
    { ...baseInput, arriveBy: '2026-09-07T00:25:00' },
    'arriveBy',
  ],
  ['invalid arriveBy', { ...baseInput, arriveBy: 'not-a-date' }, 'arriveBy'],
  [
    'missing deadline',
    { ...baseInput, arriveBy: undefined },
    'provide arriveBy or onwardDepartureAt',
  ],
  [
    'both deadline forms',
    {
      ...baseInput,
      onwardDepartureAt: '2026-09-07T00:35:00+01:00',
      stationTransferMinutes: 10,
    },
    'provide arriveBy or onwardDepartureAt, not both',
  ],
  [
    'transfer without onward departure',
    { ...baseInput, arriveBy: undefined, stationTransferMinutes: 10 },
    'provide arriveBy or onwardDepartureAt',
  ],
] as const) {
  await test(`validation rejects ${label}`, () => {
    const result = validateJourneyCheckRequest(value);
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.ok(result.issues.some((issue) => issue.includes(expected)));
  });
}

await test('validation rejects legacy or unknown contract fields', () => {
  const result = validateJourneyCheckRequest({
    ...baseInput,
    protectedDeparture: { at: '2026-09-07T00:35:00+01:00' },
    destination: { name: 'Waterloo', nationalRailCrs: 'WAT' },
  });
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.ok(result.issues.some((issue) => issue.includes('unknown field')));
});

for (const [label, value, expected] of [
  [
    'negative safety buffer',
    { ...baseInput, safetyBufferMinutes: -1 },
    'safetyBufferMinutes',
  ],
  [
    'oversized safety buffer',
    { ...baseInput, safetyBufferMinutes: 61 },
    'safetyBufferMinutes',
  ],
  [
    'string safety buffer',
    { ...baseInput, safetyBufferMinutes: '5' },
    'safetyBufferMinutes',
  ],
  [
    'negative station transfer',
    {
      ...baseInput,
      arriveBy: undefined,
      onwardDepartureAt: '2026-09-07T00:35:00+01:00',
      stationTransferMinutes: -1,
    },
    'stationTransferMinutes',
  ],
  [
    'oversized station transfer',
    {
      ...baseInput,
      arriveBy: undefined,
      onwardDepartureAt: '2026-09-07T00:35:00+01:00',
      stationTransferMinutes: 121,
    },
    'stationTransferMinutes',
  ],
  [
    'negative walking limit',
    { ...baseInput, constraints: { walkingMinutesLimit: -1 } },
    'walkingMinutesLimit',
  ],
  [
    'oversized walking limit',
    { ...baseInput, constraints: { walkingMinutesLimit: 181 } },
    'walkingMinutesLimit',
  ],
  [
    'string walking limit',
    { ...baseInput, constraints: { walkingMinutesLimit: '10' } },
    'walkingMinutesLimit',
  ],
  [
    'non-boolean step-free flag',
    { ...baseInput, constraints: { stepFreeRequired: 'yes' } },
    'stepFreeRequired',
  ],
] as const) {
  await test(`validation rejects ${label}`, () => {
    const result = validateJourneyCheckRequest(value);
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.ok(result.issues.some((issue) => issue.includes(expected)));
  });
}

await test('fixture assessment calculates station margin after the requested buffer', async () => {
  const result = evaluateJourneyCheck(
    await createFixtureAssessment(validRequest(baseInput)),
  );
  assert.equal(result.status, 'viable');
  assert.equal(result.margin?.availableMinutes, 18);
  assert.equal(result.margin?.remainingAfterBufferMinutes, 13);
  assert.equal(result.route?.arrivalAt, '2026-09-07T00:07:00+01:00');
});

await test('derived deadlines are evaluated without an onward rail assertion', async () => {
  const request = validRequest({
    ...baseInput,
    arriveBy: undefined,
    onwardDepartureAt: '2026-09-07T00:35:00+01:00',
    stationTransferMinutes: 10,
  });
  const result = evaluateJourneyCheck(await createFixtureAssessment(request));
  assert.equal(result.status, 'viable');
  assert.equal(result.deadline.source, 'derived_from_onward_departure');
  assert.equal(result.deadline.stationTransferMinutes, 10);
  assert.match(
    result.stationOnlyWarning,
    /does not check whether an onward train is running/,
  );
});

await test('route endpoint mismatch is fail-safe', () => {
  const route = oneLegRoute();
  const result = evaluateJourneyCheck(
    fixtureAssessmentInput({
      route: {
        ...route,
        legs: [{ ...route.legs[0]!, to: 'Victoria' }],
      },
    }),
  );
  assert.equal(result.status, 'unable_to_verify');
  assert.equal(result.reasons[0]?.code, 'STATION_NOT_REACHED');
});

await test('provider station descriptors match the user station name only at the suffix', () => {
  const route = oneLegRoute();
  const result = evaluateJourneyCheck(
    fixtureAssessmentInput({
      request: validRequest({
        ...baseInput,
        origin: { name: 'Stratford' },
        destination: { name: 'Waterloo' },
      }),
      route: {
        ...route,
        legs: [
          {
            ...route.legs[0]!,
            from: 'Stratford Station',
            to: 'Waterloo Underground Station',
          },
        ],
      },
    }),
  );
  assert.equal(result.status, 'viable');
});

await test('station matching does not accept a different named station', () => {
  const route = oneLegRoute();
  const result = evaluateJourneyCheck(
    fixtureAssessmentInput({
      route: { ...route, legs: [{ ...route.legs[0]!, to: 'Waterloo East' }] },
    }),
  );
  assert.equal(result.status, 'unable_to_verify');
  assert.equal(result.reasons[0]?.code, 'STATION_NOT_REACHED');
});

await test('route timing and connection contradictions are fail-safe', () => {
  const base = oneLegRoute();
  const badDuration = evaluateJourneyCheck(
    fixtureAssessmentInput({
      route: { ...base, legs: [{ ...base.legs[0]!, durationMinutes: 99 }] },
    }),
  );
  assert.equal(badDuration.reasons[0]?.code, 'EVIDENCE_CONTRADICTORY');

  const disconnected = evaluateJourneyCheck(
    fixtureAssessmentInput({
      route: {
        arrivalAt: '2026-09-07T00:17:00+01:00',
        legs: [
          { ...base.legs[0]!, to: 'London Bridge' },
          {
            ...base.legs[0]!,
            from: 'Victoria',
            to: 'Waterloo',
            departureAt: '2026-09-07T00:10:00+01:00',
            arrivalAt: '2026-09-07T00:17:00+01:00',
            durationMinutes: 7,
          },
        ],
      },
    }),
  );
  assert.equal(disconnected.reasons[0]?.code, 'EVIDENCE_CONTRADICTORY');
});

await test('departed first legs are not presented as catchable', () => {
  const base = oneLegRoute();
  const result = evaluateJourneyCheck(
    fixtureAssessmentInput({
      route: {
        ...base,
        legs: [
          {
            ...base.legs[0]!,
            departureAt: '2026-09-06T22:00:00+01:00',
            durationMinutes: 127,
          },
        ],
      },
    }),
  );
  assert.equal(result.status, 'not_viable');
  assert.equal(result.reasons[0]?.code, 'DEADLINE_MISSED');
});

await test('walking and step-free constraints remain deterministic', () => {
  const walking = evaluateJourneyCheck(
    fixtureAssessmentInput({
      request: validRequest({
        ...baseInput,
        constraints: { walkingMinutesLimit: 10, stepFreeRequired: false },
      }),
    }),
  );
  assert.equal(walking.status, 'not_viable');
  assert.equal(walking.reasons[0]?.code, 'NO_MATCHING_ROUTE');

  const stepFree = evaluateJourneyCheck(
    fixtureAssessmentInput({
      request: validRequest({
        ...baseInput,
        constraints: { walkingMinutesLimit: 20, stepFreeRequired: true },
      }),
      route: oneLegRoute({ stepFreeAvailable: false }),
    }),
  );
  assert.equal(stepFree.status, 'not_viable');
  assert.equal(stepFree.reasons[0]?.code, 'NO_MATCHING_ROUTE');
});

await test('missing walking or step-free evidence cannot be treated as a pass', () => {
  const routeWithoutWalking = oneLegRoute();
  delete routeWithoutWalking.walkingMinutes;
  const walking = evaluateJourneyCheck(
    fixtureAssessmentInput({
      request: validRequest({
        ...baseInput,
        constraints: { walkingMinutesLimit: 20, stepFreeRequired: false },
      }),
      route: routeWithoutWalking,
    }),
  );
  assert.equal(walking.status, 'unable_to_verify');
  assert.equal(walking.reasons[0]?.code, 'INPUT_AMBIGUOUS');

  const routeWithoutStepFree = oneLegRoute();
  delete routeWithoutStepFree.stepFreeAvailable;
  const stepFree = evaluateJourneyCheck(
    fixtureAssessmentInput({
      request: validRequest({
        ...baseInput,
        constraints: { walkingMinutesLimit: 20, stepFreeRequired: true },
      }),
      route: routeWithoutStepFree,
    }),
  );
  assert.equal(stepFree.status, 'unable_to_verify');
  assert.equal(stepFree.reasons[0]?.code, 'INPUT_AMBIGUOUS');
});

await test('zero-margin and exact-buffer thresholds remain explicit', () => {
  const exactBuffer = evaluateJourneyCheck(
    fixtureAssessmentInput({
      request: validRequest({ ...baseInput, safetyBufferMinutes: 18 }),
    }),
  );
  assert.equal(exactBuffer.status, 'viable');
  assert.equal(exactBuffer.margin?.remainingAfterBufferMinutes, 0);

  const zeroMargin = evaluateJourneyCheck(
    fixtureAssessmentInput({
      request: validRequest(baseInput),
      route: oneLegRoute({
        arrivalAt: '2026-09-07T00:25:00+01:00',
        legs: [
          {
            ...oneLegRoute().legs[0]!,
            arrivalAt: '2026-09-07T00:25:00+01:00',
            durationMinutes: 40,
          },
        ],
      }),
    }),
  );
  assert.equal(zeroMargin.status, 'not_viable');
  assert.equal(zeroMargin.reasons[0]?.code, 'DEADLINE_MISSED');
});

for (const dataMode of ['live', 'cache'] as const) {
  await test(`fixture evidence cannot be used in ${dataMode} mode`, () => {
    const result = evaluateJourneyCheck(fixtureAssessmentInput({ dataMode }));
    assert.equal(result.status, 'unable_to_verify');
    assert.equal(result.reasons[0]?.code, 'INPUT_AMBIGUOUS');
  });
}

await test('malformed and future evidence timestamps are not silently accepted', () => {
  const malformed = evaluateJourneyCheck(
    fixtureAssessmentInput({
      evidence: [
        {
          ...journeyFixtures[0]!.evidence[0]!,
          capturedAt: 'not-a-timestamp',
        },
      ],
    }),
  );
  assert.equal(malformed.reasons[0]?.code, 'TIME_AMBIGUOUS');

  const providerFuture = evaluateJourneyCheck(
    fixtureAssessmentInput({
      evidence: [
        {
          ...journeyFixtures[0]!.evidence[0]!,
          providerTimestamp: '2026-09-06T23:00:00Z',
        },
      ],
    }),
  );
  assert.equal(providerFuture.reasons[0]?.code, 'TIME_AMBIGUOUS');
});

await test('provider timestamps after capture are rejected even before evaluation', () => {
  const result = evaluateJourneyCheck(
    fixtureAssessmentInput({
      checkedAtMs: Date.parse('2026-09-06T22:31:42Z'),
      evidence: [
        {
          ...journeyFixtures[0]!.evidence[0]!,
          providerTimestamp: '2026-09-06T22:31:00Z',
        },
      ],
    }),
  );
  assert.equal(result.status, 'unable_to_verify');
  assert.equal(result.reasons[0]?.code, 'TIME_AMBIGUOUS');
});

await test('stale and future evidence are not silently accepted', () => {
  const stale = evaluateJourneyCheck(
    fixtureAssessmentInput({
      evidence: [
        {
          ...journeyFixtures[0]!.evidence[0]!,
          providerTimestamp: '2026-09-06T22:20:00Z',
        },
      ],
    }),
  );
  assert.equal(stale.reasons[0]?.code, 'EVIDENCE_STALE');

  const future = evaluateJourneyCheck(
    fixtureAssessmentInput({
      evidence: [
        {
          ...journeyFixtures[0]!.evidence[0]!,
          capturedAt: '2026-09-06T23:00:00Z',
        },
      ],
    }),
  );
  assert.equal(future.reasons[0]?.code, 'TIME_AMBIGUOUS');
});

await test('assessment captures the evaluation clock after provider evidence', async () => {
  const adapters: JourneyProviderAdapters = {
    journeyPlanner: {
      async getPlan() {
        return {
          dataMode: 'cache',
          value: { route: null, transferMinutes: 0 },
          evidence: [],
        };
      },
    },
  };
  const result = await buildJourneyAssessment(
    validRequest(),
    adapters,
    () => 123,
  );
  assert.equal(result.checkedAtMs, 123);
  assert.equal(result.dataMode, 'cache');
});

await test('provider failures remain bounded and do not expose payloads', async () => {
  const adapters: JourneyProviderAdapters = {
    journeyPlanner: {
      async getPlan() {
        return {
          dataMode: 'live',
          value: null,
          evidence: [],
          failure: {
            code: 'PROVIDER_RATE_LIMITED' as const,
            message: 'Provider rate limit response.',
          },
        };
      },
    },
  };
  const result = evaluateJourneyCheck(
    await buildJourneyAssessment(validRequest(), adapters, () => 123),
  );
  assert.equal(result.status, 'unable_to_verify');
  assert.equal(result.reasons[0]?.code, 'PROVIDER_RATE_LIMITED');
  assert.equal(result.route, null);
});
