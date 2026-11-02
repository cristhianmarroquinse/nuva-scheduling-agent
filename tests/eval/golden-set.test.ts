import { describe, expect, it } from 'vitest';
import { checkGoldenSet, loadGoldenSet, type GoldenEntry } from '../../eval/lib/golden.js';

// The golden set is data the eval scores every tier against (ADR 0004); its shape and coverage are checked here (AC-1.1–AC-1.4).

const INTENTS = ['accept', 'decline', 'counter', 'question', 'withdraw', 'cross_reference', 'contradictory', 'unclear'] as const;

function entry(index: number, overrides: Partial<GoldenEntry> = {}): GoldenEntry {
  const intent = INTENTS[index % INTENTS.length]!;
  return {
    id: `g${index}`,
    language: index % 2 === 0 ? 'es' : 'en',
    role: index % 3 === 0 ? 'handyman' : 'tenant',
    body: `reply ${index}`,
    proposal: { version: 1, slot: { start: '2026-11-04T12:00:00+01:00', end: '2026-11-04T14:00:00+01:00' } },
    simNow: '2026-11-04T10:00:00+01:00',
    tags: index < 5 ? ['hostile'] : [],
    expected: { intent, times: [], exclusions: [] },
    ...overrides,
  };
}

const valid = (): GoldenEntry[] => Array.from({ length: 40 }, (_, index) => entry(index));

describe('checkGoldenSet (AC-1.1, AC-1.2, AC-1.3, AC-1.4)', () => {
  it('accepts a set with 40 entries, both languages, every intent three times and five hostile entries', () => {
    expect(checkGoldenSet(valid())).toEqual([]);
  });

  it('rejects fewer than 40 entries', () => {
    expect(checkGoldenSet(valid().slice(0, 39))).toEqual([expect.stringMatching(/40/)]);
  });

  it('rejects a missing language', () => {
    const set = valid().map((item) => ({ ...item, language: 'es' as const }));
    expect(checkGoldenSet(set)).toEqual([expect.stringMatching(/en/)]);
  });

  it('rejects an intent with fewer than three entries', () => {
    const set = valid().map((item) => (item.expected.intent === 'withdraw' ? { ...item, expected: { ...item.expected, intent: 'accept' as const } } : item));
    expect(checkGoldenSet(set)).toEqual([expect.stringMatching(/withdraw/)]);
  });

  it('rejects fewer than five hostile entries', () => {
    const set = valid().map((item, index) => (index === 0 ? { ...item, tags: [] } : item));
    expect(checkGoldenSet(set)).toEqual([expect.stringMatching(/hostile/)]);
  });

  it('rejects duplicate ids', () => {
    const set = valid().map((item, index) => (index === 1 ? { ...item, id: 'g0' } : item));
    expect(checkGoldenSet(set)).toEqual([expect.stringMatching(/g0/)]);
  });

  it('rejects an expectation the production schema refuses, such as an offset or a Z (AC-1.3)', () => {
    const set = valid().map((item, index) => (index === 2 ? { ...item, expected: { ...item.expected, times: [{ date: '2026-11-05', start: '10:00Z' }] } } : item));
    expect(checkGoldenSet(set)).toEqual([expect.stringMatching(/g2/)]);
  });
});

describe('the committed golden set (AC-1.4)', () => {
  it('passes every check and every expectation validates under the production schema', () => {
    const entries = loadGoldenSet('eval/golden-set.json');
    expect(checkGoldenSet(entries)).toEqual([]);
    expect(entries.length).toBeGreaterThanOrEqual(40);
    expect(entries.filter((entry) => entry.tags.includes('scope_all')).length).toBeGreaterThanOrEqual(2);
    expect(entries.filter((entry) => entry.tags.includes('idiom')).length).toBeGreaterThanOrEqual(2);
    expect(entries.filter((entry) => entry.tags.includes('relative')).length).toBeGreaterThanOrEqual(5);
    expect(entries.filter((entry) => entry.tags.includes('exclusion')).length).toBeGreaterThanOrEqual(3);
    expect(entries.filter((entry) => entry.tags.includes('contradictory')).length).toBeGreaterThanOrEqual(3);
  });
});
