import { defaultCorsOrigins } from './http/cors.js';

export interface Config {
  port: number;
  nodeEnv: 'development' | 'test' | 'production';
  journeyProvider: JourneyProviderConfig;
  corsOrigins: readonly string[];
}

export type JourneyProviderConfig =
  { mode: 'fixture' } | { mode: 'live'; appKey: string };

function readCorsOrigins(value: string | undefined): readonly string[] {
  if (value === undefined) return defaultCorsOrigins;

  const origins = value.split(',').map((origin) => origin.trim());
  if (origins.length === 0 || origins.some((origin) => origin.length === 0)) {
    throw new Error('CORS_ORIGINS must contain one or more origins');
  }

  const normalized = origins.map((origin) => {
    let parsed: URL;
    try {
      parsed = new URL(origin);
    } catch {
      throw new Error('CORS_ORIGINS must contain valid HTTP(S) origins');
    }
    if (
      (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') ||
      parsed.origin !== origin
    ) {
      throw new Error('CORS_ORIGINS must contain valid HTTP(S) origins');
    }
    return parsed.origin;
  });

  return [...new Set(normalized)];
}

export function readConfig(env: NodeJS.ProcessEnv): Config {
  const portText = env.PORT ?? '3000';
  const port = Number(portText);
  if (
    !/^\d+$/.test(portText) ||
    !Number.isInteger(port) ||
    port < 1 ||
    port > 65535
  ) {
    throw new Error('PORT must be an integer between 1 and 65535');
  }
  const nodeEnv = env.NODE_ENV ?? 'development';
  if (
    nodeEnv !== 'development' &&
    nodeEnv !== 'test' &&
    nodeEnv !== 'production'
  ) {
    throw new Error('NODE_ENV must be development, test or production');
  }
  const mode = env.JOURNEY_DATA_MODE ?? 'fixture';
  if (mode !== 'fixture' && mode !== 'live') {
    throw new Error('JOURNEY_DATA_MODE must be fixture or live');
  }
  if (mode === 'fixture') {
    return {
      port,
      nodeEnv,
      journeyProvider: { mode },
      corsOrigins: readCorsOrigins(env.CORS_ORIGINS),
    };
  }
  const appKey = env.TFL_APP_KEY;
  if (!appKey || /\s/.test(appKey)) {
    throw new Error(
      'TFL_APP_KEY must be non-empty without whitespace in live mode',
    );
  }
  return {
    port,
    nodeEnv,
    journeyProvider: { mode, appKey },
    corsOrigins: readCorsOrigins(env.CORS_ORIGINS),
  };
}
