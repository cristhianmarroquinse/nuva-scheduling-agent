import { describe, expect, it } from 'vitest';
import { scenarioFailures, scenarioRun } from './runner.js';

// Protocol-visible behaviour of feature 010: orders moved by a handyman blackout pick their new slot by priority, and an
// undated general refusal blacks out the day of the current proposal (REQ-SC-5, REQ-SC-6).

const SPAWN_TIMEOUT = 20_000;

async function expectScenario(name: string): Promise<string> {
  const { scenario, output } = await scenarioRun(name);
  expect(scenarioFailures(scenario, output)).toEqual([]);
  return output.rawTrace;
}

describe('US1 · moved orders pick their new slot by priority', () => {
  it('010-blackout-priority: CSV order Low, Medium, High; the handyman writes on the Medium; High, Medium, Low get 09:00, 11:00, 13:00 (AC-1.1, AC-1.2, SCHED-1)', async () => {
    await expectScenario('010-blackout-priority');
  }, SPAWN_TIMEOUT);

  it('010-blackout-writer-first: the handyman writes on the High order, which picks first (AC-1.2)', async () => {
    await expectScenario('010-blackout-writer-first');
  }, SPAWN_TIMEOUT);
});

describe('US2 · a general refusal without a date is not lost', () => {
  it('010-blackout-inferred-day: no date extracted, the proposal day is blacked out and traced as inferred (AC-2.1)', async () => {
    await expectScenario('010-blackout-inferred-day');
  }, SPAWN_TIMEOUT);

  it('010-scope-all-accept: a general scope on an acceptance records no blackout (AC-2.2)', async () => {
    const trace = await expectScenario('010-scope-all-accept');
    expect(trace).not.toContain('blackout_recorded');
  }, SPAWN_TIMEOUT);
});
