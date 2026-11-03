import { describe, expect, it } from 'vitest';
import { readdirSync } from 'node:fs';
import { scenarioFailures, scenarioRun, type TraceLine } from './runner.js';

const SCENARIO_DIR = new URL('.', import.meta.url).pathname;

// Protocol-visible behaviour of feature 008: a slot the agent chooses on its own never overlaps a proposal already
// refused in that order (REQ-NG-11), through the real entry point with the fake interpreter.

const SPAWN_TIMEOUT = 20_000;

async function expectScenario(name: string): Promise<void> {
  const { scenario, output } = await scenarioRun(name);
  expect(scenarioFailures(scenario, output)).toEqual([]);
}

describe('US1 · after a refusal, the agent offers a genuinely different slot', () => {
  it('008-decline-no-overlap: three plain declines get 12:00, 14:00, 16:00, then no_mutual_slot (AC-1.1, AC-1.2, AC-1.5, SCHED-1)', async () => {
    await expectScenario('008-decline-no-overlap');
  }, SPAWN_TIMEOUT);

  it('008-decline-end-of-day: a decline of the last slot of the day moves to the next weekday at 09:00 (AC-1.2)', async () => {
    await expectScenario('008-decline-end-of-day');
  }, SPAWN_TIMEOUT);

  it('008-non-contiguous: earlier refusals are avoided too, not only the slot just refused (AC-1.1, AC-1.2, AC-1.3)', async () => {
    await expectScenario('008-non-contiguous');
  }, SPAWN_TIMEOUT);

  it('008-withdraw-no-overlap: a withdrawal without times gets a slot that does not overlap the withdrawn one (AC-1.1, AC-1.2)', async () => {
    await expectScenario('008-withdraw-no-overlap');
  }, SPAWN_TIMEOUT);

  it('008-no-fit-counter: the fallback after a counter with no fit (a past day, so 009 AC-3.1 finds nothing) does not overlap the countered slot (AC-1.1, AC-1.2)', async () => {
    await expectScenario('008-no-fit-counter');
  }, SPAWN_TIMEOUT);

  it('008-explicit-wins: a time the party names is honoured even if the other party refused it (AC-1.3)', async () => {
    await expectScenario('008-explicit-wins');
  }, SPAWN_TIMEOUT);

  it('008-per-order: a slot refused in one order stays available to another (AC-1.4, SCHED-1)', async () => {
    await expectScenario('008-per-order');
  }, SPAWN_TIMEOUT);

  it("008-preempted-avoids-refused: a preempted order's re-proposal avoids its earlier refusals (AC-1.2, SCHED-4)", async () => {
    await expectScenario('008-preempted-avoids-refused');
  }, SPAWN_TIMEOUT);
});

/** Causes for which the agent chose the slot on its own; `counter` and `withdraw` may carry stated availability. */
const FALLBACK_CAUSES = new Set(['decline', 'no_fit', 'preempted', 'blackout']);
/** Causes that mean the party refused the proposal current at the time (004 AC-3.1). */
const REFUSAL_CAUSES = new Set(['decline', 'counter', 'no_fit', 'withdraw']);

interface Span {
  start: string;
  end: string;
}
const overlap = (a: Span, b: Span) => Date.parse(a.start) < Date.parse(b.end) && Date.parse(b.start) < Date.parse(a.end);

/** Every fallback re-proposal in a trace that overlaps a slot refused earlier in the same order. */
export function fallbackOverlaps(trace: TraceLine[]): string[] {
  const current = new Map<string, Span>();
  const refused = new Map<string, Span[]>();
  const problems: string[] = [];
  for (const line of trace) {
    const id = line.work_order_id;
    if (id === null) continue;
    const detail = line.detail as Record<string, string>;
    if (line.event_type === 'hold_taken') current.set(id, { start: detail['start']!, end: detail['end']! });
    if (line.event_type !== 'decision' || detail['outcome'] !== 'repropose') continue;
    const cause = detail['cause']!;
    const before = current.get(id);
    const list = refused.get(id) ?? [];
    if (REFUSAL_CAUSES.has(cause) && before !== undefined) list.push(before);
    refused.set(id, list);
    const chosen = { start: detail['start']!, end: detail['end']! };
    if (FALLBACK_CAUSES.has(cause)) for (const slot of list) if (overlap(chosen, slot)) problems.push(`${id} v${detail['version']} (${cause}) ${chosen.start} overlaps refused ${slot.start}`);
  }
  return problems;
}

describe('success criterion · across every negotiation scenario', () => {
  const names = readdirSync(SCENARIO_DIR).filter((file) => /^00[458]-.*\.txt$/.test(file)).map((file) => file.replace(/\.txt$/, ''));

  it('no fallback re-proposal in any 004, 005 or 008 scenario overlaps a slot refused earlier in that order (AC-1.2, SCHED-1)', async () => {
    const problems: string[] = [];
    for (const name of names) {
      const { output } = await scenarioRun(name);
      for (const problem of fallbackOverlaps(output.trace)) problems.push(`${name}: ${problem}`);
    }
    expect(problems).toEqual([]);
  }, 120_000);
});
