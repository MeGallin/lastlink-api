import { json, Router } from 'express';
import { createJsonErrorHandler, requireJson } from '../http/json-errors.js';
import { evaluateJourneyCheck } from '../journey/evaluator.js';
import { createFixtureAssessment } from '../journey/fixture-adapter.js';
import type { AssessmentService } from '../journey/assessment-service.js';
import type { JourneyCheckResponse } from '../journey/types.js';
import { validateJourneyCheckRequest } from '../journey/validation.js';

export function createJourneyRouter(
  assess: AssessmentService = createFixtureAssessment,
): Router {
  const router = Router();
  router.use((_request, response, next) => {
    response.set('Cache-Control', 'no-store');
    next();
  });

  router.post(
    '/',
    requireJson,
    json({ limit: '8kb' }),
    async (request, response) => {
      const validation = validateJourneyCheckRequest(request.body as unknown);
      if (!validation.ok) {
        response.status(400).json({
          error: {
            code: 'INVALID_INPUT',
            message: validation.issues.join('; '),
          },
        });
        return;
      }
      const assessment = await assess(validation.value);
      response.json(
        stripInternalRouteIdentity(evaluateJourneyCheck(assessment)),
      );
    },
  );

  // Do not leak submitted bodies, stack traces or parser details.
  router.use(createJsonErrorHandler('JSON body exceeds 8kb'));
  return router;
}

function stripInternalRouteIdentity(
  value: JourneyCheckResponse,
): JourneyCheckResponse {
  if (value.route === null) return value;
  return {
    ...value,
    route: {
      ...value.route,
      legs: value.route.legs.map((leg) => {
        const publicLeg = { ...leg };
        delete publicLeg.fromInterchangeId;
        delete publicLeg.toInterchangeId;
        return publicLeg;
      }),
    },
  };
}
