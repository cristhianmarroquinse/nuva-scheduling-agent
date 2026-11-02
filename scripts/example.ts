// `pnpm example`: runs the real agent (real model) on traces/examples/{work_orders.csv,stdin.txt,env} and stores the
// stdout and the JSONL trace next to them (REQ-DL-3). A developer tool: it needs ANTHROPIC_API_KEY and talks to the API.

import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const DIR = 'traces/examples';
const CSV = join(DIR, 'work_orders.csv');
const STDIN = join(DIR, 'stdin.txt');
const ENV_FILE = join(DIR, 'env');
const STDOUT = join(DIR, 'stdout.txt');
const TRACE = join(DIR, 'run.jsonl');

if (!process.env['ANTHROPIC_API_KEY']) {
  process.stderr.write('ANTHROPIC_API_KEY is not set; the example is produced with the real model.\n');
  process.exit(1);
}
for (const required of [CSV, STDIN, ENV_FILE]) {
  if (!existsSync(required)) {
    process.stderr.write(`${required} is missing.\n`);
    process.exit(2);
  }
}

const env: Record<string, string | undefined> = { ...process.env };
delete env['AGENT_INTERPRETER'];
for (const line of readFileSync(ENV_FILE, 'utf8').split('\n')) {
  const index = line.indexOf('=');
  if (index > 0) env[line.slice(0, index).trim()] = line.slice(index + 1).trim();
}
const tmp = mkdtempSync(join(tmpdir(), 'example-'));
env['WORK_ORDERS_PATH'] = CSV;
env['TRACES_DIR'] = tmp;

const child = spawn(process.execPath, ['--import', 'tsx', 'src/main.ts'], { env, stdio: ['pipe', 'pipe', 'pipe'] });
const stdout: Buffer[] = [];
const stderr: Buffer[] = [];
child.stdout.on('data', (chunk: Buffer) => stdout.push(chunk));
child.stderr.on('data', (chunk: Buffer) => stderr.push(chunk));
child.stdin.write(readFileSync(STDIN, 'utf8'));
child.stdin.end();

const code = await new Promise<number | null>((resolve, reject) => {
  child.on('error', reject);
  child.on('close', resolve);
});

const traceFiles = readdirSync(tmp).filter((file) => file.endsWith('.jsonl'));
if (traceFiles.length !== 1) {
  process.stderr.write(`expected one trace file, found ${traceFiles.length}\n`);
  process.exit(3);
}
writeFileSync(STDOUT, Buffer.concat(stdout).toString('utf8'));
writeFileSync(TRACE, readFileSync(join(tmp, traceFiles[0]!), 'utf8'));
rmSync(tmp, { recursive: true, force: true });

const errText = Buffer.concat(stderr).toString('utf8');
process.stdout.write(`agent exited with ${code}; stderr ${errText === '' ? 'empty' : `NOT empty:\n${errText}`}\nwrote ${STDOUT} and ${TRACE}\n`);
process.exit(code ?? 1);
