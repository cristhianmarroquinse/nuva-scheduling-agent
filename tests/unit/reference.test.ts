import { describe, expect, it } from 'vitest';
import { resolveReferenceTime } from '../../src/time/reference.js';
import { parseLocalOrOffset, toIso } from '../../src/time/time.js';

// AC-3.1 (clock or AGENT_NOW), AC-3.2 (stale CSV is a fixture), AC-3.3 (invalid AGENT_NOW), AC-3.4 (offset in force).

const clock = new Date('2026-10-30T10:00:00Z'); // 11:00 in Madrid (+01:00)
const at = (text: string) => parseLocalOrOffset(text)!;

describe('reference time (AC-3.1, AC-3.2, AC-3.3, AC-3.4)', () => {
  it('uses the clock in Madrid when AGENT_NOW is unset and the orders are fresh', () => {
    const result = resolveReferenceTime({ clockNow: clock, agentNow: undefined, reportedAts: [at('2026-10-28T09:00')] });
    expect(result.source).toBe('clock');
    expect(toIso(result.simNow)).toBe('2026-10-30T11:00:00+01:00');
    expect(result.agentNowInvalid).toBeUndefined();
  });

  it('uses the clock when there are no valid orders', () => {
    const result = resolveReferenceTime({ clockNow: clock, agentNow: undefined, reportedAts: [] });
    expect(result).toMatchObject({ source: 'clock' });
  });

  it('uses AGENT_NOW when set, as Madrid wall-clock time without an offset and with the offset in force', () => {
    expect(toIso(resolveReferenceTime({ clockNow: clock, agentNow: '2026-10-24T18:00', reportedAts: [] }).simNow)).toBe('2026-10-24T18:00:00+02:00');
    expect(toIso(resolveReferenceTime({ clockNow: clock, agentNow: '2026-10-26T09:00', reportedAts: [] }).simNow)).toBe('2026-10-26T09:00:00+01:00');
    expect(resolveReferenceTime({ clockNow: clock, agentNow: '2026-10-26T09:00', reportedAts: [] }).source).toBe('agent_now');
  });

  it('uses AGENT_NOW with an offset as that instant in Madrid', () => {
    expect(toIso(resolveReferenceTime({ clockNow: clock, agentNow: '2026-10-26T08:00:00Z', reportedAts: [] }).simNow)).toBe('2026-10-26T09:00:00+01:00');
  });

  it('prefers AGENT_NOW over the fixture rule even when every order is stale', () => {
    const result = resolveReferenceTime({ clockNow: clock, agentNow: '2026-10-26T09:00', reportedAts: [at('2026-01-05T09:00')] });
    expect(result.source).toBe('agent_now');
  });

  it('treats an unparseable AGENT_NOW as unset and reports it', () => {
    const result = resolveReferenceTime({ clockNow: clock, agentNow: 'tomorrow', reportedAts: [at('2026-10-28T09:00')] });
    expect(result.source).toBe('clock');
    expect(result.agentNowInvalid).toBe('tomorrow');
    expect(toIso(result.simNow)).toBe('2026-10-30T11:00:00+01:00');
  });

  it('treats a blank AGENT_NOW as unset without reporting it', () => {
    const result = resolveReferenceTime({ clockNow: clock, agentNow: '  ', reportedAts: [] });
    expect(result).toMatchObject({ source: 'clock' });
    expect(result.agentNowInvalid).toBeUndefined();
  });

  it('uses the latest reported_at when every order is more than 7 days before the clock', () => {
    const result = resolveReferenceTime({ clockNow: clock, agentNow: undefined, reportedAts: [at('2026-10-05T09:00'), at('2026-10-07T18:30'), at('2026-09-30T08:00')] });
    expect(result.source).toBe('fixture');
    expect(toIso(result.simNow)).toBe('2026-10-07T18:30:00+02:00');
  });

  it('does not apply the fixture rule when one order is within 7 days or in the future', () => {
    expect(resolveReferenceTime({ clockNow: clock, agentNow: undefined, reportedAts: [at('2026-01-05T09:00'), at('2026-10-25T09:00')] }).source).toBe('clock');
    expect(resolveReferenceTime({ clockNow: clock, agentNow: undefined, reportedAts: [at('2026-01-05T09:00'), at('2026-11-05T09:00')] }).source).toBe('clock');
  });

  it('treats exactly 7 days as not stale', () => {
    expect(resolveReferenceTime({ clockNow: clock, agentNow: undefined, reportedAts: [at('2026-10-23T11:00')] }).source).toBe('clock');
    expect(resolveReferenceTime({ clockNow: clock, agentNow: undefined, reportedAts: [at('2026-10-23T10:59')] }).source).toBe('fixture');
  });
});
