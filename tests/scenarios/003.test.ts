import { describe, expect, it } from 'vitest';
import { readdirSync } from 'node:fs';
import { scenarioFailures, scenarioRun, stdoutBlocks, type TraceLine } from './runner.js';

const SCENARIO_DIR = new URL('.', import.meta.url).pathname;

// Protocol-visible behaviour of feature 003: the interpretation boundary and acceptance, through the real entry point
// with the fake interpreter (never the network).

const SPAWN_TIMEOUT = 20_000;

async function expectScenario(name: string): Promise<void> {
  const { scenario, output } = await scenarioRun(name);
  expect(scenarioFailures(scenario, output)).toEqual([]);
}

const scenarioNames = (): string[] => readdirSync(SCENARIO_DIR).filter((file) => /^003-.*\.txt$/.test(file)).map((file) => file.replace(/\.txt$/, ''));
const events = (trace: TraceLine[], type: string) => trace.filter((line) => line.event_type === type);
const headers = (stdout: string) => stdoutBlocks(stdout).map((block) => block.split('\n')[0]!);

describe('US2 · acceptance is decided by code', () => {
  it('003-both-accept: a yes from each party, both on the fast path, gives an acknowledgement, two confirmations and a scheduled result at the proposal start (AC-1.1, AC-1.3, AC-2.4, AC-2.6, AC-2.8, ACC-1, ACC-2, ACC-3)', async () => {
    await expectScenario('003-both-accept');
    const { output } = await scenarioRun('003-both-accept');
    expect(events(output.trace, 'model_call')).toEqual([]);
    expect(events(output.trace, 'interpretation')).toHaveLength(2);
    expect(headers(output.stdout)).toEqual([
      'WOID:WO-1|ROLE:tenant',
      'WOID:WO-1|ROLE:handyman',
      'WOID:WO-1|ROLE:tenant',
      'WOID:WO-1|ROLE:tenant',
      'WOID:WO-1|ROLE:handyman',
      'WOID:WO-1|RESULT:scheduled',
    ]);
    expect(output.stdout).toContain('SCHEDULED_FOR:2026-11-04T12:00:00+01:00');
  }, SPAWN_TIMEOUT);

  it('003-accept-with-range: a scripted accept whose range contains the visit is accepted and the model call is traced (AC-1.4, AC-2.1)', async () => {
    await expectScenario('003-accept-with-range');
    const { output } = await scenarioRun('003-accept-with-range');
    expect(events(output.trace, 'model_call').map((line) => (line.detail as { outcome: string }).outcome)).toEqual(['ok']);
    expect(headers(output.stdout).at(-1)).toBe('WOID:WO-1|RESULT:scheduled');
  }, SPAWN_TIMEOUT);

  it('003-accept-mismatch: an accept naming another date is not an acceptance; since 004 it is a counter-proposal that gets a new slot (AC-2.2; 004 AC-1.7)', async () => {
    await expectScenario('003-accept-mismatch');
    const { output } = await scenarioRun('003-accept-mismatch');
    expect(headers(output.stdout)).toEqual(['WOID:WO-1|ROLE:tenant', 'WOID:WO-1|ROLE:handyman', 'WOID:WO-1|ROLE:tenant', 'WOID:WO-1|ROLE:handyman', 'WOID:WO-1|RESULT:requires_review']);
  }, SPAWN_TIMEOUT);

  it('003-accept-with-constraint: an accept with an exclusion gets a one-line confirmation question; the bare yes after it counts (AC-2.3)', async () => {
    await expectScenario('003-accept-with-constraint');
    const { output } = await scenarioRun('003-accept-with-constraint');
    expect(output.stdout).toContain('To confirm: does the visit for "Leaking tap" on Wednesday 4 November 2026, 12:00 to 14:00 (Madrid time) work for you?');
    expect(output.stdout).toContain('Thank you, noted.');
  }, SPAWN_TIMEOUT);

  it('003-accept-twice: a second yes from the same party is recorded and sends nothing (AC-2.5)', async () => {
    await expectScenario('003-accept-twice');
    const { output } = await scenarioRun('003-accept-twice');
    expect(headers(output.stdout).filter((header) => header === 'WOID:WO-1|ROLE:tenant')).toHaveLength(2); // proposal + one acknowledgement
  }, SPAWN_TIMEOUT);

  it('003-accept-then-eof: one acceptance and then end of input closes as no_response, releasing the hold, never as scheduled (AC-4.2, ORD-1)', async () => {
    await expectScenario('003-accept-then-eof');
    const { output } = await scenarioRun('003-accept-then-eof');
    expect(output.stdout).not.toContain('RESULT:scheduled');
    expect(headers(output.stdout).filter((header) => header.includes('|RESULT:'))).toHaveLength(1);
  }, SPAWN_TIMEOUT);

  it('003-scheduled-dst: a Critical visit accepted across 2026-10-25 is scheduled at 08:00 +01:00 and the other order still closes at EOF (AC-2.6, AC-2.7, TIME-1)', async () => {
    await expectScenario('003-scheduled-dst');
    const { output } = await scenarioRun('003-scheduled-dst');
    expect(output.stdout).toContain('SCHEDULED_FOR:2026-10-25T08:00:00+01:00');
    expect(output.stdout).toContain('domingo 25 de octubre de 2026, de 08:00 a 10:00');
    expect(events(output.trace, 'hold_released').map((line) => line.work_order_id)).toEqual(['WO-H']);
  }, SPAWN_TIMEOUT);

  it('003-closed-order-line: a line for a scheduled order is traced as closed_order and nothing more is sent for it (ORD-2)', async () => {
    await expectScenario('003-closed-order-line');
    const { output } = await scenarioRun('003-closed-order-line');
    const scheduledAt = headers(output.stdout).indexOf('WOID:WO-1|RESULT:scheduled');
    expect(headers(output.stdout).slice(scheduledAt + 1).some((header) => header.startsWith('WOID:WO-1|'))).toBe(false);
  }, SPAWN_TIMEOUT);
});

describe('traces of feature 003', () => {
  it('no scenario schedules an order without an accept interpretation from each party for that version, and every trace line has the four fields (TRACE-1)', async () => {
    const names = scenarioNames();
    expect(names.length).toBeGreaterThanOrEqual(8);
    for (const name of names) {
      const { output } = await scenarioRun(name);
      for (const raw of output.rawTrace.split('\n').filter((line) => line !== '')) {
        expect(Object.keys(JSON.parse(raw) as object).sort(), `${name}: ${raw}`).toEqual(['detail', 'event_type', 'timestamp', 'work_order_id']);
      }
      for (const line of events(output.trace, 'result')) {
        const detail = line.detail as { kind: string };
        if (detail.kind !== 'scheduled') continue;
        const accepts = events(output.trace, 'interpretation').filter((entry) => entry.work_order_id === line.work_order_id && (entry.detail as { result: { intent: string } }).result.intent === 'accept');
        expect(new Set(accepts.map((entry) => (entry.detail as { role: string }).role)), `${name}: ${line.work_order_id}`).toEqual(new Set(['tenant', 'handyman']));
        const confirmations = events(output.trace, 'msg_out').filter((entry) => entry.work_order_id === line.work_order_id);
        expect(confirmations.length, `${name}: confirmations before result (ACC-2)`).toBeGreaterThanOrEqual(4);
      }
    }
  }, SPAWN_TIMEOUT * 4);
});

describe('US3 · unclear replies get one chance, then review', () => {
  it('003-unclear-twice: one clarification, then interpretation_failed with a one-line reason (AC-3.1, AC-3.2, AC-3.5)', async () => {
    await expectScenario('003-unclear-twice');
    const { output } = await scenarioRun('003-unclear-twice');
    expect(output.stdout).toContain('Sorry, we did not understand your reply.');
    expect(output.stdout).toContain('REASON:Two consecutive replies from the tenant could not be understood.');
  }, SPAWN_TIMEOUT);

  it('003-contradictory: an unclear reply followed by a contradictory one closes as contradictory_replies (AC-3.2)', async () => {
    await expectScenario('003-contradictory');
    const { output } = await scenarioRun('003-contradictory');
    expect(output.stdout).toContain('REASON:The tenant gave two consecutive replies that could not be reconciled with the proposed visit.');
  }, SPAWN_TIMEOUT);

  it("003-unclear-reset: a clear reply resets the tenant's count; the handyman's two unclear replies close the order (AC-3.3)", async () => {
    await expectScenario('003-unclear-reset');
    const { output } = await scenarioRun('003-unclear-reset');
    expect(output.stdout).toContain('Perdona, no he entendido tu respuesta.');
    expect(output.stdout).toContain('REASON:Two consecutive replies from the handyman could not be understood.');
  }, SPAWN_TIMEOUT);

  it('003-model-invalid-output: an output with a Z time is re-asked once then recorded unclear; foreign fields are stripped and never set state (AC-1.5, AC-1.6, LLM-1)', async () => {
    await expectScenario('003-model-invalid-output');
    const { output } = await scenarioRun('003-model-invalid-output');
    const problems = events(output.trace, 'model_call').map((line) => (line.detail as { problem?: string }).problem ?? '');
    expect(problems[0]).toContain('start');
    expect(output.stdout).not.toContain('RESULT:scheduled');
    expect(output.stdout).toContain('Thank you, noted.');
    const recorded = events(output.trace, 'interpretation')[1]!.detail as { result: Record<string, unknown> };
    expect(Object.keys(recorded.result).sort()).toEqual(['exclusions', 'intent', 'quote', 'times']);
  }, SPAWN_TIMEOUT);

  it('003-model-failure: the first model failure gets a clarification, the second closes the order as llm_unavailable (AC-1.7, AC-3.4)', async () => {
    await expectScenario('003-model-failure');
    const { output } = await scenarioRun('003-model-failure');
    expect(events(output.trace, 'llm_error')).toHaveLength(2);
    expect(events(output.trace, 'interpretation')).toEqual([]);
    expect(output.stdout).toContain('REASON:The reply interpreter was unavailable twice in a row for this order.');
  }, SPAWN_TIMEOUT);
});

