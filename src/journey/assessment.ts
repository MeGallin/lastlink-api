import type {
  JourneyAssessmentInput,
  ValidatedJourneyCheckRequest,
} from './types.js';
import type { JourneyProviderAdapters } from '../providers/contracts.js';

export async function buildJourneyAssessment(
  request: ValidatedJourneyCheckRequest,
  checkedAtMs: number,
  adapters: JourneyProviderAdapters,
): Promise<JourneyAssessmentInput> {
  if (!Number.isFinite(checkedAtMs)) {
    throw new Error('Invalid checkedAtMs');
  }

  const [planSnapshot, protectedDepartureSnapshot] = await Promise.all([
    adapters.journeyPlanner.getPlan(request),
    adapters.protectedDeparture.getProtectedDeparture(request),
  ]);

  if (planSnapshot.dataMode !== protectedDepartureSnapshot.dataMode) {
    throw new Error('Provider snapshots use different data modes');
  }

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
  };
}
