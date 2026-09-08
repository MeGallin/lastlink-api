import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  rankTflJourneyCandidates,
  type TflJourneyRankingOptions,
} from '../src/providers/tfl/journey-ranking.js';
import type { TflJourneyPlannerCandidate } from '../src/providers/tfl/journey-response.js';

const rankingOptions: TflJourneyRankingOptions = {
  protectedDepartureAtMs: Date.parse('2026-09-07T00:35:00+01:00'),
  transferMinutes: 10,
  safetyBufferMinutes: 5,
};

function candidate(
  arrivalAt: string,
  alternativeRoute = false,
): TflJourneyPlannerCandidate {
  const departureAt = '2026-09-06T23:45:00+01:00';
  return {
    alternativeRoute,
    route: {
      arrivalAt,
      walkingMinutes: 0,
      legs: [
        {
          mode: 'tube',
          from: 'Stratford',
          to: 'Waterloo',
          departureAt,
          arrivalAt,
          durationMinutes: Math.round(
            (Date.parse(arrivalAt) - Date.parse(departureAt)) / 60000,
          ),
          providerReference: `synthetic-${arrivalAt}`,
        },
      ],
    },
  };
}

await test('ranking prefers viable margin, then tight, then missed candidates', () => {
  const result = rankTflJourneyCandidates(
    [
      candidate('2026-09-07T00:20:00+01:00'),
      candidate('2026-09-07T00:07:00+01:00'),
      candidate('2026-09-07T00:40:00+01:00'),
      candidate('2026-09-07T00:32:00+01:00', true),
      candidate('2026-09-07T00:22:00+01:00'),
      candidate('2026-09-07T00:25:00+01:00'),
      candidate('2026-09-07T00:07:00+01:00', true),
    ],
    rankingOptions,
  );

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.deepEqual(
    result.rankedCandidates.map((item) => item.candidateIndex),
    [1, 6, 0, 4, 5, 3, 2],
  );
  assert.equal(result.rankedCandidates[0]?.availableMinutes, 18);
  assert.equal(result.rankedCandidates[0]?.remainingAfterBufferMinutes, 13);
  assert.equal(result.rankedCandidates[3]?.remainingAfterBufferMinutes, -2);
  assert.equal(result.rankedCandidates[4]?.availableMinutes, 0);
  assert.equal(result.rankedCandidates[6]?.availableMinutes, -15);
});

await test('ranking does not mutate candidate order and preserves every candidate', () => {
  const candidates = [
    candidate('2026-09-07T00:10:00+01:00'),
    candidate('2026-09-07T00:12:00+01:00', true),
  ];
  const originalReferences = candidates.map(
    (item) => item.route.legs[0]?.providerReference,
  );

  const result = rankTflJourneyCandidates(candidates, rankingOptions);

  assert.equal(result.ok, true);
  assert.deepEqual(
    candidates.map((item) => item.route.legs[0]?.providerReference),
    originalReferences,
  );
  if (!result.ok) return;
  assert.equal(result.rankedCandidates.length, candidates.length);
  assert.equal(result.rankedCandidates[1]?.candidate.alternativeRoute, true);
});

await test('ranking requires an explicit transfer and safety policy', () => {
  const invalidPolicies: Array<{
    options: TflJourneyRankingOptions;
    message: string;
  }> = [
    {
      options: { ...rankingOptions, protectedDepartureAtMs: Number.NaN },
      message: 'protected departure instant must be finite',
    },
    {
      options: { ...rankingOptions, transferMinutes: -1 },
      message: 'transferMinutes must be an integer from 0 through 180',
    },
    {
      options: { ...rankingOptions, transferMinutes: 1.5 },
      message: 'transferMinutes must be an integer from 0 through 180',
    },
    {
      options: { ...rankingOptions, safetyBufferMinutes: 61 },
      message: 'safetyBufferMinutes must be an integer from 0 through 60',
    },
  ];

  for (const { options, message } of invalidPolicies) {
    assert.deepEqual(
      rankTflJourneyCandidates(
        [candidate('2026-09-07T00:10:00+01:00')],
        options,
      ),
      {
        ok: false,
        code: 'INVALID_POLICY',
        message,
      },
    );
  }
});

await test('ranking fails safely for empty or offset-free candidates', () => {
  assert.deepEqual(rankTflJourneyCandidates([], rankingOptions), {
    ok: false,
    code: 'NO_CANDIDATES',
    message: 'No journey candidates were provided',
  });

  assert.deepEqual(
    rankTflJourneyCandidates(
      [candidate('2026-09-07T00:10:00')],
      rankingOptions,
    ),
    {
      ok: false,
      code: 'INVALID_CANDIDATE',
      message: 'journey candidate has no explicit arrival instant',
    },
  );
});
