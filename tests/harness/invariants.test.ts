import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { citedIds, coverage, parseInvariants, testTitles } from '../../scripts/lib/invariants.js';

describe('invariant coverage sensor', () => {
  it('parses IDs and names from the invariant list format', () => {
    const md = '- **FOO-1 (one terminal result).** Text.\nnot a line\n- **BAR-12 (x).** Text.';
    expect(parseInvariants(md)).toEqual([
      { id: 'FOO-1', name: 'one terminal result' },
      { id: 'BAR-12', name: 'x' },
    ]);
  });

  it('rejects duplicate IDs', () => {
    const md = '- **FOO-1 (a).** A.\n- **FOO-1 (b).** B.';
    expect(() => parseInvariants(md)).toThrow('Duplicate invariant ID: FOO-1');
  });

  it('reads titles of active describe/it/test calls only', () => {
    const source = [
      "describe('FOO-1 group', () => {",
      '  it("FOO-2 case", () => {});',
      '  test.only(`FOO-3 focused`, () => {});',
      "  it.skip('FOO-4 skipped', () => {});",
      "  it.todo('FOO-5 later');",
      '  // FOO-6 only in a comment',
      "  helper('FOO-7 not a test');",
      '});',
    ].join('\n');
    expect(testTitles(source)).toEqual(['FOO-1 group', 'FOO-2 case', 'FOO-3 focused']);
  });

  it('matches whole IDs only', () => {
    const cited = citedIds(['FOO-1', 'FOO-12'], ['covers FOO-12 only']);
    expect([...cited]).toEqual(['FOO-12']);
  });

  it('reports missing, stale, unknown and re-added baseline entries', () => {
    const report = coverage(['A-1', 'A-2', 'A-3', 'A-4'], new Set(['A-1', 'A-2']), ['A-2', 'A-4', 'Z-9'], ['A-2', 'Z-9']);
    expect(report).toEqual({
      covered: ['A-1', 'A-2'],
      missing: ['A-3'],
      stale: ['A-2'],
      unknown: ['Z-9'],
      added: ['A-4'],
    });
  });

  it('skips the growth check when there is no committed baseline', () => {
    expect(coverage(['A-1'], new Set(), ['A-1'], null).added).toEqual([]);
  });

  it('keeps the real invariant file parseable', () => {
    const invariants = parseInvariants(readFileSync('specs/INVARIANTS.md', 'utf8'));
    expect(invariants.length).toBeGreaterThan(0);
  });
});
