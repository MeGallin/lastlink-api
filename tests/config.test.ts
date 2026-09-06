import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readConfig } from '../src/config.js';

await test('configuration uses local defaults', () => {
  assert.deepEqual(readConfig({}), { port: 3000, nodeEnv: 'development' });
});

await test('configuration accepts valid deployment values', () => {
  assert.deepEqual(readConfig({ PORT: '10000', NODE_ENV: 'production' }), {
    port: 10000,
    nodeEnv: 'production',
  });
  assert.equal(readConfig({ PORT: '1' }).port, 1);
  assert.equal(readConfig({ PORT: '65535' }).port, 65535);
});

for (const port of [
  '',
  '0',
  '-1',
  '65536',
  '1.5',
  'abc',
  '3000abc',
  '1e3',
  ' 3000 ',
]) {
  await test(`configuration rejects invalid port "${port}"`, () => {
    assert.throws(() => readConfig({ PORT: port }), /PORT must/);
  });
}

await test('configuration rejects unknown environment', () => {
  assert.throws(() => readConfig({ NODE_ENV: 'prod' }), /NODE_ENV must/);
});
