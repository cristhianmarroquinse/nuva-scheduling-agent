// Acceptance is decided by code (ADR 0001, REQ-NG-2, REQ-NG-3). The model only says "accept"; whether the stated day and
// time fit the proposal on the table is checked here, in Madrid time.

import type { Slot } from '../calendar/calendar.js';
import type { ExclusionValue, Interpretation, StatedTimeValue } from '../interpreter/schema.js';
import { hourMinute } from '../time/format.js';
import { parseLocalOrOffset } from '../time/time.js';
import { windowsFrom } from './availability.js';

export type AcceptanceVerdict = 'accepted' | 'mismatch' | 'needs_confirmation';

function fits(stated: StatedTimeValue, proposalDate: string, proposalStart: string, proposalEnd: string): boolean {
  if (stated.date !== proposalDate) return false;
  if (stated.start !== undefined && stated.end !== undefined) return stated.start <= proposalStart && stated.end >= proposalEnd;
  if (stated.start !== undefined) return stated.start === proposalStart;
  return true;
}

const WEEKDAYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];

/** Whether an exclusion rules out the proposal: it applies to the proposal day and its hours overlap the visit (AC-4.1 of 009). */
function excludesProposal(exclusion: ExclusionValue, proposalDate: string, proposalWeekday: string, proposalStart: string, proposalEnd: string): boolean {
  if (exclusion.date !== undefined && exclusion.date !== proposalDate) return false;
  if (exclusion.weekday !== undefined && exclusion.weekday !== proposalWeekday) return false;
  if (exclusion.date === undefined && exclusion.weekday === undefined && exclusion.start === undefined && exclusion.end === undefined) return false;
  const from = exclusion.start ?? '00:00';
  const to = exclusion.end ?? '24:00';
  return from < proposalEnd && proposalStart < to;
}

/**
 * Whether a window the reply states, narrowed by its own exclusions, contains the whole proposal (AC-4.5 of 009): such a
 * reply agrees with the visit on the table even if it also lists other days.
 */
export function availabilityContains(interpretation: Interpretation, proposal: Slot): boolean {
  const start = parseLocalOrOffset(proposal.start);
  const end = parseLocalOrOffset(proposal.end);
  if (start === null || end === null || interpretation.times.length === 0) return false;
  return windowsFrom(interpretation.times, interpretation.exclusions).some((window) => window.start <= start && window.end >= end);
}

/**
 * For an `accept` interpretation: `accepted` when every stated date, range or point fits the proposal (a date equals the
 * proposal date, a range contains the visit, a point equals the start); `mismatch` otherwise; `needs_confirmation` when
 * the reply also states an exclusion or constraint, whatever the times say unless they already mismatch. An exclusion that
 * rules out the proposal itself makes it a `mismatch` (AC-4.1 of 009).
 */
export function evaluateAcceptance(interpretation: Interpretation, proposal: Slot): AcceptanceVerdict {
  const start = parseLocalOrOffset(proposal.start);
  const end = parseLocalOrOffset(proposal.end);
  if (start === null || end === null) return 'mismatch';
  const proposalDate = start.toISODate() ?? '';
  const proposalStart = hourMinute(start);
  const proposalEnd = hourMinute(end);
  if (!interpretation.times.every((stated) => fits(stated, proposalDate, proposalStart, proposalEnd))) return 'mismatch';
  const proposalWeekday = WEEKDAYS[start.weekday - 1] ?? '';
  if (interpretation.exclusions.some((exclusion) => excludesProposal(exclusion, proposalDate, proposalWeekday, proposalStart, proposalEnd))) return 'mismatch';
  if (interpretation.exclusions.length > 0) return 'needs_confirmation';
  return 'accepted';
}
