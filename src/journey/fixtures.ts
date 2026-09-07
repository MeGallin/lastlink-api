import type {
  EvidenceRecord,
  JourneyAssessmentInput,
  JourneyCheckRequestInput,
  JourneyCheckStatus,
  JourneyReason,
  JourneyRoute,
  ProtectedEvent,
  ValidatedJourneyCheckRequest,
} from './types.js';

export interface JourneyFixture {
  id: string;
  description: string;
  request: JourneyCheckRequestInput;
  checkedAtMs: number;
  route: JourneyRoute | null;
  protectedEvent: ProtectedEvent | null;
  transferMinutes: number;
  evidence: EvidenceRecord[];
  expectedStatus: JourneyCheckStatus;
  expectedReason: JourneyReason['code'];
}

const protectedDeparture = '2026-09-07T00:35:00+01:00';
const checkedAtMs = Date.parse('2026-09-06T22:30:42Z');

function makeRequest(safetyBufferMinutes: number): JourneyCheckRequestInput {
  return {
    origin: { name: 'Stratford', tflStopPointId: '940GZZLUSFD' },
    destination: { name: 'Waterloo', nationalRailCrs: 'WAT' },
    protectedDeparture: {
      at: protectedDeparture,
      kind: 'national_rail_departure',
      serviceLabel: 'Fixture service',
    },
    safetyBufferMinutes,
    constraints: { walkingMinutesLimit: 20, stepFreeRequired: false },
  };
}

function makeRoute(arrivalAt: string): JourneyRoute {
  const departureAt = '2026-09-06T23:45:00+01:00';
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
        durationMinutes:
          (Date.parse(arrivalAt) - Date.parse(departureAt)) / 60000,
        providerReference: 'fixture-route-1',
      },
    ],
  };
}

function makeProtectedEvent(
  status: ProtectedEvent['status'] = 'scheduled',
): ProtectedEvent {
  return {
    kind: 'national_rail_departure',
    at: protectedDeparture,
    station: 'Waterloo',
    serviceDate: '2026-09-06',
    serviceDateMatch: 'matched',
    matchStatus: 'matched',
    status,
    serviceLabel: 'Fixture service',
    nationalRailCrs: 'WAT',
  };
}

function makeEvidence(
  providerTimestamp = '2026-09-06T22:29:55Z',
): EvidenceRecord[] {
  return [
    {
      source: 'fixture',
      kind: 'journey_plan',
      capturedAt: '2026-09-06T22:30:42Z',
      providerTimestamp,
      completeness: 'sufficient',
      reference: 'fixture-route-1',
    },
    {
      source: 'fixture',
      kind: 'protected_event',
      capturedAt: '2026-09-06T22:30:42Z',
      providerTimestamp,
      completeness: 'sufficient',
      reference: 'fixture-event-1',
    },
  ];
}

export const journeyFixtures: JourneyFixture[] = [
  {
    id: 'fixture-viable-positive-buffer',
    description: 'A matched route leaves more than the requested buffer.',
    request: makeRequest(5),
    checkedAtMs,
    route: makeRoute('2026-09-07T00:07:00+01:00'),
    protectedEvent: makeProtectedEvent(),
    transferMinutes: 10,
    evidence: makeEvidence(),
    expectedStatus: 'viable',
    expectedReason: 'BUFFER_SATISFIED',
  },
  {
    id: 'fixture-tight-buffer-shortfall',
    description:
      'A matched route remains possible but misses the requested buffer.',
    request: makeRequest(10),
    checkedAtMs,
    route: makeRoute('2026-09-07T00:20:00+01:00'),
    protectedEvent: makeProtectedEvent(),
    transferMinutes: 10,
    evidence: makeEvidence(),
    expectedStatus: 'tight',
    expectedReason: 'BUFFER_SHORTFALL',
  },
  {
    id: 'fixture-connection-missed',
    description: 'A matched route arrives after the transfer window.',
    request: makeRequest(0),
    checkedAtMs,
    route: makeRoute('2026-09-07T00:30:00+01:00'),
    protectedEvent: makeProtectedEvent(),
    transferMinutes: 10,
    evidence: makeEvidence(),
    expectedStatus: 'not_viable',
    expectedReason: 'CONNECTION_MISSED',
  },
  {
    id: 'fixture-no-matching-route',
    description:
      'Current evidence is complete but no candidate route is available.',
    request: makeRequest(5),
    checkedAtMs,
    route: null,
    protectedEvent: makeProtectedEvent(),
    transferMinutes: 10,
    evidence: makeEvidence(),
    expectedStatus: 'not_viable',
    expectedReason: 'NO_MATCHING_ROUTE',
  },
  {
    id: 'fixture-stale-evidence',
    description:
      'A route exists but its evidence is outside the freshness policy.',
    request: makeRequest(5),
    checkedAtMs,
    route: makeRoute('2026-09-07T00:07:00+01:00'),
    protectedEvent: makeProtectedEvent(),
    transferMinutes: 10,
    evidence: makeEvidence('2026-09-06T22:20:42Z'),
    expectedStatus: 'unable_to_verify',
    expectedReason: 'EVIDENCE_STALE',
  },
];

export function toFixtureAssessment(
  fixture: JourneyFixture,
  request: ValidatedJourneyCheckRequest,
): JourneyAssessmentInput {
  return {
    request,
    checkedAtMs: fixture.checkedAtMs,
    dataMode: 'fixture',
    route: fixture.route,
    protectedEvent: fixture.protectedEvent,
    transferMinutes: fixture.transferMinutes,
    evidence: fixture.evidence,
  };
}
