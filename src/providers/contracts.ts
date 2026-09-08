import type {
  EvidenceRecord,
  JourneyDataMode,
  JourneyRoute,
  ValidatedJourneyCheckRequest,
} from '../journey/types.js';

export type ProviderFailureCode =
  'PROVIDER_UNAVAILABLE' | 'PROVIDER_RATE_LIMITED' | 'ARRIVALS_EMPTY_UNKNOWN';

export interface ProviderFailure {
  code: ProviderFailureCode;
  /** Safe adapter-owned text; never copy a raw upstream error body here. */
  message: string;
}

/** Provider adapters return normalized values; raw payloads stay inside adapters. */
export type ProviderSnapshot<T> =
  | {
      dataMode: JourneyDataMode;
      value: T | null;
      evidence: EvidenceRecord[];
      failure?: undefined;
    }
  | {
      dataMode: JourneyDataMode;
      value: null;
      evidence: EvidenceRecord[];
      failure: ProviderFailure;
    };

export interface NormalizedJourneyPlan {
  route: JourneyRoute | null;
  transferMinutes: number;
}

export interface JourneyPlannerAdapter {
  getPlan(
    request: ValidatedJourneyCheckRequest,
  ): Promise<ProviderSnapshot<NormalizedJourneyPlan>>;
}

export interface JourneyProviderAdapters {
  journeyPlanner: JourneyPlannerAdapter;
}
