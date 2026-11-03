import { describe, expect, it } from 'vitest';
import { REASON_CODES, REVIEW_SENTENCES, criticalNoResponseSentence, noResponseSentence } from '../../src/core/reasons.js';

// Review sentences for timeouts (REQ-TO-2, REQ-TO-3): one line, naming the party and what is known, never free text.

const slot = { start: '2026-11-04T12:00:00+01:00', end: '2026-11-04T14:00:00+01:00' };

describe('timeout review sentences (AC-1.4, AC-1.6)', () => {
  it('names the silent party, the slot and whether the other party accepted', () => {
    expect(noResponseSentence({ party: 'handyman', slot, otherAccepted: true })).toBe('The handyman did not reply after a reminder; the proposed visit was 2026-11-04T12:00:00+01:00, accepted by the tenant.');
    expect(noResponseSentence({ party: 'tenant', slot, otherAccepted: false })).toBe('The tenant did not reply after a reminder; the proposed visit was 2026-11-04T12:00:00+01:00, not yet accepted by the handyman.');
  });

  it('states what is known for a critical order whose tenant went silent', () => {
    expect(criticalNoResponseSentence({ slot, handymanAccepted: true })).toBe('The tenant of a critical order did not reply; the proposed visit is 2026-11-04T12:00:00+01:00, accepted by the handyman.');
    expect(criticalNoResponseSentence({ slot, handymanAccepted: false })).toBe('The tenant of a critical order did not reply; the proposed visit is 2026-11-04T12:00:00+01:00, not yet accepted by the handyman.');
  });

  it('is always one line', () => {
    for (const sentence of [noResponseSentence({ party: 'tenant', slot, otherAccepted: true }), criticalNoResponseSentence({ slot, handymanAccepted: false })]) expect(sentence).not.toContain('\n');
  });
});

describe('escalation (AC-1.2 of 012)', () => {
  it('has its own reason code and a one-line sentence naming the party', () => {
    expect(REASON_CODES).toContain('escalated');
    expect(REVIEW_SENTENCES.escalated('tenant')).toBe('The tenant asked for a person or complained; the office should contact them.');
  });
});
