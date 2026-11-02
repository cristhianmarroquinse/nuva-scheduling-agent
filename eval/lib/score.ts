// Scoring an interpreter tier against the golden set (ADR 0004). Pure.

import type { ModelCall } from '../../src/interpreter/interpreter.js';
import type { Interpretation } from '../../src/interpreter/schema.js';
import type { GoldenEntry } from './golden.js';

export type ResolvedBy = 'regex' | 'model' | 'unresolved';

export interface Outcome {
  id: string;
  resolvedBy: ResolvedBy;
  obtained: Interpretation | null;
  intentMatch: boolean;
  fullMatch: boolean;
  /** Sum over the entry's model calls; absent when no call was made. */
  latencyMs?: number;
  tokens?: { input: number; output: number };
  calls: number;
}

export interface Metrics {
  n: number;
  intentAccuracy: number;
  fullAccuracy: number;
  fastPathShare: number;
  modelShare: number;
  unresolvedShare: number;
  /** Over entries that called the model; null when none did. */
  p50LatencyMs: number | null;
  p95LatencyMs: number | null;
  inputTokens: number;
  outputTokens: number;
  /** An estimate from `PRICES`; 0 without a model. */
  costUsd: number;
}

/** USD per million tokens, first-party list price as of 2026-11-02. The report says the cost is an estimate. */
export const PRICES: Record<string, { input: number; output: number }> = {
  'claude-haiku-5-5': { input: 0.1, output: 0.5 },
  'claude-sonnet-5-5': { input: 2, output: 10 },
};

const canonical = (value: unknown): string => JSON.stringify(value, Object.keys(value as object).sort());

function normalise(interpretation: Omit<Interpretation, 'quote'>): string {
  const times = [...interpretation.times].map(canonical).sort();
  const exclusions = [...interpretation.exclusions].map(canonical).sort();
  return JSON.stringify({ intent: interpretation.intent, times, exclusions, scope: interpretation.scope ?? 'this_order' });
}

export function scoreEntry(entry: GoldenEntry, obtained: Interpretation | null, resolvedBy: ResolvedBy, calls: readonly ModelCall[]): Outcome {
  const intentMatch = obtained !== null && obtained.intent === entry.expected.intent;
  const fullMatch = obtained !== null && normalise(obtained) === normalise(entry.expected);
  const outcome: Outcome = { id: entry.id, resolvedBy, obtained, intentMatch, fullMatch, calls: calls.length };
  if (calls.length > 0) {
    outcome.latencyMs = calls.reduce((sum, call) => sum + call.latency_ms, 0);
    outcome.tokens = { input: calls.reduce((sum, call) => sum + call.tokens.input, 0), output: calls.reduce((sum, call) => sum + call.tokens.output, 0) };
  }
  return outcome;
}

/** Nearest-rank percentile over a sorted sample. */
function percentile(sorted: readonly number[], p: number): number | null {
  if (sorted.length === 0) return null;
  const rank = Math.max(1, Math.ceil((p / 100) * sorted.length));
  return sorted[rank - 1] ?? null;
}

export function summarise(outcomes: readonly Outcome[], model: string | null): Metrics {
  const n = outcomes.length;
  const share = (predicate: (outcome: Outcome) => boolean): number => (n === 0 ? 0 : outcomes.filter(predicate).length / n);
  const latencies = outcomes.flatMap((outcome) => (outcome.latencyMs === undefined ? [] : [outcome.latencyMs])).sort((a, b) => a - b);
  const inputTokens = outcomes.reduce((sum, outcome) => sum + (outcome.tokens?.input ?? 0), 0);
  const outputTokens = outcomes.reduce((sum, outcome) => sum + (outcome.tokens?.output ?? 0), 0);
  const price = model === null ? undefined : PRICES[model];
  return {
    n,
    intentAccuracy: share((outcome) => outcome.intentMatch),
    fullAccuracy: share((outcome) => outcome.fullMatch),
    fastPathShare: share((outcome) => outcome.resolvedBy === 'regex'),
    modelShare: share((outcome) => outcome.resolvedBy === 'model'),
    unresolvedShare: share((outcome) => outcome.resolvedBy === 'unresolved'),
    p50LatencyMs: percentile(latencies, 50),
    p95LatencyMs: percentile(latencies, 95),
    inputTokens,
    outputTokens,
    costUsd: price === undefined ? 0 : (inputTokens * price.input + outputTokens * price.output) / 1_000_000,
  };
}
