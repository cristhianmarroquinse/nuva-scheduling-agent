import { describe, expect, it } from 'vitest';
import { scenarioFailures, scenarioRun } from './runner.js';

// Protocol-visible behaviour of feature 013: readable review reasons, lenient urgency, ids with inner spaces.

const SPAWN_TIMEOUT = 20_000;

async function expectScenario(name: string): Promise<void> {
  const { scenario, output } = await scenarioRun(name);
  expect(scenarioFailures(scenario, output)).toEqual([]);
}

describe('013 · polish from the e2e review', () => {
  it('013-eof-reasons: at end of input the REASON names who was awaited and what was agreed, in readable Madrid time (AC-1, AC-2, ORD-1)', async () => {
    await expectScenario('013-eof-reasons');
  }, SPAWN_TIMEOUT);

  it('013-urgency-case: "critical" and " High " are read as Critical and High (AC-3)', async () => {
    await expectScenario('013-urgency-case');
  }, SPAWN_TIMEOUT);

  it('013-id-with-space: an id with an inner space gets proposals, is addressable on stdin and gets one result (AC-4, ORD-1)', async () => {
    await expectScenario('013-id-with-space');
  }, SPAWN_TIMEOUT);
});
