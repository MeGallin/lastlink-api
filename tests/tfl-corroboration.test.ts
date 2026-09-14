import assert from 'node:assert/strict';
import { test } from 'node:test';
import type {
  ProviderHttpClient,
  ProviderHttpResult,
} from '../src/providers/http-client.js';
import { createTflCorroborationAdapter } from '../src/providers/tfl/corroboration.js';
import { validateJourneyCheckRequest } from '../src/journey/validation.js';
import type {
  JourneyRoute,
  ValidatedJourneyCheckRequest,
} from '../src/journey/types.js';

function request(): ValidatedJourneyCheckRequest {
  const result = validateJourneyCheckRequest({
    origin: { name: 'Stratford', tflStopPointId: '940GZZLUSTD' },
    destination: { name: 'Waterloo', tflStopPointId: '940GZZLUWLO' },
    arriveBy: '2026-09-07T00:35:00+01:00',
    safetyBufferMinutes: 5,
  });
  if (!result.ok) throw new Error(result.issues.join('; '));
  return result.value;
}

function route(
  overrides: Partial<JourneyRoute['legs'][number]> = {},
): JourneyRoute {
  return {
    arrivalAt: '2026-09-07T00:20:00+01:00',
    legs: [
      {
        mode: 'tube',
        lineName: 'Jubilee',
        lineId: 'jubilee',
        from: 'Stratford',
        fromTflStopPointId: '940GZZLUSTD',
        to: 'Waterloo',
        toTflStopPointId: '940GZZLUWLO',
        departureAt: '2026-09-06T23:45:00+01:00',
        arrivalAt: '2026-09-07T00:20:00+01:00',
        durationMinutes: 35,
        providerReference: 'tfl:journey:0:leg:0',
        ...overrides,
      },
    ],
  };
}

function successfulClient(urls: URL[]): ProviderHttpClient {
  return {
    async getJson(url): Promise<ProviderHttpResult> {
      urls.push(url);
      if (url.pathname.endsWith('/Arrivals')) {
        return { ok: true, status: 200, value: [{ lineId: 'jubilee' }] };
      }
      if (url.pathname.endsWith('/Status')) {
        return { ok: true, status: 200, value: [{ id: 'jubilee' }] };
      }
      return { ok: true, status: 200, value: { timetable: { routes: [] } } };
    },
  };
}

await test('best-effort corroboration records all available TfL feeds', async () => {
  const urls: URL[] = [];
  const adapter = createTflCorroborationAdapter({
    baseUrl: new URL('https://api.tfl.gov.uk'),
    appKey: 'synthetic-app-key',
    readClock: () => Date.parse('2026-09-06T22:30:42Z'),
    clients: {
      arrivals: successfulClient(urls),
      timetable: successfulClient(urls),
      lineStatus: successfulClient(urls),
    },
  });

  const result = await adapter.getEvidence(request(), route());

  assert.deepEqual(
    result.evidence.map(({ source, kind, completeness, reference }) => ({
      source,
      kind,
      completeness,
      reference,
    })),
    [
      {
        source: 'tfl_arrivals',
        kind: 'arrivals',
        completeness: 'sufficient',
        reference: 'tfl:arrivals',
      },
      {
        source: 'tfl_timetable',
        kind: 'timetable',
        completeness: 'sufficient',
        reference: 'tfl:timetable',
      },
      {
        source: 'tfl_line_status',
        kind: 'line_status',
        completeness: 'sufficient',
        reference: 'tfl:line_status',
      },
    ],
  );
  assert.deepEqual(result.warnings, []);
  assert.deepEqual(
    urls.map(({ pathname }) => pathname).sort(),
    [
      '/Line/jubilee/Status',
      '/Line/jubilee/Timetable/940GZZLUSTD/940GZZLUWLO',
      '/StopPoint/940GZZLUSTD/Arrivals',
    ].sort(),
  );
  assert.equal(urls[0]?.searchParams.get('app_key'), 'synthetic-app-key');
});

await test('best-effort corroboration reports unavailable feeds without failing the route', async () => {
  const unavailableClient: ProviderHttpClient = {
    async getJson(): Promise<ProviderHttpResult> {
      return {
        ok: false,
        failure: {
          code: 'PROVIDER_UNAVAILABLE',
          message: 'safe provider failure',
        },
      };
    },
  };
  const adapter = createTflCorroborationAdapter({
    baseUrl: new URL('https://api.tfl.gov.uk'),
    clients: {
      arrivals: unavailableClient,
      timetable: unavailableClient,
      lineStatus: unavailableClient,
    },
    readClock: () => Date.parse('2026-09-06T22:30:42Z'),
  });

  const result = await adapter.getEvidence(request(), route());

  assert.deepEqual(result.evidence, []);
  assert.deepEqual(result.warnings, [
    'TfL live-arrival corroboration was unavailable.',
    'TfL timetable corroboration was unavailable.',
    'TfL line-status corroboration was unavailable.',
  ]);
});

await test('corroboration skips routes without a usable transit identity', async () => {
  let calls = 0;
  const client: ProviderHttpClient = {
    async getJson(): Promise<ProviderHttpResult> {
      calls += 1;
      return { ok: true, status: 200, value: [] };
    },
  };
  const adapter = createTflCorroborationAdapter({
    baseUrl: new URL('https://api.tfl.gov.uk'),
    clients: { arrivals: client, timetable: client, lineStatus: client },
  });

  const incompleteRoute = route();
  const incompleteLeg = incompleteRoute.legs[0];
  if (incompleteLeg === undefined) throw new Error('test route missing');
  delete incompleteLeg.lineId;
  delete incompleteLeg.fromTflStopPointId;
  const result = await adapter.getEvidence(request(), incompleteRoute);

  assert.deepEqual(result, { evidence: [], warnings: [] });
  assert.equal(calls, 0);
});
