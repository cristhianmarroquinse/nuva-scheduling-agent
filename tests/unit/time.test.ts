import { describe, expect, it } from 'vitest';
import { ZONE, fromDate, parseLocalOrOffset, toIso } from '../../src/time/time.js';

// AC-1.7 and AC-3.4: every datetime is read and written in Europe/Madrid with the offset in force (TIME-1).

describe('time module (AC-1.7, AC-3.4)', () => {
  it('uses Europe/Madrid', () => {
    expect(ZONE).toBe('Europe/Madrid');
  });

  it('reads text without an offset as Madrid wall-clock time, with the offset in force on each side of 2026-10-25', () => {
    expect(toIso(parseLocalOrOffset('2026-10-24T18:00')!)).toBe('2026-10-24T18:00:00+02:00');
    expect(toIso(parseLocalOrOffset('2026-10-26T09:00')!)).toBe('2026-10-26T09:00:00+01:00');
    expect(toIso(parseLocalOrOffset('2026-10-24 18:00')!)).toBe('2026-10-24T18:00:00+02:00');
    expect(toIso(parseLocalOrOffset('2026-10-26 09:00:30')!)).toBe('2026-10-26T09:00:30+01:00');
  });

  it('reads text with an offset as that instant expressed in Madrid', () => {
    expect(toIso(parseLocalOrOffset('2026-10-24T16:00:00Z')!)).toBe('2026-10-24T18:00:00+02:00');
    expect(toIso(parseLocalOrOffset('2026-10-26T08:00:00Z')!)).toBe('2026-10-26T09:00:00+01:00');
    expect(toIso(parseLocalOrOffset('2026-10-26T03:00:00-05:00')!)).toBe('2026-10-26T09:00:00+01:00');
  });

  it('accepts a date without a time and surrounding whitespace', () => {
    expect(toIso(parseLocalOrOffset(' 2026-10-07 ')!)).toBe('2026-10-07T00:00:00+02:00');
  });

  it('returns null for text that is not a datetime', () => {
    expect(parseLocalOrOffset('')).toBeNull();
    expect(parseLocalOrOffset('yesterday')).toBeNull();
    expect(parseLocalOrOffset('2026-13-45')).toBeNull();
    expect(parseLocalOrOffset('07/10/2026')).toBeNull();
  });

  it('expresses a JS Date in Madrid', () => {
    expect(toIso(fromDate(new Date('2026-10-25T00:30:00Z')))).toBe('2026-10-25T02:30:00+02:00');
    expect(toIso(fromDate(new Date('2026-10-25T01:30:00Z')))).toBe('2026-10-25T02:30:00+01:00');
  });
});
