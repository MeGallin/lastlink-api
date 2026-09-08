import type { JourneyProviderConfig } from '../config.js';
import {
  createProviderHttpClient,
  type ProviderHttpClient,
} from '../providers/http-client.js';
import { createProviderRequestBudget } from '../providers/request-budget.js';
import { createTflJourneyPlannerAdapter } from '../providers/tfl/journey-adapter.js';
import { buildJourneyAssessment } from './assessment.js';
import { createFixtureAssessment } from './fixture-adapter.js';
import type {
  JourneyAssessmentInput,
  ValidatedJourneyCheckRequest,
} from './types.js';

export type AssessmentService = (
  request: ValidatedJourneyCheckRequest,
) => Promise<JourneyAssessmentInput>;

export function createAssessmentService(
  config: JourneyProviderConfig,
  client?: ProviderHttpClient,
  readClock: () => number = Date.now,
): AssessmentService {
  if (config.mode === 'fixture') return createFixtureAssessment;
  const transport = client ?? createProviderHttpClient();
  return async (request) => {
    // Counters belong to one evaluation, never to the process or another user.
    const budget = createProviderRequestBudget({
      journeyPlanner: 1,
      timetable: 0,
      arrivals: 0,
      lineStatus: 0,
      stopDisruption: 0,
    });
    let attempt = 0;
    const adapter = createTflJourneyPlannerAdapter({
      baseUrl: new URL('https://api.tfl.gov.uk'),
      appKey: config.appKey,
      transferMinutes: 0, // The request already accounts for the user's station transfer.
      readClock,
      client: {
        async getJson(url) {
          const reservation = budget.reserve(
            'journeyPlanner',
            String(++attempt),
          );
          if (!reservation.allowed) {
            return {
              ok: false,
              failure: {
                code: 'PROVIDER_UNAVAILABLE',
                message: 'Journey request budget exhausted.',
              },
            };
          }
          return transport.getJson(url);
        },
      },
    });
    return buildJourneyAssessment(
      request,
      {
        journeyPlanner: {
          async getPlan(input) {
            try {
              return await adapter.getPlan(input);
            } catch {
              // Includes unrepresentable London query times; never expose URLs or keys.
              return {
                dataMode: 'live',
                value: null,
                evidence: [],
                failure: {
                  code: 'PROVIDER_UNAVAILABLE',
                  message: 'Journey provider could not verify this request.',
                },
              };
            }
          },
        },
      },
      readClock,
    );
  };
}
