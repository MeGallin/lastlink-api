import { createApp } from './app.js';
import { readConfig } from './config.js';
import { createAssessmentService } from './journey/assessment-service.js';

const config = readConfig(process.env);
const server = createApp(
  createAssessmentService(config.journeyProvider),
).listen(config.port, () => {
  console.info(`LastLink API listening on port ${config.port}`);
});

server.on('error', (error: NodeJS.ErrnoException) => {
  console.error('Server failed:', error.code ?? 'UNKNOWN');
  process.exitCode = 1;
});

let stopping = false;
function shutdown() {
  if (stopping) return;
  stopping = true;
  const deadline = setTimeout(() => {
    console.error('Graceful shutdown timed out');
    process.exit(1);
  }, 10000);
  deadline.unref();
  server.close((error) => {
    clearTimeout(deadline);
    if (error) {
      console.error('Server shutdown failed');
      process.exitCode = 1;
    }
  });
}
process.once('SIGINT', shutdown);
process.once('SIGTERM', shutdown);
