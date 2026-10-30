import { describe, expect, it } from 'vitest';
import type { Fact, RawRow } from '../../src/core/facts.js';
import { allTerminal, fold, initialState, step, type Output } from '../../src/core/state.js';

// The pure core: every projection is derived by `step`, in CSV order, and nothing is ever emitted twice.

function row(fields: Partial<RawRow> & { work_order_id: string }): RawRow {
  return {
    work_order: 'Leaking tap',
    address: 'Calle Mayor 1',
    description: 'The kitchen tap drips.',
    reported_at: '2026-10-07T09:30:00',
    urgency: 'Medium',
    ...fields,
  };
}

const started: Fact = { type: 'run_started', sim_now: '2026-10-07T10:00:00+02:00', source: 'clock', clock_now: '2026-10-07T10:00:00+02:00', agent_now: null };

function stdoutOf(outputs: Output[]): string {
  return outputs.map((output) => (output.kind === 'stdout' ? output.text : '')).join('');
}

function tracesOf(outputs: Output[], eventType: string): Output[] {
  return outputs.filter((output) => output.kind === 'trace' && output.event_type === eventType);
}

describe('run_started', () => {
  it('records sim_now and nothing else', () => {
    const { state, outputs } = step(initialState(), started);
    expect(state.simNow).toBe('2026-10-07T10:00:00+02:00');
    expect(state.loaded).toBe(false);
    expect(outputs).toEqual([]);
    expect(allTerminal(state)).toBe(false);
  });
});

describe('csv_loaded (AC-1.3, AC-1.4, AC-1.5)', () => {
  it('opens valid orders and closes invalid rows with invalid_work_order results, in CSV order', () => {
    const { state, outputs } = fold([
      started,
      {
        type: 'csv_loaded',
        rows: [
          row({ work_order_id: 'WO-1' }),
          row({ work_order_id: 'WO-2', urgency: 'Urgent' }),
          row({ work_order_id: 'WO-3' }),
          row({ work_order_id: 'WO-4', work_order: '' }),
        ],
      },
    ]);
    expect(state.loaded).toBe(true);
    expect([...state.orders.keys()]).toEqual(['WO-1', 'WO-2', 'WO-3', 'WO-4']);
    expect(state.orders.get('WO-1')).toMatchObject({ status: 'open', language: 'en' });
    expect(state.orders.get('WO-2')).toMatchObject({ status: 'closed', result: { kind: 'requires_review', code: 'invalid_work_order' } });
    expect(stdoutOf(outputs)).toBe(
      "WOID:WO-2|RESULT:requires_review\nREASON:The work order row has an unknown urgency 'Urgent'.\n\n" +
        'WOID:WO-4|RESULT:requires_review\nREASON:The work order row has no title.\n\n',
    );
    expect(tracesOf(outputs, 'state_change')).toHaveLength(2);
    expect(tracesOf(outputs, 'result').map((output) => output.kind === 'trace' && output.work_order_id)).toEqual(['WO-2', 'WO-4']);
    expect(allTerminal(state)).toBe(false);
  });

  it('traces ignored rows (no id, duplicate) and emits nothing for them', () => {
    const { state, outputs } = fold([
      started,
      { type: 'csv_loaded', rows: [row({ work_order_id: '' }), row({ work_order_id: 'WO-1' }), row({ work_order_id: 'WO-1', work_order: 'Again' })] },
    ]);
    expect([...state.orders.keys()]).toEqual(['WO-1']);
    expect(stdoutOf(outputs)).toBe('');
    expect(tracesOf(outputs, 'row_ignored').map((output) => output.kind === 'trace' && output.detail)).toEqual([
      { line: 1, reason: 'no_id' },
      { line: 3, reason: 'duplicate', id: 'WO-1' },
    ]);
  });

  it('is terminal right after loading when there are no usable orders or all are invalid', () => {
    expect(allTerminal(fold([started, { type: 'csv_loaded', rows: [] }]).state)).toBe(true);
    expect(allTerminal(fold([started, { type: 'csv_loaded', rows: [row({ work_order_id: 'WO-1', urgency: 'x' })] }]).state)).toBe(true);
  });

  it('ignores a second csv_loaded (ORD-1)', () => {
    const first = fold([started, { type: 'csv_loaded', rows: [row({ work_order_id: 'WO-1' })] }]);
    const second = step(first.state, { type: 'csv_loaded', rows: [row({ work_order_id: 'WO-2' })] });
    expect([...second.state.orders.keys()]).toEqual(['WO-1']);
    expect(stdoutOf(second.outputs)).toBe('');
  });
});

describe('eof (AC-5.1, AC-5.3)', () => {
  const loaded: Fact[] = [
    started,
    { type: 'csv_loaded', rows: [row({ work_order_id: 'WO-1' }), row({ work_order_id: 'WO-2', urgency: 'x' }), row({ work_order_id: 'WO-3' })] },
  ];

  it('closes every open order with no_response, in CSV order, and skips orders already closed (ORD-1)', () => {
    const { state, outputs } = step(fold(loaded).state, { type: 'eof' });
    expect(state.ended).toBe(true);
    expect(allTerminal(state)).toBe(true);
    expect(stdoutOf(outputs)).toBe(
      'WOID:WO-1|RESULT:requires_review\nREASON:No reply was received before the end of input.\n\n' +
        'WOID:WO-3|RESULT:requires_review\nREASON:No reply was received before the end of input.\n\n',
    );
    expect(tracesOf(outputs, 'result').map((output) => output.kind === 'trace' && output.work_order_id)).toEqual(['WO-1', 'WO-3']);
    expect([...state.orders.values()].every((order) => order.status === 'closed')).toBe(true);
  });

  it('emits nothing on a second eof: exactly one terminal result per order (ORD-1)', () => {
    const once = fold([...loaded, { type: 'eof' }]);
    const twice = step(once.state, { type: 'eof' });
    expect(twice.outputs.filter((output) => output.kind === 'stdout')).toEqual([]);
    expect(tracesOf(twice.outputs, 'result')).toEqual([]);
    expect(twice.state.orders).toEqual(once.state.orders);
  });

  it('over a whole run, every order in the CSV has exactly one result on stdout (ORD-1)', () => {
    const { outputs } = fold([...loaded, { type: 'eof' }, { type: 'eof' }]);
    const headers = stdoutOf(outputs).match(/^WOID:[^|]+\|RESULT:/gm) ?? [];
    expect(headers.sort()).toEqual(['WOID:WO-1|RESULT:', 'WOID:WO-2|RESULT:', 'WOID:WO-3|RESULT:']);
  });
});

describe('msg_in (AC-4.1, AC-4.2, AC-4.3, AC-4.5)', () => {
  const loaded: Fact[] = [
    started,
    { type: 'csv_loaded', rows: [row({ work_order_id: 'WO-1' }), row({ work_order_id: 'WO-2', urgency: 'x' })] },
  ];
  const lineOf = (raw: string, seq = 1): Fact => ({ type: 'msg_in', seq, raw });
  const classify = (raw: string): unknown => {
    const { outputs } = step(fold(loaded).state, lineOf(raw));
    expect(outputs.filter((output) => output.kind === 'stdout')).toEqual([]);
    const [classified] = tracesOf(outputs, 'line_classified');
    return classified?.kind === 'trace' ? { work_order_id: classified.work_order_id, ...(classified.detail as object) } : undefined;
  };

  it('records a message for an open order and sender, and emits nothing on stdout', () => {
    expect(classify('WO-1|tenant Hola, mañana por la tarde')).toEqual({ work_order_id: 'WO-1', classification: 'message', role: 'tenant', seq: 1, body: 'Hola, mañana por la tarde' });
    expect(classify('WO-1|handyman Vale')).toMatchObject({ classification: 'message', role: 'handyman' });
  });

  it('records <NO RESPONSE> as a timeout from that sender', () => {
    expect(classify('WO-1|tenant <NO RESPONSE>')).toEqual({ work_order_id: 'WO-1', classification: 'timeout', role: 'tenant', seq: 1 });
  });

  it('traces malformed, unknown-order and invalid-role lines with the reason and emits nothing', () => {
    expect(classify('garbage')).toEqual({ work_order_id: null, classification: 'malformed', reason: 'no_separator', seq: 1 });
    expect(classify('WO-9|tenant hello')).toEqual({ work_order_id: null, classification: 'unknown_order', woid: 'WO-9', seq: 1 });
    expect(classify('WO-1|landlord hello')).toEqual({ work_order_id: 'WO-1', classification: 'invalid_role', role: 'landlord', seq: 1 });
  });

  it('traces and ignores a line for an order that already has a terminal result (ORD-2)', () => {
    expect(classify('WO-2|tenant hello')).toEqual({ work_order_id: 'WO-2', classification: 'closed_order', role: 'tenant', seq: 1 });
    const afterEof = fold([...loaded, { type: 'eof' }]);
    const late = step(afterEof.state, lineOf('WO-1|tenant hello', 2));
    expect(late.outputs.filter((output) => output.kind === 'stdout')).toEqual([]);
    expect(tracesOf(late.outputs, 'line_classified').map((output) => output.kind === 'trace' && output.detail)).toEqual([
      { classification: 'closed_order', role: 'tenant', seq: 2 },
    ]);
    expect(late.state.orders).toEqual(afterEof.state.orders);
  });

  it('never changes an order status: lines only produce traces in this feature', () => {
    const before = fold(loaded).state;
    const after = step(before, lineOf('WO-1|tenant hello'));
    expect(after.state.orders).toEqual(before.orders);
  });
});
