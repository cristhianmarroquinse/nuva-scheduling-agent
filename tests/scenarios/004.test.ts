import { describe, expect, it } from 'vitest';
import { readdirSync } from 'node:fs';
import { scenarioFailures, scenarioRun, stdoutBlocks, type TraceLine } from './runner.js';
import { ANSWER_PROMPT_VERSION } from '../../src/interpreter/schema.js';

const SCENARIO_DIR = new URL('.', import.meta.url).pathname;

// Protocol-visible behaviour of feature 004: negotiation, through the real entry point with the fake interpreter.

const SPAWN_TIMEOUT = 20_000;

async function expectScenario(name: string): Promise<void> {
  const { scenario, output } = await scenarioRun(name);
  expect(scenarioFailures(scenario, output)).toEqual([]);
}

const scenarioNames = (): string[] => readdirSync(SCENARIO_DIR).filter((file) => /^004-.*\.txt$/.test(file)).map((file) => file.replace(/\.txt$/, ''));
const events = (trace: TraceLine[], type: string) => trace.filter((line) => line.event_type === type);
const headers = (stdout: string) => stdoutBlocks(stdout).map((block) => block.split('\n')[0]!);
const frames = (stdout: string) => stdoutBlocks(stdout).filter((block) => /^WOID:[^|]+\|ROLE:/.test(block));
const detail = <T,>(line: TraceLine) => line.detail as T;

describe('US1 · a decline or counter-proposal leads to a new concrete proposal', () => {
  it('004-decline-reproposes: a decline moves the hold to the next free slot, tells both parties the previous proposal is cancelled, and both must accept again (AC-1.1, AC-2.1, AC-2.2, AC-2.4; 008 AC-1.2)', async () => {
    await expectScenario('004-decline-reproposes');
    const { output } = await scenarioRun('004-decline-reproposes');
    expect(frames(output.stdout).filter((frame) => frame.includes('previous proposal is cancelled') || frame.includes('propuesta anterior queda cancelada'))).toHaveLength(2);
    // 008 AC-1.2: v2 no longer overlaps the declined 12:00–14:00.
    expect(output.stdout).toContain('SCHEDULED_FOR:2026-11-04T14:00:00+01:00');
  }, SPAWN_TIMEOUT);

  it('004-counter-range: a stated range gets the first free slot inside it, and the order can then be scheduled there (AC-1.2, AC-2.1)', async () => {
    await expectScenario('004-counter-range');
    const { output } = await scenarioRun('004-counter-range');
    expect(output.stdout).toContain('Thursday 5 November 2026, 15:00 to 17:00');
    expect(output.stdout).toContain('SCHEDULED_FOR:2026-11-05T15:00:00+01:00');
  }, SPAWN_TIMEOUT);

  it('004-counter-point-evening: a time the business window would refuse is honoured when the party offers it (AC-1.3)', async () => {
    await expectScenario('004-counter-point-evening');
    const { output } = await scenarioRun('004-counter-point-evening');
    expect(output.stdout).toContain('Wednesday 4 November 2026, 20:00 to 22:00');
  }, SPAWN_TIMEOUT);

  it('004-counter-date-weekend: a date alone is the whole day from 07:00, weekends included (AC-1.3, AC-1.4)', async () => {
    await expectScenario('004-counter-date-weekend');
    const { output } = await scenarioRun('004-counter-date-weekend');
    expect(output.stdout).toContain('Sunday 8 November 2026, 07:00 to 09:00');
  }, SPAWN_TIMEOUT);

  it('004-counter-past: a past date does not fit; the next free slot is proposed with a note to the tenant (AC-1.5, AC-1.6)', async () => {
    await expectScenario('004-counter-past');
    const { output } = await scenarioRun('004-counter-past');
    const [tenantFrame, handymanFrame] = frames(output.stdout).slice(2);
    expect(tenantFrame).toContain('The times you suggested are not available.');
    expect(handymanFrame).not.toContain('no están disponibles');
  }, SPAWN_TIMEOUT);

  it('004-counter-no-fit: a time whose visit would end after 22:00 does not fit; the nearest slot that day is proposed (AC-1.6; 009 AC-3.1)', async () => {
    await expectScenario('004-counter-no-fit');
    const { output } = await scenarioRun('004-counter-no-fit');
    expect(output.stdout).toContain('The times you suggested are not available.');
  }, SPAWN_TIMEOUT);

  it("004-counter-held: a counter onto another order's held hour never takes it (AC-1.5, SCHED-1)", async () => {
    await expectScenario('004-counter-held');
    const { output } = await scenarioRun('004-counter-held');
    const held = events(output.trace, 'hold_taken').map((line) => [line.work_order_id, detail<{ start: string }>(line).start]);
    expect(held).toEqual([
      ['WO-1', '2026-11-04T12:00:00+01:00'],
      ['WO-2', '2026-11-04T14:00:00+01:00'],
      // 008 AC-1.2: the no-fit fallback does not overlap the countered 14:00–16:00.
      ['WO-2', '2026-11-04T16:00:00+01:00'],
    ]);
    expect(events(output.trace, 'hold_released').filter((line) => line.work_order_id === 'WO-1').map((line) => detail<{ reason: string }>(line).reason)).toEqual(['closed']);
  }, SPAWN_TIMEOUT);

  it('004-mismatch-accept: a yes naming another time is a counter-proposal with that time (AC-1.7)', async () => {
    await expectScenario('004-mismatch-accept');
    const { output } = await scenarioRun('004-mismatch-accept');
    expect(output.stdout).toContain('Thursday 5 November 2026, 10:00 to 12:00');
  }, SPAWN_TIMEOUT);

  it('004-handyman-counter: the handyman is handled by the same rules and both parties get the new proposal (AC-1.8)', async () => {
    await expectScenario('004-handyman-counter');
    const { output } = await scenarioRun('004-handyman-counter');
    expect(headers(output.stdout).slice(2, 4)).toEqual(['WOID:WO-1|ROLE:tenant', 'WOID:WO-1|ROLE:handyman']);
  }, SPAWN_TIMEOUT);

  it('004-counter-dst: a counter across 2026-10-25 gets the new offset (AC-1.2, TIME-1)', async () => {
    await expectScenario('004-counter-dst');
    const { output } = await scenarioRun('004-counter-dst');
    expect(output.stdout).toContain('Monday 26 October 2026, 10:00 to 12:00');
    expect(events(output.trace, 'hold_taken').map((line) => detail<{ start: string }>(line).start)).toEqual(['2026-10-25T08:00:00+01:00', '2026-10-26T10:00:00+01:00']);
  }, SPAWN_TIMEOUT);
});

describe('US2 and US3 · versions, confirmation and the refusal limit', () => {
  it('004-two-versions-bare-yes: a bare yes after two unanswered versions gets a confirmation question; a yes naming the slot counts (AC-2.3)', async () => {
    await expectScenario('004-two-versions-bare-yes');
    const { output } = await scenarioRun('004-two-versions-bare-yes');
    expect(output.stdout).toContain('To confirm: does the visit for "Leaking tap" on Wednesday 4 November 2026, 14:00 to 16:00');
    expect(output.stdout).toContain('SCHEDULED_FOR:2026-11-04T14:00:00+01:00'); // v2 moved by 008 AC-1.2
  }, SPAWN_TIMEOUT);

  it('004-three-refusals: the third refusal by the tenant closes the order as no_mutual_slot and the handyman gets nothing more (AC-3.1, AC-3.2)', async () => {
    await expectScenario('004-three-refusals');
    const { output } = await scenarioRun('004-three-refusals');
    expect(output.stdout).toContain('REASON:The tenant declined or countered three proposals.');
    const lastHandymanFrame = headers(output.stdout).lastIndexOf('WOID:WO-1|ROLE:handyman');
    const result = headers(output.stdout).indexOf('WOID:WO-1|RESULT:requires_review');
    expect(events(output.trace, 'hold_taken')).toHaveLength(3);
    expect(lastHandymanFrame).toBeLessThan(result);
  }, SPAWN_TIMEOUT);

  it('004-limits-per-party: two refusals by the tenant and one by the handyman leave the order open (AC-3.1)', async () => {
    await expectScenario('004-limits-per-party');
    const { output } = await scenarioRun('004-limits-per-party');
    expect(output.stdout).not.toContain('no_mutual_slot');
    expect(events(output.trace, 'hold_taken')).toHaveLength(4);
  }, SPAWN_TIMEOUT);

  it('004-question-not-counted: a question does not count toward the limit (AC-3.3, AC-5.5)', async () => {
    await expectScenario('004-question-not-counted');
    const { output } = await scenarioRun('004-question-not-counted');
    expect(output.stdout).not.toContain('declined or countered');
    expect(output.stdout).toContain('Yes, please be at home during the visit.');
  }, SPAWN_TIMEOUT);

  it('004-withdraw: a withdrawal before scheduling re-proposes and counts; after scheduling it is ignored (AC-3.1, AC-4.1, AC-4.2)', async () => {
    await expectScenario('004-withdraw');
    const { output } = await scenarioRun('004-withdraw');
    expect(events(output.trace, 'interpretation')).toHaveLength(4);
    const scheduledAt = headers(output.stdout).indexOf('WOID:WO-1|RESULT:scheduled');
    expect(headers(output.stdout).slice(scheduledAt + 1).filter((header) => header.startsWith('WOID:WO-1|'))).toEqual([]);
  }, SPAWN_TIMEOUT);
});

describe('US5 and US6 · questions and cross-references', () => {
  it('004-question-answered: the model answer goes to the asker only, with the slot reminder, and the proposal stays (AC-5.1, AC-5.2, AC-5.4, LLM-2)', async () => {
    await expectScenario('004-question-answered');
    const { output } = await scenarioRun('004-question-answered');
    const answerFrames = frames(output.stdout).filter((frame) => frame.includes('Sí, hay aparcamiento en la calle.'));
    expect(answerFrames).toHaveLength(1);
    expect(answerFrames[0]).toMatch(/^WOID:WO-1\|ROLE:handyman\n/);
    expect(answerFrames[0]).toContain('Te recuerdo que la visita propuesta por «Leaking tap» es el miércoles 4 de noviembre de 2026, de 12:00 a 14:00 (hora de Madrid).');
    expect(events(output.trace, 'hold_taken')).toHaveLength(1);
    const call = detail<{ purpose: string; model: string; prompt_version: string; latency_ms: number; tokens: unknown; outcome: string }>(events(output.trace, 'model_call').find((line) => detail<{ purpose?: string }>(line).purpose === 'answer')!);
    expect(call).toMatchObject({ purpose: 'answer', model: 'fake', prompt_version: ANSWER_PROMPT_VERSION, outcome: 'ok' });
  }, SPAWN_TIMEOUT);

  it("004-question-answer-rejected: a foreign time, the other party's words and a failing call each become the fixed office sentence (AC-5.3)", async () => {
    await expectScenario('004-question-answer-rejected');
    const { output } = await scenarioRun('004-question-answer-rejected');
    expect(frames(output.stdout).filter((frame) => frame.includes('We will check with the office and get back to you.'))).toHaveLength(3);
    expect(output.stdout).not.toContain('09:00');
    expect(output.stdout).not.toContain('He asked');
  }, SPAWN_TIMEOUT);

  it('004-cross-reference: a clarification, then review as cross_reference (AC-6.1, AC-6.2, AC-6.3)', async () => {
    await expectScenario('004-cross-reference');
    const { output } = await scenarioRun('004-cross-reference');
    expect(output.stdout).toContain('We think you are referring to another work order.');
    expect(output.stdout).toContain('REASON:The tenant kept referring to a different work order.');
  }, SPAWN_TIMEOUT);
});

describe('across every 004 scenario', () => {
  it('model-written text goes only to the asker, every re-proposal reaches both parties with a moved hold, and live holds never overlap (LLM-2, SCHED-1)', async () => {
    const names = scenarioNames();
    expect(names.length).toBeGreaterThanOrEqual(18);
    for (const name of names) {
      const { output } = await scenarioRun(name);
      const asked = new Map(events(output.trace, 'interpretation').filter((line) => detail<{ result: { intent: string } }>(line).result.intent === 'question').map((line) => [`${line.work_order_id}:${detail<{ seq: number }>(line).seq}`, detail<{ role: string }>(line).role]));
      for (const sent of events(output.trace, 'msg_out').filter((line) => detail<{ source: string }>(line).source === 'model')) {
        const answerFact = events(output.trace, 'answer').find((line) => line.work_order_id === sent.work_order_id && detail<{ role: string }>(line).role === detail<{ to: string }>(sent).to);
        expect(answerFact, `${name}: model text to ${detail<{ to: string }>(sent).to}`).toBeDefined();
        expect(asked.get(`${sent.work_order_id}:${detail<{ seq: number }>(answerFact!).seq}`), `${name}: asker`).toBe(detail<{ to: string }>(sent).to);
      }
      for (const repropose of events(output.trace, 'decision').filter((line) => detail<{ outcome: string }>(line).outcome === 'repropose')) {
        const version = detail<{ version: number }>(repropose).version;
        const toBoth = events(output.trace, 'msg_out').filter((line) => line.work_order_id === repropose.work_order_id && detail<{ version: number }>(line).version === version).map((line) => detail<{ to: string }>(line).to);
        expect(toBoth.slice(0, 2), `${name}: v${version}`).toEqual(['tenant', 'handyman']);
        expect(events(output.trace, 'hold_taken').some((line) => line.work_order_id === repropose.work_order_id && detail<{ version: number }>(line).version === version), `${name}: hold v${version}`).toBe(true);
      }
      const live = new Map<string, { start: string; end: string }>();
      for (const line of output.trace) {
        if (line.event_type === 'hold_taken') live.set(`${line.work_order_id}`, detail<{ start: string; end: string }>(line));
        if (line.event_type === 'hold_released') live.delete(`${line.work_order_id}`);
        const holds = [...live.entries()];
        for (const [a, sa] of holds) for (const [b, sb] of holds) if (a !== b) expect(sa.start < sb.end && sb.start < sa.end, `${name}: ${a} overlaps ${b}`).toBe(false);
      }
    }
  }, SPAWN_TIMEOUT * 6);
});
