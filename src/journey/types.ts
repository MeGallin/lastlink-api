export const journeyContractVersion = 'journey-check.v0.1' as const;

export type JourneyCheckStatus =
  'viable' | 'tight' | 'not_viable' | 'unable_to_verify';

export type JourneyDataMode = 'fixture' | 'live' | 'cache';

export type ProtectedDepartureKind = 'national_rail_departure';

export type ProtectedEventMatchStatus =
  'matched' | 'not_matched' | 'ambiguous' | 'unavailable';

export type ProtectedEventStatus = 'scheduled' | 'cancelled' | 'disrupted';

export type ProtectedServiceDateMatch = 'matched' | 'not_matched' | 'ambiguous';

export type EvidenceSource =
  | 'tfl_journey_planner'
  | 'tfl_timetable'
  | 'tfl_arrivals'
  | 'tfl_line_status'
  | 'tfl_stop_point_disruption'
  | 'darwin_service'
  | 'fixture';

export type EvidenceKind =
  | 'journey_plan'
  | 'timetable'
  | 'arrivals'
  | 'line_status'
  | 'stop_point_disruption'
  | 'protected_event';

export type EvidenceCompleteness = 'sufficient' | 'partial';

export interface JourneyLocationInput {
  name: string;
  tflStopPointId?: string;
}

export interface JourneyDestinationInput {
  name: string;
  nationalRailCrs?: string;
}

export interface ProtectedDepartureInput {
  at: string;
  kind: ProtectedDepartureKind;
  serviceLabel?: string;
}

export interface JourneyConstraintsInput {
  walkingMinutesLimit?: number;
  stepFreeRequired?: boolean;
}

export interface JourneyCheckRequestInput {
  origin: JourneyLocationInput;
  destination: JourneyDestinationInput;
  protectedDeparture: ProtectedDepartureInput;
  safetyBufferMinutes: number;
  constraints?: JourneyConstraintsInput;
}

export interface ValidatedJourneyCheckRequest {
  origin: JourneyLocationInput;
  destination: JourneyDestinationInput;
  protectedDeparture: ProtectedDepartureInput & {
    atMs: number;
    localServiceDate: string;
  };
  safetyBufferMinutes: number;
  constraints: JourneyConstraintsInput & { stepFreeRequired: boolean };
}

export type JourneyRequestValidation =
  | { ok: true; value: ValidatedJourneyCheckRequest }
  | { ok: false; issues: string[] };

export type RouteMode =
  'tube' | 'overground' | 'rail' | 'bus' | 'walk' | 'other';

export interface JourneyRouteLeg {
  mode: RouteMode;
  from: string;
  to: string;
  departureAt: string;
  arrivalAt: string;
  durationMinutes: number;
  providerReference: string;
}

export interface JourneyRoute {
  legs: JourneyRouteLeg[];
  arrivalAt: string;
  walkingMinutes?: number;
  stepFreeAvailable?: boolean;
}

export interface ProtectedEvent {
  kind: ProtectedDepartureKind;
  at: string;
  station: string;
  serviceDate: string;
  serviceDateMatch: ProtectedServiceDateMatch;
  matchStatus: ProtectedEventMatchStatus;
  status: ProtectedEventStatus;
  serviceLabel?: string;
  nationalRailCrs?: string;
}

export interface EvidenceRecord {
  source: EvidenceSource;
  kind: EvidenceKind;
  capturedAt: string;
  providerTimestamp?: string;
  completeness: EvidenceCompleteness;
  reference: string;
}

export interface JourneyAssessmentInput {
  request: ValidatedJourneyCheckRequest;
  checkedAtMs: number;
  dataMode: JourneyDataMode;
  route: JourneyRoute | null;
  protectedEvent: ProtectedEvent | null;
  transferMinutes: number;
  evidence: EvidenceRecord[];
}

export interface JourneyEvaluationPolicy {
  maxEvidenceAgeSeconds: number;
}

export interface JourneyReason {
  code:
    | 'BUFFER_SATISFIED'
    | 'BUFFER_SHORTFALL'
    | 'CONNECTION_MISSED'
    | 'NO_MATCHING_ROUTE'
    | 'PROTECTED_EVENT_NOT_MATCHED'
    | 'SERVICE_CANCELLED'
    | 'SERVICE_DISRUPTED'
    | 'ARRIVALS_EMPTY_UNKNOWN'
    | 'EVIDENCE_STALE'
    | 'EVIDENCE_INCOMPLETE'
    | 'EVIDENCE_CONTRADICTORY'
    | 'PROVIDER_UNAVAILABLE'
    | 'PROVIDER_RATE_LIMITED'
    | 'TIME_AMBIGUOUS'
    | 'INPUT_AMBIGUOUS';
  message: string;
}

export interface JourneyEvidenceResult extends EvidenceRecord {
  ageSeconds: number | null;
}

export interface JourneyMargin {
  arrivalAt: string;
  transferMinutes: number;
  safetyBufferMinutes: number;
  availableMinutes: number;
  remainingAfterBufferMinutes: number;
}

export interface JourneyProtectedEventResult {
  kind: ProtectedDepartureKind;
  at: string;
  station: string;
  matchStatus: ProtectedEventMatchStatus;
  serviceLabel?: string;
}

export interface JourneyCheckResponse {
  contractVersion: typeof journeyContractVersion;
  status: JourneyCheckStatus;
  dataMode: JourneyDataMode;
  checkedAt: string;
  summary: string;
  nextAction: string;
  liveJourneyVerified: boolean;
  protectedEvent: JourneyProtectedEventResult | null;
  margin: JourneyMargin | null;
  route: JourneyRoute | null;
  reasons: JourneyReason[];
  evidence: JourneyEvidenceResult[];
  warnings: string[];
}
