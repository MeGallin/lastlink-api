import { journeyFixtures, toFixtureAssessment } from './fixtures.js';
import type {
  JourneyAssessmentInput,
  JourneyCheckRequestInput,
  ValidatedJourneyCheckRequest,
} from './types.js';
import { parseExplicitInstant } from './time.js';

const fixtureCheckedAtMs = Date.parse('2026-09-06T22:30:42Z');

export function createFixtureAssessment(
  request: ValidatedJourneyCheckRequest,
): JourneyAssessmentInput {
  const fixture = journeyFixtures.find((candidate) =>
    matchesFixtureRequest(candidate.request, request),
  );
  if (fixture !== undefined) {
    return toFixtureAssessment(fixture, request);
  }
  return {
    request,
    checkedAtMs: fixtureCheckedAtMs,
    dataMode: 'fixture',
    route: null,
    protectedEvent: null,
    transferMinutes: 0,
    evidence: [],
  };
}

function matchesFixtureRequest(
  fixtureRequest: JourneyCheckRequestInput,
  request: ValidatedJourneyCheckRequest,
): boolean {
  const fixtureDeparture = parseExplicitInstant(
    fixtureRequest.protectedDeparture.at,
  );
  return (
    sameText(fixtureRequest.origin.name, request.origin.name) &&
    sameText(fixtureRequest.destination.name, request.destination.name) &&
    fixtureRequest.protectedDeparture.kind ===
      request.protectedDeparture.kind &&
    fixtureDeparture?.atMs === request.protectedDeparture.atMs &&
    optionalMatches(
      fixtureRequest.origin.tflStopPointId,
      request.origin.tflStopPointId,
    ) &&
    optionalMatches(
      fixtureRequest.destination.nationalRailCrs,
      request.destination.nationalRailCrs,
    )
  );
}

function optionalMatches(
  fixtureValue: string | undefined,
  requestValue: string | undefined,
): boolean {
  return requestValue === undefined || fixtureValue === requestValue;
}

function sameText(left: string, right: string): boolean {
  return left.trim().toLowerCase() === right.trim().toLowerCase();
}
