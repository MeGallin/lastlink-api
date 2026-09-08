import { parseExplicitInstant } from '../journey/time.js';
import type {
  EvidenceRecord,
  ProtectedEvent,
  ValidatedJourneyCheckRequest,
} from '../journey/types.js';

export interface ProtectedDepartureCandidate {
  event: ProtectedEvent;
  evidence: EvidenceRecord[];
}

export type ProtectedDepartureMatchResult =
  | { ok: true; match: ProtectedDepartureCandidate }
  | {
      ok: false;
      code: 'NO_MATCH' | 'AMBIGUOUS';
      /** Safe matcher-owned text; never include provider payloads. */
      message: string;
    };

/**
 * Match normalized protected-departure candidates to the request without
 * inventing a service identity from a display label. Provider adapters remain
 * responsible for producing candidates and evidence; this helper only applies
 * the shared station, CRS, kind, instant and reconciliation rules.
 */
export function matchProtectedDeparture(
  request: ValidatedJourneyCheckRequest,
  candidates: readonly ProtectedDepartureCandidate[],
): ProtectedDepartureMatchResult {
  const exactCandidates = candidates.filter((candidate) =>
    matchesRequestedIdentity(candidate.event, request),
  );
  const ambiguousCandidates = exactCandidates.filter(
    ({ event }) =>
      event.matchStatus === 'ambiguous' ||
      event.serviceDateMatch === 'ambiguous',
  );
  const eligibleCandidates = exactCandidates.filter(
    ({ event }) =>
      event.matchStatus === 'matched' && event.serviceDateMatch === 'matched',
  );

  if (ambiguousCandidates.length > 0) {
    return {
      ok: false,
      code: 'AMBIGUOUS',
      message: 'The protected departure match is ambiguous.',
    };
  }
  if (eligibleCandidates.length === 0) {
    return {
      ok: false,
      code: 'NO_MATCH',
      message: 'No protected departure matched the requested event.',
    };
  }
  if (eligibleCandidates.length > 1) {
    return {
      ok: false,
      code: 'AMBIGUOUS',
      message: 'More than one protected departure matched the request.',
    };
  }

  const match = eligibleCandidates[0];
  if (match === undefined) {
    throw new Error('Protected departure match unexpectedly missing');
  }
  return { ok: true, match };
}

function matchesRequestedIdentity(
  event: ProtectedEvent,
  request: ValidatedJourneyCheckRequest,
): boolean {
  const eventAtMs = parseExplicitInstant(event.at)?.atMs;
  return (
    eventAtMs === request.protectedDeparture.atMs &&
    event.kind === request.protectedDeparture.kind &&
    sameStation(event.station, request.destination.name) &&
    (request.destination.nationalRailCrs === undefined ||
      event.nationalRailCrs === request.destination.nationalRailCrs)
  );
}

function sameStation(left: string, right: string): boolean {
  return left.trim().toLowerCase() === right.trim().toLowerCase();
}
