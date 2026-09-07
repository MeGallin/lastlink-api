import { Router, json } from 'express';
import { createJsonErrorHandler, requireJson } from '../http/json-errors.js';
import { assessDemoMargin } from './margin.js';
import { demoWarning, scenarios } from './scenarios.js';

interface DemoRequest {
  scenarioId: string;
  safetyBufferMinutes: number;
}

function isDemoRequest(value: unknown): value is DemoRequest {
  if (typeof value !== 'object' || value === null || Array.isArray(value))
    return false;
  const body = value as Record<string, unknown>;
  return (
    Object.keys(body).length === 2 &&
    typeof body.scenarioId === 'string' &&
    body.scenarioId.length > 0 &&
    body.scenarioId.length <= 100 &&
    typeof body.safetyBufferMinutes === 'number' &&
    Number.isInteger(body.safetyBufferMinutes) &&
    body.safetyBufferMinutes >= 0 &&
    body.safetyBufferMinutes <= 60
  );
}

export function createDemoRouter() {
  const router = Router();
  router.use((_request, response, next) => {
    response.set('Cache-Control', 'no-store');
    next();
  });

  router.get('/scenarios', (_request, response) => {
    response.json({ dataMode: 'fixture', warning: demoWarning, scenarios });
  });

  router.post(
    '/journey-check',
    requireJson,
    json({ limit: '4kb' }),
    (request, response) => {
      const body: unknown = request.body;
      if (!isDemoRequest(body)) {
        response.status(400).json({
          error: {
            code: 'INVALID_INPUT',
            message:
              'Provide only scenarioId and safetyBufferMinutes (integer 0–60).',
          },
        });
        return;
      }
      const scenario = scenarios.find((item) => item.id === body.scenarioId);
      if (!scenario) {
        response.status(404).json({
          error: {
            code: 'SCENARIO_NOT_FOUND',
            message: 'Unknown demo scenario',
          },
        });
        return;
      }
      response.json({
        dataMode: 'fixture',
        warning: demoWarning,
        liveJourneyVerified: false,
        scenario,
        simulation: assessDemoMargin({
          arrivalMs: Date.parse(scenario.arrivalAt),
          departureMs: Date.parse(scenario.protectedDepartureAt),
          additionalTransferMinutes: scenario.additionalTransferMinutes,
          safetyBufferMinutes: body.safetyBufferMinutes,
        }),
      });
    },
  );

  // Do not leak submitted bodies, stack traces or parser details.
  router.use(createJsonErrorHandler('JSON body exceeds 4kb'));
  return router;
}
