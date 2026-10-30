// Pure core: state = fold(step, facts) (ADR 0002). `step` derives every projection; nothing it returns is fed back.

import type { Fact } from './facts.js';
import { parseLine } from './protocol.js';
import { NO_RESPONSE_SENTENCE, invalidRowSentence } from './reasons.js';
import { formatResult, type Result, type Role } from '../io/frames.js';
import { inferLanguage } from '../orders/language.js';
import { validateRows, type WorkOrder } from '../orders/validate.js';

export type Language = 'es' | 'en';

export interface OrderState {
  id: string;
  /** Absent for rows that were rejected at load time. */
  order?: WorkOrder;
  language?: Language;
  status: 'open' | 'closed';
  result?: Result;
}

export interface State {
  simNow: string | null;
  loaded: boolean;
  /** Insertion order is CSV order. */
  orders: Map<string, OrderState>;
  ended: boolean;
}

export type Output =
  | { kind: 'stdout'; text: string }
  | { kind: 'trace'; work_order_id: string | null; event_type: string; detail: unknown };

export interface StepResult {
  state: State;
  outputs: Output[];
}

export function initialState(): State {
  return { simNow: null, loaded: false, orders: new Map(), ended: false };
}

function trace(work_order_id: string | null, event_type: string, detail: unknown): Output {
  return { kind: 'trace', work_order_id, event_type, detail };
}

/** Closes an open order with a terminal result: one state change, one traced result, one stdout result (ORD-1, ORD-2). */
function close(orders: Map<string, OrderState>, outputs: Output[], id: string, result: Result): void {
  const current = orders.get(id);
  if (current === undefined || current.status === 'closed') return;
  orders.set(id, { ...current, status: 'closed', result });
  outputs.push(trace(id, 'state_change', { from: 'open', to: 'closed', result }));
  outputs.push(trace(id, 'result', result));
  outputs.push({ kind: 'stdout', text: formatResult(id, result) });
}

function loadCsv(state: State, rows: Fact & { type: 'csv_loaded' }): StepResult {
  if (state.loaded) return { state, outputs: [trace(null, 'ignored_fact', { type: 'csv_loaded', reason: 'already_loaded' })] };
  const outputs: Output[] = [];
  const orders = new Map(state.orders);
  for (const entry of validateRows(rows.rows).entries) {
    if (entry.kind === 'ignored') {
      outputs.push(trace(null, 'row_ignored', entry.ignored));
    } else if (entry.kind === 'order') {
      const { order } = entry;
      const { language, evidence } = inferLanguage(order.title, order.description);
      orders.set(order.id, { id: order.id, order, language, status: 'open' });
      outputs.push(trace(order.id, 'order_loaded', { title: order.title, reported_at: order.reportedAt, urgency: order.urgency }));
      outputs.push(trace(order.id, 'language_inferred', { language, evidence }));
    } else {
      const { id, line, problem } = entry.rejected;
      orders.set(id, { id, status: 'open' });
      outputs.push(trace(id, 'row_rejected', { line, problem }));
      close(orders, outputs, id, { kind: 'requires_review', code: 'invalid_work_order', sentence: invalidRowSentence(problem) });
    }
  }
  return { state: { ...state, loaded: true, orders }, outputs };
}

const ROLES: readonly Role[] = ['tenant', 'handyman'];

/**
 * A stdin line: classified and traced (REQ-IN-5 to REQ-IN-7). Nothing reaches stdout, and lines for closed orders
 * change nothing (ORD-2). Negotiation on messages arrives in later features.
 */
function receiveLine(state: State, fact: Fact & { type: 'msg_in' }): StepResult {
  const parsed = parseLine(fact.raw);
  const classified = (work_order_id: string | null, detail: Record<string, unknown>): StepResult => ({
    state,
    outputs: [trace(work_order_id, 'line_classified', { ...detail, seq: fact.seq })],
  });
  if (parsed.kind === 'malformed') return classified(null, { classification: 'malformed', reason: parsed.reason });
  const order = state.orders.get(parsed.woid);
  if (order === undefined) return classified(null, { classification: 'unknown_order', woid: parsed.woid });
  if (!ROLES.includes(parsed.role as Role)) return classified(order.id, { classification: 'invalid_role', role: parsed.role });
  if (order.status === 'closed') return classified(order.id, { classification: 'closed_order', role: parsed.role });
  if (parsed.timeout) return classified(order.id, { classification: 'timeout', role: parsed.role });
  return classified(order.id, { classification: 'message', role: parsed.role, body: parsed.body });
}

/** End of input: every order still open closes as `no_response`, in CSV order (REQ-TO-4). A repeated eof changes nothing. */
function endInput(state: State): StepResult {
  if (state.ended) return { state, outputs: [trace(null, 'ignored_fact', { type: 'eof', reason: 'already_ended' })] };
  const outputs: Output[] = [];
  const orders = new Map(state.orders);
  for (const order of orders.values()) {
    close(orders, outputs, order.id, { kind: 'requires_review', code: 'no_response', sentence: NO_RESPONSE_SENTENCE });
  }
  return { state: { ...state, ended: true, orders }, outputs };
}

export function step(state: State, fact: Fact): StepResult {
  switch (fact.type) {
    case 'run_started':
      return { state: { ...state, simNow: fact.sim_now }, outputs: [] };
    case 'csv_loaded':
      return loadCsv(state, fact);
    case 'msg_in':
      return receiveLine(state, fact);
    case 'eof':
      return endInput(state);
  }
}

export function fold(facts: Iterable<Fact>): StepResult {
  let state = initialState();
  const outputs: Output[] = [];
  for (const fact of facts) {
    const next = step(state, fact);
    state = next.state;
    outputs.push(...next.outputs);
  }
  return { state, outputs };
}

/** True once the CSV is loaded and every order has a terminal result (REQ-TO-6). */
export function allTerminal(state: State): boolean {
  if (!state.loaded) return false;
  for (const order of state.orders.values()) {
    if (order.status !== 'closed') return false;
  }
  return true;
}
