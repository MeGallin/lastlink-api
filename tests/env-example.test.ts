import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { dirname, resolve } from 'node:path';

const envExamplePath = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../.env.example',
);
const envExample = await readFile(envExamplePath, 'utf8');
const nonEmptyProviderAssignment =
  /^[ \t]*(?!#)(?:export[ \t]+)?(?:TFL_[A-Z0-9_]+|DARWIN_[A-Z0-9_]+)[ \t]*=[ \t]*\S+/m;

await test('environment example contains safe provider placeholders', () => {
  assert.equal(
    /^NODE_ENV=development$/m.test(envExample),
    true,
    'environment example must document development mode',
  );
  assert.equal(
    /^PORT=3000$/m.test(envExample),
    true,
    'environment example must document the local port',
  );
  assert.equal(
    /^# TFL_APP_KEY=$/m.test(envExample),
    true,
    'environment example must document an empty TfL key placeholder',
  );

  assert.equal(
    nonEmptyProviderAssignment.test(envExample),
    false,
    'environment example must not contain non-empty provider credentials',
  );
});

await test('environment guard catches exported provider assignments', () => {
  for (const assignment of [
    'export TFL_APP_KEY=nonempty-value',
    '  export TFL_APP_KEY=nonempty-value',
    '\texport\tDARWIN_TOKEN=nonempty-value',
  ]) {
    assert.equal(
      nonEmptyProviderAssignment.test(assignment),
      true,
      'environment guard must detect exported provider assignments',
    );
  }
});
