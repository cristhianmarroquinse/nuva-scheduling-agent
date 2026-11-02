import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { sourceViolations, timerViolations } from '../../scripts/hooks/lib.js';

// The edit hook only sees the agent's Edit/Write calls; this test is the real gate for protocol purity.

function sourceFiles(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.(ts|mts|cts)$/.test(path) ? [path] : [];
  });
}

describe('source hygiene', () => {
  it('no src/ file uses console, and only the streams module touches process streams', () => {
    const violations = sourceFiles('src').flatMap((path) => sourceViolations(path, readFileSync(path, 'utf8')));
    expect(violations).toEqual([]);
  });

  it('no src/ file uses timers or wall-clock waiting (REQ-TO-5, AC-5.4)', () => {
    expect(timerViolations('src/x.ts', 'setTimeout(() => done(), 10);')).toHaveLength(1);
    expect(timerViolations('src/x.ts', "import { setTimeout } from 'node:timers/promises';")).toHaveLength(1);
    expect(timerViolations('tests/x.ts', 'setTimeout(() => done(), 10);')).toEqual([]);
    const violations = sourceFiles('src').flatMap((path) => timerViolations(path, readFileSync(path, 'utf8')));
    expect(violations).toEqual([]);
  });
});

describe('the real interpreter adapter stays out of tests (006 AC-2.7)', () => {
  const importsAdapter = (path: string): boolean => /interpreter\/anthropic(\.js)?['"]/.test(readFileSync(path, 'utf8'));
  const allowed = (path: string): boolean => path === 'src/main.ts' || path.startsWith('eval/');

  it('is imported only by src/main.ts and files under eval/', () => {
    const offenders = [...sourceFiles('src'), ...sourceFiles('tests'), ...sourceFiles('eval'), ...sourceFiles('scripts')].filter((path) => importsAdapter(path) && !allowed(path));
    expect(offenders).toEqual([]);
    expect(importsAdapter('src/main.ts')).toBe(true);
  });
});
