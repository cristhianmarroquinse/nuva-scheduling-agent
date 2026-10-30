// Fails when an invariant is neither cited by a test title nor pending in the baseline.
// The baseline is a ratchet: covered IDs must leave it, and no ID may be added back
// compared with the committed version (git HEAD), when one exists.

import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { citedIds, coverage, parseInvariants, testTitles } from './lib/invariants.js';

const ROOT = process.cwd();
const INVARIANTS = join(ROOT, 'specs/INVARIANTS.md');
const BASELINE_PATH = 'specs/coverage-baseline.json';
const TEST_DIR = join(ROOT, 'tests');

type Baseline = { pending: string[] };

function testFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) return testFiles(path);
    return path.endsWith('.test.ts') ? [path] : [];
  });
}

function committedBaseline(): string[] | null {
  try {
    const raw = execFileSync('git', ['show', `HEAD:${BASELINE_PATH}`], { cwd: ROOT, stdio: 'pipe' }).toString();
    return (JSON.parse(raw) as Baseline).pending;
  } catch {
    return null; // no git, no commits yet, or the baseline is new
  }
}

const ids = parseInvariants(readFileSync(INVARIANTS, 'utf8')).map((inv) => inv.id);
const baseline = (JSON.parse(readFileSync(join(ROOT, BASELINE_PATH), 'utf8')) as Baseline).pending;
const titles = testFiles(TEST_DIR).flatMap((file) => testTitles(readFileSync(file, 'utf8')));
const report = coverage(ids, citedIds(ids, titles), baseline, committedBaseline());

const pending = ids.length - report.covered.length;
console.log(`Invariants: ${report.covered.length}/${ids.length} covered, ${pending} pending.`);

const problems = [
  ...report.missing.map((id) => `${id} is not cited by any test title and is not pending in the baseline.`),
  ...report.stale.map((id) => `${id} is now covered: remove it from ${BASELINE_PATH}.`),
  ...report.unknown.map((id) => `${id} is in the baseline but not in INVARIANTS.md.`),
  ...report.added.map((id) => `${id} was added back to the baseline; the baseline may only shrink.`),
];

if (problems.length > 0) {
  for (const problem of problems) console.error(`  - ${problem}`);
  process.exit(1);
}
