import type {
  JourneyRoute,
  JourneyRouteLeg,
  RouteMode,
} from '../../journey/types.js';
import { parseExplicitInstant } from '../../journey/time.js';

/** The small subset of a TfL Journey Planner result used by this adapter seam. */
export interface TflJourneyPlannerCandidate {
  route: JourneyRoute;
  alternativeRoute: boolean;
}

export interface TflJourneyPlannerResponseValue {
  candidates: TflJourneyPlannerCandidate[];
  recommendedMaxAgeMinutes?: number;
  searchDateTime?: string;
  searchDateTimeType?: 'Arriving' | 'Departing';
}

export type TflJourneyPlannerResponseResult =
  | { ok: true; value: TflJourneyPlannerResponseValue }
  | {
      ok: false;
      code: 'INVALID_RESPONSE' | 'NO_JOURNEYS';
      /** Safe adapter-owned text; never include the raw provider payload. */
      message: string;
    };

export function normalizeTflJourneyPlannerResponse(
  payload: unknown,
): TflJourneyPlannerResponseResult {
  if (!isRecord(payload) || !Array.isArray(payload.journeys)) {
    return invalidResponse('response must contain a journeys array');
  }
  if (payload.journeys.length === 0) {
    return {
      ok: false,
      code: 'NO_JOURNEYS',
      message: 'TfL returned no journeys',
    };
  }

  const candidates: TflJourneyPlannerCandidate[] = [];
  for (const [journeyIndex, rawJourney] of payload.journeys.entries()) {
    const candidate = normalizeJourney(rawJourney, journeyIndex);
    if (!candidate.ok) return candidate;
    candidates.push(candidate.value);
  }

  const value: TflJourneyPlannerResponseValue = { candidates };
  if (
    payload.recommendedMaxAgeMinutes !== undefined &&
    (!isFiniteInteger(payload.recommendedMaxAgeMinutes) ||
      payload.recommendedMaxAgeMinutes < 0)
  ) {
    return invalidResponse('recommendedMaxAgeMinutes must be non-negative');
  }
  if (isFiniteInteger(payload.recommendedMaxAgeMinutes)) {
    value.recommendedMaxAgeMinutes = payload.recommendedMaxAgeMinutes;
  }
  if (
    payload.searchCriteria !== undefined &&
    payload.searchCriteria !== null &&
    !isRecord(payload.searchCriteria)
  ) {
    return invalidResponse('searchCriteria must be an object when provided');
  }
  const searchCriteria = isRecord(payload.searchCriteria)
    ? payload.searchCriteria
    : undefined;
  if (searchCriteria?.dateTime !== undefined) {
    const searchDateTime = parseProviderInstant(searchCriteria.dateTime);
    if (searchDateTime === undefined) {
      return invalidResponse(
        'search criteria date/time must include an offset',
      );
    }
    value.searchDateTime = searchDateTime.text;
  }
  if (
    searchCriteria?.dateTimeType === 'Arriving' ||
    searchCriteria?.dateTimeType === 'Departing'
  ) {
    value.searchDateTimeType = searchCriteria.dateTimeType;
  } else if (searchCriteria?.dateTimeType !== undefined) {
    return invalidResponse('search criteria date/time type is invalid');
  }
  return { ok: true, value };
}

function normalizeJourney(
  rawJourney: unknown,
  journeyIndex: number,
):
  | { ok: true; value: TflJourneyPlannerCandidate }
  | { ok: false; code: 'INVALID_RESPONSE'; message: string } {
  if (!isRecord(rawJourney) || !Array.isArray(rawJourney.legs)) {
    return invalidResponse('journey must contain a legs array');
  }
  if (rawJourney.legs.length === 0) {
    return invalidResponse('journey must contain at least one leg');
  }

  const start = parseProviderInstant(rawJourney.startDateTime);
  const arrival = parseProviderInstant(rawJourney.arrivalDateTime);
  if (start === undefined || arrival === undefined) {
    return invalidResponse(
      'journey start and arrival times must include offsets',
    );
  }
  if (arrival.atMs < start.atMs) {
    return invalidResponse('journey arrival cannot precede its start');
  }

  const legs: JourneyRouteLeg[] = [];
  let previousArrivalMs: number | undefined;
  let walkingMinutes = 0;
  for (const [legIndex, rawLeg] of rawJourney.legs.entries()) {
    const leg = normalizeLeg(rawLeg, journeyIndex, legIndex);
    if (!leg.ok) return leg;
    if (legIndex === 0 && leg.value.departureAtMs !== start.atMs) {
      return invalidResponse(
        'journey start must match the first leg departure',
      );
    }
    if (
      previousArrivalMs !== undefined &&
      leg.value.departureAtMs < previousArrivalMs
    ) {
      return invalidResponse('journey legs must be in chronological order');
    }
    previousArrivalMs = leg.value.arrivalAtMs;
    if (leg.value.mode === 'walk') walkingMinutes += leg.value.durationMinutes;
    legs.push(leg.value.routeLeg);
  }

  const finalLeg = legs.at(-1);
  if (
    finalLeg === undefined ||
    parseProviderInstant(finalLeg.arrivalAt)?.atMs !== arrival.atMs
  ) {
    return invalidResponse('journey arrival must match the final leg arrival');
  }

  const route: JourneyRoute = {
    legs,
    arrivalAt: rawJourney.arrivalDateTime as string,
    walkingMinutes,
  };
  return {
    ok: true,
    value: {
      route,
      alternativeRoute: rawJourney.alternativeRoute === true,
    },
  };
}

function normalizeLeg(
  rawLeg: unknown,
  journeyIndex: number,
  legIndex: number,
):
  | {
      ok: true;
      value: {
        routeLeg: JourneyRouteLeg;
        departureAtMs: number;
        mode: RouteMode;
        arrivalAtMs: number;
        durationMinutes: number;
      };
    }
  | { ok: false; code: 'INVALID_RESPONSE'; message: string } {
  if (!isRecord(rawLeg))
    return invalidResponse('journey leg must be an object');
  const departure = parseProviderInstant(rawLeg.departureTime);
  const arrival = parseProviderInstant(rawLeg.arrivalTime);
  const from = readPointName(rawLeg.departurePoint);
  const to = readPointName(rawLeg.arrivalPoint);
  const mode = readMode(rawLeg.mode);
  const durationMinutes = rawLeg.duration;
  if (
    departure === undefined ||
    arrival === undefined ||
    from === undefined ||
    to === undefined ||
    mode === undefined ||
    !isFiniteInteger(durationMinutes) ||
    durationMinutes < 0
  ) {
    return invalidResponse('journey leg is missing required normalized fields');
  }
  if (arrival.atMs < departure.atMs) {
    return invalidResponse('journey leg arrival cannot precede departure');
  }

  return {
    ok: true,
    value: {
      mode,
      departureAtMs: departure.atMs,
      arrivalAtMs: arrival.atMs,
      durationMinutes,
      routeLeg: {
        mode,
        from,
        to,
        departureAt: rawLeg.departureTime as string,
        arrivalAt: rawLeg.arrivalTime as string,
        durationMinutes,
        providerReference: `tfl:journey:${journeyIndex}:leg:${legIndex}`,
      },
    },
  };
}

function readPointName(value: unknown): string | undefined {
  if (!isRecord(value)) return undefined;
  for (const field of ['commonName', 'name', 'stationName', 'description']) {
    const candidate = value[field];
    if (typeof candidate === 'string' && candidate.trim() !== '') {
      return candidate;
    }
  }
  return undefined;
}

function readMode(value: unknown): RouteMode | undefined {
  if (!isRecord(value)) return undefined;
  const raw = [value.id, value.name, value.motType].find(
    (candidate): candidate is string =>
      typeof candidate === 'string' && candidate.trim() !== '',
  );
  if (raw === undefined) return undefined;
  const mode = raw.toLowerCase().replaceAll(/[^a-z]/g, '');
  if (mode === 'tube' || mode === 'underground') return 'tube';
  if (mode === 'overground') return 'overground';
  if (mode === 'rail' || mode === 'train' || mode === 'nationalrail') {
    return 'rail';
  }
  if (mode === 'bus' || mode === 'publicbus') return 'bus';
  if (mode === 'walking' || mode === 'walk') return 'walk';
  return 'other';
}

function parseProviderInstant(value: unknown) {
  return parseExplicitInstant(value);
}

function isFiniteInteger(value: unknown): value is number {
  return (
    typeof value === 'number' &&
    Number.isInteger(value) &&
    Number.isFinite(value)
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function invalidResponse(message: string): {
  ok: false;
  code: 'INVALID_RESPONSE';
  message: string;
} {
  return { ok: false, code: 'INVALID_RESPONSE', message };
}
