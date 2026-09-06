import assert from 'node:assert/strict';
import { test } from 'node:test';
import request from 'supertest';
import { createApp } from '../src/app.js';

await test('health reports process liveness without caching', async () => {
  const response = await request(createApp())
    .get('/health')
    .expect(200)
    .expect('Content-Type', /json/);
  assert.deepEqual(response.body, { status: 'ok', service: 'lastlink-api' });
  assert.equal(response.headers['cache-control'], 'no-store');
  assert.equal(response.headers['x-powered-by'], undefined);
});

await test('unknown routes return a JSON error', async () => {
  const response = await request(createApp()).get('/missing').expect(404);
  assert.deepEqual(response.body, {
    error: { code: 'NOT_FOUND', message: 'Route not found' },
  });
});

await test('unsupported health method does not report success', async () => {
  await request(createApp()).post('/health').expect(404);
});
