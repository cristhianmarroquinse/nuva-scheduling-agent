// Wording of Madrid instants for messages (REQ-OUT-3, COM-3): absolute date with weekday, and time ranges, per language.

import type { DateTime } from 'luxon';
import { ZONE } from './time.js';

export type Language = 'es' | 'en';

const LOCALE: Record<Language, string> = { es: 'es-ES', en: 'en-GB' };
const DATE_FORMAT: Record<Language, string> = { es: "cccc d 'de' LLLL 'de' yyyy", en: 'cccc d LLLL yyyy' };

/** "jueves 5 de noviembre de 2026" / "Thursday 5 November 2026", in Madrid local time. */
export function weekdayDate(dt: DateTime, language: Language): string {
  return dt.setZone(ZONE).setLocale(LOCALE[language]).toFormat(DATE_FORMAT[language]);
}

/** "10:00", Madrid local time. */
export function hourMinute(dt: DateTime): string {
  return dt.setZone(ZONE).toFormat('HH:mm');
}

/** "de 10:00 a 12:00" / "10:00 to 12:00". */
export function timeRange(start: DateTime, end: DateTime, language: Language): string {
  return language === 'es' ? `de ${hourMinute(start)} a ${hourMinute(end)}` : `${hourMinute(start)} to ${hourMinute(end)}`;
}
