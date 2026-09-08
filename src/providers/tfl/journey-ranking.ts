import { parseExplicitInstant } from '../../journey/time.js';
import type { TflJourneyPlannerCandidate } from './journey-response.js';

export interface TflJourneyRankingOptions {
  protectedDepartureAtMs: number;
  /** Supplied by a reviewed caller; this module never invents it. */
  transferMinutes: number;
  safetyBufferMinutes: number;
}

export interface RankedTflJourneyCandidate {
  candidate: TflJourneyPlannerCandidate;
  candidateIndex: number;
  arrivalAtMs: number;
  availableMinutes: number;
  remainingAfterBufferMinutes: number;
}

export type TflJourneyRankingResult =
  | { ok: true; rankedCandidates: RankedTflJourneyCandidate[] }
  | {
      ok: false;
      code: 'INVALID_POLICY' | 'INVALID_CANDIDATE' | 'NO_CANDIDATES';
      /** Safe policy-owned text; never include provider payloads. */
      message: string;
    };

/**
 * Rank candidates by the deterministic margin that a caller supplied policy
 * produces. This returns every candidate; it does not itself declare viability.
 */
export function rankTflJourneyCandidates(
  candidates: readonly TflJourneyPlannerCandidate[],
  options: TflJourneyRankingOptions,
): TflJourneyRankingResult {
  if (candidates.length === 0) {
    return {
      ok: false,
      code: 'NO_CANDIDATES',
      message: 'No journey candidates were provided',
    };
  }
  if (!Number.isFinite(options.protectedDepartureAtMs)) {
    return invalidPolicy('protected departure instant must be finite');
  }
  if (
    !Number.isInteger(options.transferMinutes) ||
    options.transferMinutes < 0 ||
    options.transferMinutes > 180
  ) {
    return invalidPolicy(
      'transferMinutes must be an integer from 0 through 180',
    );
  }
  if (
    !Number.isInteger(options.safetyBufferMinutes) ||
    options.safetyBufferMinutes < 0 ||
    options.safetyBufferMinutes > 60
  ) {
    return invalidPolicy(
      'safetyBufferMinutes must be an integer from 0 through 60',
    );
  }

  const ranked: RankedTflJourneyCandidate[] = [];
  for (const [candidateIndex, candidate] of candidates.entries()) {
    const arrivalAtMs = parseExplicitInstant(candidate.route.arrivalAt)?.atMs;
    if (arrivalAtMs === undefined) {
      return {
        ok: false,
        code: 'INVALID_CANDIDATE',
        message: 'journey candidate has no explicit arrival instant',
      };
    }
    const availableMinutes =
      (options.protectedDepartureAtMs - arrivalAtMs) / 60000 -
      options.transferMinutes;
    ranked.push({
      candidate,
      candidateIndex,
      arrivalAtMs,
      availableMinutes,
      remainingAfterBufferMinutes:
        availableMinutes - options.safetyBufferMinutes,
    });
  }

  ranked.sort(compareRankedCandidates);
  return { ok: true, rankedCandidates: ranked };
}

function compareRankedCandidates(
  left: RankedTflJourneyCandidate,
  right: RankedTflJourneyCandidate,
): number {
  const statusDifference = statusRank(left) - statusRank(right);
  if (statusDifference !== 0) return statusDifference;
  if (left.remainingAfterBufferMinutes !== right.remainingAfterBufferMinutes) {
    return right.remainingAfterBufferMinutes - left.remainingAfterBufferMinutes;
  }
  if (left.arrivalAtMs !== right.arrivalAtMs) {
    return left.arrivalAtMs - right.arrivalAtMs;
  }
  return left.candidateIndex - right.candidateIndex;
}

function statusRank(candidate: RankedTflJourneyCandidate): number {
  if (candidate.availableMinutes <= 0) return 2;
  if (candidate.remainingAfterBufferMinutes < 0) return 1;
  return 0;
}

function invalidPolicy(message: string): {
  ok: false;
  code: 'INVALID_POLICY';
  message: string;
} {
  return { ok: false, code: 'INVALID_POLICY', message };
}
