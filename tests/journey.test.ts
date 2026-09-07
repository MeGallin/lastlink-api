import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildJourneyAssessment } from '../src/journey/assessment.js';
import { evaluateJourneyCheck } from '../src/journey/evaluator.js';
import {
  journeyFixtures,
  toFixtureAssessment,
} from '../src/journey/fixtures.js';
import { validateJourneyCheckRequest } from '../src/journey/validation.js';
import type { JourneyProviderAdapters } from '../src/providers/contracts.js';

for (const fixture of journeyFixtures) {
  await test(`journey fixture ${fixture.id}`, () => {
    const validation = validateJourneyCheckRequest(fixture.request);
    if (!validation.ok) {
      throw new Error(
        `Fixture request was rejected: ${validation.issues.join('; ')}`,
      );
    }
    const result = evaluateJourneyCheck(
      toFixtureAssessment(fixture, validation.value),
    );
    assert.equal(result.status, fixture.expectedStatus);
    assert.equal(result.reasons[0]?.code, fixture.expectedReason);
    assert.equal(result.dataMode, 'fixture');
    assert.equal(result.liveJourneyVerified, false);
    assert.equal(result.checkedAt, '2026-09-06T22:30:42.000Z');
    assert.match(result.warnings[0] ?? '', /Fixture data only/);
  });
}

await test('validator normalises optional constraints without coercion', () => {
  const result = validateJourneyCheckRequest({
    origin: { name: 'Stratford' },
    destination: { name: 'Waterloo', nationalRailCrs: 'WAT' },
    protectedDeparture: {
      at: '2026-09-07T00:35:00+01:00',
      kind: 'national_rail_departure',
    },
    safetyBufferMinutes: 5,
  });
  if (!result.ok) throw new Error(result.issues.join('; '));
  assert.equal(
    result.value.protectedDeparture.atMs,
    Date.parse('2026-09-06T23:35:00Z'),
  );
  assert.equal(result.value.protectedDeparture.localServiceDate, '2026-09-07');
  assert.deepEqual(result.value.constraints, { stepFreeRequired: false });
});

for (const [label, request] of [
  [
    'offset-free protected departure',
    {
      origin: { name: 'Stratford' },
      destination: { name: 'Waterloo' },
      protectedDeparture: {
        at: '2026-09-07T00:35:00',
        kind: 'national_rail_departure',
      },
      safetyBufferMinutes: 5,
    },
  ],
  [
    'invalid calendar date',
    {
      origin: { name: 'Stratford' },
      destination: { name: 'Waterloo' },
      protectedDeparture: {
        at: '2026-02-30T00:35:00+00:00',
        kind: 'national_rail_departure',
      },
      safetyBufferMinutes: 5,
    },
  ],
  [
    'unknown root field',
    {
      origin: { name: 'Stratford' },
      destination: { name: 'Waterloo' },
      protectedDeparture: {
        at: '2026-09-07T00:35:00+01:00',
        kind: 'national_rail_departure',
      },
      safetyBufferMinutes: 5,
      unexpected: true,
    },
  ],
  [
    'string safety buffer',
    {
      origin: { name: 'Stratford' },
      destination: { name: 'Waterloo' },
      protectedDeparture: {
        at: '2026-09-07T00:35:00+01:00',
        kind: 'national_rail_departure',
      },
      safetyBufferMinutes: '5',
    },
  ],
] as const) {
  await test(`validator rejects ${label}`, () => {
    const result = validateJourneyCheckRequest(request);
    assert.equal(result.ok, false);
    if (result.ok) throw new Error('Expected validation to fail');
    assert.ok(result.issues.length > 0);
  });
}

await test('evaluator computes margin from explicit instants and transfer once', () => {
  const fixture = journeyFixtures[0];
  if (fixture === undefined) throw new Error('Expected viable fixture');
  const validation = validateJourneyCheckRequest(fixture.request);
  if (!validation.ok) throw new Error(validation.issues.join('; '));
  const result = evaluateJourneyCheck(
    toFixtureAssessment(fixture, validation.value),
  );
  assert.equal(result.margin?.availableMinutes, 18);
  assert.equal(result.margin?.remainingAfterBufferMinutes, 13);
});

await test('cached evidence age increases on a later evaluation', () => {
  const fixture = journeyFixtures[0];
  if (fixture === undefined) throw new Error('Expected viable fixture');
  const validation = validateJourneyCheckRequest(fixture.request);
  if (!validation.ok) throw new Error(validation.issues.join('; '));
  const result = evaluateJourneyCheck(
    {
      ...toFixtureAssessment(fixture, validation.value),
      checkedAtMs: fixture.checkedAtMs + 120_000,
    },
    { maxEvidenceAgeSeconds: 200 },
  );
  assert.equal(result.status, 'viable');
  assert.equal(result.evidence[0]?.ageSeconds, 167);
});

await test('matched cancellation is a deterministic negative result', () => {
  const fixture = journeyFixtures[0];
  if (fixture === undefined || fixture.protectedEvent === null) {
    throw new Error('Expected viable fixture with event');
  }
  const validation = validateJourneyCheckRequest(fixture.request);
  if (!validation.ok) throw new Error(validation.issues.join('; '));
  const result = evaluateJourneyCheck({
    ...toFixtureAssessment(fixture, validation.value),
    protectedEvent: { ...fixture.protectedEvent, status: 'cancelled' },
  });
  assert.equal(result.status, 'not_viable');
  assert.equal(result.reasons[0]?.code, 'SERVICE_CANCELLED');
  assert.equal(result.margin, null);
});

await test('unmatched protected event fails safe', () => {
  const fixture = journeyFixtures[0];
  if (fixture === undefined || fixture.protectedEvent === null) {
    throw new Error('Expected viable fixture with event');
  }
  const validation = validateJourneyCheckRequest(fixture.request);
  if (!validation.ok) throw new Error(validation.issues.join('; '));
  const result = evaluateJourneyCheck({
    ...toFixtureAssessment(fixture, validation.value),
    protectedEvent: { ...fixture.protectedEvent, matchStatus: 'ambiguous' },
  });
  assert.equal(result.status, 'unable_to_verify');
  assert.equal(result.reasons[0]?.code, 'PROTECTED_EVENT_NOT_MATCHED');
  assert.equal(result.route, null);
  assert.equal(result.margin, null);
});

await test('equivalent event instant and prior operating service date are accepted when reconciled', () => {
  const fixture = journeyFixtures[0];
  if (fixture === undefined || fixture.protectedEvent === null) {
    throw new Error('Expected viable fixture with event');
  }
  const validation = validateJourneyCheckRequest(fixture.request);
  if (!validation.ok) throw new Error(validation.issues.join('; '));
  const result = evaluateJourneyCheck({
    ...toFixtureAssessment(fixture, validation.value),
    protectedEvent: {
      ...fixture.protectedEvent,
      at: '2026-09-06T23:35:00Z',
      serviceDate: '2026-09-06',
      serviceDateMatch: 'matched',
    },
  });
  assert.equal(result.status, 'viable');
});

await test('unreconciled service date fails safe', () => {
  const fixture = journeyFixtures[0];
  if (fixture === undefined || fixture.protectedEvent === null) {
    throw new Error('Expected viable fixture with event');
  }
  const validation = validateJourneyCheckRequest(fixture.request);
  if (!validation.ok) throw new Error(validation.issues.join('; '));
  const result = evaluateJourneyCheck({
    ...toFixtureAssessment(fixture, validation.value),
    protectedEvent: {
      ...fixture.protectedEvent,
      serviceDateMatch: 'ambiguous',
    },
  });
  assert.equal(result.status, 'unable_to_verify');
  assert.equal(result.reasons[0]?.code, 'TIME_AMBIGUOUS');
});

await test('route endpoints must match the requested journey', () => {
  const fixture = journeyFixtures[0];
  if (fixture === undefined || fixture.route === null) {
    throw new Error('Expected viable fixture with route');
  }
  const validation = validateJourneyCheckRequest(fixture.request);
  if (!validation.ok) throw new Error(validation.issues.join('; '));
  const result = evaluateJourneyCheck({
    ...toFixtureAssessment(fixture, validation.value),
    route: {
      ...fixture.route,
      legs: [{ ...fixture.route.legs[0]!, from: 'West Ham' }],
    },
  });
  assert.equal(result.status, 'unable_to_verify');
  assert.equal(result.reasons[0]?.code, 'EVIDENCE_CONTRADICTORY');
});

await test('adjacent route legs must connect at the same location', () => {
  const fixture = journeyFixtures[0];
  if (fixture === undefined || fixture.route === null) {
    throw new Error('Expected viable fixture with route');
  }
  const validation = validateJourneyCheckRequest(fixture.request);
  if (!validation.ok) throw new Error(validation.issues.join('; '));
  const result = evaluateJourneyCheck({
    ...toFixtureAssessment(fixture, validation.value),
    route: {
      ...fixture.route,
      legs: [
        {
          ...fixture.route.legs[0]!,
          to: 'West Ham',
          arrivalAt: '2026-09-06T23:55:00+01:00',
          durationMinutes: 10,
        },
        {
          ...fixture.route.legs[0]!,
          from: 'Victoria',
          to: 'Waterloo',
          departureAt: '2026-09-06T23:56:00+01:00',
          arrivalAt: fixture.route.arrivalAt,
          durationMinutes: 11,
        },
      ],
    },
  });
  assert.equal(result.status, 'unable_to_verify');
  assert.equal(result.reasons[0]?.code, 'EVIDENCE_CONTRADICTORY');
});

await test('route duration must agree with its timestamps', () => {
  const fixture = journeyFixtures[0];
  if (fixture === undefined || fixture.route === null) {
    throw new Error('Expected viable fixture with route');
  }
  const validation = validateJourneyCheckRequest(fixture.request);
  if (!validation.ok) throw new Error(validation.issues.join('; '));
  const result = evaluateJourneyCheck({
    ...toFixtureAssessment(fixture, validation.value),
    route: {
      ...fixture.route,
      legs: [{ ...fixture.route.legs[0]!, durationMinutes: 0 }],
    },
  });
  assert.equal(result.status, 'unable_to_verify');
  assert.equal(result.reasons[0]?.code, 'EVIDENCE_CONTRADICTORY');
});

await test('backward-time route fails safe', () => {
  const fixture = journeyFixtures[0];
  if (fixture === undefined || fixture.route === null) {
    throw new Error('Expected viable fixture with route');
  }
  const validation = validateJourneyCheckRequest(fixture.request);
  if (!validation.ok) throw new Error(validation.issues.join('; '));
  const result = evaluateJourneyCheck({
    ...toFixtureAssessment(fixture, validation.value),
    route: {
      ...fixture.route,
      arrivalAt: '2026-09-06T23:30:00+01:00',
      legs: [
        {
          ...fixture.route.legs[0]!,
          arrivalAt: '2026-09-06T23:30:00+01:00',
        },
      ],
    },
  });
  assert.equal(result.status, 'unable_to_verify');
  assert.equal(result.reasons[0]?.code, 'EVIDENCE_CONTRADICTORY');
});

await test('a route that has already departed is not viable', () => {
  const fixture = journeyFixtures[0];
  if (fixture === undefined || fixture.route === null) {
    throw new Error('Expected viable fixture with route');
  }
  const validation = validateJourneyCheckRequest(fixture.request);
  if (!validation.ok) throw new Error(validation.issues.join('; '));
  const result = evaluateJourneyCheck({
    ...toFixtureAssessment(fixture, validation.value),
    route: {
      ...fixture.route,
      legs: [
        {
          ...fixture.route.legs[0]!,
          departureAt: '2026-09-06T22:20:00Z',
          durationMinutes: 47,
        },
      ],
    },
  });
  assert.equal(result.status, 'not_viable');
  assert.equal(result.reasons[0]?.code, 'CONNECTION_MISSED');
});

await test('walking limit failure is not presented as viable', () => {
  const fixture = journeyFixtures[0];
  if (fixture === undefined) throw new Error('Expected viable fixture');
  const validation = validateJourneyCheckRequest({
    ...fixture.request,
    constraints: { walkingMinutesLimit: 10, stepFreeRequired: false },
  });
  if (!validation.ok) throw new Error(validation.issues.join('; '));
  const result = evaluateJourneyCheck(
    toFixtureAssessment(fixture, validation.value),
  );
  assert.equal(result.status, 'not_viable');
  assert.equal(result.reasons[0]?.code, 'NO_MATCHING_ROUTE');
});

await test('missing step-free evidence fails safe', () => {
  const fixture = journeyFixtures[0];
  if (fixture === undefined || fixture.route === null) {
    throw new Error('Expected viable fixture with route');
  }
  const validation = validateJourneyCheckRequest({
    ...fixture.request,
    constraints: { stepFreeRequired: true },
  });
  if (!validation.ok) throw new Error(validation.issues.join('; '));
  const result = evaluateJourneyCheck({
    ...toFixtureAssessment(fixture, validation.value),
    route: {
      arrivalAt: fixture.route.arrivalAt,
      legs: fixture.route.legs,
    },
  });
  assert.equal(result.status, 'unable_to_verify');
  assert.equal(result.reasons[0]?.code, 'INPUT_AMBIGUOUS');
});

await test('fixture evidence cannot be labelled live', () => {
  const fixture = journeyFixtures[0];
  if (fixture === undefined) throw new Error('Expected viable fixture');
  const validation = validateJourneyCheckRequest(fixture.request);
  if (!validation.ok) throw new Error(validation.issues.join('; '));
  const result = evaluateJourneyCheck({
    ...toFixtureAssessment(fixture, validation.value),
    dataMode: 'live',
  });
  assert.equal(result.status, 'unable_to_verify');
  assert.equal(result.reasons[0]?.code, 'INPUT_AMBIGUOUS');
  assert.equal(result.liveJourneyVerified, false);
});

await test('fixture evidence cannot be labelled cache', () => {
  const fixture = journeyFixtures[0];
  if (fixture === undefined) throw new Error('Expected viable fixture');
  const validation = validateJourneyCheckRequest(fixture.request);
  if (!validation.ok) throw new Error(validation.issues.join('; '));
  const result = evaluateJourneyCheck({
    ...toFixtureAssessment(fixture, validation.value),
    dataMode: 'cache',
  });
  assert.equal(result.status, 'unable_to_verify');
  assert.equal(result.reasons[0]?.code, 'INPUT_AMBIGUOUS');
  assert.equal(result.liveJourneyVerified, false);
});

await test('invalid capture metadata is not hidden by a valid provider timestamp', () => {
  const fixture = journeyFixtures[0];
  if (fixture === undefined) throw new Error('Expected viable fixture');
  const validation = validateJourneyCheckRequest(fixture.request);
  if (!validation.ok) throw new Error(validation.issues.join('; '));
  const result = evaluateJourneyCheck({
    ...toFixtureAssessment(fixture, validation.value),
    evidence: fixture.evidence.map((item) => ({
      ...item,
      capturedAt: 'not-a-timestamp',
    })),
  });
  assert.equal(result.status, 'unable_to_verify');
  assert.equal(result.reasons[0]?.code, 'TIME_AMBIGUOUS');
  assert.equal(result.evidence[0]?.ageSeconds, null);
});

await test('empty live evidence cannot claim live verification', () => {
  const fixture = journeyFixtures[0];
  if (fixture === undefined) throw new Error('Expected viable fixture');
  const validation = validateJourneyCheckRequest(fixture.request);
  if (!validation.ok) throw new Error(validation.issues.join('; '));
  const result = evaluateJourneyCheck({
    ...toFixtureAssessment(fixture, validation.value),
    dataMode: 'live',
    evidence: [],
  });
  assert.equal(result.status, 'unable_to_verify');
  assert.equal(result.liveJourneyVerified, false);
});

await test('early evidence failure does not expose a matched invalid event', () => {
  const fixture = journeyFixtures[0];
  if (fixture === undefined || fixture.protectedEvent === null) {
    throw new Error('Expected viable fixture with event');
  }
  const validation = validateJourneyCheckRequest(fixture.request);
  if (!validation.ok) throw new Error(validation.issues.join('; '));
  const result = evaluateJourneyCheck({
    ...toFixtureAssessment(fixture, validation.value),
    evidence: [],
    protectedEvent: { ...fixture.protectedEvent, at: 'garbage' },
  });
  assert.equal(result.status, 'unable_to_verify');
  assert.equal(result.protectedEvent?.matchStatus, 'not_matched');
});

await test('provider snapshots compose into the evaluator input', async () => {
  const fixture = journeyFixtures[0];
  if (
    fixture === undefined ||
    fixture.route === null ||
    fixture.protectedEvent === null
  ) {
    throw new Error('Expected a complete fixture');
  }
  const validation = validateJourneyCheckRequest(fixture.request);
  if (!validation.ok) throw new Error(validation.issues.join('; '));
  const adapters: JourneyProviderAdapters = {
    journeyPlanner: {
      async getPlan() {
        return {
          dataMode: 'fixture',
          value: {
            route: fixture.route,
            transferMinutes: fixture.transferMinutes,
          },
          evidence: fixture.evidence.filter(
            (item) => item.kind === 'journey_plan',
          ),
        };
      },
    },
    protectedDeparture: {
      async getProtectedDeparture() {
        return {
          dataMode: 'fixture',
          value: fixture.protectedEvent,
          evidence: fixture.evidence.filter(
            (item) => item.kind === 'protected_event',
          ),
        };
      },
    },
  };
  const assessment = await buildJourneyAssessment(
    validation.value,
    adapters,
    () => fixture.checkedAtMs,
  );
  const result = evaluateJourneyCheck(assessment);
  assert.equal(result.status, 'viable');
  assert.equal(result.evidence.length, 2);
  assert.equal(result.margin?.remainingAfterBufferMinutes, 13);
});

await test('provider snapshots cannot mix data modes silently', async () => {
  const fixture = journeyFixtures[0];
  if (fixture === undefined) throw new Error('Expected a fixture');
  const validation = validateJourneyCheckRequest(fixture.request);
  if (!validation.ok) throw new Error(validation.issues.join('; '));
  const adapters: JourneyProviderAdapters = {
    journeyPlanner: {
      async getPlan() {
        return {
          dataMode: 'live',
          value: null,
          evidence: [],
        };
      },
    },
    protectedDeparture: {
      async getProtectedDeparture() {
        return {
          dataMode: 'cache',
          value: null,
          evidence: [],
        };
      },
    },
  };
  await assert.rejects(
    buildJourneyAssessment(
      validation.value,
      adapters,
      () => fixture.checkedAtMs,
    ),
    /different data modes/,
  );
});

for (const failureCode of [
  'PROVIDER_UNAVAILABLE',
  'PROVIDER_RATE_LIMITED',
  'ARRIVALS_EMPTY_UNKNOWN',
] as const) {
  await test(`provider failure ${failureCode} fails safe`, async () => {
    const fixture = journeyFixtures[0];
    if (fixture === undefined) throw new Error('Expected a fixture');
    const validation = validateJourneyCheckRequest(fixture.request);
    if (!validation.ok) throw new Error(validation.issues.join('; '));
    const adapters: JourneyProviderAdapters = {
      journeyPlanner: {
        async getPlan() {
          return {
            dataMode: 'live',
            value: null,
            evidence: [],
            failure: {
              code: failureCode,
              message: 'Safe normalized provider failure',
            },
          };
        },
      },
      protectedDeparture: {
        async getProtectedDeparture() {
          return { dataMode: 'live', value: null, evidence: [] };
        },
      },
    };
    const assessment = await buildJourneyAssessment(
      validation.value,
      adapters,
      () => fixture.checkedAtMs,
    );
    const result = evaluateJourneyCheck(assessment);
    assert.equal(result.status, 'unable_to_verify');
    assert.equal(result.reasons[0]?.code, failureCode);
    assert.equal(result.liveJourneyVerified, false);
    if (failureCode === 'ARRIVALS_EMPTY_UNKNOWN') {
      assert.equal(
        result.summary,
        'Live arrivals were empty, so the service could not be verified.',
      );
    }
  });
}

await test('multiple provider failures remain visible in conservative order', async () => {
  const fixture = journeyFixtures[0];
  if (fixture === undefined) throw new Error('Expected a fixture');
  const validation = validateJourneyCheckRequest(fixture.request);
  if (!validation.ok) throw new Error(validation.issues.join('; '));
  const adapters: JourneyProviderAdapters = {
    journeyPlanner: {
      async getPlan() {
        return {
          dataMode: 'live',
          value: null,
          evidence: [],
          failure: {
            code: 'PROVIDER_RATE_LIMITED',
            message: 'The journey planner was rate limited.',
          },
        };
      },
    },
    protectedDeparture: {
      async getProtectedDeparture() {
        return {
          dataMode: 'live',
          value: null,
          evidence: [],
          failure: {
            code: 'ARRIVALS_EMPTY_UNKNOWN',
            message: 'Arrivals were empty and service state is unknown.',
          },
        };
      },
    },
  };
  const assessment = await buildJourneyAssessment(
    validation.value,
    adapters,
    () => fixture.checkedAtMs,
  );
  const result = evaluateJourneyCheck(assessment);
  assert.equal(result.status, 'unable_to_verify');
  assert.deepEqual(
    result.reasons.map((item) => item.code),
    ['PROVIDER_RATE_LIMITED', 'ARRIVALS_EMPTY_UNKNOWN'],
  );
  assert.equal(
    result.summary,
    'Live arrivals were empty, so the service could not be verified.',
  );
});

await test('evaluation clock is read after both provider snapshots resolve', async () => {
  const fixture = journeyFixtures[0];
  if (fixture === undefined) throw new Error('Expected a fixture');
  const validation = validateJourneyCheckRequest(fixture.request);
  if (!validation.ok) throw new Error(validation.issues.join('; '));
  let resolvedSnapshots = 0;
  const adapters: JourneyProviderAdapters = {
    journeyPlanner: {
      async getPlan() {
        await Promise.resolve();
        resolvedSnapshots += 1;
        return { dataMode: 'fixture', value: null, evidence: [] };
      },
    },
    protectedDeparture: {
      async getProtectedDeparture() {
        await Promise.resolve();
        resolvedSnapshots += 1;
        return { dataMode: 'fixture', value: null, evidence: [] };
      },
    },
  };
  const assessment = await buildJourneyAssessment(
    validation.value,
    adapters,
    () => {
      assert.equal(resolvedSnapshots, 2);
      return fixture.checkedAtMs;
    },
  );
  assert.equal(assessment.checkedAtMs, fixture.checkedAtMs);
});
