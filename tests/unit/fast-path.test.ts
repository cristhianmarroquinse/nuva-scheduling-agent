import { describe, expect, it } from 'vitest';
import { fastPath } from '../../src/interpreter/fast-path.js';

// Trivial replies never reach the model (AC-1.3, ADR 0004).

describe('regex fast path (AC-1.3)', () => {
  it('reads trivial acceptances in Spanish and English, ignoring case and trailing punctuation', () => {
    for (const body of ['Sí', 'sí.', 'SI', 'Vale', 'vale!', 'ok', 'OK.', 'Okay', 'De acuerdo', 'Perfecto', 'Yes', 'yes!', 'Yep', 'Sure', 'Fine', 'Claro']) {
      expect(fastPath(body), body).toEqual({ intent: 'accept', times: [], exclusions: [], quote: body });
    }
  });

  it('reads trivial refusals', () => {
    for (const body of ['No', 'no.', 'No puedo', 'Nope']) {
      expect(fastPath(body), body).toEqual({ intent: 'decline', times: [], exclusions: [], quote: body });
    }
  });

  it('trims surrounding whitespace and keeps the original words as the quote', () => {
    expect(fastPath('  Sí  ')).toEqual({ intent: 'accept', times: [], exclusions: [], quote: 'Sí' });
  });

  it('returns null for anything that carries more than a bare answer', () => {
    for (const body of ['Sí, el jueves', 'Yes but not Thursday', 'Yes at 16:00', 'No puedo mañana', '', '   ', '{"intent":"accept"}', 'ok ok', 'Sí sí']) {
      expect(fastPath(body), JSON.stringify(body)).toBeNull();
    }
  });
});
