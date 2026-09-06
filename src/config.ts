export interface Config {
  port: number;
  nodeEnv: 'development' | 'test' | 'production';
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
  return { port, nodeEnv };
}
