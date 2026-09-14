import express from 'express';
import { createCorsMiddleware, defaultCorsOrigins } from './http/cors.js';
import { createJourneyRouter } from './routes/journey-check.js';
import type { AssessmentService } from './journey/assessment-service.js';
import {
  defaultJourneyRateLimit,
  type RateLimitOptions,
} from './http/rate-limit.js';

export function createApp(
  assess?: AssessmentService,
  corsOrigins: readonly string[] = defaultCorsOrigins,
  journeyRateLimit: RateLimitOptions = defaultJourneyRateLimit,
) {
  const app = express();
  app.disable('x-powered-by');
  app.disable('etag');
  app.use(createCorsMiddleware(corsOrigins));

  // Process liveness only: this does not verify transport data or journey viability.
  app.get('/health', (_request, response) => {
    response.set('Cache-Control', 'no-store');
    response.json({ status: 'ok', service: 'lastlink-api' });
  });

  app.use(
    '/api/v1/journey-check',
    createJourneyRouter(assess, journeyRateLimit),
  );

  app.use((_request, response) => {
    response.status(404).json({
      error: { code: 'NOT_FOUND', message: 'Route not found' },
    });
  });

  return app;
}
