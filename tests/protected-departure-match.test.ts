import assert from 'node:assert/strict';
import { test } from 'node:test';
import { matchProtectedDeparture } from '../src/providers/protected-departure-match.js';
import { validateJourneyCheckRequest } from '../src/journey/validation.js';
import type {
  EvidenceRecord,
  ProtectedEvent,
  ValidatedJourneyCheckRequest,
} from '../src/journey/types.js';

const evidence: EvidenceRecord[] = [
  {
    source: 'darwin_service',
    kind: 'protected_event',
    capturedAt: '2026-09-06T22:30:42Z',
    completeness: 'sufficient',
    reference: 'synthetic-darwin-event',
  },
];

function request(
  nationalRailCrs: string | undefined = 'WAT',
  omitNationalRailCrs = false,
): ValidatedJourneyCheckRequest {
  const result = validateJourneyCheckRequest({
    origin: { name: 'Stratford', tflStopPointId: '940GZZLUSFD' },
    destination: {
      name: 'Waterloo',
      ...(omitNationalRailCrs || nationalRailCrs === undefined
        ? {}
        : { nationalRailCrs }),
    },
    protectedDeparture: {
      at: '2026-09-07T00:35:00+01:00',
      kind: 'national_rail_departure',
      serviceLabel: 'Synthetic service',
    },
    safetyBufferMinutes: 5,
  });
  if (!result.ok) throw new Error(result.issues.join('; '));
  return result.value;
}

function event(overrides: Partial<ProtectedEvent> = {}): ProtectedEvent {
  return {
    kind: 'national_rail_departure',
    at: '2026-09-07T00:35:00+01:00',
    station: 'Waterloo',
    serviceDate: '2026-09-06',
    serviceDateMatch: 'matched',
    matchStatus: 'matched',
    status: 'scheduled',
    serviceLabel: 'Different display label',
    nationalRailCrs: 'WAT',
    ...overrides,
  };
}

await test('matches one reconciled event by instant, station and CRS', () => {
  const candidate = { event: event(), evidence };

  const result = matchProtectedDeparture(request(), [candidate]);

  assert.deepEqual(result, { ok: true, match: candidate });
});

await test('matches equivalent explicit offsets when CRS is optional', () => {
  const optionalCrsEvent = event({ at: '2026-09-06T23:35:00Z' });
  delete optionalCrsEvent.nationalRailCrs;
  const candidate = {
    event: optionalCrsEvent,
    evidence,
  };

  const result = matchProtectedDeparture(request(undefined, true), [candidate]);

  assert.deepEqual(result, { ok: true, match: candidate });
});

await test('does not use a service label as a unique identity', () => {
  const first = { event: event({ serviceLabel: 'A' }), evidence };
  const second = { event: event({ serviceLabel: 'B' }), evidence };

  const result = matchProtectedDeparture(request(), [first, second]);

  assert.deepEqual(result, {
    ok: false,
    code: 'AMBIGUOUS',
    message: 'More than one protected departure matched the request.',
  });
});

await test('ignores non-matching station, CRS, kind or instant candidates', () => {
  const result = matchProtectedDeparture(request(), [
    { event: event({ station: 'Victoria' }), evidence },
    { event: event({ nationalRailCrs: 'VIC' }), evidence },
    {
      event: event({ kind: 'other' as ProtectedEvent['kind'] }),
      evidence,
    },
    {
      event: event({ at: '2026-09-07T00:36:00+01:00' }),
      evidence,
    },
  ]);

  assert.deepEqual(result, {
    ok: false,
    code: 'NO_MATCH',
    message: 'No protected departure matched the requested event.',
  });
});

await test('does not select an explicitly unmatched exact candidate', () => {
  const result = matchProtectedDeparture(request(), [
    { event: event({ matchStatus: 'not_matched' }), evidence },
  ]);

  assert.deepEqual(result, {
    ok: false,
    code: 'NO_MATCH',
    message: 'No protected departure matched the requested event.',
  });
});

await test('fails conservatively when an exact candidate is unresolved', () => {
  const result = matchProtectedDeparture(request(), [
    {
      event: event({ serviceDateMatch: 'ambiguous' }),
      evidence,
    },
  ]);

  assert.deepEqual(result, {
    ok: false,
    code: 'AMBIGUOUS',
    message: 'The protected departure match is ambiguous.',
  });
});

await test('keeps an ambiguous exact candidate from being hidden by an eligible one', () => {
  const result = matchProtectedDeparture(request(), [
    { event: event({ serviceDateMatch: 'ambiguous' }), evidence },
    { event: event({ serviceLabel: 'Eligible label' }), evidence },
  ]);

  assert.deepEqual(result, {
    ok: false,
    code: 'AMBIGUOUS',
    message: 'The protected departure match is ambiguous.',
  });
});

await test('does not reject a matched cancellation before evaluation', () => {
  const candidate = { event: event({ status: 'cancelled' }), evidence };

  const result = matchProtectedDeparture(request(), [candidate]);

  assert.deepEqual(result, { ok: true, match: candidate });
});
