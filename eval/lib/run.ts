// Running one tier over the golden set. The regex tier is the fast path alone; a model tier goes through the production
// cascade (`interpretReply`: fast path, prompt, schema, re-ask, validator) with an injected interpreter.

import { fastPath } from '../../src/interpreter/fast-path.js';
import { interpretReply } from '../../src/interpreter/interpreter.js';
import type { Interpretation } from '../../src/interpreter/schema.js';
import type { Interpreter, InterpretRequest } from '../../src/interpreter/types.js';
import type { GoldenEntry } from './golden.js';
import { scoreEntry, type Outcome } from './score.js';

export type Tier = 'regex' | 'haiku' | 'sonnet';

export const TIERS: readonly Tier[] = ['regex', 'haiku', 'sonnet'];

/** The model behind each tier; the regex tier has none (ADR 0004). */
export const TIER_MODELS: Record<Tier, string | null> = {
  regex: null,
  haiku: 'claude-haiku-5-5',
  sonnet: 'claude-sonnet-5-5',
};

function requestFor(entry: GoldenEntry): InterpretRequest {
  return {
    woid: entry.id,
    seq: 1,
    role: entry.role,
    body: entry.body,
    language: entry.language,
    proposal: entry.proposal,
    simNow: entry.simNow,
  };
}

const UNCLEAR = (body: string): Interpretation => ({ intent: 'unclear', times: [], exclusions: [], quote: body.slice(0, 200) });

/** Scores every entry. The interpreter is only called for model tiers; the regex tier never calls it. */
export async function runTier(args: { tier: Tier; entries: readonly GoldenEntry[]; interpreter: Interpreter }): Promise<Outcome[]> {
  const outcomes: Outcome[] = [];
  for (const entry of args.entries) {
    if (args.tier === 'regex') {
      const trivial = fastPath(entry.body);
      outcomes.push(scoreEntry(entry, trivial, trivial === null ? 'unresolved' : 'regex', []));
      continue;
    }
    const outcome = await interpretReply(requestFor(entry), args.interpreter);
    if (outcome.kind === 'interpretation') {
      outcomes.push(scoreEntry(entry, outcome.fact.result, outcome.fact.source === 'regex' ? 'regex' : 'model', outcome.calls));
    } else {
      // A failed call is unclear in production (REQ-RB-1); it counts the same here.
      outcomes.push(scoreEntry(entry, UNCLEAR(entry.body), 'model', outcome.calls));
    }
  }
  return outcomes;
}
