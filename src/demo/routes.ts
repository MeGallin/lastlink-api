import { Router, json } from 'express';
import type { ErrorRequestHandler } from 'express';
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
    (request, response, next) => {
      if (!request.is('application/json')) {
        response.status(415).json({
          error: {
            code: 'UNSUPPORTED_MEDIA_TYPE',
            message: 'Use application/json',
          },
        });
        return;
      }
      next();
    },
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
  const handleError: ErrorRequestHandler = (
    error: unknown,
    _request,
    response,
    next,
  ) => {
    if (response.headersSent) {
      next(error);
      return;
    }
    const type =
      typeof error === 'object' && error !== null && 'type' in error
        ? error.type
        : undefined;
    const status =
      typeof error === 'object' && error !== null && 'status' in error
        ? error.status
        : undefined;
    if (type === 'entity.too.large') {
      response.status(413).json({
        error: {
          code: 'PAYLOAD_TOO_LARGE',
          message: 'JSON body exceeds 4kb',
        },
      });
    } else if (status === 415) {
      response.status(415).json({
        error: {
          code: 'UNSUPPORTED_MEDIA_TYPE',
          message: 'Unsupported JSON encoding',
        },
      });
    } else if (status === 400) {
      response.status(400).json({
        error: { code: 'INVALID_JSON', message: 'Invalid JSON body' },
      });
    } else {
      response.status(500).json({
        error: { code: 'INTERNAL_ERROR', message: 'Unexpected server error' },
      });
    }
  };
  router.use(handleError);
  return router;
}
