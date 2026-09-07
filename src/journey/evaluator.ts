import {
  journeyContractVersion,
  type EvidenceRecord,
  type JourneyAssessmentInput,
  type JourneyCheckResponse,
  type JourneyEvaluationPolicy,
  type JourneyReason,
  type JourneyRoute,
  type ProtectedEvent,
} from './types.js';
import { parseExplicitInstant } from './time.js';

export const defaultJourneyEvaluationPolicy: JourneyEvaluationPolicy = {
  maxEvidenceAgeSeconds: 120,
};

export function evaluateJourneyCheck(
  input: JourneyAssessmentInput,
  policy: JourneyEvaluationPolicy = defaultJourneyEvaluationPolicy,
): JourneyCheckResponse {
  assertEvaluationContext(input, policy);
  const checkedAt = new Date(input.checkedAtMs).toISOString();
  const evidenceResult = input.evidence.map((item) =>
    toEvidenceResult(item, input.checkedAtMs),
  );
  const base = {
    contractVersion: journeyContractVersion,
    dataMode: input.dataMode,
    checkedAt,
    liveJourneyVerified: false,
    protectedEvent: markEventUnmatched(
      toProtectedEventResult(input.protectedEvent),
    ),
    route: null,
    margin: null,
    evidence: evidenceResult,
    warnings: input.dataMode === 'fixture' ? [fixtureWarning] : [],
  } as const;

  const modeIssue = findModeIssue(input);
  if (modeIssue !== undefined) {
    return response(
      base,
      'unable_to_verify',
      modeIssue,
      'The evidence mode could not be verified safely.',
    );
  }

  const providerIssue = input.providerIssues[0];
  if (providerIssue !== undefined) {
    return response(
      base,
      'unable_to_verify',
      providerIssue,
      'The journey could not be verified because a required provider was unavailable.',
    );
  }

  const evidenceIssue = findEvidenceIssue(
    input.evidence,
    evidenceResult,
    policy,
  );
  if (evidenceIssue !== undefined) {
    return response(
      base,
      'unable_to_verify',
      evidenceIssue,
      'The journey could not be verified from current evidence.',
    );
  }

  const eventIssue = validateProtectedEvent(input.protectedEvent, input);
  if (eventIssue !== undefined) {
    return response(
      { ...base, protectedEvent: markEventUnmatched(base.protectedEvent) },
      'unable_to_verify',
      eventIssue,
      'The protected departure could not be matched safely.',
    );
  }

  const verifiedBase = {
    ...base,
    protectedEvent: toProtectedEventResult(input.protectedEvent),
  };

  if (input.protectedEvent?.status === 'cancelled') {
    return response(
      verifiedBase,
      'not_viable',
      reason('SERVICE_CANCELLED', 'The protected departure is cancelled.'),
      'The protected departure is cancelled.',
    );
  }
  if (input.protectedEvent?.status === 'disrupted') {
    return response(
      verifiedBase,
      'unable_to_verify',
      reason(
        'SERVICE_DISRUPTED',
        'The protected departure is disrupted and needs a fresh check.',
      ),
      'The protected departure is disrupted.',
    );
  }

  if (input.route === null) {
    return response(
      verifiedBase,
      'not_viable',
      reason(
        'NO_MATCHING_ROUTE',
        'No evaluated route reaches the protected departure.',
      ),
      'No matching route is currently available.',
    );
  }

  const routeIssue = validateRoute(input.route, input);
  if (routeIssue !== undefined) {
    return response(
      verifiedBase,
      'unable_to_verify',
      routeIssue,
      'The route evidence is incomplete or ambiguous.',
    );
  }

  const constraintIssue = evaluateConstraints(input.request, input.route);
  if (constraintIssue !== undefined) {
    const status =
      constraintIssue.code === 'NO_MATCHING_ROUTE'
        ? 'not_viable'
        : 'unable_to_verify';
    return response(
      verifiedBase,
      status,
      constraintIssue,
      status === 'not_viable'
        ? 'No evaluated route satisfies the requested constraints.'
        : 'The requested constraints could not be verified safely.',
    );
  }

  const firstLeg = input.route.legs[0];
  if (firstLeg === undefined) {
    throw new Error('Validated route has no first leg');
  }
  const firstDepartureMs = parseExplicitInstant(firstLeg.departureAt)?.atMs;
  if (firstDepartureMs === undefined || firstDepartureMs < input.checkedAtMs) {
    return response(
      verifiedBase,
      'not_viable',
      reason('CONNECTION_MISSED', 'The first route leg has already departed.'),
      'This route has already departed and cannot be caught from the origin now.',
    );
  }

  const arrivalMs = parseExplicitInstant(input.route.arrivalAt)?.atMs;
  if (arrivalMs === undefined) {
    throw new Error('Validated route has no arrival instant');
  }
  const availableMinutes =
    (input.request.protectedDeparture.atMs - arrivalMs) / 60000 -
    input.transferMinutes;
  const remainingAfterBufferMinutes =
    availableMinutes - input.request.safetyBufferMinutes;
  const margin = {
    arrivalAt: input.route.arrivalAt,
    transferMinutes: input.transferMinutes,
    safetyBufferMinutes: input.request.safetyBufferMinutes,
    availableMinutes,
    remainingAfterBufferMinutes,
  };
  const route = input.route;

  if (availableMinutes <= 0) {
    return response(
      { ...verifiedBase, route, margin },
      'not_viable',
      reason(
        'CONNECTION_MISSED',
        'The route arrives too late after the transfer allowance.',
      ),
      'This route does not reach the protected departure in time.',
    );
  }
  if (remainingAfterBufferMinutes < 0) {
    return response(
      { ...verifiedBase, route, margin },
      'tight',
      reason(
        'BUFFER_SHORTFALL',
        'The route has positive time remaining but misses the requested safety buffer.',
      ),
      `The route is tight and misses your ${input.request.safetyBufferMinutes}-minute safety buffer.`,
    );
  }
  return response(
    { ...verifiedBase, route, margin },
    'viable',
    reason(
      'BUFFER_SATISFIED',
      'The calculated margin meets the requested buffer.',
    ),
    `A route is currently shown with ${remainingAfterBufferMinutes} minutes remaining after your safety buffer.`,
  );
}

const fixtureWarning = 'Fixture data only; do not use for travel decisions.';

function assertEvaluationContext(
  input: JourneyAssessmentInput,
  policy: JourneyEvaluationPolicy,
): void {
  if (!Number.isFinite(input.checkedAtMs)) {
    throw new Error('Invalid checkedAtMs');
  }
  if (
    !Number.isInteger(input.transferMinutes) ||
    input.transferMinutes < 0 ||
    input.transferMinutes > 180
  ) {
    throw new Error('Invalid transferMinutes');
  }
  if (
    !Number.isInteger(policy.maxEvidenceAgeSeconds) ||
    policy.maxEvidenceAgeSeconds < 0
  ) {
    throw new Error('Invalid maxEvidenceAgeSeconds');
  }
}

function findModeIssue(
  input: JourneyAssessmentInput,
): JourneyReason | undefined {
  if (
    input.dataMode !== 'fixture' &&
    input.evidence.some((item) => item.source === 'fixture')
  ) {
    return reason(
      'INPUT_AMBIGUOUS',
      'Live mode cannot be evaluated with fixture evidence.',
    );
  }
  return undefined;
}

function toEvidenceResult(
  item: EvidenceRecord,
  checkedAtMs: number,
): JourneyCheckResponse['evidence'][number] {
  const captured = parseExplicitInstant(item.capturedAt);
  const provider =
    item.providerTimestamp === undefined
      ? undefined
      : parseExplicitInstant(item.providerTimestamp);
  const source = provider ?? captured;
  const ageSeconds =
    captured === undefined ||
    captured.atMs > checkedAtMs ||
    (item.providerTimestamp !== undefined &&
      (provider === undefined ||
        provider.atMs > checkedAtMs ||
        provider.atMs > captured.atMs)) ||
    source === undefined
      ? null
      : Math.floor((checkedAtMs - source.atMs) / 1000);
  return { ...item, ageSeconds };
}

function findEvidenceIssue(
  input: EvidenceRecord[],
  result: JourneyCheckResponse['evidence'],
  policy: JourneyEvaluationPolicy,
): JourneyReason | undefined {
  for (const [index, item] of input.entries()) {
    const evidence = result[index];
    if (evidence === undefined || evidence.ageSeconds === null) {
      return reason(
        'TIME_AMBIGUOUS',
        `Evidence item ${index + 1} has an invalid or future timestamp.`,
      );
    }
    if (evidence.ageSeconds > policy.maxEvidenceAgeSeconds) {
      return reason(
        'EVIDENCE_STALE',
        `Evidence item ${index + 1} is older than the freshness policy.`,
      );
    }
    if (item.completeness !== 'sufficient') {
      return reason(
        'EVIDENCE_INCOMPLETE',
        `Evidence item ${index + 1} is incomplete.`,
      );
    }
  }
  const hasJourneyPlan = input.some(
    (item) =>
      item.kind === 'journey_plan' && item.completeness === 'sufficient',
  );
  const hasProtectedEvent = input.some(
    (item) =>
      item.kind === 'protected_event' &&
      (item.source === 'fixture' || item.source === 'darwin_service') &&
      item.completeness === 'sufficient',
  );
  if (!hasJourneyPlan || !hasProtectedEvent) {
    return reason(
      'EVIDENCE_INCOMPLETE',
      'Journey-plan and protected-event evidence are both required.',
    );
  }
  return undefined;
}

function validateProtectedEvent(
  event: ProtectedEvent | null,
  input: JourneyAssessmentInput,
): JourneyReason | undefined {
  if (event === null || event.matchStatus !== 'matched') {
    return reason(
      'PROTECTED_EVENT_NOT_MATCHED',
      'The protected departure was not explicitly matched.',
    );
  }
  if (event.kind !== input.request.protectedDeparture.kind) {
    return reason(
      'PROTECTED_EVENT_NOT_MATCHED',
      'The protected departure kind did not match the request.',
    );
  }
  if (event.serviceDateMatch !== 'matched') {
    return reason(
      event.serviceDateMatch === 'ambiguous'
        ? 'TIME_AMBIGUOUS'
        : 'PROTECTED_EVENT_NOT_MATCHED',
      'The provider service date was not explicitly reconciled with the request.',
    );
  }
  const eventAtMs = parseExplicitInstant(event.at)?.atMs;
  if (
    eventAtMs === undefined ||
    eventAtMs !== input.request.protectedDeparture.atMs
  ) {
    return reason(
      'TIME_AMBIGUOUS',
      'The protected departure time could not be reconciled.',
    );
  }
  if (
    input.request.destination.nationalRailCrs !== undefined &&
    event.nationalRailCrs !== input.request.destination.nationalRailCrs
  ) {
    return reason(
      'PROTECTED_EVENT_NOT_MATCHED',
      'The protected departure station did not match the requested CRS.',
    );
  }
  if (!sameStation(event.station, input.request.destination.name)) {
    return reason(
      'PROTECTED_EVENT_NOT_MATCHED',
      'The protected departure station did not match the destination.',
    );
  }
  return undefined;
}

function validateRoute(
  route: JourneyRoute,
  input: JourneyAssessmentInput,
): JourneyReason | undefined {
  if (route.legs.length === 0) {
    return reason('EVIDENCE_INCOMPLETE', 'The evaluated route has no legs.');
  }
  const routeArrival = parseExplicitInstant(route.arrivalAt);
  if (routeArrival === undefined) {
    return reason(
      'TIME_AMBIGUOUS',
      'The route arrival time is not an explicit instant.',
    );
  }
  let previousArrivalMs: number | undefined;
  let previousTo: string | undefined;
  for (const leg of route.legs) {
    const departure = parseExplicitInstant(leg.departureAt);
    const arrival = parseExplicitInstant(leg.arrivalAt);
    if (
      leg.from.trim().length === 0 ||
      leg.to.trim().length === 0 ||
      leg.providerReference.trim().length === 0 ||
      !Number.isFinite(leg.durationMinutes) ||
      leg.durationMinutes < 0 ||
      departure === undefined ||
      arrival === undefined
    ) {
      return reason(
        'EVIDENCE_INCOMPLETE',
        'A route leg is incomplete or has invalid timing.',
      );
    }
    if (arrival.atMs < departure.atMs) {
      return reason(
        'EVIDENCE_CONTRADICTORY',
        'A route leg arrives before it departs.',
      );
    }
    const durationMinutes = (arrival.atMs - departure.atMs) / 60000;
    if (Math.abs(durationMinutes - leg.durationMinutes) > 0.001) {
      return reason(
        'EVIDENCE_CONTRADICTORY',
        'A route leg duration does not match its timestamps.',
      );
    }
    if (previousTo !== undefined && !sameStation(previousTo, leg.from)) {
      return reason(
        'EVIDENCE_CONTRADICTORY',
        'Adjacent route legs do not connect at the same location.',
      );
    }
    if (previousArrivalMs !== undefined && departure.atMs < previousArrivalMs) {
      return reason(
        'EVIDENCE_CONTRADICTORY',
        'Route legs are not chronologically continuous.',
      );
    }
    previousArrivalMs = arrival.atMs;
    previousTo = leg.to;
  }
  const finalLeg = route.legs[route.legs.length - 1];
  if (finalLeg === undefined) {
    return reason(
      'EVIDENCE_INCOMPLETE',
      'The evaluated route has no final leg.',
    );
  }
  if (parseExplicitInstant(finalLeg.arrivalAt)?.atMs !== routeArrival.atMs) {
    return reason(
      'EVIDENCE_CONTRADICTORY',
      'The route arrival does not match the final leg arrival.',
    );
  }
  const firstLeg = route.legs[0];
  if (
    firstLeg === undefined ||
    !sameStation(firstLeg.from, input.request.origin.name) ||
    !sameStation(finalLeg.to, input.request.destination.name)
  ) {
    return reason(
      'EVIDENCE_CONTRADICTORY',
      'The route endpoints do not match the requested origin and destination.',
    );
  }
  if (
    route.walkingMinutes !== undefined &&
    (!Number.isInteger(route.walkingMinutes) || route.walkingMinutes < 0)
  ) {
    return reason(
      'EVIDENCE_INCOMPLETE',
      'The route walking duration is invalid.',
    );
  }
  return undefined;
}

function evaluateConstraints(
  request: JourneyAssessmentInput['request'],
  route: JourneyRoute,
): JourneyReason | undefined {
  const walkingLimit = request.constraints.walkingMinutesLimit;
  if (
    walkingLimit !== undefined &&
    (route.walkingMinutes === undefined || route.walkingMinutes > walkingLimit)
  ) {
    return reason(
      route.walkingMinutes === undefined
        ? 'INPUT_AMBIGUOUS'
        : 'NO_MATCHING_ROUTE',
      route.walkingMinutes === undefined
        ? 'Walking duration is not available for the requested limit.'
        : 'The evaluated route exceeds the requested walking limit.',
    );
  }
  if (request.constraints.stepFreeRequired) {
    if (route.stepFreeAvailable === undefined) {
      return reason(
        'INPUT_AMBIGUOUS',
        'Step-free access is not available in the evaluated evidence.',
      );
    }
    if (!route.stepFreeAvailable) {
      return reason(
        'NO_MATCHING_ROUTE',
        'The evaluated route does not satisfy the step-free requirement.',
      );
    }
  }
  return undefined;
}

function toProtectedEventResult(
  event: ProtectedEvent | null,
): JourneyCheckResponse['protectedEvent'] {
  if (event === null) return null;
  const result: JourneyCheckResponse['protectedEvent'] = {
    kind: event.kind,
    at: event.at,
    station: event.station,
    matchStatus: event.matchStatus,
  };
  if (event.serviceLabel !== undefined)
    result.serviceLabel = event.serviceLabel;
  return result;
}

function markEventUnmatched(
  event: JourneyCheckResponse['protectedEvent'],
): JourneyCheckResponse['protectedEvent'] {
  if (event === null) return null;
  return { ...event, matchStatus: 'not_matched' };
}

function response(
  base: Omit<
    JourneyCheckResponse,
    'status' | 'summary' | 'nextAction' | 'reasons'
  > & {
    route: JourneyRoute | null;
    margin: JourneyCheckResponse['margin'];
  },
  status: JourneyCheckResponse['status'],
  reasonValue: JourneyReason,
  summary: string,
): JourneyCheckResponse {
  const liveJourneyVerified =
    base.dataMode === 'live' &&
    status !== 'unable_to_verify' &&
    base.evidence.length > 0 &&
    base.evidence.every((item) => item.source !== 'fixture');
  return {
    ...base,
    status,
    liveJourneyVerified,
    summary,
    nextAction:
      status === 'viable'
        ? 'Leave now and follow the evaluated route.'
        : 'Recheck for another route or allow more time.',
    reasons: [reasonValue],
  };
}

function reason(code: JourneyReason['code'], message: string): JourneyReason {
  return { code, message };
}

function sameStation(left: string, right: string): boolean {
  return left.trim().toLowerCase() === right.trim().toLowerCase();
}
