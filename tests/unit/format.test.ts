import { describe, expect, it } from 'vitest';
import { hourMinute, timeRange, weekdayDate } from '../../src/time/format.js';
import { parseLocalOrOffset } from '../../src/time/time.js';

// AC-3.3 and COM-3: dates in messages are absolute, with weekday and time range, in Madrid time, in the frame's language.

const at = (text: string) => parseLocalOrOffset(text)!;

describe('locale formatting of Madrid instants (AC-3.3, COM-3, TIME-1)', () => {
  it('writes the weekday, day, month and year in Spanish and in English', () => {
    expect(weekdayDate(at('2026-11-05T10:00'), 'es')).toBe('jueves 5 de noviembre de 2026');
    expect(weekdayDate(at('2026-11-05T10:00'), 'en')).toBe('Thursday 5 November 2026');
  });

  it('uses the Madrid wall clock on both sides of 2026-10-25 (TIME-1)', () => {
    // 2026-10-24T16:00Z is 18:00 +02:00; 2026-10-26T08:00Z is 09:00 +01:00.
    expect(weekdayDate(at('2026-10-24T16:00:00Z'), 'es')).toBe('sábado 24 de octubre de 2026');
    expect(hourMinute(at('2026-10-24T16:00:00Z'))).toBe('18:00');
    expect(weekdayDate(at('2026-10-26T08:00:00Z'), 'en')).toBe('Monday 26 October 2026');
    expect(hourMinute(at('2026-10-26T08:00:00Z'))).toBe('09:00');
  });

  it('writes the time range in each language', () => {
    expect(timeRange(at('2026-11-05T10:00'), at('2026-11-05T12:00'), 'es')).toBe('de 10:00 a 12:00');
    expect(timeRange(at('2026-11-05T10:00'), at('2026-11-05T12:00'), 'en')).toBe('10:00 to 12:00');
  });

  it('pads hours and minutes to two digits', () => {
    expect(hourMinute(at('2026-11-05T08:05'))).toBe('08:05');
  });
});
