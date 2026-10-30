import { describe, expect, it } from 'vitest';
import { inferLanguage } from '../../src/orders/language.js';

// AC-2.1 (Spanish or English from title and description, no model), AC-2.2 (tie → English), AC-2.3 (evidence).

describe('language inference (AC-2.1, AC-2.2, AC-2.3)', () => {
  it('detects Spanish from stopwords', () => {
    const { language, evidence } = inferLanguage('Grifo que gotea', 'El grifo de la cocina gotea toda la noche y no cierra bien.');
    expect(language).toBe('es');
    expect(evidence.es).toBeGreaterThan(evidence.en);
    expect(evidence.matches.es).toEqual(expect.arrayContaining(['que', 'el', 'de', 'la', 'y']));
  });

  it('detects English from stopwords', () => {
    const { language, evidence } = inferLanguage('Leaking tap', 'The kitchen tap drips all night and does not close properly.');
    expect(language).toBe('en');
    expect(evidence.en).toBeGreaterThan(evidence.es);
    expect(evidence.matches.en).toEqual(expect.arrayContaining(['the', 'and', 'not']));
  });

  it('counts diacritics and inverted punctuation as Spanish evidence', () => {
    const { language, evidence } = inferLanguage('Calefacción', 'Caldera rota ¿urgente?');
    expect(language).toBe('es');
    expect(evidence.es).toBeGreaterThan(0);
    expect(evidence.en).toBe(0);
  });

  it('chooses English when there is no evidence at all', () => {
    const { language, evidence } = inferLanguage('Radiator', 'KO');
    expect(language).toBe('en');
    expect(evidence).toEqual({ es: 0, en: 0, matches: { es: [], en: [] } });
  });

  it('chooses English on an exact tie', () => {
    // "the" is English, "el" is Spanish: one point each.
    const { language, evidence } = inferLanguage('Boiler', 'the el');
    expect(evidence.es).toBe(evidence.en);
    expect(language).toBe('en');
  });

  it('ignores case and punctuation when matching words', () => {
    const { language } = inferLanguage('PUERTA', 'LA PUERTA, DEL BAÑO, NO CIERRA.');
    expect(language).toBe('es');
  });

  it('does not match stopwords inside other words', () => {
    // "theatre" and "elbow" contain "the" and "el" but are not stopwords.
    const { evidence } = inferLanguage('theatre elbow', 'ellos another');
    expect(evidence.matches.en).toEqual([]);
    expect(evidence.matches.es).toEqual([]);
  });
});
