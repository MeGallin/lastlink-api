import type {
  EvidenceRecord,
  JourneyRoute,
  JourneyRouteLeg,
  ValidatedJourneyCheckRequest,
} from '../../journey/types.js';
import type { JourneyCorroborationAdapter } from '../contracts.js';
import type { ProviderHttpClient } from '../http-client.js';

export interface TflCorroborationAdapterOptions {
  baseUrl: URL;
  appKey?: string;
  clients: {
    arrivals: ProviderHttpClient;
    timetable: ProviderHttpClient;
    lineStatus: ProviderHttpClient;
  };
  readClock?: () => number;
}

const transitModes = new Set(['tube', 'overground', 'rail', 'bus']);

export function createTflCorroborationAdapter(
  options: TflCorroborationAdapterOptions,
): JourneyCorroborationAdapter {
  validateBaseUrl(options.baseUrl);
  const readClock = options.readClock ?? Date.now;

  return {
    async getEvidence(
      _request: ValidatedJourneyCheckRequest,
      route: JourneyRoute,
      capturedAtMsOverride?: number,
    ) {
      const leg = findCorroboratableLeg(route);
      if (leg === undefined) return { evidence: [], warnings: [] };
      const fromStopPointId = leg.fromTflStopPointId;
      const toStopPointId = leg.toTflStopPointId;
      const lineId = lineIdForLeg(leg);
      if (
        fromStopPointId === undefined ||
        toStopPointId === undefined ||
        lineId === undefined
      ) {
        return { evidence: [], warnings: [] };
      }

      const capturedAtMs = capturedAtMsOverride ?? readClock();
      if (!Number.isFinite(capturedAtMs)) {
        return {
          evidence: [],
          warnings: ['Optional TfL corroboration had an invalid capture time.'],
        };
      }

      const [arrivals, timetable, lineStatus] = await Promise.all([
        readFeed(
          options.clients.arrivals,
          buildStopPointArrivalsUrl(
            options.baseUrl,
            fromStopPointId,
            options.appKey,
          ),
          'arrivals',
          capturedAtMs,
        ),
        readFeed(
          options.clients.timetable,
          buildLineTimetableUrl(
            options.baseUrl,
            lineId,
            fromStopPointId,
            toStopPointId,
            options.appKey,
          ),
          'timetable',
          capturedAtMs,
        ),
        readFeed(
          options.clients.lineStatus,
          buildLineStatusUrl(options.baseUrl, lineId, options.appKey),
          'line_status',
          capturedAtMs,
        ),
      ]);

      return {
        evidence: [arrivals, timetable, lineStatus]
          .filter((result) => result.evidence !== undefined)
          .map((result) => result.evidence!),
        warnings: [arrivals, timetable, lineStatus].flatMap((result) =>
          result.warning === undefined ? [] : [result.warning],
        ),
      };
    },
  };
}

function findCorroboratableLeg(
  route: JourneyRoute,
): JourneyRouteLeg | undefined {
  return route.legs.find(
    (leg) =>
      transitModes.has(leg.mode) &&
      leg.fromTflStopPointId !== undefined &&
      leg.toTflStopPointId !== undefined &&
      lineIdForLeg(leg) !== undefined,
  );
}

function lineIdForLeg(leg: JourneyRouteLeg): string | undefined {
  if (leg.lineId !== undefined && leg.lineId.trim() !== '') {
    return leg.lineId.trim();
  }
  if (leg.lineName === undefined || leg.lineName.trim() === '')
    return undefined;
  const fallback = leg.lineName
    .replace(/\s+line$/i, '')
    .trim()
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/g, '-');
  return fallback === '' ? undefined : fallback;
}

type FeedKind = 'arrivals' | 'timetable' | 'line_status';

function readFeed(
  client: ProviderHttpClient,
  url: URL,
  kind: FeedKind,
  capturedAtMs: number,
): Promise<{ evidence?: EvidenceRecord; warning?: string }> {
  return client.getJson(url).then((response) => {
    if (!response.ok || !hasUsefulPayload(response.value, kind)) {
      return { warning: unavailableMessage(kind) };
    }
    return {
      evidence: {
        source: sourceFor(kind),
        kind,
        capturedAt: new Date(capturedAtMs).toISOString(),
        completeness: 'sufficient',
        reference: `tfl:${kind}`,
      },
    };
  });
}

function hasUsefulPayload(value: unknown, kind: FeedKind): boolean {
  if (kind === 'arrivals' || kind === 'line_status') {
    return Array.isArray(value) && value.length > 0;
  }
  return isRecord(value) && Object.keys(value).length > 0;
}

function sourceFor(kind: FeedKind): EvidenceRecord['source'] {
  if (kind === 'arrivals') return 'tfl_arrivals';
  if (kind === 'timetable') return 'tfl_timetable';
  return 'tfl_line_status';
}

function unavailableMessage(kind: FeedKind): string {
  if (kind === 'arrivals')
    return 'TfL live-arrival corroboration was unavailable.';
  if (kind === 'timetable')
    return 'TfL timetable corroboration was unavailable.';
  return 'TfL line-status corroboration was unavailable.';
}

function buildStopPointArrivalsUrl(
  baseUrl: URL,
  stopPointId: string,
  appKey?: string,
): URL {
  const endpoint = baseUrlFor(
    baseUrl,
    `/StopPoint/${encodeURIComponent(stopPointId)}/Arrivals`,
  );
  addAppKey(endpoint, appKey);
  return endpoint;
}

function buildLineStatusUrl(
  baseUrl: URL,
  lineId: string,
  appKey?: string,
): URL {
  const endpoint = baseUrlFor(
    baseUrl,
    `/Line/${encodeURIComponent(lineId)}/Status`,
  );
  addAppKey(endpoint, appKey);
  return endpoint;
}

function buildLineTimetableUrl(
  baseUrl: URL,
  lineId: string,
  fromStopPointId: string,
  toStopPointId: string,
  appKey?: string,
): URL {
  const endpoint = baseUrlFor(
    baseUrl,
    `/Line/${encodeURIComponent(lineId)}/Timetable/${encodeURIComponent(fromStopPointId)}/${encodeURIComponent(toStopPointId)}`,
  );
  addAppKey(endpoint, appKey);
  return endpoint;
}

function baseUrlFor(baseUrl: URL, path: string): URL {
  const endpoint = new URL(baseUrl.toString());
  endpoint.pathname = `${endpoint.pathname.replace(/\/+$/, '')}${path}`;
  endpoint.search = '';
  endpoint.hash = '';
  return endpoint;
}

function addAppKey(endpoint: URL, appKey: string | undefined): void {
  if (appKey !== undefined) endpoint.searchParams.set('app_key', appKey);
}

function validateBaseUrl(baseUrl: URL): void {
  if (
    baseUrl.protocol !== 'https:' ||
    baseUrl.username ||
    baseUrl.password ||
    baseUrl.search ||
    baseUrl.hash
  ) {
    throw new Error(
      'baseUrl must be an HTTPS URL without credentials or query data',
    );
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
