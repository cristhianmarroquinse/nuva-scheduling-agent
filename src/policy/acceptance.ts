// Acceptance is decided by code (ADR 0001, REQ-NG-2, REQ-NG-3). The model only says "accept"; whether the stated day and
// time fit the proposal on the table is checked here, in Madrid time.

import type { Slot } from '../calendar/calendar.js';
import type { Interpretation, StatedTimeValue } from '../interpreter/schema.js';
import { hourMinute } from '../time/format.js';
import { parseLocalOrOffset } from '../time/time.js';

export type AcceptanceVerdict = 'accepted' | 'mismatch' | 'needs_confirmation';

function fits(stated: StatedTimeValue, proposalDate: string, proposalStart: string, proposalEnd: string): boolean {
  if (stated.date !== proposalDate) return false;
  if (stated.start !== undefined && stated.end !== undefined) return stated.start <= proposalStart && stated.end >= proposalEnd;
  if (stated.start !== undefined) return stated.start === proposalStart;
  return true;
}

/**
 * For an `accept` interpretation: `accepted` when every stated date, range or point fits the proposal (a date equals the
 * proposal date, a range contains the visit, a point equals the start); `mismatch` otherwise; `needs_confirmation` when
 * the reply also states an exclusion or constraint, whatever the times say unless they already mismatch.
 */
export function evaluateAcceptance(interpretation: Interpretation, proposal: Slot): AcceptanceVerdict {
  const start = parseLocalOrOffset(proposal.start);
  const end = parseLocalOrOffset(proposal.end);
  if (start === null || end === null) return 'mismatch';
  const proposalDate = start.toISODate() ?? '';
  const proposalStart = hourMinute(start);
  const proposalEnd = hourMinute(end);
  if (!interpretation.times.every((stated) => fits(stated, proposalDate, proposalStart, proposalEnd))) return 'mismatch';
  if (interpretation.exclusions.length > 0) return 'needs_confirmation';
  return 'accepted';
}
