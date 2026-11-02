import { describe, expect, it } from 'vitest';
import { loadGoldenSet } from '../../eval/lib/golden.js';
import { runTier } from '../../eval/lib/run.js';
import { summarise } from '../../eval/lib/score.js';
import type { Interpreter } from '../../src/interpreter/types.js';

// The regex tier runs in-process and offline (AC-2.1, AC-2.7): the fast path alone, no model, no network.

const forbidden: Interpreter = {
  interpret: () => Promise.reject(new Error('the regex tier must not call the model')),
  answer: () => Promise.reject(new Error('the regex tier must not call the model')),
};

describe('regex tier (AC-2.1, AC-2.7)', () => {
  it('scores the fast path alone over the committed set without any call', async () => {
    const entries = loadGoldenSet('eval/golden-set.json');
    const outcomes = await runTier({ tier: 'regex', entries, interpreter: forbidden });
    expect(outcomes).toHaveLength(entries.length);
    for (const entry of entries) {
      const outcome = outcomes.find((candidate) => candidate.id === entry.id)!;
      if (entry.tags.includes('fast_path')) {
        expect(outcome.resolvedBy, entry.id).toBe('regex');
        expect(outcome.intentMatch, entry.id).toBe(true);
      } else {
        expect(outcome.resolvedBy, entry.id).toBe('unresolved');
        expect(outcome.obtained, entry.id).toBeNull();
      }
      expect(outcome.calls).toBe(0);
    }
    const metrics = summarise(outcomes, null);
    const fast = entries.filter((entry) => entry.tags.includes('fast_path')).length;
    expect(metrics.fastPathShare).toBeCloseTo(fast / entries.length, 9);
    expect(metrics.unresolvedShare).toBeCloseTo(1 - fast / entries.length, 9);
    expect(metrics.p50LatencyMs).toBeNull();
  });
});
