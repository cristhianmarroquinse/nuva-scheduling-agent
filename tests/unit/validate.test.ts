import { describe, expect, it } from 'vitest';
import { HEADER, readRows, validateRows } from '../../src/orders/validate.js';

// AC-1.3 (invalid rows), AC-1.4 (no usable id), AC-1.5 (duplicates), AC-1.6 (header), AC-1.7 (reported_at zones).

const header = [...HEADER];

function row(fields: Partial<Record<(typeof HEADER)[number], string>>): Record<string, string> {
  return {
    work_order_id: 'WO-1',
    work_order: 'Leaking tap',
    address: 'Calle Mayor 1',
    description: 'The kitchen tap drips.',
    reported_at: '2026-10-07T09:30:00',
    urgency: 'Medium',
    ...fields,
  };
}

describe('readRows (AC-1.6, AC-1.2)', () => {
  it('rejects an empty table and a different header', () => {
    expect(readRows([])).toEqual({ ok: false, error: 'empty', header: [] });
    expect(readRows([['id', 'title']])).toEqual({ ok: false, error: 'wrong_header', header: ['id', 'title'] });
    expect(readRows([[...header, 'extra']])).toMatchObject({ ok: false, error: 'wrong_header' });
  });

  it('accepts the exact header with surrounding whitespace and keys rows by column', () => {
    const result = readRows([header.map((column) => ` ${column} `), ['WO-1', 'Tap', 'Addr', 'Desc', '2026-10-07', 'Low']]);
    expect(result).toEqual({
      ok: true,
      rows: [{ work_order_id: 'WO-1', work_order: 'Tap', address: 'Addr', description: 'Desc', reported_at: '2026-10-07', urgency: 'Low' }],
    });
  });

  it('fills missing trailing fields with empty strings and drops extra ones', () => {
    const result = readRows([header, ['WO-1', 'Tap'], ['WO-2', 'Tap', 'A', 'D', '2026-10-07', 'Low', 'extra']]);
    expect(result.ok && result.rows).toEqual([
      { work_order_id: 'WO-1', work_order: 'Tap', address: '', description: '', reported_at: '', urgency: '' },
      { work_order_id: 'WO-2', work_order: 'Tap', address: 'A', description: 'D', reported_at: '2026-10-07', urgency: 'Low' },
    ]);
  });
});

describe('validateRows', () => {
  it('turns a valid row into a work order with reported_at in Madrid (AC-1.7)', () => {
    const { orders, rejected, ignored } = validateRows([row({})]);
    expect(rejected).toEqual([]);
    expect(ignored).toEqual([]);
    expect(orders).toEqual([
      {
        id: 'WO-1',
        title: 'Leaking tap',
        address: 'Calle Mayor 1',
        description: 'The kitchen tap drips.',
        reportedAt: '2026-10-07T09:30:00+02:00',
        urgency: 'Medium',
      },
    ]);
  });

  it('reads reported_at with an offset as that instant in Madrid, on both sides of 2026-10-25 (AC-1.7)', () => {
    const { orders } = validateRows([
      row({ work_order_id: 'A', reported_at: '2026-10-24T16:00:00Z' }),
      row({ work_order_id: 'B', reported_at: '2026-10-26T08:00:00Z' }),
      row({ work_order_id: 'C', reported_at: '2026-10-26 09:00' }),
    ]);
    expect(orders.map((order) => order.reportedAt)).toEqual(['2026-10-24T18:00:00+02:00', '2026-10-26T09:00:00+01:00', '2026-10-26T09:00:00+01:00']);
  });

  it('rejects rows with an empty title, an empty or unparseable reported_at, or an unknown urgency (AC-1.3)', () => {
    const { orders, rejected } = validateRows([
      row({ work_order_id: 'T', work_order: '  ' }),
      row({ work_order_id: 'D1', reported_at: '' }),
      row({ work_order_id: 'D2', reported_at: 'last Tuesday' }),
      row({ work_order_id: 'U', urgency: 'Urgent' }),
      row({ work_order_id: 'OK' }),
    ]);
    expect(orders.map((order) => order.id)).toEqual(['OK']);
    expect(rejected).toEqual([
      { id: 'T', line: 1, problem: { field: 'work_order', problem: 'empty' } },
      { id: 'D1', line: 2, problem: { field: 'reported_at', problem: 'empty' } },
      { id: 'D2', line: 3, problem: { field: 'reported_at', problem: 'unparseable', value: 'last Tuesday' } },
      { id: 'U', line: 4, problem: { field: 'urgency', problem: 'unknown', value: 'Urgent' } },
    ]);
  });

  it('accepts the four urgencies after trimming', () => {
    const { orders, rejected } = validateRows(
      ['Critical', ' High ', 'Medium', 'Low'].map((urgency, index) => row({ work_order_id: `WO-${index}`, urgency })),
    );
    expect(rejected).toEqual([]);
    expect(orders.map((order) => order.urgency)).toEqual(['Critical', 'High', 'Medium', 'Low']);
  });

  it('ignores rows with no usable id: empty, whitespace, or containing a pipe, whitespace or control characters (AC-1.4)', () => {
    const { orders, rejected, ignored } = validateRows([
      row({ work_order_id: '' }),
      row({ work_order_id: '   ' }),
      row({ work_order_id: 'WO|1' }),
      row({ work_order_id: 'WO 1' }),
      row({ work_order_id: 'WO\u00001' }),
    ]);
    expect(orders).toEqual([]);
    expect(rejected).toEqual([]);
    expect(ignored).toEqual([
      { line: 1, reason: 'no_id' },
      { line: 2, reason: 'no_id' },
      { line: 3, reason: 'no_id' },
      { line: 4, reason: 'no_id' },
      { line: 5, reason: 'no_id' },
    ]);
  });

  it('keeps the first row of a duplicated id and ignores the others, even when the first was invalid (AC-1.5)', () => {
    const { orders, rejected, ignored } = validateRows([
      row({ work_order_id: 'WO-1', work_order: 'First' }),
      row({ work_order_id: ' WO-1 ', work_order: 'Second' }),
      row({ work_order_id: 'WO-2', urgency: 'Bad' }),
      row({ work_order_id: 'WO-2' }),
    ]);
    expect(orders.map((order) => order.title)).toEqual(['First']);
    expect(rejected.map((entry) => entry.id)).toEqual(['WO-2']);
    expect(ignored).toEqual([
      { line: 2, reason: 'duplicate', id: 'WO-1' },
      { line: 4, reason: 'duplicate', id: 'WO-2' },
    ]);
  });

  it('trims ids, titles and the other text fields', () => {
    const { orders } = validateRows([row({ work_order_id: '  WO-9 ', work_order: ' Tap ', address: ' A ', description: ' D ' })]);
    expect(orders[0]).toMatchObject({ id: 'WO-9', title: 'Tap', address: 'A', description: 'D' });
  });
});
