// Availability stated by a party (REQ-NG-4, REQ-SC-4): windows between 07:00 and 22:00 on any day, narrowed by the
// stated exclusions; the visit is fitted by code, never by the model. Pure.

import { DateTime } from 'luxon';
import { URGENCY_RANK, VISIT_HOURS, overlaps, type Hold, type Slot } from '../calendar/calendar.js';
import type { Urgency } from '../orders/validate.js';
import type { ExclusionValue, StatedTimeValue } from '../interpreter/schema.js';
import { ZONE, toIso } from '../time/time.js';

/** Party-stated times are honoured between these hours on any day (REQ-SC-4). */
export const DAY_OPEN = '07:00';
export const DAY_CLOSE = '22:00';

export interface Window {
  start: DateTime;
  end: DateTime;
}

const WEEKDAY_INDEX: Record<string, number> = { monday: 1, tuesday: 2, wednesday: 3, thursday: 4, friday: 5, saturday: 6, sunday: 7 };

function dayAt(date: string, time: string): DateTime | null {
  const dt = DateTime.fromISO(`${date}T${time}`, { zone: ZONE });
  return dt.isValid ? dt : null;
}

function later(a: DateTime, b: DateTime): DateTime {
  return a >= b ? a : b;
}

function earlier(a: DateTime, b: DateTime): DateTime {
  return a <= b ? a : b;
}

/** A date alone is the whole day; a range is kept; a single time is a 2-hour point; an end alone starts at 07:00. */
function windowOf(stated: StatedTimeValue): Window | null {
  const open = dayAt(stated.date, DAY_OPEN);
  const close = dayAt(stated.date, DAY_CLOSE);
  if (open === null || close === null) return null;
  let start = open;
  let end = close;
  if (stated.start !== undefined) {
    const point = dayAt(stated.date, stated.start);
    if (point === null) return null;
    start = point;
    end = stated.end !== undefined ? (dayAt(stated.date, stated.end) ?? close) : point.plus({ hours: VISIT_HOURS });
  } else if (stated.end !== undefined) {
    end = dayAt(stated.date, stated.end) ?? close;
  }
  start = later(start, open);
  end = earlier(end, close);
  return start < end ? { start, end } : null;
}

function matchesDay(window: Window, exclusion: ExclusionValue): boolean {
  if (exclusion.date !== undefined) return window.start.toISODate() === exclusion.date;
  if (exclusion.weekday !== undefined) return window.start.weekday === WEEKDAY_INDEX[exclusion.weekday];
  return true;
}

/** Removes an excluded day, or cuts an excluded range out of the windows on the matching day(s). */
function applyExclusion(windows: Window[], exclusion: ExclusionValue): Window[] {
  const wholeDay = exclusion.start === undefined && exclusion.end === undefined;
  if (wholeDay && exclusion.date === undefined && exclusion.weekday === undefined) return windows;
  return windows.flatMap((window) => {
    if (!matchesDay(window, exclusion)) return [window];
    if (wholeDay) return [];
    const date = window.start.toISODate() ?? '';
    const cutStart = exclusion.start !== undefined ? dayAt(date, exclusion.start) : dayAt(date, DAY_OPEN);
    const cutEnd = exclusion.end !== undefined ? dayAt(date, exclusion.end) : dayAt(date, DAY_CLOSE);
    if (cutStart === null || cutEnd === null) return [window];
    const pieces: Window[] = [];
    if (window.start < cutStart) pieces.push({ start: window.start, end: earlier(window.end, cutStart) });
    if (window.end > cutEnd) pieces.push({ start: later(window.start, cutEnd), end: window.end });
    return pieces.filter((piece) => piece.start < piece.end);
  });
}

/** The windows a party's reply states, in Madrid time, clamped to 07:00–22:00, narrowed by exclusions, sorted by start. */
export function windowsFrom(times: readonly StatedTimeValue[], exclusions: readonly ExclusionValue[]): Window[] {
  let windows = times.flatMap((stated) => {
    const window = windowOf(stated);
    return window === null ? [] : [window];
  });
  for (const exclusion of exclusions) windows = applyExclusion(windows, exclusion);
  return windows.sort((a, b) => a.start.toMillis() - b.start.toMillis());
}

function ceilHour(dt: DateTime): DateTime {
  const floor = dt.startOf('hour');
  return floor.equals(dt) ? floor : floor.plus({ hours: 1 });
}

/** The first on-the-hour 2-hour slot inside any window, at or after `earliest`, overlapping no hold (SCHED-1); null if none. */
export function slotInside(windows: readonly Window[], args: { earliest: DateTime; holds: readonly Hold[]; blocked?: readonly Slot[] }): Slot | null {
  for (const window of windows) {
    let cursor = ceilHour(later(window.start, args.earliest.setZone(ZONE)));
    while (cursor.plus({ hours: VISIT_HOURS }) <= window.end) {
      const slot: Slot = { start: toIso(cursor), end: toIso(cursor.plus({ hours: VISIT_HOURS })) };
      if (!args.holds.some((hold) => overlaps(hold.slot, slot)) && !(args.blocked ?? []).some((blocked) => overlaps(blocked, slot))) return slot;
      cursor = cursor.plus({ hours: 1 });
    }
  }
  return null;
}

/**
 * Preemption (REQ-SC-5, SCHED-4): the earliest tentative hold inside the windows that belongs to an order of strictly
 * lower urgency, starts at or after `earliest`, and overlaps no other hold or blackout. Scheduled visits are never
 * candidates (SCHED-3). Null when there is none.
 */
export function takeoverCandidate(
  windows: readonly Window[],
  args: { earliest: DateTime; holds: readonly Hold[]; blocked?: readonly Slot[]; urgency: Urgency; urgencyOf: (orderId: string) => Urgency | undefined },
): Hold | null {
  const rank = URGENCY_RANK[args.urgency];
  const earliest = args.earliest.setZone(ZONE);
  const candidates = args.holds
    .filter((hold) => hold.kind === 'tentative')
    .filter((hold) => {
      const victimUrgency = args.urgencyOf(hold.orderId);
      return victimUrgency !== undefined && URGENCY_RANK[victimUrgency] > rank;
    })
    .filter((hold) => {
      const start = DateTime.fromISO(hold.slot.start, { zone: ZONE });
      const end = DateTime.fromISO(hold.slot.end, { zone: ZONE });
      if (start < earliest) return false;
      if (!windows.some((window) => start >= window.start && end <= window.end)) return false;
      if (args.holds.some((other) => other !== hold && overlaps(other.slot, hold.slot))) return false;
      return !(args.blocked ?? []).some((blocked) => overlaps(blocked, hold.slot));
    })
    .sort((a, b) => a.slot.start.localeCompare(b.slot.start));
  return candidates[0] ?? null;
}

function nextOccurrence(weekday: string, simNow: DateTime): string | null {
  const target = WEEKDAY_INDEX[weekday];
  if (target === undefined) return null;
  const today = simNow.setZone(ZONE).startOf('day');
  const delta = (target - today.weekday + 7) % 7;
  return today.plus({ days: delta }).toISODate();
}

/**
 * Handyman blackouts (REQ-SC-6): the stated days and hours as slots. A date alone is the whole day; a weekday without a
 * date is its next occurrence from the reference time, that day included, and only that one (AC-3.7 of 005).
 */
export function blackoutWindows(exclusions: readonly ExclusionValue[], simNow: DateTime): Slot[] {
  const windows: Slot[] = [];
  for (const exclusion of exclusions) {
    const date = exclusion.date ?? (exclusion.weekday !== undefined ? nextOccurrence(exclusion.weekday, simNow) : null);
    if (date === null) continue;
    const dayStart = DateTime.fromISO(date, { zone: ZONE });
    if (!dayStart.isValid) continue;
    const dayEnd = dayStart.plus({ days: 1 });
    const start = exclusion.start !== undefined ? (dayAt(date, exclusion.start) ?? dayStart) : dayStart;
    const end = exclusion.end !== undefined ? (dayAt(date, exclusion.end) ?? dayEnd) : dayEnd;
    if (start < end) windows.push({ start: toIso(start), end: toIso(end) });
  }
  return windows;
}

/** `HH:MM` plus the visit length, capped at 24:00. */
function plusVisit(time: string): string {
  const [hours, minutes] = time.split(':').map(Number);
  const end = Math.min((hours ?? 0) + VISIT_HOURS, 24);
  return end === 24 ? '23:59' : `${String(end).padStart(2, '0')}:${String(minutes ?? 0).padStart(2, '0')}`;
}

/** Undated time-of-day exclusions ("not before 13:00", "only afternoons") apply for this many days (AC-1.2 of 009). */
export const CONSTRAINT_DAYS = 14;

/**
 * An order's constraints as concrete Madrid windows (AC-1.2 of 009): a date or weekday as in `blackoutWindows`, except
 * that a start with no end is the 2-hour visit at that time; times without a day repeated on each of the next `days` days from the reference time; an exclusion with neither is ignored.
 */
export function constraintWindows(exclusions: readonly ExclusionValue[], simNow: DateTime, days: number = CONSTRAINT_DAYS): Slot[] {
  const windows: Slot[] = [];
  for (const stated of exclusions) {
    // A time with no end ("a las 12 no puedo") rules out the visit at that time, not the rest of the day; ruling out
    // less is the conservative reading for a constraint the system must avoid. Blackouts keep reading it as "from".
    const exclusion = stated.start !== undefined && stated.end === undefined ? { ...stated, end: plusVisit(stated.start) } : stated;
    if (exclusion.date !== undefined || exclusion.weekday !== undefined) {
      windows.push(...blackoutWindows([exclusion], simNow));
      continue;
    }
    if (exclusion.start === undefined && exclusion.end === undefined) continue;
    const first = simNow.setZone(ZONE).startOf('day');
    for (let offset = 0; offset < days; offset += 1) {
      const date = first.plus({ days: offset }).toISODate();
      if (date !== null) windows.push(...blackoutWindows([{ ...exclusion, date }], simNow));
    }
  }
  return windows;
}

/**
 * The free slot on a stated date whose start is closest to the stated start (AC-3.1 of 009; a date alone targets 07:00):
 * on-the-hour 2-hour slots inside 07:00–22:00 of that date, at or after `earliest`, overlapping no hold or blocked slot;
 * ties go to the earlier start.
 * Null when no stated date has a free slot (AC-3.2).
 */
export function nearestOnDate(times: readonly StatedTimeValue[], args: { earliest: DateTime; holds: readonly Hold[]; blocked?: readonly Slot[] }): Slot | null {
  let best: { slot: Slot; distance: number; start: DateTime } | null = null;
  for (const stated of times) {
    const open = dayAt(stated.date, DAY_OPEN);
    const close = dayAt(stated.date, DAY_CLOSE);
    if (open === null || close === null) continue;
    const target = (stated.start !== undefined ? dayAt(stated.date, stated.start) : null) ?? open;
    let cursor = ceilHour(later(open, args.earliest.setZone(ZONE)));
    while (cursor.plus({ hours: VISIT_HOURS }) <= close) {
      const end = cursor.plus({ hours: VISIT_HOURS });
      const slot: Slot = { start: toIso(cursor), end: toIso(end) };
      const free = !args.holds.some((hold) => overlaps(hold.slot, slot)) && !(args.blocked ?? []).some((blocked) => overlaps(blocked, slot));
      if (free) {
        const gap = Math.abs(cursor.diff(target, 'minutes').minutes);
        if (best === null || gap < best.distance || (gap === best.distance && cursor < best.start)) best = { slot, distance: gap, start: cursor };
      }
      cursor = cursor.plus({ hours: 1 });
    }
  }
  return best?.slot ?? null;
}
