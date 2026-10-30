// Tenant language inference (REQ-IN-4, AC-2.1–AC-2.3). Deterministic stopword and diacritic score; no model call.

import type { Language } from '../core/state.js';

export interface LanguageEvidence {
  es: number;
  en: number;
  /** The stopwords found, in order of appearance (duplicates kept: each occurrence is one point). */
  matches: { es: string[]; en: string[] };
}

// Function words only. Words shared by both languages (`no`, `a`, `me`, `he`) are deliberately absent.
const SPANISH = new Set([
  'el', 'la', 'los', 'las', 'un', 'una', 'unos', 'unas', 'de', 'del', 'al', 'que', 'en', 'y', 'o', 'pero', 'por', 'para', 'con', 'sin',
  'se', 'es', 'está', 'están', 'hay', 'ha', 'han', 'muy', 'más', 'ya', 'también', 'como', 'cuando', 'desde', 'hasta', 'hace',
  'mi', 'mis', 'su', 'sus', 'lo', 'le', 'les', 'nos', 'este', 'esta', 'esto', 'ese', 'esa', 'eso', 'todo', 'toda', 'cada',
  'tengo', 'tiene', 'tenemos', 'puede', 'pueden', 'funciona', 'porque', 'si', 'sí', 'bien', 'mal', 'cierra', 'abre',
]);

const ENGLISH = new Set([
  'the', 'an', 'and', 'or', 'but', 'of', 'to', 'in', 'on', 'at', 'for', 'with', 'from', 'by', 'is', 'are', 'was', 'were', 'be', 'been',
  'has', 'have', 'had', 'does', 'do', 'did', 'not', "doesn't", "don't", "isn't", "won't", "can't", 'cannot', 'it', "it's", 'its',
  'my', 'our', 'your', 'this', 'that', 'these', 'there', 'here', 'when', 'since', 'very', 'also', 'all', 'every', 'some', 'any',
  'please', 'broken', 'working', 'leaking', 'leak', 'water', 'night', 'morning', 'because', 'if', 'so', 'as', 'we', 'you', 'i',
]);

const SPANISH_MARKS = /[áéíóúüñ¿¡]/giu;

function words(text: string): string[] {
  return text.toLowerCase().match(/[\p{L}']+/gu) ?? [];
}

export function inferLanguage(title: string, description: string): { language: Language; evidence: LanguageEvidence } {
  const text = `${title} ${description}`;
  const matches = { es: [] as string[], en: [] as string[] };
  for (const word of words(text)) {
    if (SPANISH.has(word)) matches.es.push(word);
    if (ENGLISH.has(word)) matches.en.push(word);
  }
  const marks = text.match(SPANISH_MARKS)?.length ?? 0;
  const es = matches.es.length + marks;
  const en = matches.en.length;
  return { language: es > en ? 'es' : 'en', evidence: { es, en, matches } };
}
