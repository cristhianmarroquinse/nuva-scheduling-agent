import { describe, expect, it } from 'vitest';
import { readdirSync } from 'node:fs';
import { scenarioFailures, scenarioRun, stdoutBlocks, type TraceLine } from './runner.js';

const SCENARIO_DIR = new URL('.', import.meta.url).pathname;

// Protocol-visible behaviour of feature 005: timeouts, preemption and handyman blackouts, through the real entry point.

const SPAWN_TIMEOUT = 20_000;

async function expectScenario(name: string): Promise<void> {
  const { scenario, output } = await scenarioRun(name);
  expect(scenarioFailures(scenario, output)).toEqual([]);
}

const scenarioNames = (): string[] => readdirSync(SCENARIO_DIR).filter((file) => /^005-.*\.txt$/.test(file)).map((file) => file.replace(/\.txt$/, ''));
const events = (trace: TraceLine[], type: string) => trace.filter((line) => line.event_type === type);
const headers = (stdout: string) => stdoutBlocks(stdout).map((block) => block.split('\n')[0]!);
const detail = <T,>(line: TraceLine) => line.detail as T;

describe('US1 · a silent party is reminded once, then the order goes to review', () => {
  it('005-timeout-reminder: a first timeout from an awaited party gets a reminder restating the slot (AC-1.2, AC-1.3)', async () => {
    await expectScenario('005-timeout-reminder');
    const { output } = await scenarioRun('005-timeout-reminder');
    expect(output.stdout).toContain('Te recuerdo que sigo pendiente de tu respuesta. La visita propuesta por «Leaking tap» es el miércoles 4 de noviembre de 2026, de 12:00 a 14:00 (hora de Madrid).');
  }, SPAWN_TIMEOUT);

  it('005-timeout-twice: a second timeout closes the order naming the silent party and the accepted slot (AC-1.4)', async () => {
    await expectScenario('005-timeout-twice');
    const { output } = await scenarioRun('005-timeout-twice');
    expect(output.stdout).toContain('REASON:The handyman did not reply after a reminder; the proposed visit was 2026-11-04T12:00:00+01:00, accepted by the tenant.');
  }, SPAWN_TIMEOUT);

  it('005-timeout-reset: a real reply resets the count, so the next timeout is a reminder again (AC-1.5)', async () => {
    await expectScenario('005-timeout-reset');
    const { output } = await scenarioRun('005-timeout-reset');
    expect(events(output.trace, 'decision').filter((line) => detail<{ outcome: string }>(line).outcome === 'remind')).toHaveLength(2);
    expect(output.stdout).not.toContain('did not reply after a reminder');
  }, SPAWN_TIMEOUT);

  it('005-timeout-not-waiting: timeouts from a party that already accepted are traced as not counted and produce no frame (AC-1.2, RUN-3)', async () => {
    await expectScenario('005-timeout-not-waiting');
    const { output } = await scenarioRun('005-timeout-not-waiting');
    expect(headers(output.stdout)).toEqual(['WOID:WO-1|ROLE:tenant', 'WOID:WO-1|ROLE:handyman', 'WOID:WO-1|ROLE:tenant', 'WOID:WO-1|RESULT:requires_review']);
    expect(output.stdout).toContain('REASON:No reply was received before the end of input.');
  }, SPAWN_TIMEOUT);

  it('005-timeout-critical-tenant: the tenant of a Critical order goes to review on the first timeout, stating what is known (AC-1.6)', async () => {
    await expectScenario('005-timeout-critical-tenant');
    const { output } = await scenarioRun('005-timeout-critical-tenant');
    expect(output.stdout).toContain('REASON:The tenant of a critical order did not reply; the proposed visit is 2026-11-04T12:00:00+01:00, accepted by the handyman.');
    expect(output.stdout).not.toContain('A reminder that');
  }, SPAWN_TIMEOUT);

  it('005-timeout-critical-handyman: the handyman of a Critical order gets a reminder like anyone else (AC-1.7)', async () => {
    await expectScenario('005-timeout-critical-handyman');
    const { output } = await scenarioRun('005-timeout-critical-handyman');
    expect(output.stdout).toContain('Te recuerdo que sigo pendiente de tu respuesta.');
  }, SPAWN_TIMEOUT);

  it('005-timeout-closed: a timeout for a scheduled order is traced as closed_order and nothing more is sent (AC-1.8, ORD-2)', async () => {
    await expectScenario('005-timeout-closed');
    const { output } = await scenarioRun('005-timeout-closed');
    const scheduledAt = headers(output.stdout).indexOf('WOID:WO-1|RESULT:scheduled');
    expect(headers(output.stdout).slice(scheduledAt + 1).filter((header) => header.startsWith('WOID:WO-1|'))).toEqual([]);
  }, SPAWN_TIMEOUT);
});

describe('US2 · higher urgency takes over tentative holds, never scheduled visits', () => {
  it('005-preempt-counter: a Critical counter takes the hour a Low order was holding; the Low order is re-proposed, told why, and not penalised (AC-2.1, AC-2.3, AC-2.4, AC-2.5, SCHED-4)', async () => {
    await expectScenario('005-preempt-counter');
    const { output } = await scenarioRun('005-preempt-counter');
    expect(output.stdout).toContain('That slot had to be given to a more urgent job.');
    expect(output.stdout).toContain('Ese hueco se ha dado a un aviso más urgente.');
    const holds = events(output.trace, 'hold_taken').map((line) => [line.work_order_id, detail<{ start: string }>(line).start]);
    expect(holds).toEqual([
      ['WO-C', '2026-11-04T12:00:00+01:00'],
      ['WO-L', '2026-11-04T14:00:00+01:00'],
      ['WO-C', '2026-11-04T14:00:00+01:00'],
      ['WO-L', '2026-11-04T16:00:00+01:00'],
    ]);
  }, SPAWN_TIMEOUT);

  it('005-preempt-equal: equal urgency never takes over; the no-fit rule applies (AC-2.2)', async () => {
    await expectScenario('005-preempt-equal');
    const { output } = await scenarioRun('005-preempt-equal');
    expect(events(output.trace, 'decision').some((line) => detail<{ outcome: string }>(line).outcome === 'takeover')).toBe(false);
    expect(output.stdout).toContain('The times you suggested are not available.');
  }, SPAWN_TIMEOUT);

  it('005-preempt-scheduled: a scheduled visit is never taken over, even by a Critical order (AC-2.2, AC-2.6, SCHED-3)', async () => {
    await expectScenario('005-preempt-scheduled');
    const { output } = await scenarioRun('005-preempt-scheduled');
    expect(events(output.trace, 'hold_released').map((line) => line.work_order_id)).not.toContain('WO-L');
    expect(output.stdout).toContain('SCHEDULED_FOR:2026-11-04T14:00:00+01:00');
    expect(events(output.trace, 'decision').some((line) => detail<{ outcome: string }>(line).outcome === 'takeover')).toBe(false);
  }, SPAWN_TIMEOUT);
});

describe("US3 · the handyman's unavailability applies to every order", () => {
  it('005-blackout-day: a scope-all day off moves every other tentative hold outside it without penalty, then the current order follows its own intent, by priority (AC-3.1, AC-3.2, AC-3.3, AC-3.5; 010 AC-1.2)', async () => {
    await expectScenario('005-blackout-day');
    const { output } = await scenarioRun('005-blackout-day');
    expect(output.stdout).toContain('The handyman is not available at the previous slot.');
    expect(output.stdout).toContain('Movemos la visita por tu indisponibilidad.');
    for (const line of events(output.trace, 'hold_taken').slice(2)) expect(detail<{ start: string }>(line).start, 'moved outside the blackout').toMatch(/^2026-11-05/);
  }, SPAWN_TIMEOUT);

  it('005-blackout-scheduled: a scheduled visit inside the blackout is kept and the conflict is traced (AC-3.4, SCHED-3)', async () => {
    await expectScenario('005-blackout-scheduled');
    const { output } = await scenarioRun('005-blackout-scheduled');
    expect(events(output.trace, 'hold_released').map((line) => line.work_order_id)).not.toContain('WO-2');
    expect(events(output.trace, 'blackout_conflict').map((line) => line.work_order_id)).toEqual(['WO-2']);
  }, SPAWN_TIMEOUT);

  it('005-blackout-this-order: a statement scoped to this order creates no blackout and leaves the other order untouched (AC-3.6)', async () => {
    await expectScenario('005-blackout-this-order');
    const { output } = await scenarioRun('005-blackout-this-order');
    expect(events(output.trace, 'blackout_recorded')).toEqual([]);
    expect(events(output.trace, 'hold_taken').filter((line) => line.work_order_id === 'WO-2')).toHaveLength(1);
  }, SPAWN_TIMEOUT);

  it('005-blackout-weekday: a weekday without a date blocks the next occurrence only, for every order (AC-3.3, AC-3.7)', async () => {
    await expectScenario('005-blackout-weekday');
    const { output } = await scenarioRun('005-blackout-weekday');
    expect(output.stdout).toContain('The times you suggested are not available.');
    for (const line of events(output.trace, 'hold_taken')) expect(detail<{ start: string }>(line).start).not.toMatch(/^2026-11-05/);
  }, SPAWN_TIMEOUT);

  it('005-blackout-dst: a Sunday blackout across 2026-10-25 carries both offsets and the moved slots carry the new one (AC-3.2, TIME-1)', async () => {
    await expectScenario('005-blackout-dst');
    const { output } = await scenarioRun('005-blackout-dst');
    // WO-H still holds Monday 09:00–11:00 when WO-C is moved, so WO-C lands at 11:00 and WO-H, declining, at 13:00.
    expect(output.stdout).toContain('Monday 26 October 2026, 11:00 to 13:00');
    expect(output.stdout).toContain('lunes 26 de octubre de 2026, de 13:00 a 15:00');
  }, SPAWN_TIMEOUT);
});

describe('across every 005 scenario', () => {
  it('no scheduled hold is ever released, every takeover names a strictly lower victim urgency, and no frame follows a timeout from a party that had accepted (SCHED-3, SCHED-4, RUN-3)', async () => {
    const rank: Record<string, number> = { Critical: 0, High: 1, Medium: 2, Low: 3 };
    const names = scenarioNames();
    expect(names.length).toBeGreaterThanOrEqual(7);
    for (const name of names) {
      const { output } = await scenarioRun(name);
      const scheduled = new Set(events(output.trace, 'result').filter((line) => detail<{ kind: string }>(line).kind === 'scheduled').map((line) => line.work_order_id));
      for (const line of output.trace) {
        if (line.event_type === 'result' && detail<{ kind: string }>(line).kind === 'scheduled') scheduled.add(line.work_order_id ?? '');
        if (line.event_type === 'hold_released') expect(scheduled.has(line.work_order_id ?? ''), `${name}: ${line.work_order_id} released after being scheduled`).toBe(false);
      }
      for (const takeover of events(output.trace, 'decision').filter((line) => detail<{ outcome: string }>(line).outcome === 'takeover')) {
        const { urgency, victim_urgency } = detail<{ urgency: string; victim_urgency: string }>(takeover);
        expect(rank[urgency]!, `${name}: ${urgency} over ${victim_urgency}`).toBeLessThan(rank[victim_urgency]!);
      }
      for (const ignored of events(output.trace, 'decision').filter((line) => detail<{ outcome: string }>(line).outcome === 'timeout_ignored')) {
        const after = output.trace.slice(output.trace.indexOf(ignored) + 1).find((line) => line.event_type === 'msg_out' || line.event_type === 'msg_in' || line.event_type === 'eof');
        expect(after?.event_type, `${name}: frame after an ignored timeout`).not.toBe('msg_out');
      }
    }
  }, SPAWN_TIMEOUT * 6);
});
