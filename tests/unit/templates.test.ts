import { describe, expect, it } from 'vitest';
import { acknowledgement, clarification, confirmationRequest, confirmationToHandyman, confirmationToTenant, initialProposalToHandyman, initialProposalToTenant } from '../../src/messages/templates.js';

// First message of every order (REQ-ST-2, REQ-ST-4, REQ-OUT-2, REQ-OUT-3): templates, no model.

const slot = { start: '2026-11-05T10:00:00+01:00', end: '2026-11-05T12:00:00+01:00' };
const title = 'Grifo que gotea';

describe('initial proposal to the tenant (AC-3.2, AC-3.3, AC-3.4, AC-3.6, AC-3.7, COM-2, COM-3)', () => {
  it('is in Spanish for an es order, with weekday date, time range in Madrid time, the title and a confirm-or-availability sentence', () => {
    const body = initialProposalToTenant({ language: 'es', title, slot, critical: false });
    expect(body).toContain('jueves 5 de noviembre de 2026');
    expect(body).toContain('de 10:00 a 12:00');
    expect(body).toContain('hora de Madrid');
    expect(body).toContain(title);
    expect(body).toContain('¿Le viene bien?');
    expect(body).not.toContain('112');
    expect(body).not.toMatch(/Thursday|November/);
  });

  it('is in English for an en order', () => {
    const body = initialProposalToTenant({ language: 'en', title: 'Leaking tap', slot, critical: false });
    expect(body).toContain('Thursday 5 November 2026');
    expect(body).toContain('10:00 to 12:00');
    expect(body).toContain('Madrid time');
    expect(body).toContain('Leaking tap');
    expect(body).toContain('Does that work for you?');
    expect(body).not.toContain('112');
    expect(body).not.toMatch(/jueves|noviembre/);
  });

  it('adds one short 112 clause for a Critical order, in the tenant language (AC-3.7)', () => {
    expect(initialProposalToTenant({ language: 'es', title, slot, critical: true })).toContain('Si hay peligro inmediato, llame al 112.');
    expect(initialProposalToTenant({ language: 'en', title, slot, critical: true })).toContain('If there is immediate danger, call 112.');
    expect(initialProposalToTenant({ language: 'es', title, slot, critical: true }).match(/112/g)).toHaveLength(1);
  });

  it('inlines a multi-line title so the body stays one paragraph', () => {
    const body = initialProposalToTenant({ language: 'en', title: 'Boiler\n\nnot   working', slot, critical: false });
    expect(body).toContain('Boiler not working');
    expect(body).not.toContain('\n');
  });
});

describe('initial proposal to the handyman (AC-3.2, AC-3.3, AC-3.4, AC-3.5, AC-3.6, COM-1, COM-3)', () => {
  const order = { title: 'Leaking tap', address: 'Calle Mayor 1, 2ºB', urgency: 'High' as const, slot, description: 'The tap drips all night.' };

  it('is always in Spanish, with the title, the urgency, the address and the slot', () => {
    const body = initialProposalToHandyman(order);
    expect(body).toContain('Leaking tap');
    expect(body).toContain('Calle Mayor 1, 2ºB');
    expect(body).toContain('urgencia alta');
    expect(body).toContain('jueves 5 de noviembre de 2026');
    expect(body).toContain('de 10:00 a 12:00');
    expect(body).toContain('¿Te viene bien?');
    expect(body).not.toMatch(/Thursday|November|Madrid time/);
  });

  it('names every urgency in Spanish', () => {
    expect(initialProposalToHandyman({ ...order, urgency: 'Critical' })).toContain('urgencia crítica');
    expect(initialProposalToHandyman({ ...order, urgency: 'Medium' })).toContain('urgencia media');
    expect(initialProposalToHandyman({ ...order, urgency: 'Low' })).toContain('urgencia baja');
  });

  it('never carries the description nor the 112 clause (AC-3.5, AC-3.7)', () => {
    const body = initialProposalToHandyman({ ...order, urgency: 'Critical' });
    expect(body).not.toContain('drips');
    expect(body).not.toContain('112');
  });
});

describe('acceptance and clarification messages (AC-2.4, AC-2.6, AC-3.1, COM-1, COM-2, COM-3)', () => {
  it('acknowledges the first acceptance briefly, in the recipient language, saying the other party is awaited (AC-2.4)', () => {
    expect(acknowledgement({ language: 'es', to: 'tenant' })).toMatch(/técnico/);
    expect(acknowledgement({ language: 'en', to: 'tenant' })).toMatch(/handyman/);
    expect(acknowledgement({ language: 'es', to: 'handyman' })).toMatch(/inquilino/);
    for (const body of [acknowledgement({ language: 'es', to: 'tenant' }), acknowledgement({ language: 'en', to: 'tenant' }), acknowledgement({ language: 'es', to: 'handyman' })]) {
      expect(body.length).toBeLessThan(200);
      expect(body).not.toContain('\n');
    }
  });

  it('asks a one-line confirmation of the specific slot (AC-2.3)', () => {
    const es = confirmationRequest({ language: 'es', to: 'tenant', title, slot });
    expect(es).toContain('jueves 5 de noviembre de 2026, de 10:00 a 12:00');
    expect(es).toContain(title);
    expect(es).not.toContain('\n');
    const en = confirmationRequest({ language: 'en', to: 'tenant', title: 'Leaking tap', slot });
    expect(en).toContain('Thursday 5 November 2026, 10:00 to 12:00');
    expect(en).toContain('Leaking tap');
    expect(confirmationRequest({ language: 'es', to: 'handyman', title, slot })).toMatch(/¿te viene bien/);
  });

  it('restates the proposed slot when asking for clarification (AC-3.1)', () => {
    const es = clarification({ language: 'es', to: 'tenant', title, slot });
    expect(es).toContain('jueves 5 de noviembre de 2026, de 10:00 a 12:00');
    expect(es).toMatch(/no hemos entendido/i);
    const en = clarification({ language: 'en', to: 'tenant', title, slot });
    expect(en).toContain('Thursday 5 November 2026, 10:00 to 12:00');
    expect(en).toMatch(/did not understand/i);
    expect(clarification({ language: 'es', to: 'handyman', title, slot })).toMatch(/no he entendido/i);
  });

  it('confirms the visit to the tenant in their language and to the handyman in Spanish, both with title, weekday date and range (AC-2.6, COM-1, COM-2, COM-3)', () => {
    expect(confirmationToTenant({ language: 'es', title, slot })).toContain('Confirmado');
    expect(confirmationToTenant({ language: 'es', title, slot })).toContain('jueves 5 de noviembre de 2026, de 10:00 a 12:00 (hora de Madrid)');
    expect(confirmationToTenant({ language: 'en', title: 'Leaking tap', slot })).toContain('Confirmed');
    expect(confirmationToTenant({ language: 'en', title: 'Leaking tap', slot })).toContain('Thursday 5 November 2026, 10:00 to 12:00 (Madrid time)');
    expect(confirmationToTenant({ language: 'en', title: 'Leaking tap', slot })).toContain('Leaking tap');
    const handyman = confirmationToHandyman({ title: 'Leaking tap', address: 'Calle Mayor 1', slot });
    expect(handyman).toContain('Confirmado');
    expect(handyman).toContain('Leaking tap');
    expect(handyman).toContain('Calle Mayor 1');
    expect(handyman).toContain('jueves 5 de noviembre de 2026, de 10:00 a 12:00 (hora de Madrid)');
    expect(handyman).not.toMatch(/Thursday|Confirmed/);
  });
});
