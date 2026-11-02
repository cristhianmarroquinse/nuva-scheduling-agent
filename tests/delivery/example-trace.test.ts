import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { factFromTrace, type Fact } from '../../src/core/facts.js';
import { fold } from '../../src/core/state.js';

// The committed example run (REQ-DL-3): a real run whose trace has the required fields (TRACE-1) and whose facts replay
// to the committed stdout without calling the model (TRACE-2).

const DIR = 'traces/examples';
interface Line {
  timestamp: string;
  work_order_id: string | null;
  event_type: string;
  detail: unknown;
}

function lines(): Line[] {
  expect(existsSync(`${DIR}/run.jsonl`), 'run `pnpm example` with the key to produce the example').toBe(true);
  return readFileSync(`${DIR}/run.jsonl`, 'utf8')
    .split('\n')
    .filter((line) => line !== '')
    .map((line) => JSON.parse(line) as Line);
}

describe('the committed example run (AC-3.1, AC-3.3, TRACE-1, TRACE-2)', () => {
  it('has the four fields on every trace line (TRACE-1)', () => {
    for (const line of lines()) {
      expect(Object.keys(line).sort()).toEqual(['detail', 'event_type', 'timestamp', 'work_order_id']);
      expect(typeof line.timestamp).toBe('string');
      expect(line.work_order_id === null || typeof line.work_order_id === 'string').toBe(true);
    }
  });

  it('replays its facts to the committed stdout without the model (TRACE-2)', () => {
    const facts = lines().map(factFromTrace).filter((fact): fact is Fact => fact !== null);
    expect(facts.map((fact) => fact.type)).toEqual(expect.arrayContaining(['run_started', 'csv_loaded', 'msg_in', 'interpretation', 'answer']));
    const replayed = fold(facts);
    const stdout = replayed.outputs.map((output) => (output.kind === 'stdout' ? output.text : '')).join('');
    expect(stdout).toBe(readFileSync(`${DIR}/stdout.txt`, 'utf8'));
  });

  it('covers an acceptance, a scheduled result, a counter re-proposal, an answered question, a reminder and a Critical order (AC-3.1)', () => {
    const all = lines();
    const outcomes = all.filter((line) => line.event_type === 'decision').map((line) => line.detail as { outcome: string; cause?: string });
    expect(outcomes.some((d) => d.outcome === 'accepted')).toBe(true);
    expect(outcomes.some((d) => d.outcome === 'scheduled')).toBe(true);
    expect(outcomes.some((d) => d.outcome === 'repropose' && d.cause === 'counter')).toBe(true);
    expect(outcomes.some((d) => d.outcome === 'answered')).toBe(true);
    expect(outcomes.some((d) => d.outcome === 'remind')).toBe(true);
    expect(all.some((line) => line.event_type === 'order_loaded' && (line.detail as { urgency: string }).urgency === 'Critical')).toBe(true);
    expect(all.filter((line) => line.event_type === 'result').map((line) => (line.detail as { kind: string }).kind)).toContain('scheduled');
    expect(all.some((line) => line.event_type === 'model_call')).toBe(true);
    const sent = readFileSync(`${DIR}/stdin.txt`, 'utf8').split('\n').filter((line) => line !== '').length;
    expect(all.filter((line) => line.event_type === 'msg_in')).toHaveLength(sent);
  });
});
