import { describe, expect, it } from 'vitest';
import type { Interpretation } from '../../src/interpreter/schema.js';
import { evaluateAcceptance } from '../../src/policy/acceptance.js';

// Acceptance is decided by code (ADR 0001, REQ-NG-2, REQ-NG-3): an accept counts only if every stated time fits the proposal.

const slot = { start: '2026-11-04T14:00:00+01:00', end: '2026-11-04T16:00:00+01:00' };
const accept = (partial: Partial<Interpretation>): Interpretation => ({ intent: 'accept', times: [], exclusions: [], quote: 'yes', ...partial });

describe('evaluateAcceptance (AC-2.1, AC-2.2, AC-2.3)', () => {
  it('a bare accept is accepted', () => {
    expect(evaluateAcceptance(accept({}), slot)).toBe('accepted');
  });

  it('a stated date must equal the proposal date', () => {
    expect(evaluateAcceptance(accept({ times: [{ date: '2026-11-04' }] }), slot)).toBe('accepted');
    expect(evaluateAcceptance(accept({ times: [{ date: '2026-11-05' }] }), slot)).toBe('mismatch');
  });

  it('a stated range must contain the whole visit', () => {
    expect(evaluateAcceptance(accept({ times: [{ date: '2026-11-04', start: '14:00', end: '18:00' }] }), slot)).toBe('accepted');
    expect(evaluateAcceptance(accept({ times: [{ date: '2026-11-04', start: '12:00', end: '16:00' }] }), slot)).toBe('accepted');
    expect(evaluateAcceptance(accept({ times: [{ date: '2026-11-04', start: '15:00', end: '18:00' }] }), slot)).toBe('mismatch');
    expect(evaluateAcceptance(accept({ times: [{ date: '2026-11-04', start: '10:00', end: '15:00' }] }), slot)).toBe('mismatch');
  });

  it('a stated point time must equal the proposal start', () => {
    expect(evaluateAcceptance(accept({ times: [{ date: '2026-11-04', start: '14:00' }] }), slot)).toBe('accepted');
    expect(evaluateAcceptance(accept({ times: [{ date: '2026-11-04', start: '16:00' }] }), slot)).toBe('mismatch');
  });

  it('every stated time must fit; one mismatch is a mismatch', () => {
    expect(evaluateAcceptance(accept({ times: [{ date: '2026-11-04', start: '14:00' }, { date: '2026-11-06' }] }), slot)).toBe('mismatch');
  });

  it('an accept with an exclusion or constraint needs a one-line confirmation first (AC-2.3)', () => {
    expect(evaluateAcceptance(accept({ exclusions: [{ weekday: 'thursday' }] }), slot)).toBe('needs_confirmation');
    expect(evaluateAcceptance(accept({ exclusions: [{ date: '2026-11-04', end: '15:00' }] }), slot)).toBe('needs_confirmation');
    expect(evaluateAcceptance(accept({ times: [{ date: '2026-11-05' }], exclusions: [{ weekday: 'thursday' }] }), slot)).toBe('mismatch');
  });

  it('compares in Madrid time across the 2026-10-25 change', () => {
    const winter = { start: '2026-10-25T08:00:00+01:00', end: '2026-10-25T10:00:00+01:00' };
    expect(evaluateAcceptance(accept({ times: [{ date: '2026-10-25', start: '08:00' }] }), winter)).toBe('accepted');
    expect(evaluateAcceptance(accept({ times: [{ date: '2026-10-25', start: '07:00' }] }), winter)).toBe('mismatch');
  });
});
