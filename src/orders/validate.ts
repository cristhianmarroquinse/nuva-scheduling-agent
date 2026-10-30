// CSV rows → work orders (REQ-IN-2, REQ-IN-3). Pure; the rules are applied again on replay.

import type { RawRow } from '../core/facts.js';
import type { RowProblem } from '../core/reasons.js';
import { parseLocalOrOffset, toIso } from '../time/time.js';

export const HEADER = ['work_order_id', 'work_order', 'address', 'description', 'reported_at', 'urgency'] as const;

export type Urgency = 'Critical' | 'High' | 'Medium' | 'Low';

const URGENCIES: readonly Urgency[] = ['Critical', 'High', 'Medium', 'Low'];

export interface WorkOrder {
  id: string;
  title: string;
  address: string;
  description: string;
  /** ISO 8601 with the Madrid offset. */
  reportedAt: string;
  urgency: Urgency;
}

export type ReadRowsResult = { ok: true; rows: RawRow[] } | { ok: false; error: 'empty' | 'wrong_header'; header: string[] };

export type RejectedRow = { id: string; line: number; problem: RowProblem };
export type IgnoredRow = { line: number; reason: 'no_id' | 'duplicate'; id?: string };
export type RowEntry = { kind: 'order'; order: WorkOrder } | { kind: 'rejected'; rejected: RejectedRow } | { kind: 'ignored'; ignored: IgnoredRow };

export interface ValidatedRows {
  orders: WorkOrder[];
  /** Rows with a usable id that cannot be used (closed as `invalid_work_order`), in CSV order. */
  rejected: RejectedRow[];
  /** Rows that produce nothing: no usable id, or a repeated id. `line` is 1-based among the data rows. */
  ignored: IgnoredRow[];
  /** Every row, classified, in CSV order. */
  entries: RowEntry[];
}

/** Checks the header and keys every data row by column; missing fields are empty, extra fields are dropped. */
export function readRows(table: string[][]): ReadRowsResult {
  const [header, ...data] = table;
  if (header === undefined) return { ok: false, error: 'empty', header: [] };
  const columns = header.map((column) => column.trim());
  if (columns.length !== HEADER.length || columns.some((column, index) => column !== HEADER[index])) {
    return { ok: false, error: 'wrong_header', header: columns };
  }
  const rows = data.map((fields) => Object.fromEntries(HEADER.map((column, index) => [column, fields[index] ?? ''])) as RawRow);
  return { ok: true, rows };
}

/** A usable id is non-empty after trimming and holds no whitespace, `|` or control characters, so it is always safe in a header. */
function usableId(raw: string): string | null {
  const id = raw.trim();
  // eslint-disable-next-line no-control-regex
  return id !== '' && !/[\s|\u0000-\u001f\u007f]/.test(id) ? id : null;
}

function rowProblem(row: RawRow): RowProblem | null {
  if ((row['work_order'] ?? '').trim() === '') return { field: 'work_order', problem: 'empty' };
  const reportedAt = (row['reported_at'] ?? '').trim();
  if (reportedAt === '') return { field: 'reported_at', problem: 'empty' };
  if (parseLocalOrOffset(reportedAt) === null) return { field: 'reported_at', problem: 'unparseable', value: reportedAt };
  const urgency = (row['urgency'] ?? '').trim();
  if (!URGENCIES.includes(urgency as Urgency)) return { field: 'urgency', problem: 'unknown', value: urgency };
  return null;
}

export function validateRows(rows: RawRow[]): ValidatedRows {
  const result: ValidatedRows = { orders: [], rejected: [], ignored: [], entries: [] };
  const seen = new Set<string>();
  const ignore = (ignored: IgnoredRow): void => {
    result.ignored.push(ignored);
    result.entries.push({ kind: 'ignored', ignored });
  };
  rows.forEach((row, index) => {
    const line = index + 1;
    const id = usableId(row['work_order_id'] ?? '');
    if (id === null) return ignore({ line, reason: 'no_id' });
    if (seen.has(id)) return ignore({ line, reason: 'duplicate', id });
    seen.add(id);
    const problem = rowProblem(row);
    if (problem !== null) {
      const rejected: RejectedRow = { id, line, problem };
      result.rejected.push(rejected);
      result.entries.push({ kind: 'rejected', rejected });
      return;
    }
    const order: WorkOrder = {
      id,
      title: (row['work_order'] ?? '').trim(),
      address: (row['address'] ?? '').trim(),
      description: (row['description'] ?? '').trim(),
      reportedAt: toIso(parseLocalOrOffset(row['reported_at'] ?? '')!),
      urgency: (row['urgency'] ?? '').trim() as Urgency,
    };
    result.orders.push(order);
    result.entries.push({ kind: 'order', order });
  });
  return result;
}
