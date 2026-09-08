import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  canonicalStationName,
  stationNamesMatch,
} from '../src/journey/station-identity.js';

for (const [left, right] of [
  ['Stratford', 'Stratford Station'],
  ['Waterloo', 'Waterloo Underground Station'],
  ['Waterloo', 'Waterloo National Rail'],
  ['London Bridge', 'London Bridge Railway Station'],
  ['Bank', 'Bank Tube'],
  ['King’s Cross', 'Kings Cross Station'],
] as const) {
  await test('matches provider descriptor: ' + left + ' / ' + right, () => {
    assert.equal(stationNamesMatch(left, right), true);
  });
}

for (const [left, right] of [
  ['Waterloo', 'Waterloo East'],
  ['Stratford', 'Stratford International'],
  ['Bank', 'Barking'],
  ['A', 'Avenue'],
  ['Station', 'Station'],
] as const) {
  await test('rejects non-equivalent station: ' + left + ' / ' + right, () => {
    assert.equal(stationNamesMatch(left, right), false);
  });
}

await test('canonical names do not expose punctuation or descriptor artifacts', () => {
  assert.equal(
    canonicalStationName('  Waterloo — National Rail Station  '),
    'waterloo',
  );
  assert.equal(canonicalStationName('King’s Cross Station'), 'kings cross');
});
