import express from 'express';
import { createJourneyRouter } from './routes/journey-check.js';
import type { AssessmentService } from './journey/assessment-service.js';

export function createApp(assess?: AssessmentService) {
  const app = express();
  app.disable('x-powered-by');
  app.disable('etag');

  // Process liveness only: this does not verify transport data or journey viability.
  app.get('/health', (_request, response) => {
    response.set('Cache-Control', 'no-store');
    response.json({ status: 'ok', service: 'lastlink-api' });
  });

  app.use('/api/v1/journey-check', createJourneyRouter(assess));

  app.use((_request, response) => {
    response.status(404).json({
      error: { code: 'NOT_FOUND', message: 'Route not found' },
    });
  });

  return app;
}
