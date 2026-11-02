import { describe, expect, it } from 'vitest';
import type { GoldenEntry } from '../../eval/lib/golden.js';
import { latestFile, renderReport, type RunFile } from '../../eval/lib/report.js';
import type { Outcome } from '../../eval/lib/score.js';

// The written-down decision (AC-2.5, AC-3.1, AC-3.2, AC-3.4): one latest file per tier, one report rebuilt from them.

const entries: GoldenEntry[] = [
  { id: 'g1', language: 'en', role: 'tenant', body: 'Yes', tags: ['fast_path'], proposal: { version: 1, slot: { start: '2026-11-04T12:00:00+01:00', end: '2026-11-04T14:00:00+01:00' } }, simNow: '2026-11-04T10:00:00+01:00', expected: { intent: 'accept', times: [], exclusions: [] } },
  { id: 'g2', language: 'es', role: 'tenant', body: 'Mañana por la tarde', tags: ['relative'], proposal: { version: 1, slot: { start: '2026-11-04T12:00:00+01:00', end: '2026-11-04T14:00:00+01:00' } }, simNow: '2026-11-04T10:00:00+01:00', expected: { intent: 'counter', times: [{ date: '2026-11-05', start: '15:00', end: '20:00' }], exclusions: [] } },
];
const outcome = (partial: Partial<Outcome>): Outcome => ({ id: 'g1', resolvedBy: 'regex', obtained: null, intentMatch: true, fullMatch: true, calls: 0, ...partial });
const run = (tier: string, model: string | null, outcomes: Outcome[]): RunFile => ({
  tier, model, promptVersion: '3', date: '2026-11-02',
  metrics: { n: 2, intentAccuracy: 0.5, fullAccuracy: 0.5, fastPathShare: 0.5, modelShare: 0.5, unresolvedShare: 0, p50LatencyMs: 420, p95LatencyMs: 420, inputTokens: 900, outputTokens: 60, costUsd: 0.00012 },
  outcomes,
});

describe('latest files (AC-2.5, AC-3.4)', () => {
  it('names one file per tier under eval/results', () => {
    expect(latestFile('haiku')).toBe('eval/results/latest-haiku.json');
    expect(latestFile('regex')).toBe('eval/results/latest-regex.json');
  });
});

describe('renderReport (AC-3.1, AC-3.2)', () => {
  const haiku = run('haiku', 'claude-haiku-5-5', [outcome({}), outcome({ id: 'g2', resolvedBy: 'model', intentMatch: false, fullMatch: false, obtained: { intent: 'decline', times: [], exclusions: [], quote: 'x' }, latencyMs: 420, tokens: { input: 900, output: 60 }, calls: 1 })]);
  const regexRun = run('regex', null, [outcome({}), outcome({ id: 'g2', resolvedBy: 'unresolved', intentMatch: false, fullMatch: false })]);
  const regex: RunFile = { ...regexRun, metrics: { ...regexRun.metrics, modelShare: 0, unresolvedShare: 0.5, p50LatencyMs: null, p95LatencyMs: null, inputTokens: 0, outputTokens: 0, costUsd: 0 } };

  it('has one table row per tier with the required columns, the prompt version and the date', () => {
    const report = renderReport([regex, haiku], entries);
    expect(report).toMatch(/\| Tier \| Model \| Intent accuracy \| Full accuracy \| Fast path \| Model \| Unresolved \| p50 \| p95 \| Tokens in \/ out \| Cost \(USD\) \| Prompt \| Date \|/);
    expect(report).toContain('| regex | — | 50% | 50% | 50% | 0% | 50% | — | — | 0 / 0 | 0.0000 | 3 | 2026-11-02 |');
    expect(report).toContain('| haiku | claude-haiku-5-5 | 50% | 50% | 50% | 50% | 0% | 420 ms | 420 ms | 900 / 60 | 0.0001 | 3 | 2026-11-02 |');
  });

  it('lists the mismatches of each model tier with the expected and obtained intent', () => {
    const report = renderReport([haiku], entries);
    expect(report).toContain('### Mismatches: haiku');
    expect(report).toContain('| g2 | Mañana por la tarde | counter | decline | intent |');
    expect(report).not.toContain('| g1 |');
  });

  it('includes the hand-written reading when given, and says the cost is an estimate', () => {
    expect(renderReport([haiku], entries, 'Haiku is enough.')).toContain('## Reading\n\nHaiku is enough.');
    expect(renderReport([haiku], entries)).not.toContain('## Reading');
    expect(renderReport([haiku], entries)).toMatch(/estimate/i);
  });

  it('renders whatever latest files exist, in a fixed tier order', () => {
    const report = renderReport([haiku, regex], entries);
    expect(report.indexOf('| regex |')).toBeLessThan(report.indexOf('| haiku |'));
  });
});
