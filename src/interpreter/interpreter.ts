// The interpretation cascade (ADR 0004): regex fast path, else the model, re-asked once on invalid output, else unclear.
// The result is a fact for the fold (LLM-1); the model calls are traced separately.

import type { Fact } from '../core/facts.js';
import { buildAnswerPrompt, validateAnswer, type AnswerRequest } from './answer.js';
import { FAKE_MODEL } from './fake.js';
import { fastPath } from './fast-path.js';
import { buildPrompt } from './prompt.js';
import { PROMPT_VERSION, validateInterpretation, type Interpretation } from './schema.js';
import type { Interpreter, InterpretRequest, Prompt } from './types.js';

export type InterpretationFact = Fact & { type: 'interpretation' };

/** One model call, for the `model_call` trace (REQ-TR-2). */
export interface ModelCall {
  attempt: number;
  model: string;
  prompt_version: string;
  latency_ms: number;
  tokens: { input: number; output: number };
  outcome: 'ok' | 'invalid';
  problem?: string;
}

export type InterpretOutcome = { kind: 'interpretation'; fact: InterpretationFact; calls: ModelCall[] } | { kind: 'error'; message: string; calls: ModelCall[] };

const MAX_ATTEMPTS = 2;

function fact(request: InterpretRequest, source: InterpretationFact['source'], result: Interpretation): InterpretationFact {
  return { type: 'interpretation', seq: request.seq, woid: request.woid, role: request.role, source, prompt_version: PROMPT_VERSION, result };
}

function retryPrompt(prompt: Prompt, problem: string): Prompt {
  return { ...prompt, user: `${prompt.user}\n\nYour previous answer was invalid (${problem}). Answer again following the schema exactly.` };
}

export async function interpretReply(request: InterpretRequest, interpreter: Interpreter): Promise<InterpretOutcome> {
  const trivial = fastPath(request.body);
  if (trivial !== null) return { kind: 'interpretation', fact: fact(request, 'regex', trivial), calls: [] };

  const calls: ModelCall[] = [];
  let prompt = buildPrompt(request);
  let source: InterpretationFact['source'] = 'model';
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    let output;
    try {
      output = await interpreter.interpret(request, prompt);
    } catch (error) {
      return { kind: 'error', message: error instanceof Error ? error.message : String(error), calls };
    }
    if (output.model === FAKE_MODEL) source = 'fake';
    const validation = validateInterpretation(output.raw);
    const call: ModelCall = { attempt, model: output.model, prompt_version: prompt.version, latency_ms: output.latencyMs, tokens: output.tokens, outcome: validation.ok ? 'ok' : 'invalid' };
    if (validation.ok) {
      calls.push(call);
      return { kind: 'interpretation', fact: fact(request, source, validation.value), calls };
    }
    calls.push({ ...call, problem: validation.problem });
    prompt = retryPrompt(prompt, validation.problem);
  }
  const unclear: Interpretation = { intent: 'unclear', times: [], exclusions: [], quote: request.body.slice(0, 200) };
  return { kind: 'interpretation', fact: fact(request, source, unclear), calls };
}

export type AnswerFact = Fact & { type: 'answer' };

export interface AnswerCall extends ModelCall {
  purpose: 'answer';
}

/**
 * One model call to answer a question (REQ-NG-7); the text is validated before it becomes a fact (LLM-2). A wrong or
 * missing answer is not re-asked: the fold sends the fixed office sentence instead.
 */
export async function answerQuestion(request: AnswerRequest, interpreter: Interpreter): Promise<{ fact: AnswerFact; calls: AnswerCall[] }> {
  const prompt = buildAnswerPrompt(request);
  const base = { type: 'answer' as const, seq: request.seq, woid: request.woid, role: request.role, prompt_version: prompt.version };
  let output;
  try {
    output = await interpreter.answer(request, prompt);
  } catch (error) {
    return { fact: { ...base, outcome: 'error', text: null, problem: error instanceof Error ? error.message : String(error) }, calls: [] };
  }
  const validation = validateAnswer(output.raw, request);
  const call: AnswerCall = {
    purpose: 'answer',
    attempt: 1,
    model: output.model,
    prompt_version: prompt.version,
    latency_ms: output.latencyMs,
    tokens: output.tokens,
    outcome: validation.ok ? 'ok' : 'invalid',
  };
  if (validation.ok) return { fact: { ...base, outcome: 'ok', text: validation.text }, calls: [call] };
  return { fact: { ...base, outcome: 'invalid', text: null, problem: validation.problem }, calls: [{ ...call, problem: validation.problem }] };
}
