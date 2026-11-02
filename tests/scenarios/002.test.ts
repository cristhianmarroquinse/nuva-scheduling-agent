import { describe, expect, it } from 'vitest';
import { readdirSync } from 'node:fs';
import { scenarioFailures, scenarioRun, stdoutBlocks, type TraceLine } from './runner.js';

const SCENARIO_DIR = new URL('.', import.meta.url).pathname;

// Protocol-visible behaviour of feature 002: calendar and initial proposals, through the real entry point.

const SPAWN_TIMEOUT = 20_000;

async function expectScenario(name: string): Promise<void> {
  const { scenario, output } = await scenarioRun(name);
  expect(scenarioFailures(scenario, output)).toEqual([]);
}

const scenarioNames = (): string[] => readdirSync(SCENARIO_DIR).filter((file) => /^002-.*\.txt$/.test(file)).map((file) => file.replace(/\.txt$/, ''));
const holdsOf = (trace: TraceLine[]) => trace.filter((line) => line.event_type === 'hold_taken').map((line) => ({ id: line.work_order_id, ...(line.detail as { start: string; end: string }) }));
const isFrame = (block: string) => /^WOID:[^|]+\|ROLE:/.test(block);

describe('US1 · every order gets a first slot in urgency order', () => {
  it('002-urgency-order: Critical, High, Medium, Low get the earliest consecutive slots regardless of reported_at; holds traced; results after the frames (AC-1.1, AC-1.2, AC-1.3, AC-1.4, AC-3.1, SCHED-1)', async () => {
    await expectScenario('002-urgency-order');
    const { output } = await scenarioRun('002-urgency-order');
    expect(holdsOf(output.trace).map((hold) => hold.id)).toEqual(['WO-CRIT', 'WO-HIGH', 'WO-MED', 'WO-LOW']);
  }, SPAWN_TIMEOUT);

  it('002-invalid-row-no-proposal: an invalid row gets its result and neither a hold nor a frame (AC-1.5)', async () => {
    await expectScenario('002-invalid-row-no-proposal');
    const { output } = await scenarioRun('002-invalid-row-no-proposal');
    expect(holdsOf(output.trace).map((hold) => hold.id)).toEqual(['WO-OK']);
    expect(output.trace.filter((line) => line.event_type === 'msg_out').map((line) => line.work_order_id)).toEqual(['WO-OK', 'WO-OK']);
  }, SPAWN_TIMEOUT);

  it('002-many-orders: 12 orders from Monday 07:00 spill over three working days, 5 + 5 + 2, with no overlapping hold (AC-1.3, AC-2.5, SCHED-1)', async () => {
    await expectScenario('002-many-orders');
    const { output } = await scenarioRun('002-many-orders');
    const holds = holdsOf(output.trace);
    expect(holds).toHaveLength(12);
    const perDay = holds.reduce<Record<string, number>>((acc, hold) => ({ ...acc, [hold.start.slice(0, 10)]: (acc[hold.start.slice(0, 10)] ?? 0) + 1 }), {});
    expect(perDay).toEqual({ '2026-11-02': 5, '2026-11-03': 5, '2026-11-04': 2 });
    for (const a of holds) for (const b of holds) if (a !== b) expect(a.start < b.end && b.start < a.end, `${a.id} overlaps ${b.id}`).toBe(false);
  }, SPAWN_TIMEOUT);
});

describe('US2 · proposed slots respect the calendar rules', () => {
  it('002-dst-weekend: Saturday 20:00 +02:00 gives a Critical slot Sunday 08:00 +01:00 and a High slot Monday 09:00 +01:00, in frames and traces (AC-2.3, AC-2.4, AC-2.6, SCHED-2, TIME-1)', async () => {
    await expectScenario('002-dst-weekend');
    const { output } = await scenarioRun('002-dst-weekend');
    expect(holdsOf(output.trace)).toEqual([
      { id: 'WO-C', version: 1, start: '2026-10-25T08:00:00+01:00', end: '2026-10-25T10:00:00+01:00' },
      { id: 'WO-H', version: 1, start: '2026-10-26T09:00:00+01:00', end: '2026-10-26T11:00:00+01:00' },
    ]);
  }, SPAWN_TIMEOUT);
});

describe('US3 · both parties receive the proposal, each in their language', () => {
  it('002-languages: tenant frames in es and en, handyman frames in Spanish, each with weekday, date, time range and title (AC-3.2, AC-3.3, AC-3.4, AC-3.6, COM-1, COM-2, COM-3)', async () => {
    await expectScenario('002-languages');
    const { output } = await scenarioRun('002-languages');
    const blocks = stdoutBlocks(output.stdout).filter(isFrame);
    expect(blocks.filter((block) => block.includes('|ROLE:handyman')).every((block) => block.includes('Nueva visita propuesta') && block.includes('miércoles 4 de noviembre de 2026'))).toBe(true);
    expect(blocks.find((block) => block.startsWith('WOID:WO-ES|ROLE:tenant'))).toContain('Hola. Le escribimos por su aviso «Grifo que gotea»');
    expect(blocks.find((block) => block.startsWith('WOID:WO-EN|ROLE:tenant'))).toContain('Hello. We are writing about your report "Leaking tap"');
    expect(blocks.find((block) => block.startsWith('WOID:WO-EN|ROLE:tenant'))).toContain('Wednesday 4 November 2026, 14:00 to 16:00 (Madrid time)');
  }, SPAWN_TIMEOUT);

  it('002-handyman-frame: the handyman frame names the title, address and urgency, and neither frame contains the description (AC-3.5)', async () => {
    await expectScenario('002-handyman-frame');
    const { output } = await scenarioRun('002-handyman-frame');
    const handyman = stdoutBlocks(output.stdout).find((block) => block.startsWith('WOID:WO-1|ROLE:handyman'))!;
    expect(handyman).toContain('«Boiler leak»');
    expect(handyman).toContain('Calle Mayor 1, 2ºB');
    expect(handyman).toContain('urgencia alta');
    expect(output.stdout).not.toContain('leaks water');
  }, SPAWN_TIMEOUT);

  it('002-critical-112: the 112 clause appears once in each Critical tenant frame, in its language, and nowhere else (AC-3.7)', async () => {
    await expectScenario('002-critical-112');
    const { output } = await scenarioRun('002-critical-112');
    const withClause = stdoutBlocks(output.stdout).filter((block) => block.includes('112'));
    expect(withClause.map((block) => block.split('\n')[0])).toEqual(['WOID:WO-C-ES|ROLE:tenant', 'WOID:WO-C-EN|ROLE:tenant']);
    expect(withClause[0]).toContain('Si hay peligro inmediato, llame al 112.');
    expect(withClause[1]).toContain('If there is immediate danger, call 112.');
    expect(output.stdout.match(/112/g)).toHaveLength(2);
  }, SPAWN_TIMEOUT);

  it('every frame of every 002 scenario is traced as msg_out with recipient, language, version, slot and the body written (AC-3.8)', async () => {
    for (const name of scenarioNames()) {
      const { output } = await scenarioRun(name);
      const frames = stdoutBlocks(output.stdout).filter(isFrame);
      const sent = output.trace.filter((line) => line.event_type === 'msg_out');
      expect(sent, name).toHaveLength(frames.length);
      frames.forEach((frame, index) => {
        const [header, ...body] = frame.split('\n');
        const detail = sent[index]!.detail as Record<string, unknown>;
        expect(header, name).toBe(`WOID:${sent[index]!.work_order_id}|ROLE:${String(detail['to'])}`);
        expect(detail['body'], name).toBe(body.join('\n'));
        expect(['es', 'en'], name).toContain(detail['language']);
        expect(detail['version'], name).toBe(1);
        expect(String(detail['start']), name).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:00:00[+-]\d{2}:\d{2}$/);
        expect(String(detail['end']), name).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:00:00[+-]\d{2}:\d{2}$/);
      });
    }
  }, SPAWN_TIMEOUT * 4);
});

describe('US4 · startup frames come first and the run still ends cleanly', () => {
  it('002-queued-input-first: with lines and EOF queued before startup, every initial frame precedes anything caused by input, in allocation order; holds are released at EOF (AC-4.1, AC-4.2, AC-4.3, AC-4.4, RUN-2)', async () => {
    await expectScenario('002-queued-input-first');
    const { output } = await scenarioRun('002-queued-input-first');
    const blocks = stdoutBlocks(output.stdout);
    // The six initial proposals come first (allocation order); answers to the queued lines and the results follow.
    expect(blocks.slice(0, 6).map((block) => block.split('\n')[0])).toEqual([
      'WOID:WO-2|ROLE:tenant',
      'WOID:WO-2|ROLE:handyman',
      'WOID:WO-1|ROLE:tenant',
      'WOID:WO-1|ROLE:handyman',
      'WOID:WO-3|ROLE:tenant',
      'WOID:WO-3|ROLE:handyman',
    ]);
    const firstResult = blocks.findIndex((block) => !isFrame(block));
    expect(firstResult).toBeGreaterThanOrEqual(6);
    expect(blocks.slice(firstResult).every((block) => !isFrame(block))).toBe(true);
    expect(output.trace.filter((line) => line.event_type === 'hold_released')).toHaveLength(3);
  }, SPAWN_TIMEOUT);

  it('every trace line of every 002 scenario is JSON with the four fields, and every result has one state_change (TRACE-1)', async () => {
    const names = scenarioNames();
    expect(names.length).toBeGreaterThanOrEqual(8);
    for (const name of names) {
      const { output } = await scenarioRun(name);
      for (const raw of output.rawTrace.split('\n').filter((line) => line !== '')) {
        expect(Object.keys(JSON.parse(raw) as object).sort(), `${name}: ${raw}`).toEqual(['detail', 'event_type', 'timestamp', 'work_order_id']);
      }
      for (const block of stdoutBlocks(output.stdout)) {
        const id = /^WOID:(.+)\|RESULT:/.exec(block)?.[1];
        if (id === undefined) continue;
        expect(output.trace.filter((line) => line.event_type === 'state_change' && line.work_order_id === id), `${name}: ${id}`).toHaveLength(1);
      }
    }
  }, SPAWN_TIMEOUT * 4);
});
