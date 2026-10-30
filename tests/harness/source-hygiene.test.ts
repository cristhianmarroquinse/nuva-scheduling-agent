import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { sourceViolations } from '../../scripts/hooks/lib.js';

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
});
