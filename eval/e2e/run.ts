// `pnpm e2e [--set core,language,calendar,protocol] [--only <name part>]`: runs the end-to-end scenarios against the
// built agent (`dist/main.js`) and the real model, checks every run black-box and writes a summary per set (spec 014).
// A developer tool, like `pnpm eval`: it needs ANTHROPIC_API_KEY and talks to the API; `pnpm test` never runs it. It
// writes its report to the process streams directly.

import { spawn } from 'node:child_process';
import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PROMPT_VERSION } from '../../src/interpreter/schema.js';
import { checkRun, type RunOutput, type TraceLine } from './check.js';
import { DEFAULT_NOW, HEADER, type Scenario } from './scenario.js';
import { scenarios as calendar } from './sets/calendar.js';
import { scenarios as core } from './sets/core.js';
import { scenarios as language } from './sets/language.js';
import { scenarios as protocol } from './sets/protocol.js';

const SETS: Record<string, Scenario[]> = { core, language, calendar, protocol };
const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..');
const OUT = join(HERE, 'out');
const RESULTS = join(HERE, 'results');
const CONCURRENCY = 4;
const RUN_LIMIT_MS = 180_000;

const say = (text: string): void => {
  process.stdout.write(`${text}\n`);
};
const arg = (flag: string): string | undefined => {
  const index = process.argv.indexOf(flag);
  return index === -1 ? undefined : process.argv[index + 1];
};

interface Outcome {
  name: string;
  about: string;
  pass: boolean;
  failures: string[];
  modelCalls: number;
  modelFailures: number;
  tokens: number;
  seconds: number;
}

async function runOne(scenario: Scenario): Promise<Outcome> {
  const dir = join(OUT, scenario.name);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(join(dir, 'traces'), { recursive: true });
  const csvPath = join(dir, 'work_orders.csv');
  writeFileSync(csvPath, `${[HEADER, ...scenario.csv].join('\n')}\n`);
  writeFileSync(join(dir, 'stdin.txt'), `${scenario.stdin.join('\n')}\n`);
  const env: Record<string, string | undefined> = { ...process.env, WORK_ORDERS_PATH: csvPath, TRACES_DIR: join(dir, 'traces'), AGENT_NOW: scenario.now ?? DEFAULT_NOW };
  delete env['AGENT_INTERPRETER'];
  delete env['NODE_NO_WARNINGS'];
  const started = Date.now();
  const child = spawn(process.execPath, [join(ROOT, 'dist', 'main.js')], { cwd: ROOT, env, stdio: ['pipe', 'pipe', 'pipe'] });
  let stdout = '';
  let stderr = '';
  child.stdout.on('data', (chunk: Buffer) => (stdout += chunk.toString('utf8')));
  child.stderr.on('data', (chunk: Buffer) => (stderr += chunk.toString('utf8')));
  child.stdin.end(`${scenario.stdin.join('\n')}\n`);
  const code = await new Promise<number | null>((resolve) => {
    const limit = setTimeout(() => child.kill('SIGKILL'), RUN_LIMIT_MS);
    child.on('close', (exit) => {
      clearTimeout(limit);
      resolve(exit);
    });
  });
  writeFileSync(join(dir, 'stdout.txt'), stdout);
  const trace: TraceLine[] = [];
  const badTraceLines: string[] = [];
  for (const file of readdirSync(join(dir, 'traces')).filter((name) => name.endsWith('.jsonl'))) {
    for (const line of readFileSync(join(dir, 'traces', file), 'utf8').split('\n').filter(Boolean)) {
      try {
        trace.push(JSON.parse(line) as TraceLine);
      } catch {
        badTraceLines.push(line);
      }
    }
  }
  const run: RunOutput = { stdout, stderr, code, trace, badTraceLines };
  const failures = checkRun(scenario, run);
  const calls = trace.filter((line) => line.event_type === 'model_call');
  const tokens = calls.reduce((sum, line) => {
    const used = line.detail['tokens'] as { input?: number; output?: number } | undefined;
    return sum + (used?.input ?? 0) + (used?.output ?? 0);
  }, 0);
  return {
    name: scenario.name,
    about: scenario.about,
    pass: failures.length === 0,
    failures,
    modelCalls: calls.length,
    modelFailures: calls.filter((line) => line.detail['outcome'] !== 'ok').length,
    tokens,
    seconds: Math.round((Date.now() - started) / 100) / 10,
  };
}

async function runSet(name: string, scenarios: Scenario[]): Promise<Outcome[]> {
  const queue = [...scenarios];
  const outcomes: Outcome[] = [];
  await Promise.all(
    Array.from({ length: CONCURRENCY }, async () => {
      for (let next = queue.shift(); next !== undefined; next = queue.shift()) outcomes.push(await runOne(next));
    }),
  );
  outcomes.sort((a, b) => scenarios.findIndex((entry) => entry.name === a.name) - scenarios.findIndex((entry) => entry.name === b.name));
  for (const outcome of outcomes) {
    say(`${outcome.pass ? 'PASS' : 'FAIL'}  ${outcome.name}  (${outcome.modelCalls} calls, ${outcome.tokens} tokens, ${outcome.seconds}s)`);
    for (const failure of outcome.failures) say(`      - ${failure}`);
  }
  const passed = outcomes.filter((outcome) => outcome.pass).length;
  say(`${name}: ${passed}/${outcomes.length} passed\n`);
  return outcomes;
}

if (!process.env['ANTHROPIC_API_KEY']) {
  say('ANTHROPIC_API_KEY is not set (put it in .env); the end-to-end scenarios run against the real model.');
  process.exit(2);
}
const chosen = (arg('--set') ?? Object.keys(SETS).join(',')).split(',').filter((name) => name !== '');
const unknown = chosen.filter((name) => SETS[name] === undefined);
if (unknown.length > 0) {
  say(`Unknown set: ${unknown.join(', ')}. Sets: ${Object.keys(SETS).join(', ')}.`);
  process.exit(2);
}
const only = arg('--only');
mkdirSync(RESULTS, { recursive: true });
let failed = 0;
for (const name of chosen) {
  const scenarios = (SETS[name] ?? []).filter((entry) => only === undefined || entry.name.includes(only));
  if (scenarios.length === 0) continue;
  const outcomes = await runSet(name, scenarios);
  failed += outcomes.filter((outcome) => !outcome.pass).length;
  // A partial run (--only) does not overwrite the committed summary of the whole set.
  if (only === undefined) {
    const summary = { set: name, date: new Date().toISOString().slice(0, 10), promptVersion: PROMPT_VERSION, passed: outcomes.filter((outcome) => outcome.pass).length, total: outcomes.length, outcomes };
    writeFileSync(join(RESULTS, `latest-${name}.json`), `${JSON.stringify(summary, null, 2)}\n`);
  }
}
process.exit(failed === 0 ? 0 : 1);
