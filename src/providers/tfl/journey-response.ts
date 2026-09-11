import type {
  JourneyLegInstructions,
  JourneyLegNotice,
  JourneyLegNoticeKind,
  JourneyRoute,
  JourneyRouteLeg,
  RouteMode,
} from '../../journey/types.js';
import { parseTflInstant as parseProviderInstant } from './time.js';

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
        'search criteria date/time must resolve to an unambiguous instant',
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
      'journey start and arrival times must resolve to unambiguous instants',
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
    arrivalAt: arrival.text,
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
  const from = readPoint(rawLeg.departurePoint);
  const to = readPoint(rawLeg.arrivalPoint);
  const mode = readMode(rawLeg.mode);
  const lineName = readLineName(rawLeg.routeOptions);
  const directions = readDirections(rawLeg.routeOptions);
  const scheduledDeparture = readOptionalProviderInstant(
    rawLeg.scheduledDepartureTime,
  );
  const scheduledArrival = readOptionalProviderInstant(
    rawLeg.scheduledArrivalTime,
  );
  const instructions = readInstructions(rawLeg.instruction);
  const notices = readLegNotices(
    rawLeg.disruptions,
    rawLeg.plannedWorks,
    rawLeg.isDisrupted,
  );
  const durationMinutes = rawLeg.duration;
  if (
    departure === undefined ||
    arrival === undefined ||
    from === undefined ||
    to === undefined ||
    mode === undefined ||
    scheduledDeparture === invalidOptionalInstant ||
    scheduledArrival === invalidOptionalInstant ||
    !isFiniteInteger(durationMinutes) ||
    durationMinutes < 0
  ) {
    return invalidResponse('journey leg is missing required normalized fields');
  }
  if (arrival.atMs < departure.atMs) {
    return invalidResponse('journey leg arrival cannot precede departure');
  }
  if (
    scheduledDeparture !== undefined &&
    scheduledArrival !== undefined &&
    scheduledArrival.atMs < scheduledDeparture.atMs
  ) {
    return invalidResponse(
      'scheduled journey leg arrival cannot precede departure',
    );
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
        ...(lineName === undefined ? {} : { lineName }),
        ...(directions === undefined ? {} : { directions }),
        from: from.name,
        ...(from.tflStopPointId === undefined
          ? {}
          : { fromTflStopPointId: from.tflStopPointId }),
        ...(from.interchangeId === undefined
          ? {}
          : { fromInterchangeId: from.interchangeId }),
        to: to.name,
        ...(to.tflStopPointId === undefined
          ? {}
          : { toTflStopPointId: to.tflStopPointId }),
        ...(to.interchangeId === undefined
          ? {}
          : { toInterchangeId: to.interchangeId }),
        departureAt: departure.text,
        arrivalAt: arrival.text,
        ...(scheduledDeparture === undefined
          ? {}
          : { scheduledDepartureAt: scheduledDeparture.text }),
        ...(scheduledArrival === undefined
          ? {}
          : { scheduledArrivalAt: scheduledArrival.text }),
        ...(instructions === undefined ? {} : { instructions }),
        ...(notices === undefined ? {} : { notices }),
        durationMinutes,
        providerReference: `tfl:journey:${journeyIndex}:leg:${legIndex}`,
      },
    },
  };
}

interface TflPointIdentity {
  name: string;
  tflStopPointId?: string;
  interchangeId?: string;
}

function readPoint(value: unknown): TflPointIdentity | undefined {
  if (!isRecord(value)) return undefined;
  let name: string | undefined;
  for (const field of ['commonName', 'name', 'stationName', 'description']) {
    const candidate = value[field];
    if (typeof candidate === 'string' && candidate.trim() !== '') {
      name = candidate.trim();
      break;
    }
  }
  if (name === undefined) return undefined;
  const tflStopPointId = readOptionalText(value.naptanId);
  const interchangeId = readOptionalText(value.icsCode);
  return {
    name,
    ...(tflStopPointId === undefined ? {} : { tflStopPointId }),
    ...(interchangeId === undefined ? {} : { interchangeId }),
  };
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

function readLineName(value: unknown): string | undefined {
  if (!Array.isArray(value)) return undefined;
  for (const option of value) {
    if (!isRecord(option)) continue;
    const name = option.name;
    if (typeof name === 'string' && name.trim() !== '') return name.trim();
  }
  return undefined;
}

function readDirections(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const directions = value.flatMap((option) => {
    if (!isRecord(option) || !Array.isArray(option.directions)) return [];
    return option.directions.filter(
      (direction): direction is string =>
        typeof direction === 'string' && direction.trim() !== '',
    );
  });
  const uniqueDirections = [
    ...new Set(directions.map((direction) => direction.trim())),
  ];
  return uniqueDirections.length > 0 ? uniqueDirections : undefined;
}

function readOptionalProviderInstant(value: unknown) {
  if (value === undefined || value === null) return undefined;
  const parsed = parseProviderInstant(value);
  return parsed ?? invalidOptionalInstant;
}

const invalidOptionalInstant = Symbol('invalidOptionalInstant');

function readInstructions(value: unknown): JourneyLegInstructions | undefined {
  if (!isRecord(value)) return undefined;
  const summary = readOptionalText(value.summary);
  const detailed = readOptionalText(value.detailed);
  const steps = Array.isArray(value.steps)
    ? value.steps.flatMap((step) => {
        if (!isRecord(step)) return [];
        const description = readOptionalText(step.description);
        return description === undefined ? [] : [description];
      })
    : undefined;
  if (
    summary === undefined &&
    detailed === undefined &&
    (steps === undefined || steps.length === 0)
  ) {
    return undefined;
  }
  return {
    ...(summary === undefined ? {} : { summary }),
    ...(detailed === undefined ? {} : { detailed }),
    ...(steps === undefined || steps.length === 0 ? {} : { steps }),
  };
}

const maxNoticeTextLength = 240;
const maxNoticesPerLeg = 4;

function readLegNotices(
  disruptions: unknown,
  plannedWorks: unknown,
  isDisrupted: unknown,
): JourneyLegNotice[] | undefined {
  const notices = readProviderNotices(disruptions, 'disruption');
  if (notices.length === 0 && isDisrupted === true) {
    notices.push({
      kind: 'disruption',
      text: 'TfL marks this leg as disrupted; check current station information.',
    });
  }
  notices.push(...readProviderNotices(plannedWorks, 'planned_work'));
  const uniqueNotices = notices.filter(
    (notice, index, all) =>
      all.findIndex(
        (candidate) =>
          candidate.kind === notice.kind && candidate.text === notice.text,
      ) === index,
  );
  return uniqueNotices.length > 0
    ? uniqueNotices.slice(0, maxNoticesPerLeg)
    : undefined;
}

function readProviderNotices(
  value: unknown,
  kind: JourneyLegNoticeKind,
): JourneyLegNotice[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!isRecord(item)) return [];
    const text = [
      item.summary,
      item.description,
      item.additionalInfo,
      item.closureText,
      item.reason,
    ]
      .map(readOptionalText)
      .find((candidate): candidate is string => candidate !== undefined);
    if (text === undefined) return [];
    return [{ kind, text: text.slice(0, maxNoticeTextLength) }];
  });
}

function readOptionalText(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() !== ''
    ? value.trim()
    : undefined;
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
