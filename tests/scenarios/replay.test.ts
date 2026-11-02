import { describe, expect, it } from 'vitest';
import { factFromTrace, type Fact } from '../../src/core/facts.js';
import { fold } from '../../src/core/state.js';
import { scenarioRun } from './runner.js';

// AC-7.3: folding the recorded facts alone (no CSV, no stdin, no model) reproduces the run.

async function replay(name: string): Promise<void> {
  const { output } = await scenarioRun(name);
  const facts = output.trace.map(factFromTrace).filter((fact): fact is Fact => fact !== null);
  // A run that schedules every order exits before end of input, so `eof` is not always recorded.
  expect(facts.map((fact) => fact.type)).toEqual(expect.arrayContaining(['run_started', 'csv_loaded']));

  const replayed = fold(facts);
  const stdout = replayed.outputs.map((output) => (output.kind === 'stdout' ? output.text : '')).join('');
  expect(stdout).toBe(output.stdout);

  const tracedResults = output.trace.filter((line) => line.event_type === 'result').map((line) => [line.work_order_id, line.detail]);
  const replayedResults = [...replayed.state.orders.values()].filter((order) => order.result).map((order) => [order.id, order.result]);
  expect(replayedResults).toEqual(tracedResults);

  const tracedProjections = output.trace.filter((line) => factFromTrace(line) === null && !['run_finished', 'agent_now_invalid', 'stderr', 'model_call'].includes(line.event_type));
  const replayedProjections = replayed.outputs.filter((output) => output.kind === 'trace');
  expect(replayedProjections.map((output) => output.kind === 'trace' && [output.work_order_id, output.event_type, output.detail])).toEqual(
    tracedProjections.map((line) => [line.work_order_id, line.event_type, line.detail]),
  );
}

describe('replay (AC-7.3, TRACE-2)', () => {
  it('001-invalid-rows: replaying the facts reproduces the states, results and projections (TRACE-2)', () => replay('001-invalid-rows'), 20_000);
  it('001-bad-lines: replaying the facts reproduces the states, results and projections (TRACE-2)', () => replay('001-bad-lines'), 20_000);
  it('002-urgency-order: replaying the facts reproduces the holds, frames and results without the calendar being re-fed (TRACE-2)', () => replay('002-urgency-order'), 20_000);
  it('003-both-accept: replaying the interpretation facts reproduces the acknowledgement, confirmations and the scheduled result without calling the model (TRACE-2)', () => replay('003-both-accept'), 20_000);
  it('003-model-invalid-output: replaying reproduces the clarification and the acknowledgement from the recorded facts alone (TRACE-2)', () => replay('003-model-invalid-output'), 20_000);
  it('004-counter-range: replaying reproduces the re-proposal, the moved hold and the scheduled result (TRACE-2)', () => replay('004-counter-range'), 20_000);
  it('004-question-answered: replaying the answer fact reproduces the model-written frame without calling the model (TRACE-2)', () => replay('004-question-answered'), 20_000);
  it('005-preempt-counter: replaying reproduces the takeover, both re-proposals and the holds (TRACE-2)', () => replay('005-preempt-counter'), 20_000);
  it('005-blackout-day: replaying reproduces the blackout, the moved holds and the frames (TRACE-2)', () => replay('005-blackout-day'), 20_000);
});
