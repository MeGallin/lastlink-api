import type {
  EvidenceRecord,
  JourneyDataMode,
  JourneyRoute,
  ProtectedEvent,
  ValidatedJourneyCheckRequest,
} from '../journey/types.js';

/** Provider adapters return normalized values; raw payloads stay inside adapters. */
export interface ProviderSnapshot<T> {
  dataMode: JourneyDataMode;
  value: T | null;
  evidence: EvidenceRecord[];
}

export interface NormalizedJourneyPlan {
  route: JourneyRoute | null;
  transferMinutes: number;
}

export interface JourneyPlannerAdapter {
  getPlan(
    request: ValidatedJourneyCheckRequest,
  ): Promise<ProviderSnapshot<NormalizedJourneyPlan>>;
}

export interface ProtectedDepartureAdapter {
  getProtectedDeparture(
    request: ValidatedJourneyCheckRequest,
  ): Promise<ProviderSnapshot<ProtectedEvent>>;
}

export interface JourneyProviderAdapters {
  journeyPlanner: JourneyPlannerAdapter;
  protectedDeparture: ProtectedDepartureAdapter;
}
