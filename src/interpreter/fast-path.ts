// Regex fast path for trivial replies (ADR 0004, AC-1.3): a bare yes or no, nothing else.

import type { Interpretation } from './schema.js';

const ACCEPT = /^(s[ií]|vale|ok|okay|de acuerdo|perfecto|yes|yep|sure|fine|claro)[.!]*$/i;
const DECLINE = /^(no|no puedo|nope|tampoco|tampoco puedo)[.!]*$/i;

/** The interpretation of a trivial reply, or null when the model is needed. */
export function fastPath(body: string): Interpretation | null {
  const quote = body.trim();
  if (ACCEPT.test(quote)) return { intent: 'accept', times: [], exclusions: [], quote };
  if (DECLINE.test(quote)) return { intent: 'decline', times: [], exclusions: [], quote };
  return null;
}
