import { describe, expect, it } from 'vitest';
import type { Hold } from '../../src/calendar/calendar.js';
import { slotInside, windowsFrom } from '../../src/policy/availability.js';
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
