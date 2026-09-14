import { randomUUID } from 'node:crypto';
import type { RequestHandler } from 'express';

export type TelemetryOutcome =
  'success' | 'client_error' | 'rate_limited' | 'server_error' | 'aborted';

export interface RequestTelemetryEvent {
  event: 'http_request';
  requestId: string;
  method: string;
  route: string;
  status: number | null;
  durationMs: number;
  outcome: TelemetryOutcome;
  providerOutcome?: 'ok' | 'degraded';
}

export interface TelemetryOptions {
  now?: () => number;
  requestId?: () => string;
  logger?: (event: RequestTelemetryEvent) => void;
}

export interface TelemetryLocals {
  providerOutcome?: 'ok' | 'degraded';
}

const knownRoutes = new Set([
  '/health',
  '/ready',
  '/api/v1/journey-check',
  '/api/v1/journey-check/',
]);

export function createTelemetryMiddleware(
  options: TelemetryOptions = {},
): RequestHandler {
  const now = options.now ?? Date.now;
  const requestId = options.requestId ?? randomUUID;
  const logger = options.logger ?? (() => undefined);

  return (request, response, next) => {
    const startedAt = now();
    const id = requestId();
    response.set('X-Request-Id', id);
    let finalized = false;
    const finalize = (aborted: boolean) => {
      if (finalized) return;
      finalized = true;
      const durationMs = Math.max(0, now() - startedAt);
      const event: RequestTelemetryEvent = {
        event: 'http_request',
        requestId: id,
        method: request.method,
        route: routeLabel(`${request.baseUrl}${request.path}`),
        status: aborted && !response.headersSent ? null : response.statusCode,
        durationMs,
        outcome: aborted ? 'aborted' : outcomeForStatus(response.statusCode),
        ...((response.locals as TelemetryLocals).providerOutcome === undefined
          ? {}
          : {
              providerOutcome: (response.locals as TelemetryLocals)
                .providerOutcome,
            }),
      };
      logger(event);
    };
    response.once('finish', () => finalize(false));
    response.once('close', () => finalize(!response.writableFinished));
    next();
  };
}

function routeLabel(path: string): string {
  return knownRoutes.has(path) ? path.replace(/\/$/, '') : 'unmatched';
}

function outcomeForStatus(status: number): TelemetryOutcome {
  if (status === 429) return 'rate_limited';
  if (status >= 500) return 'server_error';
  if (status >= 400) return 'client_error';
  return 'success';
}
