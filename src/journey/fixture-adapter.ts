import { journeyFixtures } from './fixtures.js';
import { buildJourneyAssessment } from './assessment.js';
import type {
  JourneyAssessmentInput,
  JourneyCheckRequestInput,
  ValidatedJourneyCheckRequest,
} from './types.js';
import type {
  JourneyPlannerAdapter,
  JourneyProviderAdapters,
  ProtectedDepartureAdapter,
  ProviderSnapshot,
} from '../providers/contracts.js';
import { parseExplicitInstant } from './time.js';

const fixtureCheckedAtMs = Date.parse('2026-09-06T22:30:42Z');

const fixtureJourneyPlannerAdapter: JourneyPlannerAdapter = {
  async getPlan(request) {
    const fixture = findFixture(request);
    return fixtureSnapshot(
      fixture?.route === undefined
        ? null
        : {
            route: fixture.route,
            transferMinutes: fixture.transferMinutes,
          },
      fixture?.evidence.filter((item) => item.kind === 'journey_plan') ?? [],
    );
  },
};

const fixtureProtectedDepartureAdapter: ProtectedDepartureAdapter = {
  async getProtectedDeparture(request) {
    const fixture = findFixture(request);
    return fixtureSnapshot(
      fixture?.protectedEvent ?? null,
      fixture?.evidence.filter((item) => item.kind === 'protected_event') ?? [],
    );
  },
};

const fixtureAdapters: JourneyProviderAdapters = {
  journeyPlanner: fixtureJourneyPlannerAdapter,
  protectedDeparture: fixtureProtectedDepartureAdapter,
};

export async function createFixtureAssessment(
  request: ValidatedJourneyCheckRequest,
): Promise<JourneyAssessmentInput> {
  return buildJourneyAssessment(
    request,
    fixtureAdapters,
    () => fixtureCheckedAtMs,
  );
}

function findFixture(request: ValidatedJourneyCheckRequest) {
  return journeyFixtures.find((candidate) =>
    matchesFixtureRequest(candidate.request, request),
  );
}

function fixtureSnapshot<T>(
  value: T | null,
  evidence: ProviderSnapshot<T>['evidence'],
): ProviderSnapshot<T> {
  return { dataMode: 'fixture', value, evidence };
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
