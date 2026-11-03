// Closed set of review reason codes (000-product.md, "Review reasons") and their REASON sentences.

import { slotText } from '../messages/templates.js';
import type { Slot } from '../calendar/calendar.js';

export type ReasonCode =
  | 'no_response'
  | 'no_mutual_slot'
  | 'contradictory_replies'
  | 'interpretation_failed'
  | 'llm_unavailable'
  | 'cross_reference'
  | 'escalated'
  | 'invalid_work_order';

export const REASON_CODES: readonly ReasonCode[] = [
  'no_response',
  'no_mutual_slot',
  'contradictory_replies',
  'interpretation_failed',
  'llm_unavailable',
  'cross_reference',
  'escalated',
  'invalid_work_order',
];

/** Why a CSV row cannot be used. Only the offending field is named; the value is never echoed beyond that field. */
export type RowProblem =
  | { field: 'work_order'; problem: 'empty' }
  | { field: 'reported_at'; problem: 'empty' }
  | { field: 'reported_at'; problem: 'unparseable'; value: string }
  | { field: 'urgency'; problem: 'unknown'; value: string };

const MAX_ECHO = 40;

function quoted(value: string): string {
  const flat = value.replace(/\s+/g, ' ').trim();
  return `'${flat.length > MAX_ECHO ? `${flat.slice(0, MAX_ECHO)}…` : flat}'`;
}

export function invalidRowSentence(problem: RowProblem): string {
  switch (problem.field) {
    case 'work_order':
      return 'The work order row has no title.';
    case 'reported_at':
      return problem.problem === 'empty'
        ? 'The work order row has no reported_at.'
        : `The work order row has an unreadable reported_at ${quoted(problem.value)}.`;
    case 'urgency':
      return `The work order row has an unknown urgency ${quoted(problem.value)}.`;
  }
}

export const NO_RESPONSE_SENTENCE = 'No reply was received before the end of input.';

/** Sentences for the review reasons this feature closes with (REQ-NG-8, REQ-RB-1). */
export type ReviewByReply = 'contradictory_replies' | 'interpretation_failed' | 'llm_unavailable' | 'no_mutual_slot' | 'cross_reference' | 'escalated';

export const REVIEW_SENTENCES: Record<ReviewByReply, (party: 'tenant' | 'handyman') => string> = {
  contradictory_replies: (party) => `The ${party} gave two consecutive replies that could not be reconciled with the proposed visit.`,
  interpretation_failed: (party) => `Two consecutive replies from the ${party} could not be understood.`,
  llm_unavailable: () => 'The reply interpreter was unavailable twice in a row for this order.',
  no_mutual_slot: (party) => `The ${party} declined or countered three proposals.`,
  cross_reference: (party) => `The ${party} kept referring to a different work order.`,
  escalated: (party) => `The ${party} asked for a person or complained; the office should contact them.`,
};

/** Review after two timeouts (REQ-TO-2): the silent party, the slot and whether the other party had accepted. */
export function noResponseSentence(args: { party: 'tenant' | 'handyman'; slot: Slot; otherAccepted: boolean }): string {
  const other = args.party === 'tenant' ? 'handyman' : 'tenant';
  return `The ${args.party} did not reply after a reminder; the proposed visit was ${slotText(args.slot, 'en')}, ${args.otherAccepted ? 'accepted' : 'not yet accepted'} by the ${other}.`;
}

/** Immediate review for a Critical order whose tenant went silent (REQ-TO-3): what is known, nothing from free text. */
export function criticalNoResponseSentence(args: { slot: Slot; handymanAccepted: boolean }): string {
  return `The tenant of a critical order did not reply; the proposed visit is ${slotText(args.slot, 'en')}, ${args.handymanAccepted ? 'accepted' : 'not yet accepted'} by the handyman.`;
}

/** Review at end of input (REQ-TO-4, 013 AC-1, AC-2): who was awaited and what was agreed, the slot in Madrid time. */
export function endOfInputSentence(args: { slot: Slot; accepted: { tenant?: boolean; handyman?: boolean } }): string {
  const visit = slotText(args.slot, 'en');
  if (args.accepted.tenant === true && args.accepted.handyman !== true) return `Input ended while waiting for the handyman; the tenant had accepted the proposed visit on ${visit}.`;
  if (args.accepted.handyman === true && args.accepted.tenant !== true) return `Input ended while waiting for the tenant; the handyman had accepted the proposed visit on ${visit}.`;
  return `Input ended with no agreement; neither party had accepted the proposed visit on ${visit}.`;
}
