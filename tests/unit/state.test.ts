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
    // The invalid-row results come first; the initial frames of WO-1 and WO-3 follow (see "frames on csv_loaded").
    expect(
      stdoutOf(outputs).startsWith(
        "WOID:WO-2|RESULT:requires_review\nREASON:The work order row has an unknown urgency 'Urgent'.\n\n" +
          'WOID:WO-4|RESULT:requires_review\nREASON:The work order row has no title.\n\n',
      ),
    ).toBe(true);
    expect(stdoutOf(outputs).match(/\|RESULT:/g)).toHaveLength(2);
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
    expect(stdoutOf(outputs)).not.toContain('|RESULT:');
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

describe('allocation on csv_loaded (AC-1.1, AC-1.3, AC-1.4, AC-1.5, AC-4.3)', () => {
  // sim_now is Wednesday 2026-10-07 10:00 +02:00, so the earliest start is 12:00.
  const mixed: Fact = {
    type: 'csv_loaded',
    rows: [
      row({ work_order_id: 'WO-L', urgency: 'Low', reported_at: '2026-10-01T09:00:00' }),
      row({ work_order_id: 'WO-X', urgency: 'Urgent' }),
      row({ work_order_id: 'WO-C', urgency: 'Critical', reported_at: '2026-10-05T09:00:00' }),
      row({ work_order_id: 'WO-H', urgency: 'High', reported_at: '2026-10-04T09:00:00' }),
    ],
  };
  const holdsOf = (outputs: Output[]) => tracesOf(outputs, 'hold_taken').map((output) => output.kind === 'trace' && [output.work_order_id, output.detail]);

  it('gives every open order one 2-hour hold, in urgency order, and none to an invalid row', () => {
    const { state, outputs } = fold([started, mixed]);
    expect(holdsOf(outputs)).toEqual([
      ['WO-C', { version: 1, start: '2026-10-07T12:00:00+02:00', end: '2026-10-07T14:00:00+02:00' }],
      ['WO-H', { version: 1, start: '2026-10-07T14:00:00+02:00', end: '2026-10-07T16:00:00+02:00' }],
      ['WO-L', { version: 1, start: '2026-10-07T16:00:00+02:00', end: '2026-10-07T18:00:00+02:00' }],
    ]);
    expect(state.holds.map((hold) => hold.orderId)).toEqual(['WO-C', 'WO-H', 'WO-L']);
    expect(state.orders.get('WO-C')?.proposal).toEqual({ version: 1, slot: { start: '2026-10-07T12:00:00+02:00', end: '2026-10-07T14:00:00+02:00' } });
    expect(state.orders.get('WO-X')?.proposal).toBeUndefined();
    expect(state.orders.get('WO-X')).toMatchObject({ status: 'closed' });
  });

  it('does not propose before reported_at: a row reported after sim_now starts from its reported_at, rounded up (SCHED-5)', () => {
    const { outputs } = fold([started, { type: 'csv_loaded', rows: [row({ work_order_id: 'WO-F', reported_at: '2026-10-08T10:20:00' })] }]);
    expect(holdsOf(outputs)).toEqual([['WO-F', { version: 1, start: '2026-10-08T11:00:00+02:00', end: '2026-10-08T13:00:00+02:00' }]]);
  });

  it('releases every hold at eof, tracing hold_released before the closure, and clears the holds (AC-4.3)', () => {
    const loaded = fold([started, mixed]).state;
    const { state, outputs } = step(loaded, { type: 'eof' });
    expect(state.holds).toEqual([]);
    const sequence = outputs.filter((output) => output.kind === 'trace' && ['hold_released', 'state_change'].includes(output.event_type)).map((output) => output.kind === 'trace' && [output.event_type, output.work_order_id]);
    expect(sequence).toEqual([
      ['hold_released', 'WO-L'],
      ['state_change', 'WO-L'],
      ['hold_released', 'WO-C'],
      ['state_change', 'WO-C'],
      ['hold_released', 'WO-H'],
      ['state_change', 'WO-H'],
    ]);
    expect(tracesOf(outputs, 'hold_released').map((output) => output.kind === 'trace' && output.detail)).toEqual([
      { version: 1, reason: 'closed' },
      { version: 1, reason: 'closed' },
      { version: 1, reason: 'closed' },
    ]);
  });

  it('never holds two overlapping slots over a folded run (SCHED-1)', () => {
    const rows = ['Critical', 'High', 'Medium', 'Low', 'Critical', 'Low', 'High', 'Medium'].map((urgency, index) => row({ work_order_id: `WO-${index}`, urgency }));
    const { state } = fold([started, { type: 'csv_loaded', rows }]);
    expect(state.holds).toHaveLength(8);
    for (const a of state.holds) {
      for (const b of state.holds) {
        if (a === b) continue;
        expect(a.slot.start < b.slot.end && b.slot.start < a.slot.end, `${a.orderId} vs ${b.orderId}`).toBe(false);
      }
    }
  });
});

describe('frames on csv_loaded (AC-3.1, AC-3.8, AC-4.2, AC-4.4)', () => {
  // Allocation order is WO-C, WO-H, WO-L (see "allocation on csv_loaded"); WO-ES is Spanish and Medium.
  const rows: Fact = {
    type: 'csv_loaded',
    rows: [
      row({ work_order_id: 'WO-L', urgency: 'Low', reported_at: '2026-10-01T09:00:00' }),
      row({ work_order_id: 'WO-X', urgency: 'Urgent' }),
      row({ work_order_id: 'WO-ES', work_order: 'Grifo que gotea', description: 'El grifo de la cocina gotea toda la noche y no cierra bien.' }),
      row({ work_order_id: 'WO-C', urgency: 'Critical', reported_at: '2026-10-05T09:00:00' }),
    ],
  };
  const headers = (text: string) => (text.match(/^WOID:[^\n]+$/gm) ?? []);

  it('writes, after the invalid-row results, a tenant frame then a handyman frame per order, in allocation order', () => {
    const { outputs } = fold([started, rows]);
    expect(headers(stdoutOf(outputs))).toEqual([
      'WOID:WO-X|RESULT:requires_review',
      'WOID:WO-C|ROLE:tenant',
      'WOID:WO-C|ROLE:handyman',
      'WOID:WO-ES|ROLE:tenant',
      'WOID:WO-ES|ROLE:handyman',
      'WOID:WO-L|ROLE:tenant',
      'WOID:WO-L|ROLE:handyman',
    ]);
  });

  it('writes the tenant frame in the order language and the handyman frame in Spanish, each with the slot (COM-1, COM-2)', () => {
    const stdout = stdoutOf(fold([started, rows]).outputs);
    const block = (header: string) => stdout.split('\n\n').find((candidate) => candidate.startsWith(header))!;
    expect(block('WOID:WO-ES|ROLE:tenant')).toContain('Hola. Le escribimos por su aviso «Grifo que gotea»');
    expect(block('WOID:WO-ES|ROLE:tenant')).toContain('miércoles 7 de octubre de 2026, de 14:00 a 16:00 (hora de Madrid)');
    expect(block('WOID:WO-L|ROLE:tenant')).toContain('Hello. We are writing about your report "Leaking tap"');
    expect(block('WOID:WO-L|ROLE:tenant')).toContain('Wednesday 7 October 2026, 16:00 to 18:00 (Madrid time)');
    expect(block('WOID:WO-L|ROLE:handyman')).toContain('Nueva visita propuesta para el aviso «Leaking tap» (urgencia baja) en Calle Mayor 1');
    expect(block('WOID:WO-C|ROLE:tenant')).toContain('If there is immediate danger, call 112.');
    expect(block('WOID:WO-ES|ROLE:tenant')).not.toContain('112');
  });

  it('traces every frame as msg_out with recipient, language, version, slot and body (AC-3.8)', () => {
    const { outputs } = fold([started, rows]);
    const sent: Record<string, unknown>[] = tracesOf(outputs, 'msg_out').map((output) =>
      output.kind === 'trace' ? { id: output.work_order_id, ...(output.detail as Record<string, unknown>) } : {},
    );
    expect(sent.map((entry) => [entry['id'], entry['to'], entry['language'], entry['version']])).toEqual([
      ['WO-C', 'tenant', 'en', 1],
      ['WO-C', 'handyman', 'es', 1],
      ['WO-ES', 'tenant', 'es', 1],
      ['WO-ES', 'handyman', 'es', 1],
      ['WO-L', 'tenant', 'en', 1],
      ['WO-L', 'handyman', 'es', 1],
    ]);
    expect(sent[0]).toMatchObject({ start: '2026-10-07T12:00:00+02:00', end: '2026-10-07T14:00:00+02:00' });
    const frames = stdoutOf(outputs).split('\n\n').filter((block) => block.includes('|ROLE:'));
    expect(frames.map((frame) => frame.split('\n').slice(1).join('\n'))).toEqual(sent.map((entry) => entry['body']));
  });

  it('a line for a proposed order still emits nothing on stdout (AC-4.4)', () => {
    const loaded = fold([started, rows]).state;
    const { outputs } = step(loaded, { type: 'msg_in', seq: 1, raw: 'WO-C|tenant Sí, perfecto' });
    expect(outputs.filter((output) => output.kind === 'stdout')).toEqual([]);
  });
});
