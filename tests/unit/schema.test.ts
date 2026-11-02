import { describe, expect, it } from 'vitest';
import { INTENTS, PROMPT_VERSION, validateInterpretation } from '../../src/interpreter/schema.js';

// The closed schema is the only door for model output (LLM-1, ADR 0004). Dates and times are Madrid wall clock, never offsets.

describe('interpretation schema (AC-1.2, AC-1.6, AC-1.9)', () => {
  it('accepts a complete interpretation and keeps every field', () => {
    const result = validateInterpretation({
      intent: 'accept',
      times: [{ date: '2026-11-04', start: '14:00', end: '16:00' }],
      exclusions: [{ weekday: 'thursday' }],
      quote: 'yes, Wednesday afternoon works',
    });
    expect(result).toEqual({
      ok: true,
      value: {
        intent: 'accept',
        times: [{ date: '2026-11-04', start: '14:00', end: '16:00' }],
        exclusions: [{ weekday: 'thursday' }],
        quote: 'yes, Wednesday afternoon works',
      },
    });
  });

  it('defaults times and exclusions to empty and accepts every intent of the closed set', () => {
    for (const intent of INTENTS) {
      const result = validateInterpretation({ intent, quote: 'x' });
      expect(result.ok, intent).toBe(true);
      if (result.ok) expect(result.value).toEqual({ intent, times: [], exclusions: [], quote: 'x' });
    }
    expect(validateInterpretation({ intent: 'scheduled', quote: 'x' }).ok).toBe(false);
  });

  it('rejects an offset, a Z suffix, a zone name or a datetime in time fields (AC-1.6)', () => {
    for (const bad of [
      { date: '2026-11-04', start: '10:00Z' },
      { date: '2026-11-04', start: '10:00+01:00' },
      { date: '2026-11-04', start: '10:00 Europe/Madrid' },
      { date: '2026-11-04T10:00', start: '10:00' },
      { date: '2026-11-04', start: '10:00:00' },
      { date: '04/11/2026', start: '10:00' },
      { date: '2026-11-04', start: '25:00' },
    ]) {
      const result = validateInterpretation({ intent: 'accept', times: [bad], quote: 'x' });
      expect(result.ok, JSON.stringify(bad)).toBe(false);
    }
  });

  it('strips unknown fields so nothing but the schema reaches the fold (AC-1.9, LLM-1)', () => {
    const result = validateInterpretation({ intent: 'accept', quote: 'ok', result: 'scheduled', hold: 'release', state: { status: 'closed' } });
    expect(result).toEqual({ ok: true, value: { intent: 'accept', times: [], exclusions: [], quote: 'ok' } });
  });

  it('rejects non-objects, missing intent, oversized quotes and reports the problem', () => {
    expect(validateInterpretation('yes').ok).toBe(false);
    expect(validateInterpretation(null).ok).toBe(false);
    expect(validateInterpretation({ quote: 'x' }).ok).toBe(false);
    const long = validateInterpretation({ intent: 'accept', quote: 'x'.repeat(201) });
    expect(long.ok).toBe(false);
    if (!long.ok) expect(long.problem).toContain('quote');
  });

  it('has a prompt version', () => {
    expect(PROMPT_VERSION).toMatch(/^\d+$/);
  });
});
