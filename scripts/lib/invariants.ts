// Parsing and coverage logic for specs/INVARIANTS.md, kept pure so it can be tested.

export interface Invariant {
  id: string;
  name: string;
}

export interface CoverageReport {
  covered: string[];
  /** Uncited and not in the baseline: the check fails. */
  missing: string[];
  /** In the baseline but now cited: the baseline must shrink. */
  stale: string[];
  /** In the baseline but no longer an invariant. */
  unknown: string[];
  /** In the baseline now but not in the committed baseline: the ratchet moved backwards. */
  added: string[];
}

const INVARIANT_LINE = /^- \*\*([A-Z]+-\d+) \(([^)]+)\)\.\*\*/;
// describe/it/test, optionally .only, then the title literal. `.skip` and `.todo` deliberately do not match.
const TEST_TITLE = /\b(?:describe|it|test)(?:\.only)?\s*\(\s*(['"`])((?:(?!\1)[^\\]|\\.)*)\1/g;

export function parseInvariants(markdown: string): Invariant[] {
  const invariants: Invariant[] = [];
  const seen = new Set<string>();
  for (const line of markdown.split('\n')) {
    const match = INVARIANT_LINE.exec(line);
    if (!match) continue;
    const [, id, name] = match as unknown as [string, string, string];
    if (seen.has(id)) throw new Error(`Duplicate invariant ID: ${id}`);
    seen.add(id);
    invariants.push({ id, name });
  }
  return invariants;
}

/** Titles of active describe/it/test calls in a test source file. */
export function testTitles(source: string): string[] {
  return [...source.matchAll(TEST_TITLE)].map((match) => match[2] ?? '');
}

export function citedIds(ids: string[], titles: string[]): Set<string> {
  const cited = new Set<string>();
  for (const id of ids) {
    const pattern = new RegExp(`\\b${id}\\b`);
    if (titles.some((title) => pattern.test(title))) cited.add(id);
  }
  return cited;
}

export function coverage(
  ids: string[],
  cited: Set<string>,
  baseline: string[],
  committedBaseline: string[] | null = null,
): CoverageReport {
  const allowed = new Set(baseline);
  const known = new Set(ids);
  const committed = committedBaseline ? new Set(committedBaseline) : null;
  return {
    covered: ids.filter((id) => cited.has(id)),
    missing: ids.filter((id) => !cited.has(id) && !allowed.has(id)),
    stale: baseline.filter((id) => cited.has(id)),
    unknown: baseline.filter((id) => !known.has(id)),
    added: committed ? baseline.filter((id) => !committed.has(id)) : [],
  };
}
