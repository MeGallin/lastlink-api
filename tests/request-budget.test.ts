import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  createProviderRequestBudget,
  type ProviderRequestLimits,
} from '../src/providers/request-budget.js';

const limits: ProviderRequestLimits = {
  journeyPlanner: 1,
  timetable: 1,
  arrivals: 2,
  lineStatus: 1,
  stopDisruption: 1,
  darwinBoard: 1,
  darwinServiceDetails: 1,
};

await test('request budget reserves distinct operations independently', () => {
  const budget = createProviderRequestBudget(limits);

  assert.deepEqual(budget.reserve('journeyPlanner', 'plan-1'), {
    allowed: true,
    deduplicated: false,
    usage: 1,
  });
  assert.deepEqual(budget.reserve('darwinBoard', 'board-1'), {
    allowed: true,
    deduplicated: false,
    usage: 1,
  });
  assert.equal(budget.usage('journeyPlanner'), 1);
  assert.equal(budget.usage('darwinBoard'), 1);
});

await test('identical request keys are deduplicated without consuming budget', () => {
  const budget = createProviderRequestBudget(limits);

  assert.equal(budget.reserve('arrivals', 'stop-1').deduplicated, false);
  assert.deepEqual(budget.reserve('arrivals', 'stop-1'), {
    allowed: true,
    deduplicated: true,
    usage: 1,
  });
  assert.equal(budget.usage('arrivals'), 1);
});

await test('budget exhaustion is explicit and does not add another key', () => {
  const budget = createProviderRequestBudget(limits);

  budget.reserve('journeyPlanner', 'plan-1');
  assert.deepEqual(budget.reserve('journeyPlanner', 'plan-2'), {
    allowed: false,
    deduplicated: false,
    usage: 1,
    reason: 'budget_exhausted',
  });
  assert.equal(budget.usage('journeyPlanner'), 1);
});

await test('a retry must use a distinct key and is counted', () => {
  const budget = createProviderRequestBudget({
    ...limits,
    arrivals: 2,
  });

  assert.equal(budget.reserve('arrivals', 'stop-1-attempt-1').allowed, true);
  assert.equal(budget.reserve('arrivals', 'stop-1-attempt-2').allowed, true);
  assert.equal(budget.reserve('arrivals', 'stop-1-attempt-3').allowed, false);
  assert.equal(budget.usage('arrivals'), 2);
});

await test('budget limits are isolated from later caller mutation', () => {
  const mutableLimits = { ...limits };
  const budget = createProviderRequestBudget(mutableLimits);
  mutableLimits.journeyPlanner = 3;

  budget.reserve('journeyPlanner', 'plan-1');
  assert.equal(budget.reserve('journeyPlanner', 'plan-2').allowed, false);
  assert.equal(budget.usage('journeyPlanner'), 1);
});

const invalidLimitCases: ReadonlyArray<[string, ProviderRequestLimits]> = [
  ['negative', { ...limits, journeyPlanner: -1 }],
  ['fractional', { ...limits, journeyPlanner: 1.5 }],
];

for (const [label, invalidLimits] of invalidLimitCases) {
  await test(`request budget rejects ${label} limits`, () => {
    assert.throws(
      () => createProviderRequestBudget(invalidLimits),
      /must be a non-negative integer/,
    );
  });
}

await test('request budget rejects empty request keys', () => {
  const budget = createProviderRequestBudget(limits);
  assert.throws(
    () => budget.reserve('journeyPlanner', '  '),
    /requestKey must be a non-empty string/,
  );
});
