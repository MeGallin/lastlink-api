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
  const planSnapshot = await adapters.journeyPlanner.getPlan(request);
  const checkedAtMs = readEvaluationClock();
  if (!Number.isFinite(checkedAtMs)) {
    throw new Error('Invalid checkedAtMs');
  }

  const providerIssues: JourneyReason[] = planSnapshot.failure
    ? [
        {
          code: planSnapshot.failure.code,
          message: planSnapshot.failure.message,
        },
      ]
    : [];

  return {
    request,
    checkedAtMs,
    dataMode: planSnapshot.dataMode,
    route: planSnapshot.value?.route ?? null,
    transferMinutes: planSnapshot.value?.transferMinutes ?? 0,
    evidence: planSnapshot.evidence,
    providerIssues,
  };
}
