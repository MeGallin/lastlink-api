import express from 'express';
import { createDemoRouter } from './demo/routes.js';

export function createApp() {
  const app = express();
  app.disable('x-powered-by');
  app.disable('etag');

  // Process liveness only: this does not verify transport data or journey viability.
  app.get('/health', (_request, response) => {
    response.set('Cache-Control', 'no-store');
    response.json({ status: 'ok', service: 'lastlink-api' });
  });

  app.use('/api/v1/demo', createDemoRouter());

  app.use((_request, response) => {
    response.status(404).json({
      error: { code: 'NOT_FOUND', message: 'Route not found' },
    });
  });

  return app;
}
