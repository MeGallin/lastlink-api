import type { RequestHandler } from 'express';

export const defaultCorsOrigins = [
  'http://localhost:5173',
  'http://127.0.0.1:5173',
  'http://localhost:4173',
  'http://127.0.0.1:4173',
] as const;

const corsMethods = 'GET, POST, OPTIONS';
const corsHeaders = 'Content-Type';

export function createCorsMiddleware(
  allowedOrigins: readonly string[],
): RequestHandler {
  const allowed = new Set(allowedOrigins);

  return (request, response, next) => {
    const origin = request.get('Origin');
    if (!origin) {
      next();
      return;
    }

    response.vary('Origin');
    if (!allowed.has(origin)) {
      response.status(403).json({
        error: {
          code: 'CORS_ORIGIN_NOT_ALLOWED',
          message: 'Origin not allowed',
        },
      });
      return;
    }

    response.set('Access-Control-Allow-Origin', origin);
    response.set('Access-Control-Allow-Methods', corsMethods);
    response.set('Access-Control-Allow-Headers', corsHeaders);
    response.set('Access-Control-Max-Age', '600');

    if (request.method === 'OPTIONS') {
      response.status(204).end();
      return;
    }

    next();
  };
}
