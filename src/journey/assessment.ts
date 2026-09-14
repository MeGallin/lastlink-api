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
  let evidence = [...planSnapshot.evidence];
  let providerWarnings: string[] = [];
  if (
    planSnapshot.value?.route !== null &&
    planSnapshot.value?.route !== undefined
  ) {
    const corroboration = adapters.corroboration;
    if (corroboration !== undefined) {
      try {
        const result = await corroboration.getEvidence(
          request,
          planSnapshot.value.route,
          checkedAtMs,
        );
        evidence = [...evidence, ...result.evidence];
        providerWarnings = result.warnings;
      } catch {
        providerWarnings = [
          'Optional TfL corroboration could not be completed; the route remains Journey Planner evidence only.',
        ];
      }
    }
  }

  return {
    request,
    checkedAtMs,
    dataMode: planSnapshot.dataMode,
    route: planSnapshot.value?.route ?? null,
    transferMinutes: planSnapshot.value?.transferMinutes ?? 0,
    evidence,
    providerIssues,
    providerWarnings,
  };
}
