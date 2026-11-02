// The written-down tier decision: one latest result file per tier and a Markdown report rebuilt from them (AC-2.5, AC-3.x).

import type { GoldenEntry } from './golden.js';
import type { Metrics, Outcome } from './score.js';

export const RESULTS_DIR = 'eval/results';

export interface RunFile {
  tier: string;
  model: string | null;
  promptVersion: string;
  /** ISO date of the run. */
  date: string;
  metrics: Metrics;
  outcomes: Outcome[];
}

export function latestFile(tier: string): string {
  return `${RESULTS_DIR}/latest-${tier}.json`;
}

const TIER_ORDER = ['regex', 'haiku', 'sonnet'];

const pct = (value: number): string => `${Math.round(value * 100)}%`;
const ms = (value: number | null): string => (value === null ? '—' : `${Math.round(value)} ms`);

function row(run: RunFile): string {
  const m = run.metrics;
  return `| ${run.tier} | ${run.model ?? '—'} | ${pct(m.intentAccuracy)} | ${pct(m.fullAccuracy)} | ${pct(m.fastPathShare)} | ${pct(m.modelShare)} | ${pct(m.unresolvedShare)} | ${ms(m.p50LatencyMs)} | ${ms(m.p95LatencyMs)} | ${m.inputTokens} / ${m.outputTokens} | ${m.costUsd.toFixed(4)} | ${run.promptVersion} | ${run.date} |`;
}

function mismatchRows(run: RunFile, entries: readonly GoldenEntry[]): string[] {
  const byId = new Map(entries.map((entry) => [entry.id, entry]));
  return run.outcomes
    .filter((outcome) => !outcome.fullMatch)
    .map((outcome) => {
      const entry = byId.get(outcome.id);
      const body = (entry?.body ?? '').replace(/\|/g, '\\|').replace(/\s+/g, ' ');
      const expected = entry?.expected.intent ?? '?';
      const obtained = outcome.obtained?.intent ?? (outcome.resolvedBy === 'unresolved' ? 'unresolved' : '?');
      const kind = outcome.intentMatch ? 'times/exclusions/scope' : 'intent';
      return `| ${outcome.id} | ${body} | ${expected} | ${obtained} | ${kind} |`;
    });
}

/** The report: a metrics table for every run given, the mismatches of each model tier, and the hand-written reading. */
export function renderReport(runs: readonly RunFile[], entries: readonly GoldenEntry[], reading?: string): string {
  const ordered = [...runs].sort((a, b) => TIER_ORDER.indexOf(a.tier) - TIER_ORDER.indexOf(b.tier));
  const lines: string[] = [
    '# Interpretation evaluation',
    '',
    `Golden set of ${entries.length} labelled replies scored against each interpreter tier (ADR 0004). The regex tier is the fast path alone; the model tiers run the production cascade (fast path, prompt, schema, one re-ask, validator). Full accuracy requires intent, times, exclusions and scope to match the hand-written label. Cost is an estimate from list prices.`,
    '',
    '| Tier | Model | Intent accuracy | Full accuracy | Fast path | Model | Unresolved | p50 | p95 | Tokens in / out | Cost (USD) | Prompt | Date |',
    '|---|---|---|---|---|---|---|---|---|---|---|---|---|',
    ...ordered.map(row),
  ];
  for (const run of ordered.filter((candidate) => candidate.model !== null)) {
    const rows = mismatchRows(run, entries);
    lines.push('', `### Mismatches: ${run.tier}`, '');
    if (rows.length === 0) {
      lines.push('None.');
    } else {
      lines.push('| Id | Reply | Expected | Obtained | Differs in |', '|---|---|---|---|---|', ...rows);
    }
  }
  if (reading !== undefined && reading.trim() !== '') lines.push('', '## Reading', '', reading.trim());
  lines.push('');
  return lines.join('\n');
}
