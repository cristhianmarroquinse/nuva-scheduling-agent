// Pure core: state = fold(step, facts) (ADR 0002). `step` derives every projection; nothing it returns is fed back.

import type { Fact } from './facts.js';
import { parseLine } from './protocol.js';
import { NO_RESPONSE_SENTENCE, REVIEW_SENTENCES, invalidRowSentence } from './reasons.js';
import { earliestStart, nextSlot, priorityOrder, type Hold, type Slot } from '../calendar/calendar.js';
import { formatFrame, formatResult, type Result, type Role } from '../io/frames.js';
import { acknowledgement, clarification, confirmationRequest, confirmationToHandyman, confirmationToTenant, initialProposalToHandyman, initialProposalToTenant } from '../messages/templates.js';
import { evaluateAcceptance } from '../policy/acceptance.js';
import { inferLanguage } from '../orders/language.js';
import { validateRows, type WorkOrder } from '../orders/validate.js';
import type { InterpretRequest } from '../interpreter/types.js';
import type { Language } from '../time/format.js';
import { parseLocalOrOffset } from '../time/time.js';

export type { Language } from '../time/format.js';

export interface Proposal {
  version: number;
  slot: Slot;
}

export interface OrderState {
  id: string;
  /** Absent for rows that were rejected at load time. */
  order?: WorkOrder;
  language?: Language;
  status: 'open' | 'closed';
  /** The latest proposal sent for the order; its hold lives in `State.holds` while the order is open. */
  proposal?: Proposal;
  /** Proposal version each party accepted (ACC-1). */
  accepted: Partial<Record<Role, number>>;
  /** Parties asked to confirm a constrained acceptance (REQ-NG-3). */
  awaitingConfirmation: Partial<Record<Role, true>>;
  /** Consecutive unclear or contradictory replies per party (REQ-NG-8). */
  unclearStreak: Record<Role, { count: number; contradictory: boolean }>;
  /** Consecutive model failures for this order (REQ-RB-1). */
  llmFailures: number;
  result?: Result;
}

const FRESH_STREAK = { tenant: { count: 0, contradictory: false }, handyman: { count: 0, contradictory: false } } as const;

function newOrderState(id: string): OrderState {
  return { id, status: 'open', accepted: {}, awaitingConfirmation: {}, unclearStreak: { ...FRESH_STREAK }, llmFailures: 0 };
}

export interface State {
  simNow: string | null;
  loaded: boolean;
  /** Insertion order is CSV order. */
  orders: Map<string, OrderState>;
  /** Live tentative holds (SCHED-1: never overlapping). */
  holds: Hold[];
  ended: boolean;
}

export type Output =
  | { kind: 'stdout'; text: string }
  | { kind: 'trace'; work_order_id: string | null; event_type: string; detail: unknown }
  /** An effect for the runner: ask the interpreter; its answer comes back as an `interpretation` or `llm_error` fact. */
  | { kind: 'interpret'; request: InterpretRequest };

export interface StepResult {
  state: State;
  outputs: Output[];
}

export function initialState(): State {
  return { simNow: null, loaded: false, orders: new Map(), holds: [], ended: false };
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
      orders.set(order.id, { ...newOrderState(order.id), order, language });
      outputs.push(trace(order.id, 'order_loaded', { title: order.title, reported_at: order.reportedAt, urgency: order.urgency }));
      outputs.push(trace(order.id, 'language_inferred', { language, evidence }));
    } else {
      const { id, line, problem } = entry.rejected;
      orders.set(id, newOrderState(id));
      outputs.push(trace(id, 'row_rejected', { line, problem }));
      close(orders, outputs, id, { kind: 'requires_review', code: 'invalid_work_order', sentence: invalidRowSentence(problem) });
    }
  }
  const holds = allocate(state, orders, outputs);
  return { state: { ...state, loaded: true, orders, holds }, outputs };
}

/**
 * Initial proposals (REQ-ST-1..3): every open order gets the earliest free 2-hour slot, allocated Critical first, then
 * High, Medium, Low, ties by `reported_at`. Each allocation is a tentative hold, traced as `hold_taken`, followed by the
 * tenant frame and the handyman frame (REQ-ST-2), each traced as `msg_out`.
 */
function allocate(state: State, orders: Map<string, OrderState>, outputs: Output[]): Hold[] {
  if (state.simNow === null) throw new Error('csv_loaded before run_started: no reference time');
  const simNow = parseLocalOrOffset(state.simNow);
  if (simNow === null) throw new Error(`Unreadable reference time ${state.simNow}`);
  const holds = [...state.holds];
  const open = [...orders.values()].flatMap((entry) => (entry.status === 'open' && entry.order !== undefined ? [entry.order] : []));
  for (const order of priorityOrder(open)) {
    const slot = nextSlot({ from: earliestStart(simNow, parseLocalOrOffset(order.reportedAt)!), urgency: order.urgency, holds });
    const version = 1;
    holds.push({ orderId: order.id, version, kind: 'tentative', slot });
    const current = orders.get(order.id)!;
    orders.set(order.id, { ...current, proposal: { version, slot } });
    outputs.push(trace(order.id, 'hold_taken', { version, start: slot.start, end: slot.end }));
    const language: Language = current.language ?? 'en';
    send(outputs, order.id, 'tenant', language, version, slot, initialProposalToTenant({ language, title: order.title, slot, critical: order.urgency === 'Critical' }));
    send(outputs, order.id, 'handyman', 'es', version, slot, initialProposalToHandyman({ title: order.title, address: order.address, urgency: order.urgency, slot }));
  }
  return holds;
}

/** One outgoing message: traced as `msg_out`, then written as exactly one frame (OUT-2). */
function send(outputs: Output[], id: string, to: Role, language: Language, version: number, slot: Slot, body: string): void {
  const text = formatFrame(id, to, body);
  const written = text.slice(text.indexOf('\n') + 1).trimEnd();
  outputs.push(trace(id, 'msg_out', { to, language, version, start: slot.start, end: slot.end, body: written }));
  outputs.push({ kind: 'stdout', text });
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
  const message = classified(order.id, { classification: 'message', role: parsed.role, body: parsed.body });
  if (order.proposal === undefined || state.simNow === null) return message;
  const role = parsed.role as Role;
  const request: InterpretRequest = {
    woid: order.id,
    seq: fact.seq,
    role,
    body: parsed.body,
    language: role === 'handyman' ? 'es' : (order.language ?? 'en'),
    proposal: order.proposal,
    simNow: state.simNow,
  };
  return { state, outputs: [...message.outputs, { kind: 'interpret', request }] };
}

const OTHER: Record<Role, Role> = { tenant: 'handyman', handyman: 'tenant' };

function languageFor(order: OrderState, party: Role): Language {
  return party === 'handyman' ? 'es' : (order.language ?? 'en');
}

/**
 * An interpretation enters here and nowhere else (LLM-1): code decides what it means for the order. Acceptance follows
 * REQ-NG-2/3 and REQ-NG-6; both parties accepting the same live proposal schedules the visit (REQ-RES-1, ACC-1..3).
 */
function applyInterpretation(state: State, fact: Fact & { type: 'interpretation' }): StepResult {
  const order = state.orders.get(fact.woid);
  if (order === undefined || order.status === 'closed' || order.order === undefined || order.proposal === undefined) {
    return { state, outputs: [trace(fact.woid, 'ignored_fact', { type: fact.type, reason: order?.status === 'closed' ? 'closed_order' : 'no_open_proposal' })] };
  }
  const outputs: Output[] = [];
  const orders = new Map(state.orders);
  let holds = state.holds;
  const party = fact.role;
  const { result } = fact;
  const { proposal } = order;
  const { title, address } = order.order;
  const language = languageFor(order, party);
  const decision = (outcome: string, extra: Record<string, unknown> = {}): void => {
    outputs.push(trace(order.id, 'decision', { outcome, party, intent: result.intent, version: proposal.version, ...extra }));
  };
  const current: OrderState = { ...order, llmFailures: 0 };
  if (result.intent !== 'unclear' && result.intent !== 'contradictory') {
    current.unclearStreak = { ...current.unclearStreak, [party]: { count: 0, contradictory: false } };
  }

  if (result.intent === 'accept') {
    const verdict = evaluateAcceptance(result, proposal.slot);
    if (verdict === 'needs_confirmation') {
      current.awaitingConfirmation = { ...current.awaitingConfirmation, [party]: true };
      decision('needs_confirmation', { exclusions: result.exclusions });
      send(outputs, order.id, party, language, proposal.version, proposal.slot, confirmationRequest({ language, to: party, title, slot: proposal.slot }));
    } else if (verdict === 'mismatch') {
      decision('mismatch', { times: result.times });
    } else {
      const { [party]: _asked, ...stillAwaiting } = current.awaitingConfirmation;
      current.awaitingConfirmation = stillAwaiting;
      if (current.accepted[party] === proposal.version) {
        decision('already_accepted');
      } else {
        current.accepted = { ...current.accepted, [party]: proposal.version };
        const hold = holds.find((candidate) => candidate.orderId === order.id && candidate.version === proposal.version && candidate.kind === 'tentative');
        if (current.accepted[OTHER[party]] === proposal.version && hold !== undefined) {
          decision('scheduled');
          const tenantLanguage = languageFor(order, 'tenant');
          send(outputs, order.id, 'tenant', tenantLanguage, proposal.version, proposal.slot, confirmationToTenant({ language: tenantLanguage, title, slot: proposal.slot }));
          send(outputs, order.id, 'handyman', 'es', proposal.version, proposal.slot, confirmationToHandyman({ title, address, slot: proposal.slot }));
          holds = holds.map((candidate) => (candidate === hold ? { ...candidate, kind: 'scheduled' as const } : candidate));
          orders.set(order.id, current);
          close(orders, outputs, order.id, { kind: 'scheduled', scheduledFor: proposal.slot.start });
          return { state: { ...state, orders, holds }, outputs };
        }
        decision('accepted');
        send(outputs, order.id, party, language, proposal.version, proposal.slot, acknowledgement({ language, to: party }));
      }
    }
    orders.set(order.id, current);
    return { state: { ...state, orders, holds }, outputs };
  }

  if (result.intent === 'unclear' || result.intent === 'contradictory') {
    return unclearReply({ state, orders, holds, outputs, current, party, language, decision, send }, result.intent);
  }

  // decline, counter, question, withdraw, cross_reference: recorded now, acted on by the negotiation feature (AC-4.1).
  decision('deferred');
  orders.set(order.id, current);
  return { state: { ...state, orders, holds }, outputs };
}

interface ReplyContext {
  state: State;
  orders: Map<string, OrderState>;
  holds: Hold[];
  outputs: Output[];
  current: OrderState;
  party: Role;
  language: Language;
  decision: (outcome: string, extra?: Record<string, unknown>) => void;
  send: typeof send;
}

/** One clarification for the first unclear or contradictory reply of a party; the second in a row goes to review (REQ-NG-8). */
function unclearReply(ctx: ReplyContext, intent: 'unclear' | 'contradictory'): StepResult {
  const { current, party } = ctx;
  const streak = current.unclearStreak[party];
  const next = { count: streak.count + 1, contradictory: streak.contradictory || intent === 'contradictory' };
  current.unclearStreak = { ...current.unclearStreak, [party]: next };
  if (next.count >= 2) {
    const code = next.contradictory ? 'contradictory_replies' : 'interpretation_failed';
    ctx.decision('review', { reason: code });
    return review(ctx, code, REVIEW_SENTENCES[code](party));
  }
  ctx.decision('clarify');
  const { proposal, order } = current;
  if (proposal !== undefined && order !== undefined) {
    ctx.send(ctx.outputs, current.id, party, ctx.language, proposal.version, proposal.slot, clarification({ language: ctx.language, to: party, title: order.title, slot: proposal.slot }));
  }
  ctx.orders.set(current.id, current);
  return { state: { ...ctx.state, orders: ctx.orders, holds: ctx.holds }, outputs: ctx.outputs };
}

/** Closes an open order for review: its tentative holds are released first, then the result is written once (ORD-1). */
function review(ctx: ReplyContext, code: 'contradictory_replies' | 'interpretation_failed' | 'llm_unavailable', sentence: string): StepResult {
  const { current } = ctx;
  for (const hold of ctx.holds.filter((candidate) => candidate.orderId === current.id && candidate.kind === 'tentative')) {
    ctx.outputs.push(trace(current.id, 'hold_released', { version: hold.version, reason: 'closed' }));
  }
  const holds = ctx.holds.filter((candidate) => !(candidate.orderId === current.id && candidate.kind === 'tentative'));
  ctx.orders.set(current.id, current);
  close(ctx.orders, ctx.outputs, current.id, { kind: 'requires_review', code, sentence });
  return { state: { ...ctx.state, orders: ctx.orders, holds }, outputs: ctx.outputs };
}

/** A model failure counts as an unclear reply (REQ-RB-1); two in a row for the order close it as `llm_unavailable`. */
function applyLlmError(state: State, fact: Fact & { type: 'llm_error' }): StepResult {
  const order = state.orders.get(fact.woid);
  if (order === undefined || order.status === 'closed' || order.order === undefined || order.proposal === undefined) {
    return { state, outputs: [trace(fact.woid, 'ignored_fact', { type: fact.type, reason: order?.status === 'closed' ? 'closed_order' : 'no_open_proposal' })] };
  }
  const outputs: Output[] = [];
  const orders = new Map(state.orders);
  const party = fact.role;
  const current: OrderState = { ...order, llmFailures: order.llmFailures + 1 };
  const decision = (outcome: string, extra: Record<string, unknown> = {}): void => {
    outputs.push(trace(order.id, 'decision', { outcome, party, intent: null, version: order.proposal?.version ?? null, ...extra }));
  };
  decision('llm_error', { failures: current.llmFailures, message: fact.message });
  const ctx: ReplyContext = { state, orders, holds: state.holds, outputs, current, party, language: languageFor(order, party), decision, send };
  if (current.llmFailures >= 2) {
    decision('review', { reason: 'llm_unavailable' });
    return review(ctx, 'llm_unavailable', REVIEW_SENTENCES.llm_unavailable(party));
  }
  return unclearReply(ctx, 'unclear');
}

/** End of input: every order still open closes as `no_response`, in CSV order (REQ-TO-4). A repeated eof changes nothing. */
function endInput(state: State): StepResult {
  if (state.ended) return { state, outputs: [trace(null, 'ignored_fact', { type: 'eof', reason: 'already_ended' })] };
  const outputs: Output[] = [];
  const orders = new Map(state.orders);
  let holds = state.holds;
  for (const order of orders.values()) {
    if (order.status === 'closed') continue;
    for (const hold of holds.filter((candidate) => candidate.orderId === order.id)) {
      outputs.push(trace(order.id, 'hold_released', { version: hold.version, reason: 'closed' }));
    }
    holds = holds.filter((hold) => hold.orderId !== order.id);
    close(orders, outputs, order.id, { kind: 'requires_review', code: 'no_response', sentence: NO_RESPONSE_SENTENCE });
  }
  return { state: { ...state, ended: true, orders, holds }, outputs };
}

export function step(state: State, fact: Fact): StepResult {
  switch (fact.type) {
    case 'run_started':
      return { state: { ...state, simNow: fact.sim_now }, outputs: [] };
    case 'csv_loaded':
      return loadCsv(state, fact);
    case 'msg_in':
      return receiveLine(state, fact);
    case 'interpretation':
      return applyInterpretation(state, fact);
    case 'llm_error':
      return applyLlmError(state, fact);
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
