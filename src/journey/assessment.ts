import type {
  JourneyAssessmentInput,
  JourneyReason,
  ValidatedJourneyCheckRequest,
} from './types.js';
import type { JourneyProviderAdapters } from '../providers/contracts.js';

export type JourneyEvaluationClock = () => number;

export async function buildJourneyAssessment(
  request: ValidatedJourneyCheckRequest,
  adapters: JourneyProviderAdapters,
  readEvaluationClock: JourneyEvaluationClock = Date.now,
): Promise<JourneyAssessmentInput> {
  const [planSnapshot, protectedDepartureSnapshot] = await Promise.all([
    adapters.journeyPlanner.getPlan(request),
    adapters.protectedDeparture.getProtectedDeparture(request),
  ]);

  const checkedAtMs = readEvaluationClock();
  if (!Number.isFinite(checkedAtMs)) {
    throw new Error('Invalid checkedAtMs');
  }

  if (planSnapshot.dataMode !== protectedDepartureSnapshot.dataMode) {
    throw new Error('Provider snapshots use different data modes');
  }

  const providerIssues: JourneyReason[] = [
    planSnapshot.failure,
    protectedDepartureSnapshot.failure,
  ]
    .filter((failure) => failure !== undefined)
    .map((failure) => ({ code: failure.code, message: failure.message }));

  return {
    request,
    checkedAtMs,
    dataMode: planSnapshot.dataMode,
    route: planSnapshot.value?.route ?? null,
    protectedEvent: protectedDepartureSnapshot.value,
    transferMinutes: planSnapshot.value?.transferMinutes ?? 0,
    evidence: [
      ...planSnapshot.evidence,
      ...protectedDepartureSnapshot.evidence,
    ],
    providerIssues,
  };
}
