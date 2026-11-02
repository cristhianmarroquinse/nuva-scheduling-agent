import { describe, expect, it } from 'vitest';
import type { GoldenEntry } from '../../eval/lib/golden.js';
import { PRICES, scoreEntry, summarise, type Outcome } from '../../eval/lib/score.js';
import type { Interpretation } from '../../src/interpreter/schema.js';

// Scoring an interpreter tier (AC-2.3, AC-2.4): intent match, full match after normalisation, shares, latency, tokens, cost.

const base: GoldenEntry = {
  id: 'g1', language: 'en', role: 'tenant', body: 'Thursday afternoon', tags: [],
  proposal: { version: 1, slot: { start: '2026-11-04T12:00:00+01:00', end: '2026-11-04T14:00:00+01:00' } },
  simNow: '2026-11-04T10:00:00+01:00',
  expected: { intent: 'counter', times: [{ date: '2026-11-05', start: '15:00', end: '20:00' }], exclusions: [{ weekday: 'friday' }] },
};
const obtained = (partial: Partial<Interpretation>): Interpretation => ({ intent: 'counter', times: [], exclusions: [], quote: 'x', ...partial });

describe('scoreEntry (AC-2.3)', () => {
  it('matches the intent and, after normalisation, the times, exclusions and scope', () => {
    const exact = scoreEntry(base, obtained({ times: [{ date: '2026-11-05', start: '15:00', end: '20:00' }], exclusions: [{ weekday: 'friday' }] }), 'model', []);
    expect(exact).toMatchObject({ id: 'g1', intentMatch: true, fullMatch: true, resolvedBy: 'model' });
    const reordered = scoreEntry({ ...base, expected: { ...base.expected, times: [{ date: '2026-11-06' }, { date: '2026-11-05' }] } }, obtained({ times: [{ date: '2026-11-05' }, { date: '2026-11-06' }], exclusions: [{ weekday: 'friday' }] }), 'model', []);
    expect(reordered.fullMatch).toBe(true);
    const scopeDefault = scoreEntry({ ...base, expected: { intent: 'counter', times: [], exclusions: [] } }, obtained({ scope: 'this_order' }), 'model', []);
    expect(scopeDefault.fullMatch).toBe(true);
  });

  it('counts intent only when times differ, and nothing when the intent differs or nothing was obtained', () => {
    expect(scoreEntry(base, obtained({ times: [{ date: '2026-11-05' }], exclusions: [{ weekday: 'friday' }] }), 'model', [])).toMatchObject({ intentMatch: true, fullMatch: false });
    expect(scoreEntry(base, obtained({ intent: 'decline' }), 'model', [])).toMatchObject({ intentMatch: false, fullMatch: false });
    expect(scoreEntry(base, null, 'unresolved', [])).toMatchObject({ intentMatch: false, fullMatch: false, resolvedBy: 'unresolved', obtained: null });
  });

  it('sums latency and tokens over the calls of the entry', () => {
    const calls = [
      { attempt: 1, model: 'm', prompt_version: '3', latency_ms: 120, tokens: { input: 300, output: 40 }, outcome: 'invalid' as const },
      { attempt: 2, model: 'm', prompt_version: '3', latency_ms: 80, tokens: { input: 320, output: 30 }, outcome: 'ok' as const },
    ];
    expect(scoreEntry(base, obtained({}), 'model', calls)).toMatchObject({ latencyMs: 200, tokens: { input: 620, output: 70 }, calls: 2 });
  });
});

describe('summarise (AC-2.4)', () => {
  const outcome = (partial: Partial<Outcome>): Outcome => ({ id: 'x', resolvedBy: 'model', obtained: null, intentMatch: false, fullMatch: false, calls: 0, ...partial });
  const outcomes: Outcome[] = [
    outcome({ id: 'a', resolvedBy: 'regex', intentMatch: true, fullMatch: true }),
    outcome({ id: 'b', resolvedBy: 'regex', intentMatch: true, fullMatch: true }),
    outcome({ id: 'c', resolvedBy: 'model', intentMatch: true, fullMatch: false, latencyMs: 100, tokens: { input: 1000, output: 100 }, calls: 1 }),
    outcome({ id: 'd', resolvedBy: 'model', intentMatch: false, fullMatch: false, latencyMs: 300, tokens: { input: 2000, output: 200 }, calls: 2 }),
    outcome({ id: 'e', resolvedBy: 'unresolved' }),
  ];

  it('gives accuracies, shares, latency percentiles over model calls only, tokens and an estimated cost', () => {
    const metrics = summarise(outcomes, 'claude-haiku-5-5');
    expect(metrics).toMatchObject({ n: 5, intentAccuracy: 0.6, fullAccuracy: 0.4, fastPathShare: 0.4, modelShare: 0.4, unresolvedShare: 0.2, inputTokens: 3000, outputTokens: 300 });
    expect(metrics.p50LatencyMs).toBe(100);
    expect(metrics.p95LatencyMs).toBe(300);
    expect(metrics.costUsd).toBeCloseTo((3000 * PRICES['claude-haiku-5-5']!.input + 300 * PRICES['claude-haiku-5-5']!.output) / 1_000_000, 9);
  });

  it('has no latency or cost for the regex tier', () => {
    const metrics = summarise(outcomes.slice(0, 2), null);
    expect(metrics).toMatchObject({ n: 2, intentAccuracy: 1, fullAccuracy: 1, fastPathShare: 1, p50LatencyMs: null, p95LatencyMs: null, costUsd: 0 });
  });

  it('lists prices for the two model tiers with the date of the list', () => {
    expect(Object.keys(PRICES).sort()).toEqual(['claude-haiku-5-5', 'claude-sonnet-5-5']);
    expect(PRICES['claude-sonnet-5-5']!.input).toBeGreaterThan(PRICES['claude-haiku-5-5']!.input);
  });
});
