// Spawns the real entry point against a scenario: temp CSV, temp traces dir, scripted stdin.
//
// Scenario file format (`tests/scenarios/*.txt`): sections start with a line `# <name>` and run to the next section.
//   # csv            the CSV file (absent → WORK_ORDERS_PATH points at a missing file)
//   # env            KEY=VALUE lines; `${TMP}` expands to the temp dir
//   # imports        extra `--import` modules for the spawned process, one per line (paths relative to the project)
//   # stdin          lines piped in, one per line; `\r` in a line is a carriage return; `# stdin keep-open` leaves stdin open
//   # stdout         expected stdout, exactly (section text plus a final newline when not empty)
//   # exit           expected exit code
//   # trace          one JSON object per line; each must be a subset of at least one trace line (in order of appearance)
// `${NOW}`, `${NOW+2d}` and `${NOW-10d}` in the csv section expand to the real clock, in Madrid, as ISO 8601.

import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fromDate, toIso } from '../../src/time/time.js';

export interface TraceLine {
  timestamp: string;
  work_order_id: string | null;
  event_type: string;
  detail: unknown;
}

export interface RunInput {
  csv?: string;
  env?: Record<string, string>;
  stdin?: string;
  keepStdinOpen?: boolean;
  /** Extra `--import` modules, e.g. a fixture that makes noise. */
  imports?: string[];
}

export interface RunOutput {
  stdout: string;
  stderr: string;
  code: number | null;
  trace: TraceLine[];
  rawTrace: string;
  /** The CSV file as it was after the run (undefined when none was written). */
  csvAfter?: string;
}

export interface Scenario {
  name: string;
  input: RunInput;
  expected: {
    stdout?: string;
    /** `results`: `stdout` is compared with the result blocks only (frames are still shape-checked). Default `exact`. */
    stdoutMode?: 'exact' | 'results';
    exit?: number;
    trace?: unknown[];
  };
}

const SCENARIO_DIR = new URL('.', import.meta.url).pathname;
const PROJECT_DIR = join(SCENARIO_DIR, '..', '..');

export function expandNow(text: string, clock: Date = new Date()): string {
  return text.replace(/\$\{NOW(?:([+-])(\d+)d)?\}/g, (_match, sign: string | undefined, days: string | undefined) => {
    const base = fromDate(clock);
    const shifted = sign === undefined ? base : base.plus({ days: Number(days) * (sign === '-' ? -1 : 1) });
    return toIso(shifted);
  });
}

export function parseScenario(name: string, text: string): Scenario {
  const sections = new Map<string, { flags: string[]; lines: string[] }>();
  let current: { flags: string[]; lines: string[] } | undefined;
  for (const line of text.split('\n')) {
    const header = /^# (\w+)(?:\s+(.*))?$/.exec(line);
    if (header) {
      current = { flags: (header[2] ?? '').split(/\s+/).filter(Boolean), lines: [] };
      sections.set(header[1] ?? '', current);
    } else if (current) {
      current.lines.push(line);
    }
  }
  const body = (section: string): string | undefined => {
    const found = sections.get(section);
    if (!found) return undefined;
    const lines = [...found.lines];
    while (lines.length > 0 && lines.at(-1) === '') lines.pop();
    return lines.join('\n');
  };

  const input: RunInput = {};
  const csv = body('csv');
  if (csv !== undefined) input.csv = `${expandNow(csv)}\n`;
  const env = body('env');
  if (env !== undefined) {
    input.env = Object.fromEntries(
      env
        .split('\n')
        .filter((line) => line.includes('='))
        .map((line) => {
          const index = line.indexOf('=');
          return [line.slice(0, index), line.slice(index + 1)] as const;
        }),
    );
  }
  const imports = body('imports');
  if (imports !== undefined) input.imports = imports.split('\n').filter((line) => line.trim() !== '');
  const stdin = sections.get('stdin');
  if (stdin) {
    const lines = [...stdin.lines];
    while (lines.length > 0 && lines.at(-1) === '') lines.pop();
    input.stdin = lines.map((line) => `${line.replace(/\\r/g, '\r')}\n`).join('');
    if (stdin.flags.includes('keep-open')) input.keepStdinOpen = true;
  }

  const expected: Scenario['expected'] = {};
  // stdout is exact: blank lines are part of the protocol, so the section is taken as written (plus the final newline).
  const stdout = sections.get('stdout');
  if (stdout) {
    expected.stdout = stdout.lines.length === 0 ? '' : `${stdout.lines.join('\n')}\n`;
    expected.stdoutMode = stdout.flags.includes('results') ? 'results' : 'exact';
  }
  const exit = body('exit');
  if (exit !== undefined) expected.exit = Number(exit.trim());
  const trace = body('trace');
  if (trace !== undefined) expected.trace = trace.split('\n').filter((line) => line.trim() !== '').map((line) => JSON.parse(line) as unknown);
  return { name, input, expected };
}

export function loadScenario(name: string): Scenario {
  return parseScenario(name, readFileSync(join(SCENARIO_DIR, `${name}.txt`), 'utf8'));
}

export async function runAgent(input: RunInput): Promise<RunOutput> {
  const tmp = mkdtempSync(join(tmpdir(), 'scenario-'));
  try {
    const csvPath = join(tmp, 'work_orders.csv');
    if (input.csv !== undefined) writeFileSync(csvPath, input.csv);
    const tracesDir = join(tmp, 'traces');
    const env: Record<string, string | undefined> = { ...process.env };
    delete env['AGENT_NOW'];
    delete env['NODE_NO_WARNINGS'];
    env['WORK_ORDERS_PATH'] = input.csv === undefined ? join(tmp, 'missing.csv') : csvPath;
    env['TRACES_DIR'] = tracesDir;
    for (const [key, value] of Object.entries(input.env ?? {})) env[key] = value.replace(/\$\{TMP\}/g, tmp);

    const args = ['--import', 'tsx', ...(input.imports ?? []).flatMap((module) => ['--import', module]), 'src/main.ts'];
    const child = spawn(process.execPath, args, { cwd: PROJECT_DIR, env, stdio: ['pipe', 'pipe', 'pipe'] });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    child.stdout.on('data', (chunk: Buffer) => stdout.push(chunk));
    child.stderr.on('data', (chunk: Buffer) => stderr.push(chunk));
    child.stdin.on('error', () => undefined);
    if (input.stdin) child.stdin.write(input.stdin);
    if (!input.keepStdinOpen) child.stdin.end();

    const code = await new Promise<number | null>((resolve, reject) => {
      child.on('error', reject);
      child.on('close', (exitCode) => resolve(exitCode));
    });
    if (input.keepStdinOpen) child.stdin.destroy();

    const traceFiles = existsSync(tracesDir) ? readdirSync(tracesDir).filter((file) => file.endsWith('.jsonl')) : [];
    const rawTrace = traceFiles.map((file) => readFileSync(join(tracesDir, file), 'utf8')).join('');
    const trace = rawTrace
      .split('\n')
      .filter((line) => line !== '')
      .map((line) => JSON.parse(line) as TraceLine);
    const output: RunOutput = { stdout: Buffer.concat(stdout).toString('utf8'), stderr: Buffer.concat(stderr).toString('utf8'), code, trace, rawTrace };
    if (input.csv !== undefined) output.csvAfter = readFileSync(csvPath, 'utf8');
    return output;
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

const cache = new Map<string, Promise<{ scenario: Scenario; output: RunOutput }>>();

/** Runs a named scenario once per test process; later callers share the result. */
export function scenarioRun(name: string): Promise<{ scenario: Scenario; output: RunOutput }> {
  let pending = cache.get(name);
  if (!pending) {
    const scenario = loadScenario(name);
    pending = runAgent(scenario.input).then((output) => ({ scenario, output }));
    cache.set(name, pending);
  }
  return pending;
}

/** Deep subset: every key in `expected` must be present and equal (recursively) in `actual`. */
export function isSubset(expected: unknown, actual: unknown): boolean {
  if (expected === null || typeof expected !== 'object') return Object.is(expected, actual);
  if (actual === null || typeof actual !== 'object') return false;
  if (Array.isArray(expected)) {
    return Array.isArray(actual) && expected.length === actual.length && expected.every((item, index) => isSubset(item, actual[index]));
  }
  const actualRecord = actual as Record<string, unknown>;
  return Object.entries(expected as Record<string, unknown>).every(([key, value]) => key in actualRecord && isSubset(value, actualRecord[key]));
}

/** Each expected trace subset must match a trace line, and the matches must appear in order. Returns the unmatched subsets. */
export function unmatchedTraces(expected: unknown[], trace: TraceLine[]): unknown[] {
  const unmatched: unknown[] = [];
  let from = 0;
  for (const subset of expected) {
    const index = trace.findIndex((line, position) => position >= from && isSubset(subset, line));
    if (index === -1) unmatched.push(subset);
    else from = index + 1;
  }
  return unmatched;
}

/** stdout split into protocol blocks (frames or results), each without its terminating blank line. */
export function stdoutBlocks(stdout: string): string[] {
  if (stdout === '') return [];
  return stdout.split('\n\n').filter((block) => block !== '');
}

/** Only the terminal results of stdout, each with its terminating blank line, in order. */
export function resultBlocks(stdout: string): string {
  return stdoutBlocks(stdout)
    .filter((block) => /^WOID:[^|\s]+\|RESULT:/.test(block))
    .map((block) => `${block}\n\n`)
    .join('');
}

const FRAME_HEADER = /^WOID:[^|\s]+\|ROLE:(tenant|handyman)$/;
const RESULT_REVIEW = /^WOID:[^|\s]+\|RESULT:requires_review$/;
const RESULT_SCHEDULED = /^WOID:[^|\s]+\|RESULT:scheduled$/;

/** Whether a stdout block is a well-formed frame or terminal result (OUT-1). */
export function isProtocolBlock(block: string): boolean {
  const lines = block.split('\n');
  const [header, ...rest] = lines;
  if (header === undefined) return false;
  if (FRAME_HEADER.test(header)) return rest.every((line) => line.trim() !== '');
  if (RESULT_REVIEW.test(header)) return rest.length === 1 && rest[0]!.startsWith('REASON:') && rest[0]!.length > 'REASON:'.length;
  if (RESULT_SCHEDULED.test(header)) return rest.length === 1 && /^SCHEDULED_FOR:\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[+-]\d{2}:\d{2}$/.test(rest[0]!);
  return false;
}

/** Asserts a loaded scenario's expectations against its output; returns a list of failures (empty when it passed). */
export function scenarioFailures(scenario: Scenario, output: RunOutput): string[] {
  const failures: string[] = [];
  if (output.stderr !== '') failures.push(`stderr is not empty:\n${output.stderr}`);
  if (scenario.expected.exit !== undefined && output.code !== scenario.expected.exit) failures.push(`exit code ${output.code}, expected ${scenario.expected.exit}`);
  if (scenario.expected.stdout !== undefined) {
    const compared = scenario.expected.stdoutMode === 'results' ? resultBlocks(output.stdout) : output.stdout;
    if (compared !== scenario.expected.stdout) {
      failures.push(`stdout (${scenario.expected.stdoutMode ?? 'exact'}) differs.\n--- expected\n${scenario.expected.stdout}\n--- actual\n${compared}`);
    }
  }
  for (const block of stdoutBlocks(output.stdout)) {
    if (!isProtocolBlock(block)) failures.push(`stdout block is not a frame or result:\n${block}`);
  }
  if (scenario.expected.trace) {
    for (const subset of unmatchedTraces(scenario.expected.trace, output.trace)) {
      failures.push(`no trace line matches ${JSON.stringify(subset)}`);
    }
  }
  if (scenario.input.csv !== undefined && output.csvAfter !== scenario.input.csv) failures.push('the CSV file was modified');
  return failures;
}
