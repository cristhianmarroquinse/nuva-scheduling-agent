// `pnpm eval --tier <regex|haiku|sonnet>`: scores one interpreter tier over the golden set, writes the tier's latest
// result file and rebuilds eval/REPORT.md from every latest file present (ADR 0004). A developer tool, never run by the
// agent: it writes to the process streams directly. The model tiers need ANTHROPIC_API_KEY; the regex tier is offline.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { PROMPT_VERSION } from '../src/interpreter/schema.js';
import type { Interpreter } from '../src/interpreter/types.js';
import { checkGoldenSet, loadGoldenSet } from './lib/golden.js';
import { RESULTS_DIR, latestFile, renderReport, type RunFile } from './lib/report.js';
import { TIERS, TIER_MODELS, runTier, type Tier } from './lib/run.js';
import { summarise } from './lib/score.js';

const GOLDEN_SET = 'eval/golden-set.json';
const READING = 'eval/reading.md';
const REPORT = 'eval/REPORT.md';

function fail(message: string, code: number): never {
  process.stderr.write(`${message}\n`);
  process.exit(code);
}

const tierIndex = process.argv.indexOf('--tier');
const tierArg = tierIndex === -1 ? undefined : process.argv[tierIndex + 1];
const tier = TIERS.find((candidate) => candidate === tierArg);
if (tier === undefined) fail(`usage: pnpm eval --tier <${TIERS.join('|')}>`, 2);

const entries = loadGoldenSet(GOLDEN_SET);
const problems = checkGoldenSet(entries);
if (problems.length > 0) fail(`golden set is not usable:\n- ${problems.join('\n- ')}`, 2);

const model = TIER_MODELS[tier];
const interpreter: Interpreter = await selectInterpreter(tier);
const outcomes = await runTier({ tier, entries, interpreter });
const metrics = summarise(outcomes, model);
const file: RunFile = { tier, model, promptVersion: PROMPT_VERSION, date: new Date().toISOString().slice(0, 10), metrics, outcomes };

mkdirSync(RESULTS_DIR, { recursive: true });
writeFileSync(latestFile(tier), `${JSON.stringify(file, null, 2)}\n`);
const runs = TIERS.filter((candidate) => existsSync(latestFile(candidate))).map((candidate) => JSON.parse(readFileSync(latestFile(candidate), 'utf8')) as RunFile);
const reading = existsSync(READING) ? readFileSync(READING, 'utf8') : undefined;
writeFileSync(REPORT, renderReport(runs, entries, reading));

const pct = (value: number): string => `${Math.round(value * 100)}%`;
process.stdout.write(
  `${tier}${model === null ? '' : ` (${model})`}: intent ${pct(metrics.intentAccuracy)}, full ${pct(metrics.fullAccuracy)}, fast path ${pct(metrics.fastPathShare)}, model ${pct(metrics.modelShare)}, unresolved ${pct(metrics.unresolvedShare)}` +
    `${metrics.p50LatencyMs === null ? '' : `, p50 ${Math.round(metrics.p50LatencyMs)} ms, p95 ${Math.round(metrics.p95LatencyMs ?? 0)} ms, cost ~$${metrics.costUsd.toFixed(4)}`}\n` +
    `wrote ${latestFile(tier)} and ${REPORT}\n`,
);

async function selectInterpreter(selected: Tier): Promise<Interpreter> {
  if (selected === 'regex') {
    const refuse = (): Promise<never> => Promise.reject(new Error('the regex tier never calls a model'));
    return { interpret: refuse, answer: refuse };
  }
  if (!process.env['ANTHROPIC_API_KEY']) fail(`ANTHROPIC_API_KEY is not set; the ${selected} tier needs it. The regex tier runs offline.`, 1);
  const { createAnthropicInterpreter } = await import('../src/interpreter/anthropic.js');
  const model = TIER_MODELS[selected];
  return createAnthropicInterpreter({ elapsed: () => performance.now(), ...(model === null ? {} : { model }) });
}
