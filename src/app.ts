import express from 'express';
import { createCorsMiddleware, defaultCorsOrigins } from './http/cors.js';
import { createJourneyRouter } from './routes/journey-check.js';
import type { AssessmentService } from './journey/assessment-service.js';
import {
  defaultJourneyRateLimit,
  type RateLimitOptions,
} from './http/rate-limit.js';

export type JourneyDataMode = 'fixture' | 'live';

export function createApp(
  assess?: AssessmentService,
  corsOrigins: readonly string[] = defaultCorsOrigins,
  journeyRateLimit: RateLimitOptions = defaultJourneyRateLimit,
  journeyDataMode: JourneyDataMode = 'fixture',
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

  // Startup readiness only: this reports validated runtime configuration and
  // deliberately does not make a live provider call.
  app.get('/ready', (_request, response) => {
    response.set('Cache-Control', 'no-store');
    response.json({
      status: 'ready',
      service: 'lastlink-api',
      dataMode: journeyDataMode,
    });
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
