import type {
  JourneyPlannerAdapter,
  NormalizedJourneyPlan,
  ProviderSnapshot,
} from '../contracts.js';
import type { ProviderHttpClient } from '../http-client.js';
import { parseExplicitInstant } from '../../journey/time.js';
import { buildTflJourneyPlannerRequest } from './journey-request.js';
import { normalizeTflJourneyPlannerResponse } from './journey-response.js';
import {
  rankTflJourneyCandidates,
  type RankedTflJourneyCandidate,
} from './journey-ranking.js';

export interface TflJourneyPlannerAdapterOptions {
  baseUrl: URL;
  appKey?: string;
  /** Deliberately injected; this slice must not create an accidental live client. */
  client: ProviderHttpClient;
  transferMinutes: number;
  readClock?: () => number;
}

const evidenceReference = 'tfl:journey-planner';

/**
 * Compose the credential-free request, transport, normalizer and provisional
 * ranking seams. The live HTTP route must still choose when this adapter is
 * allowed to run and how its evidence is combined with other providers.
 */
export function createTflJourneyPlannerAdapter(
  options: TflJourneyPlannerAdapterOptions,
): JourneyPlannerAdapter {
  validateTransferMinutes(options.transferMinutes);
  const readClock = options.readClock ?? Date.now;

  return {
    async getPlan(request): Promise<ProviderSnapshot<NormalizedJourneyPlan>> {
      const outbound = buildTflJourneyPlannerRequest(request, {
        baseUrl: options.baseUrl,
        ...(options.appKey === undefined ? {} : { appKey: options.appKey }),
      });
      const response = await options.client.getJson(outbound.url);
      if (!response.ok) {
        return {
          dataMode: 'live',
          value: null,
          evidence: [],
          failure: response.failure,
        };
      }

      const capturedAt = readClock();
      if (!Number.isFinite(capturedAt)) {
        return unavailableSnapshot('Provider capture time was invalid.');
      }
      const evidence = [journeyEvidence(capturedAt, 'partial')];
      const normalized = normalizeTflJourneyPlannerResponse(response.value);
      if (!normalized.ok) {
        if (normalized.code === 'NO_JOURNEYS') {
          return {
            dataMode: 'live',
            value: { route: null, transferMinutes: options.transferMinutes },
            evidence,
          };
        }
        return {
          dataMode: 'live',
          value: null,
          evidence,
          failure: {
            code: 'PROVIDER_UNAVAILABLE',
            message: 'Provider returned an invalid journey result.',
          },
        };
      }

      const ranked = rankTflJourneyCandidates(normalized.value.candidates, {
        protectedDepartureAtMs: request.protectedDeparture.atMs,
        transferMinutes: options.transferMinutes,
        safetyBufferMinutes: request.safetyBufferMinutes,
      });
      if (!ranked.ok) {
        return unavailableSnapshot('Provider journey candidates were invalid.');
      }
      const selected = selectCatchableCandidate(
        ranked.rankedCandidates,
        capturedAt,
        request.constraints.walkingMinutesLimit,
        request.constraints.stepFreeRequired,
      );
      if (selected === undefined) {
        return {
          dataMode: 'live',
          value: { route: null, transferMinutes: options.transferMinutes },
          evidence,
        };
      }

      return {
        dataMode: 'live',
        value: {
          route: selected.candidate.route,
          transferMinutes: options.transferMinutes,
        },
        evidence: [journeyEvidence(capturedAt, 'sufficient')],
      };
    },
  };
}

function selectCatchableCandidate(
  candidates: readonly RankedTflJourneyCandidate[],
  capturedAtMs: number,
  walkingMinutesLimit: number | undefined,
  stepFreeRequired: boolean,
) {
  for (const ranked of candidates) {
    const firstLeg = ranked.candidate.route.legs[0];
    const departureAtMs =
      firstLeg === undefined
        ? undefined
        : parseExplicitInstant(firstLeg.departureAt)?.atMs;
    if (departureAtMs === undefined || departureAtMs < capturedAtMs) {
      continue;
    }
    const walkingMinutes = ranked.candidate.route.walkingMinutes;
    if (
      walkingMinutesLimit !== undefined &&
      (walkingMinutes === undefined || walkingMinutes > walkingMinutesLimit)
    ) {
      continue;
    }
    if (
      stepFreeRequired &&
      ranked.candidate.route.stepFreeAvailable === false
    ) {
      continue;
    }
    return ranked;
  }
  return undefined;
}

function validateTransferMinutes(value: number): void {
  if (!Number.isInteger(value) || value < 0 || value > 180) {
    throw new Error('transferMinutes must be an integer from 0 through 180');
  }
}

function journeyEvidence(
  capturedAtMs: number,
  completeness: 'sufficient' | 'partial',
) {
  return {
    source: 'tfl_journey_planner' as const,
    kind: 'journey_plan' as const,
    capturedAt: new Date(capturedAtMs).toISOString(),
    completeness,
    reference: evidenceReference,
  };
}

function unavailableSnapshot(
  message: string,
): ProviderSnapshot<NormalizedJourneyPlan> {
  return {
    dataMode: 'live',
    value: null,
    evidence: [],
    failure: { code: 'PROVIDER_UNAVAILABLE', message },
  };
}
