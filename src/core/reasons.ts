// Closed set of review reason codes (000-product.md, "Review reasons") and their REASON sentences.

export type ReasonCode =
  | 'no_response'
  | 'no_mutual_slot'
  | 'contradictory_replies'
  | 'interpretation_failed'
  | 'llm_unavailable'
  | 'cross_reference'
  | 'invalid_work_order';

export const REASON_CODES: readonly ReasonCode[] = [
  'no_response',
  'no_mutual_slot',
  'contradictory_replies',
  'interpretation_failed',
  'llm_unavailable',
  'cross_reference',
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
