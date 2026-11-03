import { describe, expect, it } from 'vitest';
import { checkRun, type RunOutput, type TraceLine } from '../../eval/e2e/check.js';
import { HEADER, type Scenario } from '../../eval/e2e/scenario.js';
import { scenarios as calendar } from '../../eval/e2e/sets/calendar.js';
import { scenarios as core } from '../../eval/e2e/sets/core.js';
import { scenarios as language } from '../../eval/e2e/sets/language.js';
import { scenarios as protocol } from '../../eval/e2e/sets/protocol.js';
import { runAgent } from '../scenarios/runner.js';

// The end-to-end checker (spec 014 AC-2.1) on a real run of the agent with the fake interpreter, unchanged and then
// broken one invariant at a time; and the scenario sets themselves (AC-2.2). No network.

const scenario: Scenario = {
  name: 'checker-fixture',
  about: 'two orders; WO-1 is scheduled, WO-2 is declined once and left open',
  csv: [
    'WO-1,Leaking tap,Calle Mayor 1,The kitchen tap drips all night.,2026-11-02T09:00:00,Medium',
    'WO-2,Grifo que gotea,Calle Mayor 2,El grifo de la cocina gotea toda la noche.,2026-11-02T10:00:00,Low',
  ],
  stdin: ['WO-1|tenant Yes', 'WO-1|handyman Sí', 'WO-2|tenant No'],
  expect: { 'WO-1': { result: 'scheduled', at: '2026-11-04T12:00:00+01:00' }, 'WO-2': { result: 'requires_review', codes: ['no_response'] } },
};

let clean: RunOutput | undefined;
async function cleanRun(): Promise<RunOutput> {
  if (clean !== undefined) return clean;
  const output = await runAgent({ csv: [HEADER, ...scenario.csv].join('\n') + '\n', stdin: scenario.stdin.join('\n') + '\n', env: { AGENT_NOW: '2026-11-04T10:00' } });
  clean = { stdout: output.stdout, stderr: output.stderr, code: output.code, trace: output.trace as unknown as TraceLine[], badTraceLines: [] };
  return clean;
}
const mutate = async (change: (run: RunOutput) => RunOutput): Promise<string[]> => checkRun(scenario, change(structuredClone(await cleanRun())));
const has = (failures: string[], prefix: string): boolean => failures.some((failure) => failure.startsWith(prefix));

describe('checkRun (spec 014 AC-1.3, AC-2.1)', () => {
  it('passes a clean run of the agent', async () => {
    expect(checkRun(scenario, await cleanRun())).toEqual([]);
  }, 20_000);

  it('catches stderr output, a bad exit code and an invalid trace line (OUT-1, RUN-1, TRACE-1)', async () => {
    const failures = await mutate((run) => ({ ...run, stderr: 'warning', code: 1, badTraceLines: ['{oops'] }));
    expect(has(failures, 'OUT-1')).toBe(true);
    expect(has(failures, 'RUN-1')).toBe(true);
    expect(has(failures, 'TRACE-1')).toBe(true);
  });

  it('catches a malformed block, a second result and output after a result (OUT-2, ORD-1, ORD-2)', async () => {
    const failures = await mutate((run) => ({ ...run, stdout: `${run.stdout}WOID:WO-1|RESULT:requires_review\nREASON:again\n\nnot a frame\n\n` }));
    expect(has(failures, 'OUT-2')).toBe(true);
    expect(has(failures, 'ORD-1 second result for WO-1')).toBe(true);
    expect(has(failures, 'ORD-2')).toBe(true);
  });

  it('catches a scheduled result without both confirmations just before it (ACC-2)', async () => {
    const failures = await mutate((run) => ({ ...run, stdout: run.stdout.replace(/WOID:WO-1\|ROLE:handyman\nConfirmado[^\n]*\n\n/, '') }));
    expect(has(failures, 'ACC-2 WO-1')).toBe(true);
  });

  it('catches a frame to the handyman in English and a tenant frame in the wrong language (COM-1, COM-2)', async () => {
    const failures = await mutate((run) => ({
      ...run,
      stdout: run.stdout.replace(/(WOID:WO-2\|ROLE:handyman\n)[^\n]*/, '$1The previous proposal is cancelled and we propose the visit for you on Thursday.').replace(/(WOID:WO-2\|ROLE:tenant\n)[^\n]*/, '$1Hello, we propose the visit for you on Thursday, please tell us.'),
    }));
    expect(has(failures, 'COM-1 WO-2')).toBe(true);
    expect(has(failures, 'COM-2 WO-2')).toBe(true);
  });

  it("catches a party's words forwarded to the other party and a forbidden text (LLM-2)", async () => {
    const failures = checkRun(
      { ...scenario, mustNotReach: [{ role: 'handyman', text: 'secret 7731' }] },
      await (async () => {
        const run = structuredClone(await cleanRun());
        run.trace.push({ timestamp: 'x', work_order_id: 'WO-2', event_type: 'line_classified', detail: { classification: 'message', role: 'tenant', body: 'the door code is secret 7731' } });
        return { ...run, stdout: run.stdout.replace(/(WOID:WO-2\|ROLE:handyman\n)([^\n]*)/, '$1$2 the door code is secret 7731') };
      })(),
    );
    expect(has(failures, 'LLM-2 tenant text forwarded to handyman')).toBe(true);
    expect(has(failures, 'LEAK "secret 7731"')).toBe(true);
  });

  it('catches overlapping holds, a hold that is not 2 hours, one before the reference time, and a re-proposal onto a refused slot (SCHED-1, SCHED-2, SCHED-5, REQ-NG-11)', async () => {
    const failures = await mutate((run) => {
      const hold = (id: string, start: string, end: string): TraceLine => ({ timestamp: 'x', work_order_id: id, event_type: 'hold_taken', detail: { version: 9, start, end } });
      const repropose: TraceLine = { timestamp: 'x', work_order_id: 'WO-2', event_type: 'decision', detail: { outcome: 'repropose', cause: 'decline', version: 9, start: '2026-11-04T15:00:00+01:00', end: '2026-11-04T17:00:00+01:00' } };
      const index = run.trace.findIndex((line) => line.event_type === 'hold_taken' && line.work_order_id === 'WO-2');
      run.trace.splice(index + 1, 0, repropose, hold('WO-3', '2026-11-04T14:30:00+01:00', '2026-11-04T15:30:00+01:00'), hold('WO-4', '2026-11-03T09:00:00+01:00', '2026-11-03T11:00:00+01:00'));
      return run;
    });
    expect(has(failures, 'SCHED-1 WO-3')).toBe(true);
    expect(has(failures, 'SCHED-2 WO-3')).toBe(true);
    expect(has(failures, 'SCHED-5 WO-4')).toBe(true);
    expect(has(failures, 'REQ-NG-11 WO-2')).toBe(true);
  });

  it('catches a wrong offset, a mismatch with the traced result and every kind of expectation (TIME-1, ACC-3)', async () => {
    const failures = await mutate((run) => ({ ...run, stdout: run.stdout.replace('SCHEDULED_FOR:2026-11-04T12:00:00+01:00', 'SCHEDULED_FOR:2026-11-04T12:00:00+02:00') }));
    expect(has(failures, 'TIME-1 WO-1')).toBe(true);
    expect(has(failures, 'ACC-3 WO-1')).toBe(true);
    expect(has(failures, 'EXPECT WO-1: wanted at')).toBe(true);
    const wrong = checkRun({ ...scenario, expect: { 'WO-1': { result: 'requires_review' }, 'WO-2': { result: 'requires_review', codes: ['escalated'] } }, traceHas: [{ event_type: 'blackout_recorded' }] }, await cleanRun());
    expect(has(wrong, 'EXPECT WO-1: wanted requires_review')).toBe(true);
    expect(has(wrong, 'EXPECT WO-2: wanted code escalated')).toBe(true);
    expect(has(wrong, 'TRACE expected blackout_recorded')).toBe(true);
  });
});

describe('the scenario sets (spec 014 AC-1.1, AC-2.2)', () => {
  const sets = { core, language, calendar, protocol };
  const all = Object.values(sets).flat();

  it('load, have unique names and a purpose, and every expected order exists in their CSV', () => {
    expect(all.length).toBeGreaterThanOrEqual(90);
    expect(new Set(all.map((entry) => entry.name)).size).toBe(all.length);
    for (const entry of all) {
      expect(entry.about.length, entry.name).toBeGreaterThan(10);
      const ids = new Set(entry.csv.map((row) => row.split(',')[0]!.trim()));
      for (const id of Object.keys(entry.expect)) expect(ids.has(id), `${entry.name}: ${id}`).toBe(true);
    }
  });
});
