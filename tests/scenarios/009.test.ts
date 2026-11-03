import { describe, expect, it } from 'vitest';
import { scenarioFailures, scenarioRun, stdoutBlocks } from './runner.js';

// Protocol-visible behaviour of feature 009: what a party rules out is never proposed again by the system, the "not
// available" note is only sent when times were requested, and the last word of a reply wins (REQ-NG-12, REQ-NG-13).

const SPAWN_TIMEOUT = 20_000;
const NOTE = 'The times you suggested are not available.';

async function run(name: string) {
  const { scenario, output } = await scenarioRun(name);
  expect(scenarioFailures(scenario, output)).toEqual([]);
  const tenantFrames = stdoutBlocks(output.stdout).filter((block) => block.startsWith('WOID:WO-1|ROLE:tenant'));
  return { output, tenantFrames };
}

describe('US1 · what a party rules out stays ruled out', () => {
  it('009-decline-excluded-day: a decline that excludes Wednesday moves to Thursday, with no note (AC-1.1, AC-1.3, AC-2.2, SCHED-1)', async () => {
    const { tenantFrames } = await run('009-decline-excluded-day');
    expect(tenantFrames.some((frame) => frame.includes(NOTE))).toBe(false);
  }, SPAWN_TIMEOUT);

  it('009-weekdays-excluded: a counter with only exclusions avoids each excluded weekday, with no note (AC-1.2, AC-1.3, AC-2.2)', async () => {
    const { tenantFrames } = await run('009-weekdays-excluded');
    expect(tenantFrames.some((frame) => frame.includes(NOTE))).toBe(false);
  }, SPAWN_TIMEOUT);

  it('009-afternoons-only: an undated "only afternoons" holds on later days too (AC-1.2, AC-1.3)', async () => {
    await run('009-afternoons-only');
  }, SPAWN_TIMEOUT);

  it("009-constraints-add-up: both parties' constraints are avoided (AC-1.1, AC-1.3)", async () => {
    await run('009-constraints-add-up');
  }, SPAWN_TIMEOUT);

  it('009-explicit-inside-constraint: a time named now wins over an earlier constraint (AC-1.4)', async () => {
    await run('009-explicit-inside-constraint');
  }, SPAWN_TIMEOUT);
});

describe('US2 and US3 · true notes and the nearest slot on the stated day', () => {
  it('009-nearest-same-day: "tonight at 21:30" gets 20:00–22:00 that evening, with the note (AC-3.1, AC-2.1)', async () => {
    const { tenantFrames } = await run('009-nearest-same-day');
    expect(tenantFrames.filter((frame) => frame.includes(NOTE))).toHaveLength(1);
  }, SPAWN_TIMEOUT);

  it('009-nearest-none-free: a stated day with nothing free falls back to the next slot, with the note (AC-3.2, AC-2.1)', async () => {
    const { tenantFrames } = await run('009-nearest-none-free');
    expect(tenantFrames.filter((frame) => frame.includes(NOTE))).toHaveLength(1);
  }, SPAWN_TIMEOUT);
});

describe("US4 · readings that keep the party's last word", () => {
  it('009-accept-excludes-proposal: "yes, but not before 1pm" to 12:00 is a counter, with no confirmation question and no note (AC-4.1, AC-2.2)', async () => {
    const { tenantFrames } = await run('009-accept-excludes-proposal');
    expect(tenantFrames.some((frame) => frame.includes('To confirm'))).toBe(false);
    expect(tenantFrames.some((frame) => frame.includes(NOTE))).toBe(false);
  }, SPAWN_TIMEOUT);

  it('009-accept-constraint-elsewhere: "yes, but not Thursday" to Wednesday still asks for confirmation (AC-4.1; 003 AC-2.3, ACC-1)', async () => {
    const { tenantFrames } = await run('009-accept-constraint-elsewhere');
    expect(tenantFrames.some((frame) => frame.includes('To confirm'))).toBe(true);
  }, SPAWN_TIMEOUT);

  it('009-contradictory-with-time: a correction with a time is a counter, not a clarification (AC-4.2)', async () => {
    const { tenantFrames } = await run('009-contradictory-with-time');
    expect(tenantFrames.some((frame) => frame.includes('did not understand'))).toBe(false);
  }, SPAWN_TIMEOUT);

  it('009-tampoco: a bare "Tampoco" is a decline through the fast path (AC-4.4)', async () => {
    await run('009-tampoco');
  }, SPAWN_TIMEOUT);
});

describe('US4 · availability that contains the proposal', () => {
  it('009-availability-contains-proposal: "whenever, all week" and "Wednesday 9 to 6" accept the slot on the table, with no re-proposal (AC-4.5, ACC-1)', async () => {
    const { output } = await run('009-availability-contains-proposal');
    expect(output.stdout).not.toContain('previous proposal is cancelled');
  }, SPAWN_TIMEOUT);
});
