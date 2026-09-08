export const journeyContractVersion = 'journey-check.v0.2' as const;

export type JourneyCheckStatus =
  'viable' | 'tight' | 'not_viable' | 'unable_to_verify';

export type JourneyDataMode = 'fixture' | 'live' | 'cache';

export type EvidenceSource =
  | 'tfl_journey_planner'
  | 'tfl_timetable'
  | 'tfl_arrivals'
  | 'tfl_line_status'
  | 'tfl_stop_point_disruption'
  | 'tfl_stop_point_structure'
  | 'fixture';

export type EvidenceKind =
  | 'journey_plan'
  | 'timetable'
  | 'arrivals'
  | 'line_status'
  | 'stop_point_disruption'
  | 'stop_point_structure';

export type EvidenceCompleteness = 'sufficient' | 'partial';

export interface JourneyLocationInput {
  name: string;
  tflStopPointId?: string;
}

export interface JourneyDestinationInput {
  name: string;
  tflStopPointId?: string;
}

export type JourneyDeadlineSource =
  'user_input' | 'derived_from_onward_departure';

export interface JourneyCheckRequestInput {
  origin: JourneyLocationInput;
  destination: JourneyDestinationInput;
  arriveBy?: string;
  onwardDepartureAt?: string;
  stationTransferMinutes?: number;
  safetyBufferMinutes: number;
  constraints?: JourneyConstraintsInput;
}

export interface JourneyConstraintsInput {
  walkingMinutesLimit?: number;
  stepFreeRequired?: boolean;
}

export interface ValidatedJourneyDeadline {
  arriveBy: string;
  arriveByAtMs: number;
  source: JourneyDeadlineSource;
  onwardDepartureAt?: string;
  onwardDepartureAtMs?: number;
  stationTransferMinutes?: number;
}

export interface ValidatedJourneyCheckRequest {
  origin: JourneyLocationInput;
  destination: JourneyDestinationInput;
  deadline: ValidatedJourneyDeadline;
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
  transferMinutes: number;
  evidence: EvidenceRecord[];
  providerIssues: JourneyReason[];
}

export interface JourneyEvaluationPolicy {
  maxEvidenceAgeSeconds: number;
}

export interface JourneyReason {
  code:
    | 'BUFFER_SATISFIED'
    | 'BUFFER_SHORTFALL'
    | 'DEADLINE_MISSED'
    | 'NO_MATCHING_ROUTE'
    | 'STATION_NOT_REACHED'
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

export interface JourneyDeadlineResult {
  arriveBy: string;
  source: JourneyDeadlineSource;
  onwardDepartureAt: string | null;
  stationTransferMinutes: number | null;
}

export interface JourneyMargin {
  arrivalAt: string;
  transferMinutes: number;
  safetyBufferMinutes: number;
  availableMinutes: number;
  remainingAfterBufferMinutes: number;
}

export interface JourneyCheckResponse {
  contractVersion: typeof journeyContractVersion;
  status: JourneyCheckStatus;
  dataMode: JourneyDataMode;
  checkedAt: string;
  summary: string;
  nextAction: string;
  stationOnly: true;
  stationOnlyWarning: string;
  deadline: JourneyDeadlineResult;
  margin: JourneyMargin | null;
  route: JourneyRoute | null;
  reasons: JourneyReason[];
  evidence: JourneyEvidenceResult[];
  warnings: string[];
}
