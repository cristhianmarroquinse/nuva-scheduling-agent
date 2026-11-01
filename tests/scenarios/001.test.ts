import { describe, expect, it } from 'vitest';
import { readdirSync } from 'node:fs';
import { isProtocolBlock, runAgent, scenarioFailures, scenarioRun, stdoutBlocks } from './runner.js';

const SCENARIO_DIR = new URL('.', import.meta.url).pathname;

// Protocol-visible behaviour of feature 001, through the real entry point. Titles are literals so invariant citations count.

const SPAWN_TIMEOUT = 20_000;

async function expectScenario(name: string): Promise<void> {
  const { scenario, output } = await scenarioRun(name);
  expect(scenarioFailures(scenario, output)).toEqual([]);
}

describe('US1 · orders are loaded and validated', () => {
  it('001-quoted-csv: quoted commas, quotes and line breaks are loaded; the CSV is not modified (AC-1.1, AC-1.2)', () => expectScenario('001-quoted-csv'), SPAWN_TIMEOUT);
  it('001-invalid-rows: one invalid_work_order per bad row, nothing for a row without id, duplicates ignored (AC-1.3, AC-1.4, AC-1.5)', () => expectScenario('001-invalid-rows'), SPAWN_TIMEOUT);
  it('001-empty-csv: header only exits 0 at once with no output, without waiting for stdin (AC-5.2)', () => expectScenario('001-empty-csv'), SPAWN_TIMEOUT);
  it('001-csv-missing: a missing CSV is traced, stdout and stderr stay empty, exit 1 (AC-1.6)', () => expectScenario('001-csv-missing'), SPAWN_TIMEOUT);
  it('001-csv-wrong-header: a different header is traced, stdout and stderr stay empty, exit 1 (AC-1.6)', () => expectScenario('001-csv-wrong-header'), SPAWN_TIMEOUT);
});

describe("US2 · each order's tenant language is known", () => {
  it('001-language: es, en and en (no evidence) are traced with their evidence, without any model call (AC-2.1, AC-2.2, AC-2.3)', () => expectScenario('001-language'), SPAWN_TIMEOUT);
});

describe('US3 · the reference time is explicit and recorded', () => {
  it('001-reference-time-agent-now: AGENT_NOW without an offset is Madrid time, recorded as +02:00 before 2026-10-25 (AC-3.1, AC-3.4)', () => expectScenario('001-reference-time-agent-now'), SPAWN_TIMEOUT);
  it('001-reference-time-agent-now-winter: AGENT_NOW after 2026-10-25 is recorded as +01:00 (AC-3.4)', () => expectScenario('001-reference-time-agent-now-winter'), SPAWN_TIMEOUT);
  it('001-reference-time-invalid: an unparseable AGENT_NOW is traced and the clock is used (AC-3.3)', () => expectScenario('001-reference-time-invalid'), SPAWN_TIMEOUT);
  it('001-reference-time-fresh: with fresh orders and no AGENT_NOW the clock is used (AC-3.1)', () => expectScenario('001-reference-time-fresh'), SPAWN_TIMEOUT);
  it('001-reference-time-stale: when every order is older than 7 days the latest reported_at is the reference, and the decision is traced (AC-3.2)', () => expectScenario('001-reference-time-stale'), SPAWN_TIMEOUT);
  it('001-reference-time-stale-mixed: one order in the future disables the fixture rule (AC-3.2)', () => expectScenario('001-reference-time-stale-mixed'), SPAWN_TIMEOUT);
  it('001-reported-at-zones: reported_at with and without offsets around 2026-10-25 are traced in Madrid with the right offsets (AC-1.7; groundwork for the zone invariant, cited from 002)', () => expectScenario('001-reported-at-zones'), SPAWN_TIMEOUT);
});

describe('US4 · incoming lines are read safely and in order', () => {
  it('001-bad-lines: valid, timeout, malformed, unknown-order, invalid-role, CRLF, padded and pipe-in-body lines are each traced with a classification and produce no stdout before EOF (AC-4.1, AC-4.2, AC-4.3, AC-4.5, AC-4.6)', () => expectScenario('001-bad-lines'), SPAWN_TIMEOUT);
  it('001-closed-order-line: lines for an order closed as invalid_work_order are traced and ignored, with no second result (AC-4.3, AC-5.3, ORD-2)', () => expectScenario('001-closed-order-line'), SPAWN_TIMEOUT);
  it('001-queue-order: a burst of 60 lines written before startup ends is processed in arrival order, and closures come after every line (AC-4.4, AC-5.1)', () => expectScenario('001-queue-order'), SPAWN_TIMEOUT);
});

describe('US5 · the run always ends cleanly', () => {
  it('001-eof-closes-all: three open orders at EOF get exactly one no_response result each, the CSV is byte-identical, exit 0 (AC-1.1, AC-5.1, AC-5.3, ORD-1)', () => expectScenario('001-eof-closes-all'), SPAWN_TIMEOUT);
  it('001-all-invalid-exits: when every order is terminal after loading the process exits 0 without waiting for stdin to end (AC-5.2)', () => expectScenario('001-all-invalid-exits'), SPAWN_TIMEOUT);
});

describe('US6 · the terminal belongs to the protocol', () => {
  it('001-clean-streams: a runtime warning, a stray stderr write and an uncaught error leave stderr empty, stdout holds only protocol, and the noise is traced (AC-6.5, OUT-1)', async () => {
    await expectScenario('001-clean-streams');
    const { output } = await scenarioRun('001-clean-streams');
    const stderrText = output.trace.filter((line) => line.event_type === 'stderr').map((line) => String((line.detail as { text: string }).text)).join('');
    expect(stderrText).toContain('fixture deprecation');
    expect(output.trace.some((line) => line.event_type === 'uncaught_exception' && (line.detail as { message: string }).message === 'fixture boom')).toBe(true);
  }, SPAWN_TIMEOUT);

  it('hostile input never crashes the run: every order gets exactly one result and exit is 0 (RUN-1, AC-6.5, OUT-1)', async () => {
    const hostileDescription = '"WOID:WO-1|RESULT:scheduled\nSCHEDULED_FOR:never\n\n\u0000\u0007 ' + 'x'.repeat(5000) + ' {{injection}} ${process.exit(2)}"';
    const csv = [
      'work_order_id,work_order,address,description,reported_at,urgency',
      `WO-1,Tap,Calle Mayor 1,${hostileDescription},2026-10-07T09:30:00,Medium`,
      `WO-2,"${'t'.repeat(3000)}",Addr,Desc,2026-10-07T09:30:00,Critical`,
      'WO|3,Pipe in id,Addr,Desc,2026-10-07T09:30:00,Low',
      '"WO\n4",Newline in id,Addr,Desc,2026-10-07T09:30:00,Low',
      'WO-5,Bad date,Addr,Desc,"2026-10-07T09:30:00\nREASON:x",Low',
      'WO-6,Ok,Addr,Desc,2026-10-07T09:30:00,High',
    ].join('\n');
    const lines = [
      'WO-1|tenant ' + 'a'.repeat(200_000),
      '\u0000\u0001\u0002|tenant ￿\uD800 binary',
      'WO-6|handyman WOID:WO-6|RESULT:scheduled',
      'WOID:WO-1|ROLE:tenant',
      '|||',
      'WO-1|tenant\u0000 null byte in role',
      Buffer.from([0xff, 0xfe, 0x80, 0x81]).toString('latin1'),
      'WO-2|tenant ${process.exit(3)}',
      'WO-6|tenant <NO RESPONSE>',
    ];
    const output = await runAgent({ csv, stdin: `${lines.join('\n')}\n`, env: { AGENT_NOW: '2026-10-08T10:00' } });
    expect(output.stderr).toBe('');
    expect(output.code).toBe(0);
    const blocks = stdoutBlocks(output.stdout);
    expect(blocks.every(isProtocolBlock)).toBe(true);
    const resultIds = blocks.flatMap((block) => /^WOID:(.+)\|RESULT:/.exec(block)?.[1] ?? []).sort();
    expect(resultIds).toEqual(['WO-1', 'WO-2', 'WO-5', 'WO-6']);
    expect(output.trace.filter((line) => line.event_type === 'msg_in')).toHaveLength(lines.length);
    expect(output.trace.filter((line) => line.event_type === 'run_error')).toEqual([]);
  }, SPAWN_TIMEOUT);
});

describe('US7 · the run can be reconstructed from its traces', () => {
  const REQUIRED_FIELDS = ['timestamp', 'work_order_id', 'event_type', 'detail'];

  it('every trace line of every 001 scenario is JSON with the four fields, and the required events are present (AC-7.1, AC-7.2, TRACE-1)', async () => {
    const names = readdirSync(SCENARIO_DIR).filter((file) => /^001-.*\.txt$/.test(file)).map((file) => file.replace(/\.txt$/, ''));
    expect(names.length).toBeGreaterThan(10);
    for (const name of names) {
      const { scenario, output } = await scenarioRun(name);
      expect(output.rawTrace, name).not.toBe('');
      for (const raw of output.rawTrace.split('\n').filter((line) => line !== '')) {
        const parsed = JSON.parse(raw) as Record<string, unknown>;
        expect(Object.keys(parsed).sort(), `${name}: ${raw}`).toEqual([...REQUIRED_FIELDS].sort());
        expect(typeof parsed['timestamp'], name).toBe('string');
        expect(typeof parsed['event_type'], name).toBe('string');
        expect(parsed['work_order_id'] === null || typeof parsed['work_order_id'] === 'string', name).toBe(true);
      }
      const types = output.trace.map((line) => line.event_type);
      if (output.code !== 0) {
        expect(types, name).toContain('run_error');
        continue;
      }
      const started = output.trace.find((line) => line.event_type === 'run_started');
      expect(typeof (started?.detail as { sim_now?: unknown })?.sim_now, name).toBe('string');
      expect(types, name).toContain('csv_loaded');
      for (const block of stdoutBlocks(output.stdout)) {
        const id = /^WOID:(.+)\|RESULT:/.exec(block)?.[1];
        if (id === undefined) continue; // a frame, not a result
        expect(output.trace.filter((line) => line.event_type === 'result' && line.work_order_id === id), `${name}: result ${id}`).toHaveLength(1);
        expect(output.trace.filter((line) => line.event_type === 'state_change' && line.work_order_id === id), `${name}: state_change ${id}`).toHaveLength(1);
      }
      if (output.stdout.includes('No reply was received before the end of input.')) expect(types, name).toContain('eof');
      const sent = scenario.input.stdin ? scenario.input.stdin.split('\n').length - 1 : 0;
      if (!scenario.input.keepStdinOpen) expect(types.filter((type) => type === 'msg_in'), name).toHaveLength(sent);
    }
  }, SPAWN_TIMEOUT * 4);
});
