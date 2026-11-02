// The runner: wires facts, the pure core, the tracer and the output writer. Returns the exit code.

import { readFileSync } from 'node:fs';
import type { Fact } from '../core/facts.js';
import { allTerminal, initialState, step, type Output, type State } from '../core/state.js';
import { answerQuestion, interpretReply } from '../interpreter/interpreter.js';
import type { Interpreter } from '../interpreter/types.js';
import { parseCsv } from '../orders/csv.js';
import { readRows, validateRows } from '../orders/validate.js';
import { resolveReferenceTime } from '../time/reference.js';
import { fromDate, parseLocalOrOffset, toIso } from '../time/time.js';
import type { Tracer } from '../trace/tracer.js';

export interface RunOptions {
  csvPath: string;
  /** Raw `AGENT_NOW`, if set. */
  agentNow: string | undefined;
  /** Injected clock (TIME-1). */
  clockNow: () => Date;
  lines: AsyncIterable<string>;
  write: (text: string) => void;
  tracer: Tracer;
  /** Injected (ADR 0004): the real adapter in production, the fake in tests. */
  interpreter: Interpreter;
}

function describeError(error: unknown): { message: string; stack?: string } {
  if (error instanceof Error) {
    return error.stack === undefined ? { message: error.message } : { message: error.message, stack: error.stack };
  }
  return { message: String(error) };
}

export async function run(options: RunOptions): Promise<number> {
  const { tracer, write } = options;
  let state: State = initialState();

  const emit = (output: Output): void => {
    if (output.kind === 'stdout') write(output.text);
    else if (output.kind === 'trace') tracer.trace({ work_order_id: output.work_order_id, event_type: output.event_type, detail: output.detail });
    // `interpret` requests are effects handled by the line loop, not projections.
  };

  /** Traces the fact, folds it, emits what the fold derived and returns it. An exception never ends the run (RUN-1). */
  const record = (fact: Fact, work_order_id: string | null = null): Output[] => {
    const { type, ...detail } = fact;
    tracer.trace({ work_order_id, event_type: type, detail });
    try {
      const next = step(state, fact);
      state = next.state;
      for (const output of next.outputs) emit(output);
      return next.outputs;
    } catch (error) {
      tracer.trace({ work_order_id, event_type: 'run_error', detail: { during: type, ...describeError(error) } });
      return [];
    }
  };

  /** Answers an `interpret` request through the injected interpreter and records the outcome as a fact (LLM-1). */
  const interpret = async (output: Output & { kind: 'interpret' }): Promise<void> => {
    const { request } = output;
    const outcome = await interpretReply(request, options.interpreter);
    for (const call of outcome.calls) tracer.trace({ work_order_id: request.woid, event_type: 'model_call', detail: { seq: request.seq, ...call } });
    const outputs =
      outcome.kind === 'interpretation'
        ? record(outcome.fact, request.woid)
        : record({ type: 'llm_error', seq: request.seq, woid: request.woid, role: request.role, message: outcome.message }, request.woid);
    for (const output of outputs) {
      if (output.kind === 'answer') await answer(output);
    }
  };

  /** Answers a question through the model and records the validated (or rejected) answer as a fact (REQ-NG-7, LLM-2). */
  const answer = async (output: Output & { kind: 'answer' }): Promise<void> => {
    const { request } = output;
    const outcome = await answerQuestion(request, options.interpreter);
    for (const call of outcome.calls) tracer.trace({ work_order_id: request.woid, event_type: 'model_call', detail: { seq: request.seq, ...call } });
    record(outcome.fact, request.woid);
  };

  let text: string;
  try {
    text = readFileSync(options.csvPath, 'utf8');
  } catch (error) {
    tracer.trace({ work_order_id: null, event_type: 'run_error', detail: { during: 'read_csv', path: options.csvPath, ...describeError(error) } });
    return 1;
  }
  const table = readRows(parseCsv(text));
  if (!table.ok) {
    tracer.trace({ work_order_id: null, event_type: 'run_error', detail: { during: 'read_csv', path: options.csvPath, problem: table.error, header: table.header } });
    return 1;
  }

  const clockNow = options.clockNow();
  const reportedAts = validateRows(table.rows).orders.map((order) => parseLocalOrOffset(order.reportedAt)!);
  const reference = resolveReferenceTime({ clockNow, agentNow: options.agentNow, reportedAts });
  if (reference.agentNowInvalid !== undefined) {
    tracer.trace({ work_order_id: null, event_type: 'agent_now_invalid', detail: { agent_now: reference.agentNowInvalid } });
  }
  record({
    type: 'run_started',
    sim_now: toIso(reference.simNow),
    source: reference.source,
    clock_now: toIso(fromDate(clockNow)),
    agent_now: options.agentNow ?? null,
  });
  record({ type: 'csv_loaded', rows: table.rows });
  if (allTerminal(state)) return 0;

  let seq = 0;
  for await (const raw of options.lines) {
    seq += 1;
    const outputs = record({ type: 'msg_in', seq, raw });
    for (const output of outputs) {
      if (output.kind === 'interpret') await interpret(output);
    }
    if (allTerminal(state)) return 0;
  }
  record({ type: 'eof' });
  return 0;
}
