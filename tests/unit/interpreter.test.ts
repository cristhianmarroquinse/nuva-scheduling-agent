import { describe, expect, it } from 'vitest';
import { interpretReply } from '../../src/interpreter/interpreter.js';
import type { Interpreter, InterpretRequest, ModelOutput, Prompt } from '../../src/interpreter/types.js';

// The cascade (ADR 0004): fast path, else the model once, re-asked once on invalid output, else unclear (AC-1.4, AC-1.5, AC-1.7).

const request: InterpretRequest = {
  woid: 'WO-1',
  seq: 1,
  role: 'tenant',
  body: 'Yes, Wednesday afternoon works for me',
  language: 'en',
  proposal: { version: 1, slot: { start: '2026-11-04T14:00:00+01:00', end: '2026-11-04T16:00:00+01:00' } },
  simNow: '2026-11-04T10:00:00+01:00',
};

/** An interpreter that returns the scripted outputs in order, or throws the scripted error; records the prompts it saw. */
function scripted(outputs: (unknown | Error)[], model = 'scripted'): Interpreter & { prompts: Prompt[] } {
  const prompts: Prompt[] = [];
  return {
    prompts,
    interpret: (_request: InterpretRequest, prompt: Prompt): Promise<ModelOutput> => {
      prompts.push(prompt);
      const next = outputs.shift();
      if (next instanceof Error) return Promise.reject(next);
      return Promise.resolve({ raw: next, model, latencyMs: 5, tokens: { input: 10, output: 4 } });
    },
  };
}

const valid = { intent: 'accept', times: [{ date: '2026-11-04', start: '14:00', end: '18:00' }], exclusions: [], quote: 'Wednesday afternoon works' };
const invalid = { intent: 'accept', times: [{ date: '2026-11-04', start: '14:00Z' }], quote: 'x' };

describe('interpretReply (AC-1.4, AC-1.5, AC-1.7)', () => {
  it('answers a trivial reply from the fast path without calling the model', async () => {
    const interpreter = scripted([valid]);
    const outcome = await interpretReply({ ...request, body: 'Sí' }, interpreter);
    expect(interpreter.prompts).toEqual([]);
    expect(outcome).toEqual({
      kind: 'interpretation',
      fact: { type: 'interpretation', seq: 1, woid: 'WO-1', role: 'tenant', source: 'regex', prompt_version: '1', result: { intent: 'accept', times: [], exclusions: [], quote: 'Sí' } },
      calls: [],
    });
  });

  it('records a valid model output as an interpretation from the model, with the call traced', async () => {
    const outcome = await interpretReply(request, scripted([valid]));
    expect(outcome.kind).toBe('interpretation');
    if (outcome.kind !== 'interpretation') return;
    expect(outcome.fact).toMatchObject({ type: 'interpretation', source: 'model', prompt_version: '1', result: valid });
    expect(outcome.calls).toEqual([{ attempt: 1, model: 'scripted', prompt_version: '1', latency_ms: 5, tokens: { input: 10, output: 4 }, outcome: 'ok' }]);
  });

  it('re-asks once on invalid output, telling the model what failed, and accepts a valid second answer', async () => {
    const interpreter = scripted([invalid, valid]);
    const outcome = await interpretReply(request, interpreter);
    expect(interpreter.prompts).toHaveLength(2);
    expect(interpreter.prompts[0]!.system).toBe(interpreter.prompts[1]!.system);
    expect(interpreter.prompts[1]!.user).toContain('invalid');
    expect(interpreter.prompts[1]!.user).toContain('start');
    expect(outcome.kind).toBe('interpretation');
    if (outcome.kind !== 'interpretation') return;
    expect(outcome.fact.result).toEqual(valid);
    expect(outcome.calls.map((call) => [call.attempt, call.outcome])).toEqual([
      [1, 'invalid'],
      [2, 'ok'],
    ]);
    expect(outcome.calls[0]!.problem).toContain('start');
  });

  it('records unclear after two invalid outputs, keeping the problems in the call traces', async () => {
    const outcome = await interpretReply(request, scripted([invalid, { nonsense: true }]));
    expect(outcome.kind).toBe('interpretation');
    if (outcome.kind !== 'interpretation') return;
    expect(outcome.fact.result).toEqual({ intent: 'unclear', times: [], exclusions: [], quote: request.body });
    expect(outcome.fact.source).toBe('model');
    expect(outcome.calls.map((call) => call.outcome)).toEqual(['invalid', 'invalid']);
    expect(outcome.calls[1]!.problem).toContain('intent');
  });

  it('reports a model failure as an error outcome, never as an interpretation (AC-1.7)', async () => {
    const outcome = await interpretReply(request, scripted([new Error('boom')]));
    expect(outcome).toEqual({ kind: 'error', message: 'boom', calls: [] });
    const late = await interpretReply(request, scripted([invalid, new Error('boom again')]));
    expect(late.kind).toBe('error');
    if (late.kind === 'error') expect(late.calls.map((call) => call.outcome)).toEqual(['invalid']);
  });

  it('marks output of the fake interpreter as source fake', async () => {
    const outcome = await interpretReply(request, scripted([valid], 'fake'));
    expect(outcome.kind === 'interpretation' && outcome.fact.source).toBe('fake');
  });

  it('strips foreign fields before the fact is built (AC-1.9, LLM-1)', async () => {
    const outcome = await interpretReply(request, scripted([{ ...valid, result: 'scheduled', hold: 'release' }]));
    expect(outcome.kind === 'interpretation' && outcome.fact.result).toEqual(valid);
  });
});
