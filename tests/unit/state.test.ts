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

  it('closes every open order with no_response, in CSV order, naming what was agreed, and skips orders already closed (ORD-1; 013 AC-1)', () => {
    const { state, outputs } = step(fold(loaded).state, { type: 'eof' });
    expect(state.ended).toBe(true);
    expect(allTerminal(state)).toBe(true);
    expect(stdoutOf(outputs)).toBe(
      'WOID:WO-1|RESULT:requires_review\nREASON:Input ended with no agreement; neither party had accepted the proposed visit on Wednesday 7 October 2026, 12:00 to 14:00 (Madrid time).\n\n' +
        'WOID:WO-3|RESULT:requires_review\nREASON:Input ended with no agreement; neither party had accepted the proposed visit on Wednesday 7 October 2026, 14:00 to 16:00 (Madrid time).\n\n',
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
    const [classified] = tracesOf(outputs, 'line_classified');
    return classified?.kind === 'trace' ? { work_order_id: classified.work_order_id, ...(classified.detail as object) } : undefined;
  };

  it('records a message for an open order and sender, and emits nothing on stdout', () => {
    expect(classify('WO-1|tenant Hola, mañana por la tarde')).toEqual({ work_order_id: 'WO-1', classification: 'message', role: 'tenant', seq: 1, body: 'Hola, mañana por la tarde' });
    expect(classify('WO-1|handyman Vale')).toMatchObject({ classification: 'message', role: 'handyman' });
  });

  it('records <NO RESPONSE> as a timeout from that sender; since 005 an awaited party gets a reminder', () => {
    expect(classify('WO-1|tenant <NO RESPONSE>')).toEqual({ work_order_id: 'WO-1', classification: 'timeout', role: 'tenant', seq: 1 });
    expect(stdoutOf(step(fold(loaded).state, lineOf('WO-1|tenant <NO RESPONSE>')).outputs)).toContain('A reminder that we are still waiting for your reply.');
  });

  it('traces malformed, unknown-order and invalid-role lines with the reason and emits nothing', () => {
    for (const raw of ['garbage', 'WO-9|tenant hello', 'WO-1|landlord hello', 'WO-1|tenant hello']) expect(stdoutOf(step(fold(loaded).state, lineOf(raw)).outputs), raw).toBe('');
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
    const statuses = (orders: Map<string, { status: string }>) => [...orders.values()].map((order) => order.status);
    expect(statuses(after.state.orders)).toEqual(statuses(before.orders));
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

describe('interpret requests and the model boundary (AC-1.1, AC-1.9, LLM-1)', () => {
  const loaded: Fact[] = [
    started,
    {
      type: 'csv_loaded',
      rows: [
        row({ work_order_id: 'WO-1', work_order: 'Grifo que gotea', description: 'El grifo de la cocina gotea toda la noche y no cierra bien.' }),
        row({ work_order_id: 'WO-X', urgency: 'Urgent' }),
      ],
    },
  ];
  const requestsOf = (outputs: Output[]) => outputs.filter((output) => output.kind === 'interpret');
  const lineOf = (raw: string, seq = 1): Fact => ({ type: 'msg_in', seq, raw });

  it('emits exactly one interpret request for a message on an open order with a proposal, carrying the sender, the proposal and the reference time', () => {
    const { outputs } = step(fold(loaded).state, lineOf('WO-1|tenant Sí, el miércoles por la tarde', 7));
    expect(requestsOf(outputs)).toEqual([
      {
        kind: 'interpret',
        request: {
          woid: 'WO-1',
          seq: 7,
          role: 'tenant',
          body: 'Sí, el miércoles por la tarde',
          language: 'es',
          proposal: { version: 1, slot: { start: '2026-10-07T12:00:00+02:00', end: '2026-10-07T14:00:00+02:00' } },
          simNow: '2026-10-07T10:00:00+02:00',
        },
      },
    ]);
    const handyman = step(fold(loaded).state, lineOf('WO-1|handyman Vale, perfecto', 8));
    expect(requestsOf(handyman.outputs).map((output) => output.kind === 'interpret' && output.request.language)).toEqual(['es']);
  });

  it('emits no request for a timeout, a malformed line, an unknown order or a closed order', () => {
    const state = fold(loaded).state;
    for (const raw of ['WO-1|tenant <NO RESPONSE>', 'garbage', 'WO-9|tenant hello', 'WO-X|tenant hello', 'WO-1|landlord hello']) {
      expect(requestsOf(step(state, lineOf(raw)).outputs), raw).toEqual([]);
    }
  });

  it('an interpretation for a closed order is traced as ignored and changes nothing (ORD-2)', () => {
    const before = fold(loaded).state;
    const { state, outputs } = step(before, { type: 'interpretation', seq: 1, woid: 'WO-X', role: 'tenant', source: 'fake', prompt_version: '1', result: { intent: 'accept', times: [], exclusions: [], quote: 'yes' } });
    expect(state).toEqual(before);
    expect(outputs.filter((output) => output.kind === 'stdout')).toEqual([]);
    expect(tracesOf(outputs, 'ignored_fact')).toHaveLength(1);
  });

  it('a single accept interpretation never closes an order or writes a result by itself (LLM-1)', () => {
    const { state, outputs } = step(fold(loaded).state, { type: 'interpretation', seq: 1, woid: 'WO-1', role: 'tenant', source: 'fake', prompt_version: '1', result: { intent: 'accept', times: [], exclusions: [], quote: 'yes' } });
    expect(state.orders.get('WO-1')?.status).toBe('open');
    expect(stdoutOf(outputs)).not.toContain('|RESULT:');
    expect(tracesOf(outputs, 'result')).toEqual([]);
    expect(state.holds.map((hold) => hold.kind)).toEqual(['tentative']);
  });
});

describe('acceptance rules (AC-2.4, AC-2.5, AC-2.6, AC-2.7, AC-2.8, AC-4.2, ACC-1, ACC-2, ACC-3, ORD-1)', () => {
  // WO-1 (en, Medium) is proposed Wed 7 Oct 12:00–14:00; WO-ES (es, Medium, same reported_at) 14:00–16:00.
  const loaded: Fact[] = [
    started,
    {
      type: 'csv_loaded',
      rows: [
        row({ work_order_id: 'WO-1' }),
        row({ work_order_id: 'WO-ES', work_order: 'Grifo que gotea', description: 'El grifo de la cocina gotea toda la noche y no cierra bien.' }),
      ],
    },
  ];
  type Result = import('../../src/interpreter/schema.js').Interpretation;
  const interp = (woid: string, role: 'tenant' | 'handyman', result: Partial<Result>, seq = 1): Fact => ({
    type: 'interpretation',
    seq,
    woid,
    role,
    source: 'fake',
    prompt_version: '1',
    result: { intent: 'accept', times: [], exclusions: [], quote: 'yes', ...result },
  });
  const decisions = (outputs: Output[]) => tracesOf(outputs, 'decision').map((output) => output.kind === 'trace' && (output.detail as Record<string, unknown>)['outcome']);
  const blocks = (outputs: Output[]) => stdoutOf(outputs).split('\n\n').filter(Boolean).map((block) => block.split('\n')[0]);

  it('the first acceptance gets a brief acknowledgement and is recorded against the proposal version (AC-2.4)', () => {
    const { state, outputs } = step(fold(loaded).state, interp('WO-1', 'tenant', {}));
    expect(decisions(outputs)).toEqual(['accepted']);
    expect(blocks(outputs)).toEqual(['WOID:WO-1|ROLE:tenant']);
    expect(stdoutOf(outputs)).toContain('Thank you, noted.');
    expect(state.orders.get('WO-1')).toMatchObject({ status: 'open', accepted: { tenant: 1 } });
    expect(tracesOf(outputs, 'msg_out')).toHaveLength(1);
  });

  it('a repeated acceptance is recorded and sends nothing (AC-2.5)', () => {
    const once = fold([...loaded, interp('WO-1', 'tenant', {})]).state;
    const { outputs } = step(once, interp('WO-1', 'tenant', {}, 2));
    expect(decisions(outputs)).toEqual(['already_accepted']);
    expect(stdoutOf(outputs)).toBe('');
  });

  it('an accept whose stated time does not fit is a mismatch: not an acceptance, it becomes a counter-proposal (AC-2.2; 004 AC-1.7)', () => {
    const { state, outputs } = step(fold(loaded).state, interp('WO-1', 'tenant', { times: [{ date: '2026-10-08' }] }));
    expect(decisions(outputs)).toEqual(['mismatch', 'repropose']);
    expect(state.orders.get('WO-1')?.accepted).toEqual({});
  });

  it('an accept with a constraint gets a one-line confirmation request; a bare accept afterwards counts (AC-2.3)', () => {
    const first = step(fold(loaded).state, interp('WO-1', 'tenant', { exclusions: [{ weekday: 'thursday' }] }));
    expect(decisions(first.outputs)).toEqual(['needs_confirmation']);
    expect(stdoutOf(first.outputs)).toContain('To confirm: does the visit for "Leaking tap" on Wednesday 7 October 2026, 12:00 to 14:00');
    expect(first.state.orders.get('WO-1')?.accepted).toEqual({});
    const second = step(first.state, interp('WO-1', 'tenant', {}, 2));
    expect(decisions(second.outputs)).toEqual(['accepted']);
    expect(second.state.orders.get('WO-1')?.accepted).toEqual({ tenant: 1 });
  });

  it('when both parties accept the same version, confirmations go to the tenant and the handyman before the scheduled result, whose SCHEDULED_FOR is the hold start (AC-2.6, ACC-1, ACC-2, ACC-3)', () => {
    const afterTenant = fold([...loaded, interp('WO-ES', 'tenant', {})]).state;
    const { state, outputs } = step(afterTenant, interp('WO-ES', 'handyman', {}, 2));
    expect(decisions(outputs)).toEqual(['scheduled']);
    expect(blocks(outputs)).toEqual(['WOID:WO-ES|ROLE:tenant', 'WOID:WO-ES|ROLE:handyman', 'WOID:WO-ES|RESULT:scheduled']);
    expect(stdoutOf(outputs)).toContain('Confirmado: la visita del técnico por «Grifo que gotea» queda fijada para el miércoles 7 de octubre de 2026, de 14:00 a 16:00 (hora de Madrid).');
    expect(stdoutOf(outputs)).toContain('Confirmado: visita por «Grifo que gotea» en Calle Mayor 1, miércoles 7 de octubre de 2026, de 14:00 a 16:00 (hora de Madrid).');
    expect(stdoutOf(outputs)).toMatch(/WOID:WO-ES\|RESULT:scheduled\nSCHEDULED_FOR:2026-10-07T14:00:00\+02:00\n\n$/);
    expect(state.orders.get('WO-ES')).toMatchObject({ status: 'closed', result: { kind: 'scheduled', scheduledFor: '2026-10-07T14:00:00+02:00' } });
    expect(state.holds.find((hold) => hold.orderId === 'WO-ES')).toMatchObject({ kind: 'scheduled', version: 1 });
    expect(tracesOf(outputs, 'result')).toHaveLength(1);
  });

  it('a scheduled visit keeps its slot at end of input and gets no second result (AC-2.7, AC-4.2, ORD-1)', () => {
    const scheduled = fold([...loaded, interp('WO-ES', 'tenant', {}), interp('WO-ES', 'handyman', {}, 2)]).state;
    const { state, outputs } = step(scheduled, { type: 'eof' });
    expect(state.holds.map((hold) => [hold.orderId, hold.kind])).toEqual([['WO-ES', 'scheduled']]);
    expect(blocks(outputs)).toEqual(['WOID:WO-1|RESULT:requires_review']);
    expect(tracesOf(outputs, 'hold_released').map((output) => output.kind === 'trace' && output.work_order_id)).toEqual(['WO-1']);
  });

  it('acceptances of different proposal versions never schedule (ACC-1)', () => {
    const afterTenant = fold([...loaded, interp('WO-1', 'tenant', {})]).state;
    const order = afterTenant.orders.get('WO-1')!;
    const bumped = { ...afterTenant, orders: new Map(afterTenant.orders).set('WO-1', { ...order, proposal: { ...order.proposal!, version: 2 } }) };
    const { state, outputs } = step(bumped, interp('WO-1', 'handyman', {}, 2));
    expect(decisions(outputs)).toEqual(['accepted']);
    expect(state.orders.get('WO-1')?.status).toBe('open');
    expect(stdoutOf(outputs)).not.toContain('RESULT:');
  });
});

describe('unclear replies, model failures and deferred intents (AC-3.1, AC-3.2, AC-3.3, AC-3.4, AC-3.5, AC-4.1)', () => {
  // WO-1 (en, Medium) is proposed Wed 7 Oct 12:00–14:00.
  const loaded: Fact[] = [started, { type: 'csv_loaded', rows: [row({ work_order_id: 'WO-1' })] }];
  type Result = import('../../src/interpreter/schema.js').Interpretation;
  let seq = 0;
  const interp = (role: 'tenant' | 'handyman', result: Partial<Result>): Fact => ({
    type: 'interpretation',
    seq: (seq += 1),
    woid: 'WO-1',
    role,
    source: 'fake',
    prompt_version: '1',
    result: { intent: 'unclear', times: [], exclusions: [], quote: '???', ...result },
  });
  const failure = (role: 'tenant' | 'handyman' = 'tenant'): Fact => ({ type: 'llm_error', seq: (seq += 1), woid: 'WO-1', role, message: 'boom' });
  const decisions = (outputs: Output[]) => tracesOf(outputs, 'decision').map((output) => output.kind === 'trace' && (output.detail as Record<string, unknown>)['outcome']);
  const reasonOf = (outputs: Output[]) => tracesOf(outputs, 'decision').map((output) => output.kind === 'trace' && (output.detail as Record<string, unknown>)['reason']);

  it('the first unclear reply gets one clarification that restates the slot (AC-3.1, AC-3.5)', () => {
    const { state, outputs } = step(fold(loaded).state, interp('tenant', {}));
    expect(decisions(outputs)).toEqual(['clarify']);
    expect(stdoutOf(outputs)).toContain('WOID:WO-1|ROLE:tenant\nSorry, we did not understand your reply. The proposed visit for "Leaking tap" is on Wednesday 7 October 2026, 12:00 to 14:00 (Madrid time).');
    expect(state.orders.get('WO-1')).toMatchObject({ status: 'open', unclearStreak: { tenant: { count: 1, contradictory: false } } });
  });

  it('a second consecutive unclear reply from the same party closes the order as interpretation_failed, releasing the hold (AC-3.2)', () => {
    const once = fold([...loaded, interp('tenant', {})]).state;
    const { state, outputs } = step(once, interp('tenant', {}));
    expect(decisions(outputs)).toEqual(['review']);
    expect(reasonOf(outputs)).toEqual(['interpretation_failed']);
    expect(stdoutOf(outputs)).toBe('WOID:WO-1|RESULT:requires_review\nREASON:Two consecutive replies from the tenant could not be understood.\n\n');
    expect(state.orders.get('WO-1')).toMatchObject({ status: 'closed', result: { code: 'interpretation_failed' } });
    expect(state.holds).toEqual([]);
    expect(tracesOf(outputs, 'hold_released')).toHaveLength(1);
  });

  it('is contradictory_replies when either of the two was contradictory (AC-3.2)', () => {
    const a = step(fold([...loaded, interp('tenant', {})]).state, interp('tenant', { intent: 'contradictory' }));
    expect(reasonOf(a.outputs)).toEqual(['contradictory_replies']);
    const b = step(fold([...loaded, interp('tenant', { intent: 'contradictory' })]).state, interp('tenant', {}));
    expect(reasonOf(b.outputs)).toEqual(['contradictory_replies']);
    expect(stdoutOf(b.outputs)).toContain('REASON:The tenant gave two consecutive replies that could not be reconciled with the proposed visit.');
  });

  it('any other intent resets the party streak, so unclear, accept, unclear gives a second clarification (AC-3.3)', () => {
    const { state, outputs } = step(fold([...loaded, interp('tenant', {}), interp('tenant', { intent: 'accept', quote: 'yes' })]).state, interp('tenant', {}));
    expect(decisions(outputs)).toEqual(['clarify']);
    expect(state.orders.get('WO-1')?.status).toBe('open');
  });

  it('streaks are per party: one unclear from each side gives two clarifications and no review', () => {
    const { state, outputs } = step(fold([...loaded, interp('tenant', {})]).state, interp('handyman', {}));
    expect(decisions(outputs)).toEqual(['clarify']);
    expect(stdoutOf(outputs)).toContain('Perdona, no he entendido tu respuesta.');
    expect(state.orders.get('WO-1')?.status).toBe('open');
  });

  it('a model failure counts as unclear: one clarification; two in a row close the order as llm_unavailable (AC-1.7, AC-3.4)', () => {
    const first = step(fold(loaded).state, failure());
    expect(decisions(first.outputs)).toEqual(['llm_error', 'clarify']);
    expect(first.state.orders.get('WO-1')).toMatchObject({ status: 'open', llmFailures: 1 });
    expect(stdoutOf(first.outputs)).toContain('Sorry, we did not understand your reply.');
    const second = step(first.state, failure('handyman'));
    expect(reasonOf(second.outputs)).toContain('llm_unavailable');
    expect(stdoutOf(second.outputs)).toBe('WOID:WO-1|RESULT:requires_review\nREASON:The reply interpreter was unavailable twice in a row for this order.\n\n');
    expect(second.state.holds).toEqual([]);
  });

  it('a valid reply between two model failures resets the failure count', () => {
    const { state, outputs } = step(fold([...loaded, failure(), interp('tenant', { intent: 'accept', quote: 'yes' })]).state, failure());
    expect(decisions(outputs)).toEqual(['llm_error', 'clarify']);
    expect(state.orders.get('WO-1')?.status).toBe('open');
  });

  it('a model failure for a closed order is ignored (ORD-2)', () => {
    const closed = fold([...loaded, { type: 'eof' }]).state;
    const { state, outputs } = step(closed, failure());
    expect(state).toEqual(closed);
    expect(tracesOf(outputs, 'ignored_fact')).toHaveLength(1);
  });
});

describe('negotiation: declines, counters, re-proposals, limits and withdrawals (004)', () => {
  // sim_now Wed 2026-11-04 10:00 +01:00. WO-1 (en, Medium, reported 02 Nov 09:00) → v1 Wed 12:00–14:00; WO-2 (Low) → v1 Wed 14:00–16:00.
  const startedNov: Fact = { type: 'run_started', sim_now: '2026-11-04T10:00:00+01:00', source: 'agent_now', clock_now: '2026-11-04T10:00:00+01:00', agent_now: '2026-11-04T10:00' };
  const loaded: Fact[] = [
    startedNov,
    {
      type: 'csv_loaded',
      rows: [
        row({ work_order_id: 'WO-1', reported_at: '2026-11-02T09:00:00' }),
        row({ work_order_id: 'WO-2', work_order: 'Squeaky door', address: 'Calle Mayor 2', urgency: 'Low', reported_at: '2026-11-02T10:00:00' }),
      ],
    },
  ];
  type Result = import('../../src/interpreter/schema.js').Interpretation;
  let seq = 100;
  const interp = (woid: string, role: 'tenant' | 'handyman', result: Partial<Result>): Fact => ({
    type: 'interpretation',
    seq: (seq += 1),
    woid,
    role,
    source: 'fake',
    prompt_version: '2',
    result: { intent: 'accept', times: [], exclusions: [], quote: 'q', ...result },
  });
  const decisionsOf = (outputs: Output[]) => tracesOf(outputs, 'decision').map((output) => output.kind === 'trace' && (output.detail as Record<string, unknown>));
  const outcomes = (outputs: Output[]) => decisionsOf(outputs).map((detail) => detail && detail['outcome']);
  const headersOf = (outputs: Output[]) => stdoutOf(outputs).split('\n\n').filter(Boolean).map((block) => block.split('\n')[0]);
  const holdOf = (state: import('../../src/core/state.js').State, id: string) => state.holds.find((hold) => hold.orderId === id);
  const noOverlap = (state: import('../../src/core/state.js').State) => {
    for (const a of state.holds) for (const b of state.holds) if (a !== b) expect(a.slot.start < b.slot.end && b.slot.start < a.slot.end, `${a.orderId} vs ${b.orderId}`).toBe(false);
  };

  describe('declines and counters (AC-1.1, AC-1.2, AC-1.6, AC-1.7, AC-1.8, SCHED-1)', () => {
    it('a decline re-proposes the next free slot after the declined one, skipping other holds, to both parties', () => {
      const { state, outputs } = step(fold(loaded).state, interp('WO-1', 'tenant', { intent: 'decline' }));
      expect(outcomes(outputs)).toEqual(['repropose']);
      expect(decisionsOf(outputs)[0]).toMatchObject({ cause: 'decline', party: 'tenant', version: 2, start: '2026-11-04T16:00:00+01:00' });
      expect(headersOf(outputs)).toEqual(['WOID:WO-1|ROLE:tenant', 'WOID:WO-1|ROLE:handyman']);
      expect(stdoutOf(outputs)).toContain('The previous proposal is cancelled. New proposal for "Leaking tap": Wednesday 4 November 2026, 16:00 to 18:00 (Madrid time).');
      expect(stdoutOf(outputs)).toContain('La propuesta anterior queda cancelada. Nueva propuesta para el aviso «Leaking tap» en Calle Mayor 1: miércoles 4 de noviembre de 2026, de 16:00 a 18:00 (hora de Madrid).');
      expect(tracesOf(outputs, 'hold_released').map((output) => output.kind === 'trace' && output.detail)).toEqual([{ version: 1, reason: 'reproposed' }]);
      expect(holdOf(state, 'WO-1')).toMatchObject({ version: 2, kind: 'tentative', slot: { start: '2026-11-04T16:00:00+01:00' } });
      expect(holdOf(state, 'WO-2')).toMatchObject({ version: 1, slot: { start: '2026-11-04T14:00:00+01:00' } });
      expect(state.orders.get('WO-1')).toMatchObject({ proposal: { version: 2 }, accepted: {} });
      noOverlap(state);
    });

    it('a counter with a fitting window gets a slot inside it (AC-1.2)', () => {
      const { state, outputs } = step(fold(loaded).state, interp('WO-1', 'tenant', { intent: 'counter', times: [{ date: '2026-11-05', start: '15:00', end: '20:00' }] }));
      expect(decisionsOf(outputs)[0]).toMatchObject({ outcome: 'repropose', cause: 'counter', version: 2, start: '2026-11-05T15:00:00+01:00', end: '2026-11-05T17:00:00+01:00' });
      expect(stdoutOf(outputs)).not.toContain('not available');
      expect(holdOf(state, 'WO-1')?.slot.start).toBe('2026-11-05T15:00:00+01:00');
    });

    it('a counter with no fit gets the nearest slot that day and the note goes only to that party (AC-1.6; 009 AC-3.1)', () => {
      const { outputs } = step(fold(loaded).state, interp('WO-1', 'tenant', { intent: 'counter', times: [{ date: '2026-11-05', start: '21:00' }] }));
      expect(decisionsOf(outputs)[0]).toMatchObject({ outcome: 'repropose', cause: 'no_fit', start: '2026-11-05T20:00:00+01:00' });
      const [tenantFrame, handymanFrame] = stdoutOf(outputs).split('\n\n');
      expect(tenantFrame).toContain('The times you suggested are not available.');
      expect(handymanFrame).not.toContain('no están disponibles');
    });

    it('a mismatched acceptance is a counter with its stated times (AC-1.7)', () => {
      const { outputs } = step(fold(loaded).state, interp('WO-1', 'tenant', { intent: 'accept', times: [{ date: '2026-11-05' }] }));
      expect(decisionsOf(outputs).map((detail) => detail && [detail['outcome'], detail['cause']])).toEqual([['mismatch', undefined], ['repropose', 'counter']]);
      expect(decisionsOf(outputs)[1]).toMatchObject({ start: '2026-11-05T07:00:00+01:00' });
    });

    it('the handyman is handled by the same rules; his availability applies to this order only (AC-1.8)', () => {
      const declined = step(fold(loaded).state, interp('WO-1', 'handyman', { intent: 'decline' }));
      expect(decisionsOf(declined.outputs)[0]).toMatchObject({ outcome: 'repropose', cause: 'decline', party: 'handyman', version: 2 });
      expect(headersOf(declined.outputs)).toEqual(['WOID:WO-1|ROLE:tenant', 'WOID:WO-1|ROLE:handyman']);
      const countered = step(fold(loaded).state, interp('WO-1', 'handyman', { intent: 'counter', times: [{ date: '2026-11-05', start: '09:00' }] }));
      expect(decisionsOf(countered.outputs)[0]).toMatchObject({ cause: 'counter', start: '2026-11-05T09:00:00+01:00' });
      expect(holdOf(countered.state, 'WO-2')?.slot.start).toBe('2026-11-04T14:00:00+01:00');
    });

    it("a counter onto another order's held hour of equal urgency does not take it (SCHED-1; takeover of lower urgency is 005)", () => {
      const twoMediums: Fact[] = [startedNov, { type: 'csv_loaded', rows: [row({ work_order_id: 'WO-1', reported_at: '2026-11-02T09:00:00' }), row({ work_order_id: 'WO-2', work_order: 'Squeaky door', address: 'Calle Mayor 2', reported_at: '2026-11-02T10:00:00' })] }];
      const { state, outputs } = step(fold(twoMediums).state, interp('WO-1', 'tenant', { intent: 'counter', times: [{ date: '2026-11-04', start: '14:00', end: '16:00' }] }));
      expect(decisionsOf(outputs)[0]).toMatchObject({ cause: 'no_fit' });
      expect(holdOf(state, 'WO-2')).toMatchObject({ orderId: 'WO-2', slot: { start: '2026-11-04T14:00:00+01:00' } });
      noOverlap(state);
    });
  });

  describe('re-proposals cancel the previous one for both parties (AC-2.1, AC-2.2, AC-2.3, AC-2.4, ACC-1)', () => {
    it('forgets both acceptances: the order is scheduled only when both accept the new version', () => {
      const afterDecline = fold([...loaded, interp('WO-1', 'handyman', {}), interp('WO-1', 'tenant', { intent: 'decline' })]).state;
      expect(afterDecline.orders.get('WO-1')?.accepted).toEqual({});
      const handymanAgain = step(afterDecline, interp('WO-1', 'handyman', {}));
      expect(outcomes(handymanAgain.outputs)).toEqual(['accepted']);
      expect(handymanAgain.state.orders.get('WO-1')?.status).toBe('open');
      const tenant = step(handymanAgain.state, interp('WO-1', 'tenant', {}));
      expect(outcomes(tenant.outputs)).toEqual(['scheduled']);
      expect(stdoutOf(tenant.outputs)).toContain('SCHEDULED_FOR:2026-11-04T16:00:00+01:00');
      expect(holdOf(tenant.state, 'WO-1')).toMatchObject({ version: 2, kind: 'scheduled' });
    });

    it('a bare yes from a party with two unanswered versions gets a confirmation request; a yes naming the slot counts at once (AC-2.3)', () => {
      const twoVersions = fold([...loaded, interp('WO-1', 'handyman', { intent: 'decline' })]).state; // tenant has v1 and v2 unanswered
      expect(twoVersions.orders.get('WO-1')?.unanswered).toEqual({ tenant: 2, handyman: 1 });
      const bare = step(twoVersions, interp('WO-1', 'tenant', {}));
      expect(decisionsOf(bare.outputs)[0]).toMatchObject({ outcome: 'needs_confirmation', reason: 'unanswered_versions' });
      expect(stdoutOf(bare.outputs)).toContain('To confirm: does the visit for "Leaking tap" on Wednesday 4 November 2026, 16:00 to 18:00');
      expect(bare.state.orders.get('WO-1')?.unanswered).toEqual({ tenant: 0, handyman: 1 });
      const confirmed = step(bare.state, interp('WO-1', 'tenant', {}));
      expect(outcomes(confirmed.outputs)).toEqual(['accepted']);
      const named = step(twoVersions, interp('WO-1', 'tenant', { times: [{ date: '2026-11-04', start: '16:00' }] }));
      expect(outcomes(named.outputs)).toEqual(['accepted']);
    });

    it('live holds never overlap across repeated re-proposals of two orders (SCHED-1)', () => {
      const { state } = fold([
        ...loaded,
        interp('WO-1', 'tenant', { intent: 'counter', times: [{ date: '2026-11-04', start: '14:00' }] }),
        interp('WO-2', 'tenant', { intent: 'counter', times: [{ date: '2026-11-04', start: '16:00' }] }),
        interp('WO-1', 'handyman', { intent: 'decline' }),
        interp('WO-2', 'handyman', { intent: 'counter', times: [{ date: '2026-11-05' }] }),
      ]);
      expect(state.holds).toHaveLength(2);
      noOverlap(state);
    });
  });

  describe('refusal limit (AC-3.1, AC-3.2, AC-3.3, AC-3.4, ORD-1)', () => {
    it('the third refusal by one party closes the order as no_mutual_slot without a new proposal', () => {
      const two = fold([...loaded, interp('WO-1', 'tenant', { intent: 'decline' }), interp('WO-1', 'tenant', { intent: 'counter', times: [{ date: '2026-11-06' }] })]).state;
      expect(two.orders.get('WO-1')?.refusals).toEqual({ tenant: 2, handyman: 0 });
      const { state, outputs } = step(two, interp('WO-1', 'tenant', { intent: 'decline' }));
      expect(outcomes(outputs)).toEqual(['review']);
      expect(stdoutOf(outputs)).toBe('WOID:WO-1|RESULT:requires_review\nREASON:The tenant declined or countered three proposals.\n\n');
      expect(state.orders.get('WO-1')).toMatchObject({ status: 'closed', result: { code: 'no_mutual_slot' } });
      expect(holdOf(state, 'WO-1')).toBeUndefined();
      expect(tracesOf(outputs, 'result')).toHaveLength(1);
    });

    it('limits are per party', () => {
      const { state } = fold([...loaded, interp('WO-1', 'tenant', { intent: 'decline' }), interp('WO-1', 'tenant', { intent: 'decline' }), interp('WO-1', 'handyman', { intent: 'decline' })]);
      expect(state.orders.get('WO-1')).toMatchObject({ status: 'open', proposal: { version: 4 }, refusals: { tenant: 2, handyman: 1 } });
    });

    it('questions, clarifications and confirmation requests do not count; mismatched accepts, no-fit counters and withdrawals do', () => {
      const soft = fold([...loaded, interp('WO-1', 'tenant', { intent: 'unclear' }), interp('WO-1', 'tenant', { intent: 'question', question: 'Parking?' }), interp('WO-1', 'tenant', { exclusions: [{ weekday: 'friday' }] })]).state;
      expect(soft.orders.get('WO-1')?.refusals).toEqual({ tenant: 0, handyman: 0 });
      const hard = fold([
        ...loaded,
        interp('WO-1', 'tenant', { times: [{ date: '2026-11-06' }] }),
        interp('WO-1', 'tenant', { intent: 'counter', times: [{ date: '2026-11-05', start: '21:00' }] }),
      ]).state;
      expect(hard.orders.get('WO-1')?.refusals).toEqual({ tenant: 2, handyman: 0 });
      const closed = step(hard, interp('WO-1', 'tenant', { intent: 'withdraw' }));
      expect(outcomes(closed.outputs)).toEqual(['review']);
    });
  });

  describe('withdrawals (AC-4.1, AC-4.2, ORD-2)', () => {
    it('a withdrawal before scheduling forgets the acceptance, counts and re-proposes', () => {
      const accepted = fold([...loaded, interp('WO-1', 'tenant', {})]).state;
      const { state, outputs } = step(accepted, interp('WO-1', 'tenant', { intent: 'withdraw' }));
      expect(decisionsOf(outputs)[0]).toMatchObject({ outcome: 'repropose', cause: 'withdraw', version: 2 });
      expect(state.orders.get('WO-1')).toMatchObject({ accepted: {}, refusals: { tenant: 1, handyman: 0 } });
      const withTimes = step(accepted, interp('WO-1', 'tenant', { intent: 'withdraw', times: [{ date: '2026-11-05', start: '10:00' }] }));
      expect(decisionsOf(withTimes.outputs)[0]).toMatchObject({ cause: 'withdraw', start: '2026-11-05T10:00:00+01:00' });
    });

    it('a withdrawal after scheduling is ignored (ORD-2)', () => {
      const scheduled = fold([...loaded, interp('WO-1', 'tenant', {}), interp('WO-1', 'handyman', {})]).state;
      const { state, outputs } = step(scheduled, interp('WO-1', 'tenant', { intent: 'withdraw' }));
      expect(state).toEqual(scheduled);
      expect(stdoutOf(outputs)).toBe('');
      expect(tracesOf(outputs, 'ignored_fact')).toHaveLength(1);
    });
  });
});

describe('questions and answers (AC-5.2, AC-5.5, LLM-2, ORD-2)', () => {
  const startedNov: Fact = { type: 'run_started', sim_now: '2026-11-04T10:00:00+01:00', source: 'agent_now', clock_now: '2026-11-04T10:00:00+01:00', agent_now: '2026-11-04T10:00' };
  const loaded: Fact[] = [startedNov, { type: 'csv_loaded', rows: [row({ work_order_id: 'WO-1', reported_at: '2026-11-02T09:00:00' })] }];
  const asked: Fact[] = [
    ...loaded,
    { type: 'msg_in', seq: 1, raw: 'WO-1|tenant The tap drips all night, please hurry' },
    { type: 'msg_in', seq: 2, raw: 'WO-1|handyman ¿Hay aparcamiento?' },
    { type: 'interpretation', seq: 2, woid: 'WO-1', role: 'handyman', source: 'fake', prompt_version: '2', result: { intent: 'question', times: [], exclusions: [], question: '¿Hay aparcamiento?', quote: '¿Hay aparcamiento?' } },
  ];
  const answerFact = (outcome: 'ok' | 'invalid' | 'error', text: string | null): Fact => ({ type: 'answer', seq: 2, woid: 'WO-1', role: 'handyman', prompt_version: '1', outcome, text });

  it('remembers the last message body of each party', () => {
    const { state } = fold(asked);
    expect(state.orders.get('WO-1')?.lastBody).toEqual({ tenant: 'The tap drips all night, please hurry', handyman: '¿Hay aparcamiento?' });
  });

  it('a question emits one answer request with the facts, the slot and the other party text, counts nothing and sends nothing yet (AC-5.5)', () => {
    const { state, outputs } = step(fold(asked.slice(0, -1)).state, asked.at(-1)!);
    const requests = outputs.filter((output) => output.kind === 'answer');
    expect(requests).toHaveLength(1);
    expect(requests[0]!.kind === 'answer' && requests[0]!.request).toMatchObject({
      woid: 'WO-1',
      seq: 2,
      role: 'handyman',
      language: 'es',
      body: '¿Hay aparcamiento?',
      question: '¿Hay aparcamiento?',
      slot: { start: '2026-11-04T12:00:00+01:00' },
      otherPartyText: 'The tap drips all night, please hurry',
    });
    expect(tracesOf(outputs, 'decision').map((output) => output.kind === 'trace' && (output.detail as { outcome: string }).outcome)).toEqual(['question']);
    expect(state.orders.get('WO-1')).toMatchObject({ refusals: { tenant: 0, handyman: 0 }, proposal: { version: 1 } });
    expect(stdoutOf(outputs)).not.toContain('|ROLE:');
  });

  it('a valid answer goes to the asker only, with the slot reminder (LLM-2)', () => {
    const { outputs } = step(fold(asked).state, answerFact('ok', 'Sí, hay aparcamiento en la calle.'));
    expect(stdoutOf(outputs).split('\n\n').filter(Boolean).map((block) => block.split('\n')[0])).toEqual(['WOID:WO-1|ROLE:handyman']);
    expect(stdoutOf(outputs)).toContain('Sí, hay aparcamiento en la calle. Te recuerdo que la visita propuesta por «Leaking tap» es el miércoles 4 de noviembre de 2026, de 12:00 a 14:00 (hora de Madrid).');
    expect(tracesOf(outputs, 'msg_out').map((output) => output.kind === 'trace' && (output.detail as { to: string; source: string }))).toEqual([expect.objectContaining({ to: 'handyman', source: 'model' })]);
    expect(tracesOf(outputs, 'decision').map((output) => output.kind === 'trace' && (output.detail as { outcome: string; source: string }))).toEqual([{ outcome: 'answered', party: 'handyman', source: 'model', version: 1 }]);
  });

  it('a rejected or failed answer becomes the fixed office sentence, still to the asker only', () => {
    for (const fact of [answerFact('invalid', null), answerFact('error', null)]) {
      const { outputs } = step(fold(asked).state, fact);
      expect(stdoutOf(outputs)).toContain('WOID:WO-1|ROLE:handyman\nLo consulto con la oficina y te digo. Te recuerdo que la visita propuesta');
      expect(tracesOf(outputs, 'msg_out').map((output) => output.kind === 'trace' && (output.detail as { source: string }).source)).toEqual(['template']);
    }
  });

  it('an answer for a closed order is ignored (ORD-2)', () => {
    const closed = fold([...asked, { type: 'eof' }]).state;
    const { state, outputs } = step(closed, answerFact('ok', 'Sí.'));
    expect(state).toEqual(closed);
    expect(tracesOf(outputs, 'ignored_fact')).toHaveLength(1);
    expect(stdoutOf(outputs)).toBe('');
  });
});

describe('cross-references (AC-6.1, AC-6.2, AC-6.3)', () => {
  const startedNov: Fact = { type: 'run_started', sim_now: '2026-11-04T10:00:00+01:00', source: 'agent_now', clock_now: '2026-11-04T10:00:00+01:00', agent_now: '2026-11-04T10:00' };
  const loaded: Fact[] = [startedNov, { type: 'csv_loaded', rows: [row({ work_order_id: 'WO-1', reported_at: '2026-11-02T09:00:00' })] }];
  type Result = import('../../src/interpreter/schema.js').Interpretation;
  let seq = 200;
  const interp = (role: 'tenant' | 'handyman', result: Partial<Result>): Fact => ({
    type: 'interpretation',
    seq: (seq += 1),
    woid: 'WO-1',
    role,
    source: 'fake',
    prompt_version: '2',
    result: { intent: 'cross_reference', times: [], exclusions: [], cross_reference: 'WO-7', quote: 'about the other one', ...result },
  });
  const outcomes = (outputs: Output[]) => tracesOf(outputs, 'decision').map((output) => output.kind === 'trace' && (output.detail as { outcome: string }).outcome);
  const reasons = (outputs: Output[]) => tracesOf(outputs, 'decision').map((output) => output.kind === 'trace' && (output.detail as { reason?: string }).reason);

  it('the first cross-reference gets a clarification that restates this order and its slot (AC-6.1)', () => {
    const { state, outputs } = step(fold(loaded).state, interp('tenant', {}));
    expect(outcomes(outputs)).toEqual(['clarify_cross_reference']);
    expect(stdoutOf(outputs)).toContain('WOID:WO-1|ROLE:tenant\n');
    expect(stdoutOf(outputs)).toContain('"Leaking tap"');
    expect(stdoutOf(outputs)).toContain('Wednesday 4 November 2026, 12:00 to 14:00');
    expect(state.orders.get('WO-1')).toMatchObject({ status: 'open', refusals: { tenant: 0, handyman: 0 } });
  });

  it('a second consecutive cross-reference closes the order as cross_reference (AC-6.2)', () => {
    const { state, outputs } = step(fold([...loaded, interp('tenant', {})]).state, interp('tenant', {}));
    expect(reasons(outputs)).toEqual(['cross_reference']);
    expect(stdoutOf(outputs)).toBe('WOID:WO-1|RESULT:requires_review\nREASON:The tenant kept referring to a different work order.\n\n');
    expect(state.holds).toEqual([]);
  });

  it('precedence over two consecutive problem replies: contradictory, then cross_reference, then interpretation_failed (AC-6.3)', () => {
    const crossThenUnclear = step(fold([...loaded, interp('tenant', {})]).state, interp('tenant', { intent: 'unclear' }));
    expect(reasons(crossThenUnclear.outputs)).toEqual(['cross_reference']);
    const unclearThenCross = step(fold([...loaded, interp('tenant', { intent: 'unclear' })]).state, interp('tenant', {}));
    expect(reasons(unclearThenCross.outputs)).toEqual(['cross_reference']);
    const crossThenContradictory = step(fold([...loaded, interp('tenant', {})]).state, interp('tenant', { intent: 'contradictory' }));
    expect(reasons(crossThenContradictory.outputs)).toEqual(['contradictory_replies']);
  });

  it('a clear reply in between resets the streak', () => {
    const { state, outputs } = step(fold([...loaded, interp('tenant', {}), interp('tenant', { intent: 'question', question: 'Parking?' })]).state, interp('tenant', {}));
    expect(outcomes(outputs)).toEqual(['clarify_cross_reference']);
    expect(state.orders.get('WO-1')?.status).toBe('open');
  });
});

describe('timeouts (AC-1.1, AC-1.2, AC-1.3, AC-1.4, AC-1.5, AC-1.6, AC-1.7, AC-1.8, RUN-3, ORD-1, ORD-2)', () => {
  const startedNov: Fact = { type: 'run_started', sim_now: '2026-11-04T10:00:00+01:00', source: 'agent_now', clock_now: '2026-11-04T10:00:00+01:00', agent_now: '2026-11-04T10:00' };
  const loaded: Fact[] = [startedNov, { type: 'csv_loaded', rows: [row({ work_order_id: 'WO-1', reported_at: '2026-11-02T09:00:00' })] }];
  const critical: Fact[] = [startedNov, { type: 'csv_loaded', rows: [row({ work_order_id: 'WO-C', work_order: 'Gas smell', urgency: 'Critical', reported_at: '2026-11-03T09:00:00' })] }];
  let seq = 300;
  const timeout = (woid: string, role: 'tenant' | 'handyman'): Fact => ({ type: 'msg_in', seq: (seq += 1), raw: `${woid}|${role} <NO RESPONSE>` });
  const accept = (woid: string, role: 'tenant' | 'handyman'): Fact => ({ type: 'interpretation', seq: (seq += 1), woid, role, source: 'regex', prompt_version: '3', result: { intent: 'accept', times: [], exclusions: [], quote: 'yes' } });
  const decline = (woid: string, role: 'tenant' | 'handyman'): Fact => ({ type: 'interpretation', seq: (seq += 1), woid, role, source: 'regex', prompt_version: '3', result: { intent: 'decline', times: [], exclusions: [], quote: 'no' } });
  const outcomes = (outputs: Output[]) => tracesOf(outputs, 'decision').map((output) => output.kind === 'trace' && (output.detail as { outcome: string }).outcome);

  it('a timeout from an awaited party counts and gets a reminder restating the slot (AC-1.1, AC-1.2, AC-1.3)', () => {
    const { state, outputs } = step(fold(loaded).state, timeout('WO-1', 'handyman'));
    expect(outcomes(outputs)).toEqual(['remind']);
    expect(stdoutOf(outputs)).toContain('WOID:WO-1|ROLE:handyman\nTe recuerdo que sigo pendiente de tu respuesta. La visita propuesta por «Leaking tap» es el miércoles 4 de noviembre de 2026, de 12:00 a 14:00 (hora de Madrid).');
    expect(state.orders.get('WO-1')).toMatchObject({ status: 'open', timeouts: { tenant: 0, handyman: 1 }, refusals: { tenant: 0, handyman: 0 } });
  });

  it('a timeout from a party that already accepted is traced as not counted and sends nothing (RUN-3)', () => {
    const accepted = fold([...loaded, accept('WO-1', 'tenant')]).state;
    const { state, outputs } = step(accepted, timeout('WO-1', 'tenant'));
    expect(outcomes(outputs)).toEqual(['timeout_ignored']);
    expect(stdoutOf(outputs)).toBe('');
    expect(state.orders.get('WO-1')?.timeouts).toEqual({ tenant: 0, handyman: 0 });
  });

  it('a second timeout closes the order as no_response naming the party and the other side acceptance, releasing the hold (AC-1.4)', () => {
    const once = fold([...loaded, accept('WO-1', 'tenant'), timeout('WO-1', 'handyman')]).state;
    const { state, outputs } = step(once, timeout('WO-1', 'handyman'));
    expect(outcomes(outputs)).toEqual(['review']);
    expect(stdoutOf(outputs)).toBe('WOID:WO-1|RESULT:requires_review\nREASON:The handyman did not reply after a reminder; the proposed visit was Wednesday 4 November 2026, 12:00 to 14:00 (Madrid time), accepted by the tenant.\n\n');
    expect(state.orders.get('WO-1')).toMatchObject({ status: 'closed', result: { code: 'no_response' } });
    expect(state.holds).toEqual([]);
  });

  it('a real reply resets the count (AC-1.5)', () => {
    const { state, outputs } = step(fold([...loaded, timeout('WO-1', 'handyman'), decline('WO-1', 'handyman')]).state, timeout('WO-1', 'handyman'));
    expect(outcomes(outputs)).toEqual(['remind']);
    expect(state.orders.get('WO-1')?.timeouts).toEqual({ tenant: 0, handyman: 1 });
  });

  it('a silent tenant on a Critical order goes to review at once, stating the slot and the handyman state (AC-1.6)', () => {
    const { state, outputs } = step(fold([...critical, accept('WO-C', 'handyman')]).state, timeout('WO-C', 'tenant'));
    expect(outcomes(outputs)).toEqual(['review']);
    expect(stdoutOf(outputs)).toBe('WOID:WO-C|RESULT:requires_review\nREASON:The tenant of a critical order did not reply; the proposed visit is Wednesday 4 November 2026, 12:00 to 14:00 (Madrid time), accepted by the handyman.\n\n');
    expect(state.orders.get('WO-C')?.status).toBe('closed');
    const alone = step(fold(critical).state, timeout('WO-C', 'tenant'));
    expect(stdoutOf(alone.outputs)).toContain('not yet accepted by the handyman.');
  });

  it('a silent handyman on a Critical order gets a reminder (AC-1.7)', () => {
    const { outputs } = step(fold(critical).state, timeout('WO-C', 'handyman'));
    expect(outcomes(outputs)).toEqual(['remind']);
  });

  it('both parties silent: two reminders, then one result only (ORD-1)', () => {
    const { state, outputs } = fold([...loaded, timeout('WO-1', 'tenant'), timeout('WO-1', 'handyman'), timeout('WO-1', 'tenant'), timeout('WO-1', 'handyman')]);
    expect(tracesOf(outputs, 'result')).toHaveLength(1);
    expect(stdoutOf(outputs).match(/\|RESULT:/g)).toHaveLength(1);
    expect(state.orders.get('WO-1')?.status).toBe('closed');
  });

  it('a timeout for a closed order is classified closed_order and changes nothing (AC-1.8, ORD-2)', () => {
    const closed = fold([...loaded, accept('WO-1', 'tenant'), accept('WO-1', 'handyman')]).state;
    const { state, outputs } = step(closed, timeout('WO-1', 'tenant'));
    expect(state).toEqual(closed);
    expect(stdoutOf(outputs)).toBe('');
    expect(tracesOf(outputs, 'line_classified').map((output) => output.kind === 'trace' && (output.detail as { classification: string }).classification)).toEqual(['closed_order']);
  });
});

describe('preemption (AC-2.1, AC-2.2, AC-2.3, AC-2.4, AC-2.5, AC-2.6, SCHED-3, SCHED-4, ACC-1, SCHED-1)', () => {
  // Priority at startup: WO-C (Critical) 12:00–14:00, WO-M (Medium) 14:00–16:00, WO-L (Low) 16:00–18:00.
  const startedNov: Fact = { type: 'run_started', sim_now: '2026-11-04T10:00:00+01:00', source: 'agent_now', clock_now: '2026-11-04T10:00:00+01:00', agent_now: '2026-11-04T10:00' };
  const rows = [
    row({ work_order_id: 'WO-L', work_order: 'Squeaky door', urgency: 'Low', reported_at: '2026-11-02T08:00:00' }),
    row({ work_order_id: 'WO-M', work_order: 'Leaking tap', urgency: 'Medium', reported_at: '2026-11-02T09:00:00' }),
    row({ work_order_id: 'WO-C', work_order: 'Gas smell', urgency: 'Critical', reported_at: '2026-11-03T09:00:00' }),
  ];
  const loaded: Fact[] = [startedNov, { type: 'csv_loaded', rows }];
  let seq = 400;
  const counter = (woid: string, start: string, end: string, role: 'tenant' | 'handyman' = 'tenant'): Fact => ({
    type: 'interpretation', seq: (seq += 1), woid, role, source: 'fake', prompt_version: '3',
    result: { intent: 'counter', times: [{ date: '2026-11-04', start, end }], exclusions: [], quote: 'later' },
  });
  const accept = (woid: string, role: 'tenant' | 'handyman'): Fact => ({ type: 'interpretation', seq: (seq += 1), woid, role, source: 'regex', prompt_version: '3', result: { intent: 'accept', times: [], exclusions: [], quote: 'yes' } });
  const decisionsOf = (outputs: Output[]) => tracesOf(outputs, 'decision').map((output) => output.kind === 'trace' && (output.detail as Record<string, unknown>));
  const holdOf = (state: import('../../src/core/state.js').State, id: string) => state.holds.find((hold) => hold.orderId === id);

  it('a Critical counter onto a Low hold takes it over; the Low order is re-proposed with the note and no penalty (AC-2.1, AC-2.3, AC-2.4, AC-2.5, SCHED-4)', () => {
    const { state, outputs } = step(fold([...loaded, accept('WO-L', 'tenant')]).state, counter('WO-C', '16:00', '18:00'));
    const decisions = decisionsOf(outputs);
    expect(decisions.map((d) => d && [d['outcome'], d['cause'] ?? d['from']])).toEqual([
      ['takeover', 'WO-L'],
      ['repropose', 'counter'],
      ['repropose', 'preempted'],
    ]);
    expect(decisions[0]).toMatchObject({ outcome: 'takeover', from: 'WO-L', urgency: 'Critical', victim_urgency: 'Low', slot: { start: '2026-11-04T16:00:00+01:00' } });
    expect(holdOf(state, 'WO-C')).toMatchObject({ version: 2, slot: { start: '2026-11-04T16:00:00+01:00' } });
    expect(holdOf(state, 'WO-L')).toMatchObject({ version: 2, kind: 'tentative' });
    expect(holdOf(state, 'WO-L')?.slot.start).not.toBe('2026-11-04T16:00:00+01:00');
    expect(state.orders.get('WO-L')).toMatchObject({ refusals: { tenant: 0, handyman: 0 }, accepted: {}, proposal: { version: 2 } });
    expect(tracesOf(outputs, 'hold_released').map((output) => output.kind === 'trace' && [output.work_order_id, (output.detail as { reason: string }).reason])).toEqual([
      ['WO-L', 'preempted'],
      ['WO-C', 'reproposed'],
    ]);
    const frames = stdoutOf(outputs).split('\n\n').filter(Boolean);
    expect(frames.filter((frame) => frame.startsWith('WOID:WO-L|')).map((frame) => frame.split('\n')[0])).toEqual(['WOID:WO-L|ROLE:tenant', 'WOID:WO-L|ROLE:handyman']);
    expect(frames.find((frame) => frame.startsWith('WOID:WO-L|ROLE:tenant'))).toContain('That slot had to be given to a more urgent job.');
    expect(frames.find((frame) => frame.startsWith('WOID:WO-L|ROLE:handyman'))).toContain('Ese hueco se ha dado a un aviso más urgente.');
    for (const a of state.holds) for (const b of state.holds) if (a !== b) expect(a.slot.start < b.slot.end && b.slot.start < a.slot.end).toBe(false);
  });

  it('equal urgency never takes over: the no-fit rule applies (AC-2.2)', () => {
    const twoMediums: Fact[] = [startedNov, { type: 'csv_loaded', rows: [row({ work_order_id: 'WO-A', reported_at: '2026-11-02T09:00:00' }), row({ work_order_id: 'WO-B', reported_at: '2026-11-02T10:00:00' })] }];
    const { state, outputs } = step(fold(twoMediums).state, counter('WO-B', '12:00', '14:00'));
    expect(decisionsOf(outputs).map((d) => d && d['outcome'])).toEqual(['repropose']);
    expect(decisionsOf(outputs)[0]).toMatchObject({ cause: 'no_fit' });
    expect(holdOf(state, 'WO-A')?.slot.start).toBe('2026-11-04T12:00:00+01:00');
  });

  it('a scheduled visit is never taken over, whatever the urgency (AC-2.2, AC-2.6, SCHED-3)', () => {
    const scheduledLow = fold([...loaded, accept('WO-L', 'tenant'), accept('WO-L', 'handyman')]).state;
    expect(holdOf(scheduledLow, 'WO-L')?.kind).toBe('scheduled');
    const { state, outputs } = step(scheduledLow, counter('WO-C', '16:00', '18:00'));
    expect(decisionsOf(outputs).map((d) => d && d['outcome'])).toEqual(['repropose']);
    expect(decisionsOf(outputs)[0]).toMatchObject({ cause: 'no_fit' });
    expect(holdOf(state, 'WO-L')).toEqual(holdOf(scheduledLow, 'WO-L'));
    expect(state.orders.get('WO-L')?.status).toBe('closed');
  });

  it("a preempted order's re-proposal never takes over in turn (AC-2.5)", () => {
    const { state, outputs } = step(fold(loaded).state, counter('WO-C', '14:00', '16:00'));
    expect(decisionsOf(outputs)[0]).toMatchObject({ outcome: 'takeover', from: 'WO-M', victim_urgency: 'Medium' });
    // 15:00 and 16:00 overlap the new WO-C hold or WO-L's; 17:00 would end past 19:00 after overlapping WO-L: Thursday morning it is.
    expect(holdOf(state, 'WO-M')?.slot.start).toBe('2026-11-05T09:00:00+01:00');
    expect(holdOf(state, 'WO-L')).toMatchObject({ version: 1, slot: { start: '2026-11-04T16:00:00+01:00' } });
    expect(tracesOf(outputs, 'decision').filter((output) => output.kind === 'trace' && (output.detail as { outcome: string }).outcome === 'takeover')).toHaveLength(1);
  });

  it('a hostile sequence against a scheduled order leaves its hold untouched (SCHED-3)', () => {
    const scheduledLow = fold([...loaded, accept('WO-L', 'tenant'), accept('WO-L', 'handyman')]).state;
    const before = holdOf(scheduledLow, 'WO-L');
    const after = fold([
      ...loaded, accept('WO-L', 'tenant'), accept('WO-L', 'handyman'),
      counter('WO-C', '16:00', '18:00'),
      counter('WO-M', '16:00', '18:00', 'handyman'),
      { type: 'msg_in', seq: (seq += 1), raw: 'WO-C|tenant <NO RESPONSE>' },
      { type: 'eof' },
    ]).state;
    expect(holdOf(after, 'WO-L')).toEqual(before);
    expect(after.orders.get('WO-L')).toMatchObject({ status: 'closed', result: { kind: 'scheduled' } });
  });
});

describe('handyman blackouts (AC-3.1, AC-3.2, AC-3.3, AC-3.4, AC-3.5, AC-3.6, SCHED-3)', () => {
  // WO-1 (Medium) v1 Wed 12:00–14:00; WO-2 (Low) v1 Wed 14:00–16:00; sim_now Wed 4 Nov 10:00.
  const startedNov: Fact = { type: 'run_started', sim_now: '2026-11-04T10:00:00+01:00', source: 'agent_now', clock_now: '2026-11-04T10:00:00+01:00', agent_now: '2026-11-04T10:00' };
  const loaded: Fact[] = [
    startedNov,
    { type: 'csv_loaded', rows: [row({ work_order_id: 'WO-1', reported_at: '2026-11-02T09:00:00' }), row({ work_order_id: 'WO-2', work_order: 'Squeaky door', address: 'Calle Mayor 2', urgency: 'Low', reported_at: '2026-11-02T10:00:00' })] },
  ];
  type Result = import('../../src/interpreter/schema.js').Interpretation;
  let seq = 500;
  const interp = (woid: string, role: 'tenant' | 'handyman', result: Partial<Result>): Fact => ({
    type: 'interpretation', seq: (seq += 1), woid, role, source: 'fake', prompt_version: '3',
    result: { intent: 'decline', times: [], exclusions: [], quote: 'no', ...result },
  });
  const accept = (woid: string, role: 'tenant' | 'handyman'): Fact => interp(woid, role, { intent: 'accept', quote: 'yes' });
  const wednesdayOff = (woid: string, extra: Partial<Result> = {}): Fact => interp(woid, 'handyman', { intent: 'decline', exclusions: [{ date: '2026-11-04' }], scope: 'all', quote: 'mañana no puedo nada', ...extra });
  const decisionsOf = (outputs: Output[]) => tracesOf(outputs, 'decision').map((output) => output.kind === 'trace' && (output.detail as Record<string, unknown>));
  const holdOf = (state: import('../../src/core/state.js').State, id: string) => state.holds.find((hold) => hold.orderId === id);

  it('records the blackout, moves every other tentative hold outside it without penalty, then handles the current order by its own intent, by priority (AC-3.1, AC-3.2, AC-3.5; 010 AC-1.1, AC-1.2)', () => {
    const { state, outputs } = step(fold(loaded).state, wednesdayOff('WO-1'));
    expect(state.blackouts).toEqual([{ start: '2026-11-04T00:00:00+01:00', end: '2026-11-05T00:00:00+01:00' }]);
    expect(tracesOf(outputs, 'blackout_recorded')).toHaveLength(1);
    expect(tracesOf(outputs, 'hold_released').map((output) => output.kind === 'trace' && [output.work_order_id, (output.detail as { reason: string }).reason])).toEqual([
      ['WO-2', 'blackout'],
      ['WO-1', 'reproposed'],
    ]);
    // 010: WO-1 (Medium, the order the handyman wrote on) ranks above WO-2 (Low), so it picks first.
    expect(decisionsOf(outputs).map((d) => d && [d['outcome'], d['cause']])).toEqual([
      ['repropose', 'decline'],
      ['repropose', 'blackout'],
    ]);
    expect(holdOf(state, 'WO-1')?.slot.start).toBe('2026-11-05T09:00:00+01:00');
    expect(holdOf(state, 'WO-2')?.slot.start).toBe('2026-11-05T11:00:00+01:00');
    expect(state.orders.get('WO-2')).toMatchObject({ refusals: { tenant: 0, handyman: 0 }, proposal: { version: 2 } });
    expect(state.orders.get('WO-1')).toMatchObject({ refusals: { tenant: 0, handyman: 1 }, proposal: { version: 2 } });
    const frames = stdoutOf(outputs).split('\n\n').filter(Boolean);
    expect(frames.find((frame) => frame.startsWith('WOID:WO-2|ROLE:tenant'))).toContain('The handyman is not available at the previous slot.');
    expect(frames.find((frame) => frame.startsWith('WOID:WO-2|ROLE:handyman'))).toContain('Movemos la visita por tu indisponibilidad.');
    expect(frames.find((frame) => frame.startsWith('WOID:WO-1|ROLE:tenant'))).not.toContain('not available at the previous slot');
  });

  it('later proposals avoid the blackout for every order (AC-3.3)', () => {
    const blacked = fold([...loaded, wednesdayOff('WO-1')]).state;
    const { outputs } = step(blacked, interp('WO-2', 'tenant', { intent: 'counter', times: [{ date: '2026-11-04', start: '16:00' }], quote: 'today at 4' }));
    expect(decisionsOf(outputs)[0]).toMatchObject({ outcome: 'repropose', cause: 'no_fit' });
    expect((decisionsOf(outputs)[0] as { start: string })['start']).not.toMatch(/^2026-11-04/);
  });

  it('keeps a scheduled visit that overlaps the blackout and traces the conflict (AC-3.4, SCHED-3)', () => {
    const scheduled = fold([...loaded, accept('WO-2', 'tenant'), accept('WO-2', 'handyman')]).state;
    const before = holdOf(scheduled, 'WO-2');
    const { state, outputs } = step(scheduled, wednesdayOff('WO-1'));
    expect(holdOf(state, 'WO-2')).toEqual(before);
    expect(tracesOf(outputs, 'blackout_conflict').map((output) => output.kind === 'trace' && output.work_order_id)).toEqual(['WO-2']);
    expect(tracesOf(outputs, 'hold_released').map((output) => output.kind === 'trace' && output.work_order_id)).toEqual(['WO-1']);
  });

  it('a statement scoped to this order, or from a tenant, creates no blackout (AC-3.6)', () => {
    const own = step(fold(loaded).state, wednesdayOff('WO-1', { scope: 'this_order' }));
    expect(own.state.blackouts).toEqual([]);
    expect(holdOf(own.state, 'WO-2')?.slot.start).toBe('2026-11-04T14:00:00+01:00');
    const tenant = step(fold(loaded).state, interp('WO-1', 'tenant', { exclusions: [{ date: '2026-11-04' }], scope: 'all' }));
    expect(tenant.state.blackouts).toEqual([]);
  });

  it('a weekday blackout covers the next occurrence only (AC-3.7)', () => {
    const { state } = step(fold(loaded).state, interp('WO-1', 'handyman', { intent: 'counter', times: [{ date: '2026-11-06', start: '09:00' }], exclusions: [{ weekday: 'thursday' }], scope: 'all', quote: 'el jueves no, el viernes a las 9' }));
    expect(state.blackouts).toEqual([{ start: '2026-11-05T00:00:00+01:00', end: '2026-11-06T00:00:00+01:00' }]);
    expect(holdOf(state, 'WO-1')?.slot.start).toBe('2026-11-06T09:00:00+01:00');
    expect(holdOf(state, 'WO-2')?.slot.start).toBe('2026-11-04T14:00:00+01:00');
  });
});

describe('008 · re-proposals never overlap a refused slot (REQ-NG-11)', () => {
  // sim_now Wed 2026-11-04 10:00 +01:00. One Medium order WO-1 → v1 Wed 12:00–14:00 unless stated otherwise.
  const startedNov: Fact = { type: 'run_started', sim_now: '2026-11-04T10:00:00+01:00', source: 'agent_now', clock_now: '2026-11-04T10:00:00+01:00', agent_now: '2026-11-04T10:00' };
  const one: Fact[] = [startedNov, { type: 'csv_loaded', rows: [row({ work_order_id: 'WO-1', reported_at: '2026-11-02T09:00:00' })] }];
  // WO-H (High) v1 Wed 12:00–14:00; WO-L (Low) v1 Wed 14:00–16:00.
  const two: Fact[] = [
    startedNov,
    { type: 'csv_loaded', rows: [row({ work_order_id: 'WO-H', urgency: 'High', reported_at: '2026-11-02T09:00:00' }), row({ work_order_id: 'WO-L', work_order: 'Squeaky door', urgency: 'Low', reported_at: '2026-11-02T10:00:00' })] },
  ];
  type Result = import('../../src/interpreter/schema.js').Interpretation;
  type State = import('../../src/core/state.js').State;
  let seq = 800;
  const say = (woid: string, role: 'tenant' | 'handyman', result: Partial<Result>): Fact => ({
    type: 'interpretation', seq: (seq += 1), woid, role, source: 'fake', prompt_version: '3',
    result: { intent: 'decline', times: [], exclusions: [], quote: 'q', ...result },
  });
  const decline = (woid: string, role: 'tenant' | 'handyman' = 'tenant') => say(woid, role, { intent: 'decline' });
  const startOf = (state: State, id: string) => state.holds.find((hold) => hold.orderId === id)?.slot.start;
  const refusedOf = (state: State, id: string) => state.orders.get(id)?.refused.map((slot) => slot.start);
  const sound = (state: State) => {
    for (const a of state.holds) {
      expect(Date.parse(a.slot.end) - Date.parse(a.slot.start), `${a.orderId} lasts 2 hours (SCHED-2)`).toBe(2 * 3600_000);
      for (const b of state.holds) if (a !== b) expect(Date.parse(a.slot.start) < Date.parse(b.slot.end) && Date.parse(b.slot.start) < Date.parse(a.slot.end), `${a.orderId} vs ${b.orderId} (SCHED-1)`).toBe(false);
    }
  };

  describe('what counts as refused (AC-1.1)', () => {
    it('a decline, a counter, a mismatched acceptance and a withdrawal each add the current slot', () => {
      expect(refusedOf(fold([...one, decline('WO-1')]).state, 'WO-1')).toEqual(['2026-11-04T12:00:00+01:00']);
      expect(refusedOf(fold([...one, say('WO-1', 'handyman', { intent: 'counter', times: [{ date: '2026-11-05', start: '09:00' }] })]).state, 'WO-1')).toEqual(['2026-11-04T12:00:00+01:00']);
      expect(refusedOf(fold([...one, say('WO-1', 'tenant', { intent: 'accept', times: [{ date: '2026-11-05' }] })]).state, 'WO-1')).toEqual(['2026-11-04T12:00:00+01:00']);
      expect(refusedOf(fold([...one, say('WO-1', 'tenant', { intent: 'accept' }), say('WO-1', 'tenant', { intent: 'withdraw' })]).state, 'WO-1')).toEqual(['2026-11-04T12:00:00+01:00']);
    });

    it('a preemption and a blackout add nothing to the moved order (REQ-NG-9)', () => {
      const preempted = fold([...two, say('WO-H', 'tenant', { intent: 'counter', times: [{ date: '2026-11-04', start: '14:00', end: '16:00' }] })]).state;
      expect(startOf(preempted, 'WO-H')).toBe('2026-11-04T14:00:00+01:00');
      expect(refusedOf(preempted, 'WO-L')).toEqual([]);
      const blackedOut = fold([...two, say('WO-H', 'handyman', { intent: 'decline', exclusions: [{ date: '2026-11-04' }], scope: 'all' })]).state;
      expect(refusedOf(blackedOut, 'WO-L')).toEqual([]);
      expect(refusedOf(blackedOut, 'WO-H')).toEqual(['2026-11-04T12:00:00+01:00']);
    });
  });

  describe('the fallback avoids every refused slot (AC-1.2, SCHED-1, SCHED-2)', () => {
    it('three plain declines walk 12:00 → 14:00 → 16:00, never overlapping the slot just refused', () => {
      const first = fold([...one, decline('WO-1')]).state;
      expect(startOf(first, 'WO-1')).toBe('2026-11-04T14:00:00+01:00');
      const second = step(first, decline('WO-1', 'handyman')).state;
      expect(startOf(second, 'WO-1')).toBe('2026-11-04T16:00:00+01:00');
      sound(second);
    });

    it('a decline of the last slot of the day moves to the next weekday at 09:00', () => {
      const late = fold([...one, say('WO-1', 'tenant', { intent: 'counter', times: [{ date: '2026-11-04', start: '17:00' }] })]).state;
      expect(startOf(late, 'WO-1')).toBe('2026-11-04T17:00:00+01:00');
      expect(startOf(step(late, decline('WO-1', 'handyman')).state, 'WO-1')).toBe('2026-11-05T09:00:00+01:00');
    });

    it('avoids earlier refusals too, not only the slot it starts after (non-contiguous)', () => {
      const state = fold([
        ...one,
        decline('WO-1', 'handyman'), // v1 12:00 refused → v2 14:00
        decline('WO-1', 'tenant'), // v2 14:00 refused → v3 16:00
        say('WO-1', 'tenant', { intent: 'counter', times: [{ date: '2026-11-04', start: '13:00' }] }), // v3 refused; explicit 13:00 → v4
      ]).state;
      expect(startOf(state, 'WO-1')).toBe('2026-11-04T13:00:00+01:00');
      const after = step(state, decline('WO-1', 'handyman')).state; // v4 13:00 refused; every Wednesday hour overlaps a refusal
      expect(startOf(after, 'WO-1')).toBe('2026-11-05T09:00:00+01:00');
      sound(after);
    });
  });

  describe('explicit statements and other orders (AC-1.3, AC-1.4)', () => {
    it('a stated time is honoured even when it overlaps a slot refused earlier in the order', () => {
      const state = fold([...one, decline('WO-1', 'handyman'), say('WO-1', 'tenant', { intent: 'counter', times: [{ date: '2026-11-04', start: '12:00' }] })]).state;
      expect(startOf(state, 'WO-1')).toBe('2026-11-04T12:00:00+01:00');
    });

    it("a slot refused in one order stays available to another order's fallback", () => {
      const lowDeclined = fold([...two, decline('WO-L')]).state;
      expect(startOf(lowDeclined, 'WO-L')).toBe('2026-11-04T16:00:00+01:00');
      const highDeclined = step(lowDeclined, decline('WO-H')).state;
      expect(startOf(highDeclined, 'WO-H')).toBe('2026-11-04T14:00:00+01:00');
      sound(highDeclined);
    });
  });
});

describe('009 · stated constraints are honoured, and notes are true (REQ-NG-12, REQ-NG-13)', () => {
  // sim_now Wed 2026-11-04 10:00 +01:00; one Medium order WO-1 (English) → v1 Wed 12:00–14:00.
  const startedNov: Fact = { type: 'run_started', sim_now: '2026-11-04T10:00:00+01:00', source: 'agent_now', clock_now: '2026-11-04T10:00:00+01:00', agent_now: '2026-11-04T10:00' };
  const one: Fact[] = [startedNov, { type: 'csv_loaded', rows: [row({ work_order_id: 'WO-1', reported_at: '2026-11-02T09:00:00' })] }];
  type Result = import('../../src/interpreter/schema.js').Interpretation;
  type State = import('../../src/core/state.js').State;
  let seq = 900;
  const say = (role: 'tenant' | 'handyman', result: Partial<Result>): Fact => ({
    type: 'interpretation', seq: (seq += 1), woid: 'WO-1', role, source: 'fake', prompt_version: '4',
    result: { intent: 'decline', times: [], exclusions: [], quote: 'q', ...result },
  });
  const startOf = (state: State) => state.holds.find((hold) => hold.orderId === 'WO-1')?.slot.start;
  const lastDecision = (outputs: Output[]) => {
    const decisions = tracesOf(outputs, 'decision');
    const last = decisions[decisions.length - 1];
    return last?.kind === 'trace' ? (last.detail as Record<string, unknown>) : undefined;
  };
  const NOTE = 'The times you suggested are not available.';
  const sound = (state: State) => {
    for (const a of state.holds) {
      expect(Date.parse(a.slot.end) - Date.parse(a.slot.start), 'SCHED-2').toBe(2 * 3600_000);
      for (const b of state.holds) if (a !== b) expect(Date.parse(a.slot.start) < Date.parse(b.slot.end) && Date.parse(b.slot.start) < Date.parse(a.slot.end), 'SCHED-1').toBe(false);
    }
  };

  describe('what a party rules out stays ruled out (AC-1.1, AC-1.2, AC-1.3, AC-1.4)', () => {
    it('a decline that excludes the day moves to another day, without a note', () => {
      const { state, outputs } = step(fold(one).state, say('tenant', { exclusions: [{ weekday: 'wednesday' }] }));
      expect(startOf(state)).toBe('2026-11-05T09:00:00+01:00');
      expect(lastDecision(outputs)).toMatchObject({ outcome: 'repropose', cause: 'decline' });
      expect(stdoutOf(outputs)).not.toContain(NOTE);
      sound(state);
    });

    it('a counter with exclusions and no times is re-proposed like a decline, avoiding them, without a note (AC-2.2)', () => {
      const weekdays = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday'] as const;
      const { state, outputs } = step(fold(one).state, say('tenant', { intent: 'counter', exclusions: weekdays.map((weekday) => ({ weekday })) }));
      expect(startOf(state)).toBe('2026-11-11T09:00:00+01:00');
      expect(lastDecision(outputs)).toMatchObject({ outcome: 'repropose', cause: 'counter' });
      expect(stdoutOf(outputs)).not.toContain(NOTE);
    });

    it('undated times are a daily constraint: "only afternoons" never gets a morning on a later day', () => {
      const state = fold([...one, say('tenant', { exclusions: [{ end: '14:00' }] }), say('handyman', {}), say('handyman', {})]).state;
      expect(startOf(state)).toBe('2026-11-05T14:00:00+01:00');
      expect(state.orders.get('WO-1')?.constraints.length).toBe(14);
      sound(state);
    });

    it('constraints of both parties add up', () => {
      const state = fold([...one, say('tenant', { exclusions: [{ weekday: 'wednesday' }] }), say('handyman', { exclusions: [{ weekday: 'thursday' }] })]).state;
      expect(startOf(state)).toBe('2026-11-06T09:00:00+01:00');
    });

    it('a time the party names now wins over an earlier constraint (AC-1.4)', () => {
      const state = fold([...one, say('tenant', { exclusions: [{ weekday: 'wednesday' }] }), say('tenant', { intent: 'counter', times: [{ date: '2026-11-04', start: '16:00' }] })]).state;
      expect(startOf(state)).toBe('2026-11-04T16:00:00+01:00');
    });
  });

  it('"Hoy a las 12 no puedo, ¿hoy a las 14?" with 14:00 held keeps the rest of the afternoon open: the nearest slot is today 16:00 (AC-1.2, AC-3.1)', () => {
    const two: Fact[] = [startedNov, { type: 'csv_loaded', rows: [row({ work_order_id: 'WO-1', reported_at: '2026-11-02T09:00:00' }), row({ work_order_id: 'WO-2', reported_at: '2026-11-02T10:00:00' })] }];
    const { state } = step(fold(two).state, say('tenant', { intent: 'counter', times: [{ date: '2026-11-04', start: '14:00' }], exclusions: [{ date: '2026-11-04', start: '12:00' }] }));
    expect(startOf(state)).toBe('2026-11-04T16:00:00+01:00');
  });

  describe('the nearest slot on the stated day, and true notes (AC-2.1, AC-3.1, AC-3.2)', () => {
    it('a time that cannot fit gets the nearest slot that day, with the note', () => {
      const { state, outputs } = step(fold(one).state, say('tenant', { intent: 'counter', times: [{ date: '2026-11-04', start: '21:30' }] }));
      expect(startOf(state)).toBe('2026-11-04T20:00:00+01:00');
      expect(lastDecision(outputs)).toMatchObject({ outcome: 'repropose', cause: 'no_fit' });
      expect(stdoutOf(outputs)).toContain(NOTE);
    });

    it('a stated day with nothing free falls back to the next slot, with the note', () => {
      const { state, outputs } = step(fold(one).state, say('tenant', { intent: 'counter', times: [{ date: '2026-11-02', start: '10:00' }] }));
      expect(startOf(state)).toBe('2026-11-04T14:00:00+01:00');
      expect(stdoutOf(outputs)).toContain(NOTE);
    });
  });

  describe("readings that keep the party's last word (AC-4.1, AC-4.2)", () => {
    it('"yes, but not before 13:00" to the 12:00 slot is a counter, not a confirmation question', () => {
      const { state, outputs } = step(fold(one).state, say('tenant', { intent: 'accept', exclusions: [{ end: '13:00' }] }));
      expect(tracesOf(outputs, 'decision').map((output) => output.kind === 'trace' && (output.detail as { outcome: string }).outcome)).toEqual(['mismatch', 'repropose']);
      expect(startOf(state)).toBe('2026-11-04T14:00:00+01:00');
      expect(stdoutOf(outputs)).not.toContain('To confirm');
      expect(stdoutOf(outputs)).not.toContain(NOTE);
    });

    it('a contradictory reply that states a time is a counter with that time', () => {
      const { state, outputs } = step(fold(one).state, say('tenant', { intent: 'contradictory', times: [{ date: '2026-11-05', start: '11:00' }] }));
      expect(tracesOf(outputs, 'decision').map((output) => output.kind === 'trace' && (output.detail as { outcome: string }).outcome)).toEqual(['correction', 'repropose']);
      expect(startOf(state)).toBe('2026-11-05T11:00:00+01:00');
      expect(state.orders.get('WO-1')?.unclearStreak.tenant.count).toBe(0);
    });
  });
});

describe('009 · stated availability that contains the proposal is an acceptance (AC-4.5)', () => {
  const startedNov: Fact = { type: 'run_started', sim_now: '2026-11-04T10:00:00+01:00', source: 'agent_now', clock_now: '2026-11-04T10:00:00+01:00', agent_now: '2026-11-04T10:00' };
  const one: Fact[] = [startedNov, { type: 'csv_loaded', rows: [row({ work_order_id: 'WO-1', reported_at: '2026-11-02T09:00:00' })] }];
  type Result = import('../../src/interpreter/schema.js').Interpretation;
  let seq = 950;
  const say = (result: Partial<Result>): Fact => ({ type: 'interpretation', seq: (seq += 1), woid: 'WO-1', role: 'tenant', source: 'fake', prompt_version: '4', result: { intent: 'accept', times: [], exclusions: [], quote: 'q', ...result } });
  const outcomes = (outputs: Output[]) => tracesOf(outputs, 'decision').map((output) => output.kind === 'trace' && (output.detail as { outcome: string }).outcome);

  it('an accept listing the whole week counts for the current proposal, without a re-proposal', () => {
    const week = ['2026-11-04', '2026-11-05', '2026-11-06', '2026-11-07', '2026-11-08'].map((date) => ({ date }));
    const { state, outputs } = step(fold(one).state, say({ times: week }));
    expect(outcomes(outputs)).toEqual(['accepted']);
    expect(state.orders.get('WO-1')).toMatchObject({ accepted: { tenant: 1 }, proposal: { version: 1 } });
  });

  it('a counter whose range contains the proposal is an acceptance; one that does not is still a counter', () => {
    expect(outcomes(step(fold(one).state, say({ intent: 'counter', times: [{ date: '2026-11-04', start: '09:00', end: '18:00' }] })).outputs)).toEqual(['accepted']);
    expect(outcomes(step(fold(one).state, say({ intent: 'counter', times: [{ date: '2026-11-04', start: '13:00', end: '18:00' }] })).outputs)).toEqual(['repropose']);
  });

  it('an exclusion that rules the proposal out wins over a window that contains it', () => {
    const { outputs } = step(fold(one).state, say({ times: [{ date: '2026-11-04' }], exclusions: [{ end: '13:00' }] }));
    expect(outcomes(outputs)).toEqual(['mismatch', 'repropose']);
  });
});

describe('010 · blackout moves respect priority (REQ-SC-5, REQ-SC-6)', () => {
  // sim_now Wed 2026-11-04 10:00. Allocation: H (High) 12:00, M (Medium) 14:00, L (Low) 16:00, whatever the CSV order.
  const startedNov: Fact = { type: 'run_started', sim_now: '2026-11-04T10:00:00+01:00', source: 'agent_now', clock_now: '2026-11-04T10:00:00+01:00', agent_now: '2026-11-04T10:00' };
  const loaded: Fact[] = [
    startedNov,
    {
      type: 'csv_loaded',
      rows: [
        row({ work_order_id: 'L', urgency: 'Low', reported_at: '2026-11-02T08:00:00' }),
        row({ work_order_id: 'M', urgency: 'Medium', reported_at: '2026-11-02T09:00:00' }),
        row({ work_order_id: 'H', urgency: 'High', reported_at: '2026-11-02T10:00:00' }),
      ],
    },
  ];
  type Result = import('../../src/interpreter/schema.js').Interpretation;
  type State = import('../../src/core/state.js').State;
  let seq = 1000;
  const handyman = (woid: string, result: Partial<Result>): Fact => ({ type: 'interpretation', seq: (seq += 1), woid, role: 'handyman', source: 'fake', prompt_version: '4', result: { intent: 'decline', times: [], exclusions: [], quote: 'hoy no puedo nada', scope: 'all', ...result } });
  const today = { exclusions: [{ date: '2026-11-04' }] };
  const startOf = (state: State, id: string) => state.holds.find((hold) => hold.orderId === id)?.slot.start;
  const sound = (state: State) => {
    for (const a of state.holds) for (const b of state.holds) if (a !== b) expect(Date.parse(a.slot.start) < Date.parse(b.slot.end) && Date.parse(b.slot.start) < Date.parse(a.slot.end), 'SCHED-1').toBe(false);
  };

  it('the handyman writes on the Medium order: High moves first, then the Medium by its own reply, then the Low (AC-1.1, AC-1.2)', () => {
    const { state } = step(fold(loaded).state, handyman('M', today));
    expect([startOf(state, 'H'), startOf(state, 'M'), startOf(state, 'L')]).toEqual(['2026-11-05T09:00:00+01:00', '2026-11-05T11:00:00+01:00', '2026-11-05T13:00:00+01:00']);
    sound(state);
  });

  it('the handyman writes on the Low order: the High and the Medium move before it (AC-1.2)', () => {
    const { state } = step(fold(loaded).state, handyman('L', today));
    expect([startOf(state, 'H'), startOf(state, 'M'), startOf(state, 'L')]).toEqual(['2026-11-05T09:00:00+01:00', '2026-11-05T11:00:00+01:00', '2026-11-05T13:00:00+01:00']);
  });

  it('an undated general decline blacks out the day of the current proposal, traced as inferred (AC-2.1)', () => {
    const { state, outputs } = step(fold(loaded).state, handyman('M', {}));
    expect(state.blackouts).toEqual([{ start: '2026-11-04T00:00:00+01:00', end: '2026-11-05T00:00:00+01:00' }]);
    expect(tracesOf(outputs, 'blackout_recorded').map((output) => output.kind === 'trace' && (output.detail as { inferred?: boolean }).inferred)).toEqual([true]);
    expect(startOf(state, 'H')).toBe('2026-11-05T09:00:00+01:00');
  });

  it('a general scope on an acceptance never creates a blackout (AC-2.2)', () => {
    const { state, outputs } = step(fold(loaded).state, handyman('M', { intent: 'accept', quote: 'vale' }));
    expect(state.blackouts).toEqual([]);
    expect(tracesOf(outputs, 'blackout_recorded')).toHaveLength(0);
  });
});

describe('011 · a time a party names counts as their acceptance (ACC-1, RUN-3)', () => {
  // sim_now Wed 2026-11-04 10:00; one Medium order WO-1 (English) → v1 Wed 12:00–14:00.
  const startedNov: Fact = { type: 'run_started', sim_now: '2026-11-04T10:00:00+01:00', source: 'agent_now', clock_now: '2026-11-04T10:00:00+01:00', agent_now: '2026-11-04T10:00' };
  const one: Fact[] = [startedNov, { type: 'csv_loaded', rows: [row({ work_order_id: 'WO-1', reported_at: '2026-11-02T09:00:00' })] }];
  type Result = import('../../src/interpreter/schema.js').Interpretation;
  let seq = 1100;
  const say = (role: 'tenant' | 'handyman', result: Partial<Result>): Fact => ({ type: 'interpretation', seq: (seq += 1), woid: 'WO-1', role, source: 'fake', prompt_version: '4', result: { intent: 'accept', times: [], exclusions: [], quote: 'q', ...result } });
  const thursday10 = { intent: 'counter' as const, times: [{ date: '2026-11-05', start: '10:00' }] };
  const outcomes = (outputs: Output[]) => tracesOf(outputs, 'decision').map((output) => output.kind === 'trace' && (output.detail as { outcome: string }).outcome);

  it('the handyman names Thursday 10:00: v2 is that slot, he is recorded as accepting it and told so, the tenant is asked (AC-1.1, AC-1.2)', () => {
    const { state, outputs } = step(fold(one).state, say('handyman', thursday10));
    expect(state.orders.get('WO-1')).toMatchObject({ proposal: { version: 2, slot: { start: '2026-11-05T10:00:00+01:00' } }, accepted: { handyman: 2 } });
    expect(tracesOf(outputs, 'decision').map((output) => output.kind === 'trace' && output.detail)).toEqual([expect.objectContaining({ outcome: 'repropose', accepted_by: 'handyman' })]);
    const frames = stdoutOf(outputs).split('\n\n').filter(Boolean);
    expect(frames.find((frame) => frame.startsWith('WOID:WO-1|ROLE:handyman'))).toContain('Anotamos la visita que propones');
    expect(frames.find((frame) => frame.startsWith('WOID:WO-1|ROLE:tenant'))).toContain('Does that work for you?');
  });

  it("the tenant's acceptance of that version schedules it, with confirmations to both (AC-1.5, ACC-1, ACC-2)", () => {
    const { state, outputs } = step(fold([...one, say('handyman', thursday10)]).state, say('tenant', { times: [{ date: '2026-11-05', start: '10:00' }] }));
    expect(outcomes(outputs)).toEqual(['scheduled']);
    expect(state.orders.get('WO-1')?.result).toEqual({ kind: 'scheduled', scheduledFor: '2026-11-05T10:00:00+01:00' });
  });

  it('the namer is not awaited: his <NO RESPONSE> is not counted, and a later bare yes from him is not a second version (AC-1.3, RUN-3)', () => {
    const named = fold([...one, say('tenant', thursday10)]).state;
    expect(named.orders.get('WO-1')?.unanswered.tenant).toBe(0);
    const { outputs } = step(named, { type: 'msg_in', seq: 2, raw: 'WO-1|tenant <NO RESPONSE>' });
    expect(outcomes(outputs)).toEqual(['timeout_ignored']);
  });

  it('a wider range, a date alone or the nearest slot when the time did not fit do not count (AC-1.4)', () => {
    const range = fold([...one, say('tenant', { intent: 'counter', times: [{ date: '2026-11-05', start: '15:00', end: '20:00' }] })]).state;
    expect(range.orders.get('WO-1')?.accepted).toEqual({});
    const nearest = fold([...one, say('tenant', { intent: 'counter', times: [{ date: '2026-11-04', start: '21:30' }] })]).state;
    expect(nearest.orders.get('WO-1')?.accepted).toEqual({});
  });
});

describe('012 · escalate to a person (REQ-NG-14, LLM-2, ORD-1)', () => {
  const startedNov: Fact = { type: 'run_started', sim_now: '2026-11-04T10:00:00+01:00', source: 'agent_now', clock_now: '2026-11-04T10:00:00+01:00', agent_now: '2026-11-04T10:00' };
  const one: Fact[] = [startedNov, { type: 'csv_loaded', rows: [row({ work_order_id: 'WO-1', reported_at: '2026-11-02T09:00:00' })] }];
  let seq = 1200;
  const say = (role: 'tenant' | 'handyman', intent: string, quote: string): Fact => ({ type: 'interpretation', seq: (seq += 1), woid: 'WO-1', role, source: 'fake', prompt_version: '5', result: { intent, times: [], exclusions: [], quote } as never });

  it('acknowledges the sender, closes as escalated and releases the hold; the other party gets nothing (AC-1.2, AC-1.3)', () => {
    const { state, outputs } = step(fold([...one, say('handyman', 'accept', 'vale')]).state, say('tenant', 'escalate', 'I want to talk to a person'));
    expect(state.orders.get('WO-1')?.result).toEqual({ kind: 'requires_review', code: 'escalated', sentence: 'The tenant asked for a person or complained; the office should contact them.' });
    const blocks = stdoutOf(outputs).split('\n\n').filter(Boolean);
    expect(blocks.map((block) => block.split('\n')[0])).toEqual(['WOID:WO-1|ROLE:tenant', 'WOID:WO-1|RESULT:requires_review']);
    expect(blocks[0]).toContain('someone will contact you');
    expect(stdoutOf(outputs)).not.toContain('talk to a person');
    expect(state.holds.filter((hold) => hold.orderId === 'WO-1')).toEqual([]);
  });
});
