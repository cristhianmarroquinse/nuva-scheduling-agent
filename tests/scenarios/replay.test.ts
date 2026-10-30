import { describe, expect, it } from 'vitest';
import { factFromTrace, type Fact } from '../../src/core/facts.js';
import { fold } from '../../src/core/state.js';
import { scenarioRun } from './runner.js';

// AC-7.3: folding the recorded facts alone (no CSV, no stdin, no model) reproduces the run.

async function replay(name: string): Promise<void> {
  const { output } = await scenarioRun(name);
  const facts = output.trace.map(factFromTrace).filter((fact): fact is Fact => fact !== null);
  expect(facts.map((fact) => fact.type)).toEqual(expect.arrayContaining(['run_started', 'csv_loaded', 'eof']));

  const replayed = fold(facts);
  const stdout = replayed.outputs.map((output) => (output.kind === 'stdout' ? output.text : '')).join('');
  expect(stdout).toBe(output.stdout);

  const tracedResults = output.trace.filter((line) => line.event_type === 'result').map((line) => [line.work_order_id, line.detail]);
  const replayedResults = [...replayed.state.orders.values()].filter((order) => order.result).map((order) => [order.id, order.result]);
  expect(replayedResults).toEqual(tracedResults);

  const tracedProjections = output.trace.filter((line) => factFromTrace(line) === null && !['run_finished', 'agent_now_invalid', 'stderr'].includes(line.event_type));
  const replayedProjections = replayed.outputs.filter((output) => output.kind === 'trace');
  expect(replayedProjections.map((output) => output.kind === 'trace' && [output.work_order_id, output.event_type, output.detail])).toEqual(
    tracedProjections.map((line) => [line.work_order_id, line.event_type, line.detail]),
  );
}

describe('replay (AC-7.3, TRACE-2)', () => {
  it('001-invalid-rows: replaying the facts reproduces the states, results and projections (TRACE-2)', () => replay('001-invalid-rows'), 20_000);
  it('001-bad-lines: replaying the facts reproduces the states, results and projections (TRACE-2)', () => replay('001-bad-lines'), 20_000);
});
