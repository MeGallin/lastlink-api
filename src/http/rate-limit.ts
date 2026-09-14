import { isIP } from 'node:net';
import type { RequestHandler } from 'express';

export interface RateLimitConfig {
  windowMs: number;
  maxRequests: number;
  maxEntries: number;
}

export const defaultJourneyRateLimit: Readonly<RateLimitConfig> = {
  windowMs: 60_000,
  maxRequests: 30,
  maxEntries: 10_000,
};

interface WindowEntry {
  count: number;
  resetAt: number;
}

export interface RateLimitOptions extends RateLimitConfig {
  now?: () => number;
  /**
   * A hosting-controlled single-value client address header. The only
   * supported value is Cloudflare's header, which Render documents as being
   * overwritten at its edge before a request reaches a web service.
   */
  clientIpHeader?: RateLimitClientIpHeader;
}

export type RateLimitClientIpHeader = 'cf-connecting-ip';

/**
 * Applies a bounded, per-process fixed-window limit to one public endpoint.
 * The limiter is intentionally local: it absorbs accidental bursts without
 * adding a datastore dependency. A distributed edge limit remains a hosting
 * concern for a multi-instance production deployment.
 */
export function createRateLimitMiddleware(
  options: RateLimitOptions,
): RequestHandler {
  validateRateLimitOptions(options);
  const now = options.now ?? Date.now;
  const entries = new Map<string, WindowEntry>();

  return (request, response, next) => {
    const currentTime = now();
    pruneExpiredEntries(entries, currentTime);
    const key =
      readConfiguredClientIp(request, options.clientIpHeader) ??
      request.socket.remoteAddress ??
      'unknown';
    let entry = entries.get(key);

    if (entry === undefined || currentTime >= entry.resetAt) {
      if (entry === undefined) {
        keepMapBounded(entries, options.maxEntries);
      }
      entry = { count: 0, resetAt: currentTime + options.windowMs };
      entries.set(key, entry);
    }

    entry.count = Math.min(entry.count + 1, options.maxRequests + 1);
    const retryAfterSeconds = Math.max(
      1,
      Math.ceil((entry.resetAt - currentTime) / 1000),
    );
    const remaining = Math.max(0, options.maxRequests - entry.count);

    response.set('Cache-Control', 'no-store');
    response.set('RateLimit-Limit', String(options.maxRequests));
    response.set('RateLimit-Remaining', String(remaining));
    response.set('RateLimit-Reset', String(retryAfterSeconds));

    if (entry.count > options.maxRequests) {
      response.set('Retry-After', String(retryAfterSeconds));
      response.status(429).json({
        error: {
          code: 'RATE_LIMITED',
          message:
            'Too many journey checks. Please wait a moment and try again.',
        },
      });
      return;
    }

    next();
  };
}

function readConfiguredClientIp(
  request: Parameters<RequestHandler>[0],
  header: RateLimitClientIpHeader | undefined,
): string | undefined {
  if (header === undefined) return undefined;
  const value = request.get(header)?.trim();
  if (!value || value.includes(',') || isIP(value) === 0) return undefined;
  return value;
}

function pruneExpiredEntries(
  entries: Map<string, WindowEntry>,
  currentTime: number,
): void {
  for (const [key, entry] of entries) {
    if (currentTime >= entry.resetAt) entries.delete(key);
  }
}

function keepMapBounded(
  entries: Map<string, WindowEntry>,
  maxEntries: number,
): void {
  if (entries.size < maxEntries) return;
  const oldest = entries.keys().next().value;
  if (oldest !== undefined) entries.delete(oldest);
}

function validateRateLimitOptions(config: RateLimitOptions): void {
  for (const [name, value] of [
    ['windowMs', config.windowMs],
    ['maxRequests', config.maxRequests],
    ['maxEntries', config.maxEntries],
  ] as const) {
    if (!Number.isSafeInteger(value) || value < 1) {
      throw new Error(`${name} must be a positive safe integer`);
    }
  }
  if (
    config.clientIpHeader !== undefined &&
    config.clientIpHeader !== 'cf-connecting-ip'
  ) {
    throw new Error('clientIpHeader must be cf-connecting-ip when configured');
  }
}
