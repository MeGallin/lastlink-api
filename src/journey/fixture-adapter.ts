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
  ProviderSnapshot,
} from '../providers/contracts.js';
import { parseExplicitInstant } from './time.js';

const fixtureCheckedAtMs = Date.parse('2026-09-06T22:30:42Z');

const fixtureJourneyPlannerAdapter: JourneyPlannerAdapter = {
  async getPlan(request) {
    const fixture = findFixture(request);
    return fixtureSnapshot(
      fixture === undefined
        ? null
        : {
            route: fixture.route,
            transferMinutes: fixture.transferMinutes,
          },
      fixture?.evidence ?? [],
    );
  },
};

const fixtureAdapters: JourneyProviderAdapters = {
  journeyPlanner: fixtureJourneyPlannerAdapter,
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
  const fixtureDeadline = resolveFixtureDeadline(fixtureRequest);
  return (
    sameText(fixtureRequest.origin.name, request.origin.name) &&
    sameText(fixtureRequest.destination.name, request.destination.name) &&
    fixtureDeadline === request.deadline.arriveByAtMs &&
    optionalMatches(
      fixtureRequest.origin.tflStopPointId,
      request.origin.tflStopPointId,
    ) &&
    optionalMatches(
      fixtureRequest.destination.tflStopPointId,
      request.destination.tflStopPointId,
    )
  );
}

function resolveFixtureDeadline(request: JourneyCheckRequestInput): number {
  if (request.arriveBy !== undefined) {
    return parseExplicitInstant(request.arriveBy)?.atMs ?? Number.NaN;
  }
  if (
    request.onwardDepartureAt !== undefined &&
    request.stationTransferMinutes !== undefined
  ) {
    const onward = parseExplicitInstant(request.onwardDepartureAt)?.atMs;
    return onward === undefined
      ? Number.NaN
      : onward - request.stationTransferMinutes * 60_000;
  }
  return Number.NaN;
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
