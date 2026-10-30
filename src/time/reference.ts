// Reference time resolution (ADR 0003, REQ-TM-1, REQ-TM-2). Pure: the clock is an argument.

import type { DateTime } from 'luxon';
import type { ReferenceSource } from '../core/facts.js';
import { fromDate, parseLocalOrOffset } from './time.js';

export interface ReferenceInput {
  clockNow: Date;
  agentNow: string | undefined;
  /** `reported_at` of every valid order. */
  reportedAts: DateTime[];
}

export interface ReferenceTime {
  simNow: DateTime;
  source: ReferenceSource;
  /** The raw `AGENT_NOW` text when it was set but could not be parsed (AC-3.3). */
  agentNowInvalid?: string;
}

/** A CSV is a fixture when every order was reported more than this long before the clock (REQ-TM-2). */
const STALE_DAYS = 7;

export function resolveReferenceTime({ clockNow, agentNow, reportedAts }: ReferenceInput): ReferenceTime {
  const clock = fromDate(clockNow);
  let agentNowInvalid: string | undefined;
  if (agentNow !== undefined && agentNow.trim() !== '') {
    const parsed = parseLocalOrOffset(agentNow);
    if (parsed !== null) return { simNow: parsed, source: 'agent_now' };
    agentNowInvalid = agentNow;
  }

  const threshold = clock.minus({ days: STALE_DAYS });
  const latest = reportedAts.reduce<DateTime | null>((max, at) => (max === null || at > max ? at : max), null);
  const allStale = latest !== null && reportedAts.every((at) => at < threshold);
  const resolved: ReferenceTime = allStale && latest !== null ? { simNow: latest, source: 'fixture' } : { simNow: clock, source: 'clock' };
  return agentNowInvalid === undefined ? resolved : { ...resolved, agentNowInvalid };
}
