// Availability stated by a party (REQ-NG-4, REQ-SC-4): windows between 07:00 and 22:00 on any day, narrowed by the
// stated exclusions; the visit is fitted by code, never by the model. Pure.

import { DateTime } from 'luxon';
import { VISIT_HOURS, overlaps, type Hold, type Slot } from '../calendar/calendar.js';
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
export function slotInside(windows: readonly Window[], args: { earliest: DateTime; holds: readonly Hold[] }): Slot | null {
  for (const window of windows) {
    let cursor = ceilHour(later(window.start, args.earliest.setZone(ZONE)));
    while (cursor.plus({ hours: VISIT_HOURS }) <= window.end) {
      const slot: Slot = { start: toIso(cursor), end: toIso(cursor.plus({ hours: VISIT_HOURS })) };
      if (!args.holds.some((hold) => overlaps(hold.slot, slot))) return slot;
      cursor = cursor.plus({ hours: 1 });
    }
  }
  return null;
}
