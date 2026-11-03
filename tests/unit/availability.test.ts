import { describe, expect, it } from 'vitest';
import type { Hold } from '../../src/calendar/calendar.js';
import { blackoutWindows, constraintWindows, nearestOnDate, slotInside, takeoverCandidate, windowsFrom } from '../../src/policy/availability.js';
import { parseLocalOrOffset, toIso } from '../../src/time/time.js';

// Availability stated by a party (REQ-NG-4, REQ-SC-4): windows between 07:00 and 22:00 on any day; code fits the 2-hour visit.

const at = (text: string) => parseLocalOrOffset(text)!;
const iso = (text: string) => toIso(at(text));
const span = (windows: ReturnType<typeof windowsFrom>) => windows.map((window) => [toIso(window.start), toIso(window.end)]);
const hold = (id: string, start: string, end: string, kind: Hold['kind'] = 'tentative'): Hold => ({ orderId: id, version: 1, kind, slot: { start: iso(start), end: iso(end) } });

describe('windows from stated times (AC-1.3, AC-1.4)', () => {
  it('a date alone is that day from 07:00 to 22:00', () => {
    expect(span(windowsFrom([{ date: '2026-11-05' }], []))).toEqual([['2026-11-05T07:00:00+01:00', '2026-11-05T22:00:00+01:00']]);
  });

  it('a range is kept, "after" and "before" are open on one side, a single time is a 2-hour point', () => {
    expect(span(windowsFrom([{ date: '2026-11-05', start: '15:00', end: '20:00' }], []))).toEqual([['2026-11-05T15:00:00+01:00', '2026-11-05T20:00:00+01:00']]);
    expect(span(windowsFrom([{ date: '2026-11-05', start: '17:00', end: '22:00' }], []))).toEqual([['2026-11-05T17:00:00+01:00', '2026-11-05T22:00:00+01:00']]);
    expect(span(windowsFrom([{ date: '2026-11-05', end: '15:00' }], []))).toEqual([['2026-11-05T07:00:00+01:00', '2026-11-05T15:00:00+01:00']]);
    expect(span(windowsFrom([{ date: '2026-11-05', start: '16:00' }], []))).toEqual([['2026-11-05T16:00:00+01:00', '2026-11-05T18:00:00+01:00']]);
  });

  it('clamps everything to 07:00–22:00 and drops what is left empty', () => {
    expect(span(windowsFrom([{ date: '2026-11-05', start: '06:00', end: '23:30' }], []))).toEqual([['2026-11-05T07:00:00+01:00', '2026-11-05T22:00:00+01:00']]);
    expect(span(windowsFrom([{ date: '2026-11-05', start: '21:00' }], []))).toEqual([['2026-11-05T21:00:00+01:00', '2026-11-05T22:00:00+01:00']]);
    expect(windowsFrom([{ date: '2026-11-05', start: '22:30', end: '23:30' }], [])).toEqual([]);
  });

  it('sorts windows by start and ignores unreadable dates', () => {
    const windows = windowsFrom([{ date: '2026-11-06' }, { date: '2026-11-05', start: '10:00', end: '12:00' }, { date: '2026-13-40' }], []);
    expect(span(windows).map(([start]) => start)).toEqual(['2026-11-05T10:00:00+01:00', '2026-11-06T07:00:00+01:00']);
  });

  it('exclusions by weekday or date drop that day; ranges cut and can split a window', () => {
    expect(windowsFrom([{ date: '2026-11-05' }], [{ weekday: 'thursday' }])).toEqual([]);
    expect(windowsFrom([{ date: '2026-11-05' }], [{ date: '2026-11-05' }])).toEqual([]);
    expect(span(windowsFrom([{ date: '2026-11-05' }], [{ date: '2026-11-05', end: '13:00' }]))).toEqual([['2026-11-05T13:00:00+01:00', '2026-11-05T22:00:00+01:00']]);
    expect(span(windowsFrom([{ date: '2026-11-05' }], [{ start: '12:00', end: '14:00' }]))).toEqual([
      ['2026-11-05T07:00:00+01:00', '2026-11-05T12:00:00+01:00'],
      ['2026-11-05T14:00:00+01:00', '2026-11-05T22:00:00+01:00'],
    ]);
    expect(span(windowsFrom([{ date: '2026-11-05' }, { date: '2026-11-06' }], [{ date: '2026-11-05', start: '18:00' }]))).toEqual([
      ['2026-11-05T07:00:00+01:00', '2026-11-05T18:00:00+01:00'],
      ['2026-11-06T07:00:00+01:00', '2026-11-06T22:00:00+01:00'],
    ]);
  });
});

describe('slot inside stated availability (AC-1.2, AC-1.5, SCHED-1, SCHED-2, SCHED-5)', () => {
  const thursday = windowsFrom([{ date: '2026-11-05' }], []);

  it('takes the first on-the-hour 2-hour slot at or after the earliest start (SCHED-2, SCHED-5)', () => {
    expect(slotInside(thursday, { earliest: at('2026-11-05T12:00'), holds: [] })).toEqual({ start: '2026-11-05T12:00:00+01:00', end: '2026-11-05T14:00:00+01:00' });
    expect(slotInside(thursday, { earliest: at('2026-11-05T12:20'), holds: [] })).toEqual({ start: '2026-11-05T13:00:00+01:00', end: '2026-11-05T15:00:00+01:00' });
    expect(slotInside(thursday, { earliest: at('2026-11-04T12:00'), holds: [] })).toEqual({ start: '2026-11-05T07:00:00+01:00', end: '2026-11-05T09:00:00+01:00' });
  });

  it('skips tentative and scheduled holds alike (SCHED-1)', () => {
    const holds = [hold('A', '2026-11-05T07:00', '2026-11-05T09:00'), hold('B', '2026-11-05T09:00', '2026-11-05T11:00', 'scheduled')];
    expect(slotInside(thursday, { earliest: at('2026-11-04T12:00'), holds })).toEqual({ start: '2026-11-05T11:00:00+01:00', end: '2026-11-05T13:00:00+01:00' });
  });

  it('returns null when nothing fits: past window, held point, point too late, too short', () => {
    expect(slotInside(windowsFrom([{ date: '2026-11-03' }], []), { earliest: at('2026-11-04T12:00'), holds: [] })).toBeNull();
    expect(slotInside(windowsFrom([{ date: '2026-11-05', start: '16:00' }], []), { earliest: at('2026-11-04T12:00'), holds: [hold('A', '2026-11-05T15:00', '2026-11-05T17:00')] })).toBeNull();
    expect(slotInside(windowsFrom([{ date: '2026-11-05', start: '21:00' }], []), { earliest: at('2026-11-04T12:00'), holds: [] })).toBeNull();
    expect(slotInside(windowsFrom([{ date: '2026-11-05', start: '10:00', end: '11:00' }], []), { earliest: at('2026-11-04T12:00'), holds: [] })).toBeNull();
  });

  it('allows evenings and weekends that the business windows of 002 would not (REQ-SC-4)', () => {
    expect(slotInside(windowsFrom([{ date: '2026-11-04', start: '20:00' }], []), { earliest: at('2026-11-04T12:00'), holds: [] })).toEqual({ start: '2026-11-04T20:00:00+01:00', end: '2026-11-04T22:00:00+01:00' });
    expect(slotInside(windowsFrom([{ date: '2026-11-08' }], []), { earliest: at('2026-11-04T12:00'), holds: [] })).toEqual({ start: '2026-11-08T07:00:00+01:00', end: '2026-11-08T09:00:00+01:00' });
  });

  it('crosses 2026-10-25 with the right offset (TIME-1)', () => {
    expect(slotInside(windowsFrom([{ date: '2026-10-25' }], []), { earliest: at('2026-10-24T22:00'), holds: [] })).toEqual({ start: '2026-10-25T07:00:00+01:00', end: '2026-10-25T09:00:00+01:00' });
  });
});

describe('blocked slots inside stated availability (AC-3.3 of 005)', () => {
  it('slotInside skips blackout windows', () => {
    const blocked = [{ start: iso('2026-11-05T07:00'), end: iso('2026-11-05T13:00') }];
    expect(slotInside(windowsFrom([{ date: '2026-11-05' }], []), { earliest: at('2026-11-04T12:00'), holds: [], blocked })).toEqual({ start: '2026-11-05T13:00:00+01:00', end: '2026-11-05T15:00:00+01:00' });
    expect(slotInside(windowsFrom([{ date: '2026-11-05', start: '10:00' }], []), { earliest: at('2026-11-04T12:00'), holds: [], blocked })).toBeNull();
  });
});

describe('takeover candidate (AC-2.1, AC-2.2, SCHED-3, SCHED-4)', () => {
  const urgencies: Record<string, 'Critical' | 'High' | 'Medium' | 'Low'> = { A: 'Low', B: 'Medium', C: 'Low', D: 'High' };
  const urgencyOf = (id: string) => urgencies[id];
  const holds = [hold('A', '2026-11-05T10:00', '2026-11-05T12:00'), hold('B', '2026-11-05T12:00', '2026-11-05T14:00'), hold('C', '2026-11-05T14:00', '2026-11-05T16:00', 'scheduled'), hold('D', '2026-11-05T16:00', '2026-11-05T18:00')];
  const thursday = windowsFrom([{ date: '2026-11-05', start: '09:00', end: '18:00' }], []);
  const earliest = at('2026-11-04T12:00');

  it('returns the earliest tentative hold of strictly lower urgency inside the windows (SCHED-4)', () => {
    expect(takeoverCandidate(thursday, { earliest, holds, urgency: 'Critical', urgencyOf })?.orderId).toBe('A');
    expect(takeoverCandidate(thursday, { earliest, holds, urgency: 'Medium', urgencyOf })?.orderId).toBe('A');
    expect(takeoverCandidate(thursday, { earliest, holds, urgency: 'High', urgencyOf })?.orderId).toBe('A');
    expect(takeoverCandidate(windowsFrom([{ date: '2026-11-05', start: '12:00', end: '18:00' }], []), { earliest, holds, urgency: 'Critical', urgencyOf })?.orderId).toBe('B');
  });

  it('never takes equal or higher urgency, nor a scheduled visit (SCHED-3)', () => {
    expect(takeoverCandidate(thursday, { earliest, holds, urgency: 'Low', urgencyOf })).toBeNull();
    expect(takeoverCandidate(windowsFrom([{ date: '2026-11-05', start: '12:00', end: '14:00' }], []), { earliest, holds, urgency: 'Medium', urgencyOf })).toBeNull();
    expect(takeoverCandidate(windowsFrom([{ date: '2026-11-05', start: '14:00', end: '16:00' }], []), { earliest, holds, urgency: 'Critical', urgencyOf })).toBeNull();
    expect(takeoverCandidate(windowsFrom([{ date: '2026-11-05', start: '16:00', end: '18:00' }], []), { earliest, holds, urgency: 'High', urgencyOf })).toBeNull();
  });

  it('respects the earliest start, the window bounds and blackouts', () => {
    expect(takeoverCandidate(thursday, { earliest: at('2026-11-05T11:00'), holds, urgency: 'Critical', urgencyOf })?.orderId).toBe('B');
    expect(takeoverCandidate(thursday, { earliest: at('2026-11-05T17:00'), holds, urgency: 'Critical', urgencyOf })).toBeNull();
    expect(takeoverCandidate(windowsFrom([{ date: '2026-11-05', start: '10:00', end: '11:00' }], []), { earliest, holds, urgency: 'Critical', urgencyOf })).toBeNull();
    // A and B overlap the blackout; D is High, equal to the asker, so nothing is left for a High order.
    expect(takeoverCandidate(thursday, { earliest, holds, urgency: 'High', urgencyOf, blocked: [{ start: iso('2026-11-05T11:00'), end: iso('2026-11-05T13:00') }] })).toBeNull();
  });
});

describe('blackout windows (AC-3.1, AC-3.7 of 005)', () => {
  const simNow = at('2026-11-04T10:00');
  const spanOf = (slots: { start: string; end: string }[]) => slots.map((slot) => [slot.start, slot.end]);

  it('a date alone is the whole day; a date with times is that range', () => {
    expect(spanOf(blackoutWindows([{ date: '2026-11-05' }], simNow))).toEqual([['2026-11-05T00:00:00+01:00', '2026-11-06T00:00:00+01:00']]);
    expect(spanOf(blackoutWindows([{ date: '2026-11-05', start: '14:00', end: '18:00' }], simNow))).toEqual([['2026-11-05T14:00:00+01:00', '2026-11-05T18:00:00+01:00']]);
    expect(spanOf(blackoutWindows([{ date: '2026-11-05', start: '18:00' }], simNow))).toEqual([['2026-11-05T18:00:00+01:00', '2026-11-06T00:00:00+01:00']]);
    expect(spanOf(blackoutWindows([{ date: '2026-11-05', end: '12:00' }], simNow))).toEqual([['2026-11-05T00:00:00+01:00', '2026-11-05T12:00:00+01:00']]);
  });

  it('a weekday without a date is the next occurrence from the reference time, the same day included, and only that one (AC-3.7)', () => {
    expect(spanOf(blackoutWindows([{ weekday: 'thursday' }], simNow))).toEqual([['2026-11-05T00:00:00+01:00', '2026-11-06T00:00:00+01:00']]);
    expect(spanOf(blackoutWindows([{ weekday: 'wednesday' }], simNow))).toEqual([['2026-11-04T00:00:00+01:00', '2026-11-05T00:00:00+01:00']]);
    expect(spanOf(blackoutWindows([{ weekday: 'tuesday' }], simNow))).toEqual([['2026-11-10T00:00:00+01:00', '2026-11-11T00:00:00+01:00']]);
    expect(spanOf(blackoutWindows([{ weekday: 'friday', start: '09:00', end: '13:00' }], simNow))).toEqual([['2026-11-06T09:00:00+01:00', '2026-11-06T13:00:00+01:00']]);
  });

  it('ignores exclusions with neither date nor weekday and unreadable dates', () => {
    expect(blackoutWindows([{ start: '09:00', end: '13:00' }, { date: '2026-13-40' }], simNow)).toEqual([]);
  });

  it('carries the offsets across 2026-10-25 (TIME-1)', () => {
    expect(spanOf(blackoutWindows([{ date: '2026-10-25' }], at('2026-10-24T20:00')))).toEqual([['2026-10-25T00:00:00+02:00', '2026-10-26T00:00:00+01:00']]);
  });
});

describe('constraint windows of an order (AC-1.2 of 009, TIME-1)', () => {
  const now = at('2026-11-04T10:00');
  const spans = (slots: { start: string; end: string }[]) => slots.map((slot) => [slot.start, slot.end]);

  it('a date is that whole day; a weekday is its next occurrence; a dated range is that range', () => {
    expect(spans(constraintWindows([{ date: '2026-11-05' }], now))).toEqual([['2026-11-05T00:00:00+01:00', '2026-11-06T00:00:00+01:00']]);
    expect(spans(constraintWindows([{ weekday: 'wednesday' }], now))).toEqual([['2026-11-04T00:00:00+01:00', '2026-11-05T00:00:00+01:00']]);
    expect(spans(constraintWindows([{ date: '2026-11-05', start: '09:00', end: '13:00' }], now))).toEqual([['2026-11-05T09:00:00+01:00', '2026-11-05T13:00:00+01:00']]);
  });

  it('undated times repeat on each of the next 14 days, with the offset of each day across the DST change', () => {
    const windows = constraintWindows([{ end: '13:00' }], at('2026-10-24T10:00'));
    expect(windows).toHaveLength(14);
    expect(windows[0]).toEqual({ start: '2026-10-24T00:00:00+02:00', end: '2026-10-24T13:00:00+02:00' });
    expect(windows[1]).toEqual({ start: '2026-10-25T00:00:00+02:00', end: '2026-10-25T13:00:00+01:00' });
    expect(windows[13]).toEqual({ start: '2026-11-06T00:00:00+01:00', end: '2026-11-06T13:00:00+01:00' });
  });

  it('a time with no end is the 2-hour visit at that time, not the rest of the day; a blackout keeps reading it as "from" (AC-1.2 of 009)', () => {
    // "Hoy a las 12 no puedo" comes back as { start: 12:00 } with no end: it rules out the noon visit only.
    expect(spans(constraintWindows([{ date: '2026-11-04', start: '12:00' }], now))).toEqual([['2026-11-04T12:00:00+01:00', '2026-11-04T14:00:00+01:00']]);
    expect(constraintWindows([{ start: '12:00' }], now)[0]).toEqual({ start: '2026-11-04T12:00:00+01:00', end: '2026-11-04T14:00:00+01:00' });
    expect(blackoutWindows([{ date: '2026-11-04', start: '12:00' }], now)).toEqual([{ start: '2026-11-04T12:00:00+01:00', end: '2026-11-05T00:00:00+01:00' }]);
  });

  it('an exclusion with neither day nor times constrains nothing', () => {
    expect(constraintWindows([{}], now)).toEqual([]);
  });
});

describe('nearest slot on the stated day (AC-3.1, AC-3.2 of 009)', () => {
  const earliest = at('2026-11-04T12:00');
  it('a point that cannot fit gets the closest slot that day inside 07:00–22:00', () => {
    expect(nearestOnDate([{ date: '2026-11-04', start: '21:30' }], { earliest, holds: [] })).toEqual({ start: '2026-11-04T20:00:00+01:00', end: '2026-11-04T22:00:00+01:00' });
    // 21:00 cannot fit either: 20:00 starts 60 minutes away, 19:00 120, so 20:00 wins.
    expect(nearestOnDate([{ date: '2026-11-04', start: '21:00' }], { earliest, holds: [] })).toEqual({ start: '2026-11-04T20:00:00+01:00', end: '2026-11-04T22:00:00+01:00' });
  });

  it('skips held and blocked slots and prefers the earlier of two equally close slots', () => {
    const holds = [hold('OTHER', '2026-11-04T15:00', '2026-11-04T17:00')];
    expect(nearestOnDate([{ date: '2026-11-04', start: '15:00', end: '17:00' }], { earliest, holds })).toEqual({ start: '2026-11-04T13:00:00+01:00', end: '2026-11-04T15:00:00+01:00' });
    const blocked = [{ start: iso('2026-11-04T12:00'), end: iso('2026-11-04T15:00') }];
    expect(nearestOnDate([{ date: '2026-11-04', start: '15:00', end: '17:00' }], { earliest, holds, blocked })).toEqual({ start: '2026-11-04T17:00:00+01:00', end: '2026-11-04T19:00:00+01:00' });
  });

  it('is null when the stated day has no free slot, or is in the past', () => {
    const full = [hold('OTHER', '2026-11-04T07:00', '2026-11-04T22:00')];
    expect(nearestOnDate([{ date: '2026-11-04', start: '21:30' }], { earliest, holds: full })).toBeNull();
    expect(nearestOnDate([{ date: '2026-11-02', start: '10:00' }], { earliest, holds: [] })).toBeNull();
  });
});
