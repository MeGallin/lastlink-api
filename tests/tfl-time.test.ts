import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseTflInstant } from '../src/providers/tfl/time.js';
import { parseExplicitInstant } from '../src/journey/time.js';

for (const [input, output] of [
  ['2026-01-15T23:45:00', '2026-01-15T23:45:00+00:00'],
  ['2026-09-07T00:07:00', '2026-09-07T00:07:00+01:00'],
  ['2026-09-07T00:07:00.123', '2026-09-07T00:07:00.123+01:00'],
  ['2026-09-07T00:07', '2026-09-07T00:07+01:00'],
  ['2026-03-29T00:59:59', '2026-03-29T00:59:59+00:00'],
  ['2026-03-29T02:00:00', '2026-03-29T02:00:00+01:00'],
  ['2026-10-25T00:59:59', '2026-10-25T00:59:59+01:00'],
  ['2026-10-25T02:00:00', '2026-10-25T02:00:00+00:00'],
  ['2024-02-29T12:00:00', '2024-02-29T12:00:00+00:00'],
]) {
  await test(`London provider time resolves ${input}`, () => {
    const parsed = parseTflInstant(input);
    assert.equal(parsed?.text, output);
    assert.equal(parsed?.atMs, Date.parse(output!));
    assert.equal(
      parseExplicitInstant(input),
      undefined,
      'user parser must remain strict',
    );
  });
}

for (const input of [
  '2026-03-29T01:00:00',
  '2026-03-29T01:59:59.999',
  '2026-10-25T01:00:00',
  '2026-10-25T01:59:59.999',
  '2026-02-29T12:00:00',
  '2026-09-07T24:00:00',
  '2026-09-07T12:60:00',
  '2026-09-07T12:00:60',
  '2026-09-07T12:00:00junk',
  '2026-09-07',
  '',
  '1999-09-07T12:00:00',
  '2100-09-07T12:00:00',
  null,
  123,
]) {
  await test(`rejects unresolved or invalid London provider time ${input}`, () => {
    assert.equal(parseTflInstant(input), undefined);
  });
}

await test('explicit offsets disambiguate both occurrences and remain unchanged', () => {
  const first = parseTflInstant('2026-10-25T01:30:00+01:00');
  const second = parseTflInstant('2026-10-25T01:30:00+00:00');
  assert.equal(first?.text, '2026-10-25T01:30:00+01:00');
  assert.ok(first);
  assert.ok(second);
  assert.equal(second.atMs - first.atMs, 3_600_000);
  assert.equal(
    parseTflInstant('2026-10-25T01:30:00Z')?.text,
    '2026-10-25T01:30:00Z',
  );
});
