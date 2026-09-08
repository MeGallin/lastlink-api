import type { ValidatedJourneyCheckRequest } from '../../journey/types.js';

export interface TflJourneyPlannerRequestOptions {
  baseUrl: URL;
  appKey?: string;
}

export interface TflJourneyPlannerRequest {
  /** Internal cache/budget key. It deliberately excludes the TfL app key. */
  requestKey: string;
  /** Keep this URL inside the server-side transport; never expose or log it. */
  url: URL;
}

export function buildTflJourneyPlannerRequest(
  request: ValidatedJourneyCheckRequest,
  options: TflJourneyPlannerRequestOptions,
): TflJourneyPlannerRequest {
  validateBaseUrl(options.baseUrl);
  if (options.appKey !== undefined && options.appKey.trim() === '') {
    throw new Error('appKey must be a non-empty string when provided');
  }

  const from = request.origin.tflStopPointId ?? request.origin.name;
  const to = request.destination.name;
  const endpoint = new URL(options.baseUrl.toString());
  const pathPrefix = endpoint.pathname.replace(/\/+$/, '');
  endpoint.pathname = `${pathPrefix}/Journey/JourneyResults/${encodeURIComponent(from)}/to/${encodeURIComponent(to)}`;
  endpoint.search = '';
  endpoint.hash = '';

  const { date, time } = extractArrivalDateAndTime(request);
  endpoint.searchParams.set('date', date);
  endpoint.searchParams.set('time', time);
  endpoint.searchParams.set('timeIs', 'Arriving');
  endpoint.searchParams.set('journeyPreference', 'LeastTime');
  endpoint.searchParams.set('includeAlternativeRoutes', 'true');
  endpoint.searchParams.set('useRealTimeLiveArrivals', 'true');
  endpoint.searchParams.set('routeBetweenEntrances', 'true');
  endpoint.searchParams.set('combineTransferLegs', 'true');

  const walkingLimit = request.constraints.walkingMinutesLimit;
  if (walkingLimit !== undefined) {
    endpoint.searchParams.set('maxWalkingMinutes', String(walkingLimit));
  }
  if (request.constraints.stepFreeRequired) {
    endpoint.searchParams.set('accessibilityPreference', 'StepFreeToPlatform');
  }

  const requestKey = endpoint.toString();
  if (options.appKey !== undefined) {
    endpoint.searchParams.set('app_key', options.appKey);
  }

  return { requestKey, url: endpoint };
}

function validateBaseUrl(baseUrl: URL): void {
  if (baseUrl.protocol !== 'https:') {
    throw new Error('baseUrl must use HTTPS');
  }
  if (baseUrl.username || baseUrl.password) {
    throw new Error('baseUrl must not contain credentials');
  }
  if (baseUrl.search || baseUrl.hash) {
    throw new Error('baseUrl must not contain query or fragment data');
  }
}

function extractArrivalDateAndTime(request: ValidatedJourneyCheckRequest): {
  date: string;
  time: string;
} {
  if (!Number.isFinite(request.protectedDeparture.atMs)) {
    throw new Error('protected departure instant must be finite');
  }

  const local = formatLondonDateTime(request.protectedDeparture.atMs);
  if (
    local ===
      formatLondonDateTime(request.protectedDeparture.atMs - 60 * 60 * 1000) ||
    local ===
      formatLondonDateTime(request.protectedDeparture.atMs + 60 * 60 * 1000)
  ) {
    throw new Error(
      'protected departure local time is ambiguous in Europe/London',
    );
  }

  const separator = local.indexOf('T');
  if (separator === -1) {
    throw new Error('could not separate London local date and time');
  }
  return {
    date: local.slice(0, separator).replaceAll('-', ''),
    time: local.slice(separator + 1).replace(':', ''),
  };
}

function formatLondonDateTime(atMs: number): string {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/London',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date(atMs));
  const values = new Map(
    parts
      .filter((part) => part.type !== 'literal')
      .map((part) => [part.type, part.value]),
  );
  const year = values.get('year');
  const month = values.get('month');
  const day = values.get('day');
  const hour = values.get('hour');
  const minute = values.get('minute');
  if (
    year === undefined ||
    month === undefined ||
    day === undefined ||
    hour === undefined ||
    minute === undefined
  ) {
    throw new Error('could not format protected departure in Europe/London');
  }
  return `${year}-${month}-${day}T${hour}:${minute}`;
}
