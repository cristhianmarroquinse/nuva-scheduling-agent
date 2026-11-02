import { describe, expect, it } from 'vitest';
import { earliestStart, fitsWindow, nextSlot, overlaps, priorityOrder, type Hold, type Slot } from '../../src/calendar/calendar.js';
import { parseLocalOrOffset, toIso } from '../../src/time/time.js';

// The calendar: one handyman, 2-hour visits on the hour, business windows, no overlap (REQ-SC-1, REQ-SC-2, REQ-SC-3).

const at = (text: string) => parseLocalOrOffset(text)!;
const iso = (text: string) => toIso(at(text));
const hold = (id: string, start: string, end: string): Hold => ({ orderId: id, version: 1, kind: 'tentative', slot: { start: iso(start), end: iso(end) } });

describe('earliest start (AC-2.2, SCHED-5)', () => {
  it('is one hour after the next full hour, and the next full hour is strictly after the reference time', () => {
    expect(toIso(earliestStart(at('2026-10-07T10:00:00'), at('2026-10-01T09:00')))).toBe('2026-10-07T12:00:00+02:00');
    expect(toIso(earliestStart(at('2026-10-07T10:30:00'), at('2026-10-01T09:00')))).toBe('2026-10-07T12:00:00+02:00');
    expect(toIso(earliestStart(at('2026-10-07T18:30:00'), at('2026-10-01T09:00')))).toBe('2026-10-07T20:00:00+02:00');
  });

  it('never precedes reported_at, rounded up to the hour (SCHED-5)', () => {
    expect(toIso(earliestStart(at('2026-10-07T10:00'), at('2026-10-30T14:20')))).toBe('2026-10-30T15:00:00+01:00');
    expect(toIso(earliestStart(at('2026-10-07T10:00'), at('2026-10-30T14:00')))).toBe('2026-10-30T14:00:00+01:00');
  });
});

describe('business windows (AC-2.3, AC-2.4)', () => {
  it('Critical: any day, start and end between 08:00 and 21:00', () => {
    expect(fitsWindow(at('2026-10-25T08:00'), 'Critical')).toBe(true); // Sunday
    expect(fitsWindow(at('2026-10-25T19:00'), 'Critical')).toBe(true); // ends 21:00
    expect(fitsWindow(at('2026-10-25T20:00'), 'Critical')).toBe(false); // ends 22:00
    expect(fitsWindow(at('2026-10-25T07:00'), 'Critical')).toBe(false);
  });

  it('other urgencies: Monday to Friday, start and end between 09:00 and 19:00', () => {
    expect(fitsWindow(at('2026-10-26T09:00'), 'High')).toBe(true); // Monday
    expect(fitsWindow(at('2026-10-26T17:00'), 'Medium')).toBe(true); // ends 19:00
    expect(fitsWindow(at('2026-10-26T18:00'), 'Low')).toBe(false); // ends 20:00
    expect(fitsWindow(at('2026-10-26T08:00'), 'High')).toBe(false);
    expect(fitsWindow(at('2026-10-24T10:00'), 'High')).toBe(false); // Saturday
    expect(fitsWindow(at('2026-10-25T10:00'), 'High')).toBe(false); // Sunday
  });
});

describe('next slot (AC-2.1, AC-2.5, SCHED-1, SCHED-2)', () => {
  const twoHours = (slot: Slot) => at(slot.end).diff(at(slot.start), 'hours').hours;

  it('lasts exactly 2 hours and starts on the hour (SCHED-2)', () => {
    const slot = nextSlot({ from: at('2026-10-07T12:00'), urgency: 'Medium', holds: [] });
    expect(slot).toEqual({ start: '2026-10-07T12:00:00+02:00', end: '2026-10-07T14:00:00+02:00' });
    expect(twoHours(slot)).toBe(2);
  });

  it('skips the weekend for non-Critical orders: Friday 18:30 → Monday 09:00', () => {
    const slot = nextSlot({ from: earliestStart(at('2026-10-30T18:30'), at('2026-10-01')), urgency: 'High', holds: [] });
    expect(slot).toEqual({ start: '2026-11-02T09:00:00+01:00', end: '2026-11-02T11:00:00+01:00' });
  });

  it('uses the next morning, weekend included, for a Critical order late in the day', () => {
    const slot = nextSlot({ from: earliestStart(at('2026-10-30T18:30'), at('2026-10-01')), urgency: 'Critical', holds: [] });
    expect(slot).toEqual({ start: '2026-10-31T08:00:00+01:00', end: '2026-10-31T10:00:00+01:00' });
  });

  it('never overlaps a hold, including partial overlaps (SCHED-1)', () => {
    const holds = [hold('A', '2026-11-02T10:00', '2026-11-02T12:00')];
    expect(nextSlot({ from: at('2026-11-02T09:00'), urgency: 'Low', holds })).toEqual({ start: '2026-11-02T12:00:00+01:00', end: '2026-11-02T14:00:00+01:00' });
    expect(nextSlot({ from: at('2026-11-02T10:00'), urgency: 'Low', holds })).toEqual({ start: '2026-11-02T12:00:00+01:00', end: '2026-11-02T14:00:00+01:00' });
    expect(nextSlot({ from: at('2026-11-02T11:00'), urgency: 'Low', holds })).toEqual({ start: '2026-11-02T12:00:00+01:00', end: '2026-11-02T14:00:00+01:00' });
  });

  it('crosses 2026-10-25 with the right offsets (AC-2.6): Saturday 20:00 +02:00 → Critical Sunday 08:00 +01:00, High Monday 09:00 +01:00', () => {
    const simNow = at('2026-10-24T20:00');
    const reported = at('2026-10-20T09:00');
    expect(toIso(simNow)).toBe('2026-10-24T20:00:00+02:00');
    const critical = nextSlot({ from: earliestStart(simNow, reported), urgency: 'Critical', holds: [] });
    expect(critical).toEqual({ start: '2026-10-25T08:00:00+01:00', end: '2026-10-25T10:00:00+01:00' });
    const high = nextSlot({ from: earliestStart(simNow, reported), urgency: 'High', holds: [{ orderId: 'C', version: 1, kind: 'tentative', slot: critical }] });
    expect(high).toEqual({ start: '2026-10-26T09:00:00+01:00', end: '2026-10-26T11:00:00+01:00' });
  });

  it('spills over following working days: 12 allocations from Monday 09:00 fill 5 + 5 + 2 slots with no overlap (SCHED-1)', () => {
    const holds: Hold[] = [];
    for (let i = 0; i < 12; i += 1) {
      const slot = nextSlot({ from: at('2026-11-02T09:00'), urgency: 'Medium', holds });
      holds.push({ orderId: `O${i}`, version: 1, kind: 'tentative', slot });
    }
    const days = holds.map((h) => h.slot.start.slice(0, 10));
    expect(days.filter((d) => d === '2026-11-02')).toHaveLength(5);
    expect(days.filter((d) => d === '2026-11-03')).toHaveLength(5);
    expect(days.filter((d) => d === '2026-11-04')).toHaveLength(2);
    for (const a of holds) for (const b of holds) if (a !== b) expect(overlaps(a.slot, b.slot)).toBe(false);
  });

  it('overlap is strict: touching slots do not overlap', () => {
    const a: Slot = { start: iso('2026-11-02T09:00'), end: iso('2026-11-02T11:00') };
    const b: Slot = { start: iso('2026-11-02T11:00'), end: iso('2026-11-02T13:00') };
    const c: Slot = { start: iso('2026-11-02T10:00'), end: iso('2026-11-02T12:00') };
    expect(overlaps(a, b)).toBe(false);
    expect(overlaps(a, c)).toBe(true);
    expect(overlaps(c, a)).toBe(true);
  });
});

describe('priority order (AC-1.2)', () => {
  const order = (id: string, urgency: 'Critical' | 'High' | 'Medium' | 'Low', reportedAt: string) => ({ id, urgency, reportedAt: iso(reportedAt) });

  it('sorts Critical, High, Medium, Low; ties by earlier reported_at; identical ties keep input order', () => {
    const sorted = priorityOrder([
      order('L', 'Low', '2026-10-01T09:00'),
      order('M2', 'Medium', '2026-10-03T09:00'),
      order('C', 'Critical', '2026-10-05T09:00'),
      order('M1', 'Medium', '2026-10-02T09:00'),
      order('H-b', 'High', '2026-10-04T09:00'),
      order('H-a', 'High', '2026-10-04T09:00'),
    ]);
    expect(sorted.map((o) => o.id)).toEqual(['C', 'H-b', 'H-a', 'M1', 'M2', 'L']);
  });

  it('compares reported_at as instants, not as text', () => {
    const sorted = priorityOrder([order('later', 'High', '2026-10-04T10:00:00+02:00'), order('earlier', 'High', '2026-10-04T07:00:00Z')]);
    expect(sorted.map((o) => o.id)).toEqual(['earlier', 'later']);
  });
});

describe('scheduled holds (AC-2.7)', () => {
  it('a hold of kind scheduled is avoided by nextSlot like a tentative one', () => {
    const holds: Hold[] = [{ orderId: 'S', version: 1, kind: 'scheduled', slot: { start: iso('2026-11-02T09:00'), end: iso('2026-11-02T11:00') } }];
    expect(nextSlot({ from: at('2026-11-02T09:00'), urgency: 'Low', holds })).toEqual({ start: '2026-11-02T11:00:00+01:00', end: '2026-11-02T13:00:00+01:00' });
  });
});

describe('next slot after a declined one (AC-1.1 of 004)', () => {
  it('starts strictly after the given slot, still inside the window and clear of holds', () => {
    const declined: Slot = { start: iso('2026-11-04T12:00'), end: iso('2026-11-04T14:00') };
    expect(nextSlot({ from: at('2026-11-04T12:00'), urgency: 'Medium', holds: [], after: declined })).toEqual({ start: '2026-11-04T13:00:00+01:00', end: '2026-11-04T15:00:00+01:00' });
    const held = [hold('OTHER', '2026-11-04T13:00', '2026-11-04T15:00')];
    expect(nextSlot({ from: at('2026-11-04T12:00'), urgency: 'Medium', holds: held, after: declined })).toEqual({ start: '2026-11-04T15:00:00+01:00', end: '2026-11-04T17:00:00+01:00' });
    const friday: Slot = { start: iso('2026-11-06T17:00'), end: iso('2026-11-06T19:00') };
    expect(nextSlot({ from: at('2026-11-06T10:00'), urgency: 'High', holds: [], after: friday })).toEqual({ start: '2026-11-09T09:00:00+01:00', end: '2026-11-09T11:00:00+01:00' });
  });

  it('never goes before `from` even when `after` is earlier', () => {
    const old: Slot = { start: iso('2026-11-02T09:00'), end: iso('2026-11-02T11:00') };
    expect(nextSlot({ from: at('2026-11-04T12:00'), urgency: 'Low', holds: [], after: old })).toEqual({ start: '2026-11-04T12:00:00+01:00', end: '2026-11-04T14:00:00+01:00' });
  });
});

describe('blocked slots (AC-3.3 of 005)', () => {
  it('nextSlot skips blackout windows like holds', () => {
    const blocked: Slot[] = [{ start: iso('2026-11-04T12:00'), end: iso('2026-11-04T16:00') }];
    expect(nextSlot({ from: at('2026-11-04T12:00'), urgency: 'Medium', holds: [], blocked })).toEqual({ start: '2026-11-04T16:00:00+01:00', end: '2026-11-04T18:00:00+01:00' });
    expect(nextSlot({ from: at('2026-11-04T12:00'), urgency: 'Medium', holds: [], blocked: [{ start: iso('2026-11-04T00:00'), end: iso('2026-11-05T00:00') }] })).toEqual({ start: '2026-11-05T09:00:00+01:00', end: '2026-11-05T11:00:00+01:00' });
  });
});
