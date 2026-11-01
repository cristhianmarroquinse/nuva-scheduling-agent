// The calendar: one handyman, 2-hour visits on the hour, business windows, never overlapping (REQ-SC-1..3, ADR 0003). Pure.

import type { DateTime } from 'luxon';
import type { Urgency } from '../orders/validate.js';
import { ZONE, parseLocalOrOffset, toIso } from '../time/time.js';

/** A visit, ISO 8601 with the Madrid offset (SCHED-2: always 2 hours). */
export interface Slot {
  start: string;
  end: string;
}

/** A tentative reservation of a slot for a proposal version of an order. */
export interface Hold {
  orderId: string;
  version: number;
  slot: Slot;
}

export const VISIT_HOURS = 2;

const WINDOWS: Record<Urgency, { open: number; close: number; weekdaysOnly: boolean }> = {
  Critical: { open: 8, close: 21, weekdaysOnly: false },
  High: { open: 9, close: 19, weekdaysOnly: true },
  Medium: { open: 9, close: 19, weekdaysOnly: true },
  Low: { open: 9, close: 19, weekdaysOnly: true },
};

const URGENCY_RANK: Record<Urgency, number> = { Critical: 0, High: 1, Medium: 2, Low: 3 };

/** Safety net against an unbounded search; a full year of holds is not a realistic CSV. */
const MAX_SEARCH_DAYS = 366;

function ceilHour(dt: DateTime): DateTime {
  const floor = dt.startOf('hour');
  return floor.equals(dt) ? floor : floor.plus({ hours: 1 });
}

function later(a: DateTime, b: DateTime): DateTime {
  return a >= b ? a : b;
}

/**
 * The earliest start for an order: one hour after the next full hour strictly after the reference time (REQ-SC-2),
 * and never before `reportedAt` rounded up to the hour (SCHED-5).
 */
export function earliestStart(simNow: DateTime, reportedAt: DateTime): DateTime {
  const nextFullHour = simNow.setZone(ZONE).startOf('hour').plus({ hours: 1 });
  return later(nextFullHour.plus({ hours: 1 }), ceilHour(reportedAt.setZone(ZONE)));
}

/** Whether a 2-hour visit starting at `start` lies inside the window for the urgency (REQ-SC-3). */
export function fitsWindow(start: DateTime, urgency: Urgency): boolean {
  const window = WINDOWS[urgency];
  const local = start.setZone(ZONE);
  if (window.weekdaysOnly && local.weekday > 5) return false;
  const opens = local.set({ hour: window.open, minute: 0, second: 0, millisecond: 0 });
  const closes = local.set({ hour: window.close, minute: 0, second: 0, millisecond: 0 });
  const end = local.plus({ hours: VISIT_HOURS });
  return local >= opens && end <= closes;
}

/** Strict overlap: slots that only touch do not overlap. */
export function overlaps(a: Slot, b: Slot): boolean {
  return parseLocalOrOffset(a.start)! < parseLocalOrOffset(b.end)! && parseLocalOrOffset(b.start)! < parseLocalOrOffset(a.end)!;
}

/** The first on-the-hour 2-hour slot at or after `from` that fits the urgency's window and overlaps no hold (SCHED-1). */
export function nextSlot(args: { from: DateTime; urgency: Urgency; holds: readonly Hold[] }): Slot {
  let cursor = ceilHour(args.from.setZone(ZONE));
  const limit = cursor.plus({ days: MAX_SEARCH_DAYS });
  while (cursor < limit) {
    if (fitsWindow(cursor, args.urgency)) {
      const slot: Slot = { start: toIso(cursor), end: toIso(cursor.plus({ hours: VISIT_HOURS })) };
      if (!args.holds.some((hold) => overlaps(hold.slot, slot))) return slot;
    }
    cursor = cursor.plus({ hours: 1 });
  }
  throw new Error(`No free slot within ${MAX_SEARCH_DAYS} days of ${toIso(args.from)}`);
}

/** Allocation order (REQ-ST-3): Critical, High, Medium, Low; ties by earlier `reportedAt`; identical ties keep input order. */
export function priorityOrder<T extends { urgency: Urgency; reportedAt: string }>(orders: readonly T[]): T[] {
  return [...orders].sort((a, b) => {
    const byUrgency = URGENCY_RANK[a.urgency] - URGENCY_RANK[b.urgency];
    if (byUrgency !== 0) return byUrgency;
    return parseLocalOrOffset(a.reportedAt)!.toMillis() - parseLocalOrOffset(b.reportedAt)!.toMillis();
  });
}
