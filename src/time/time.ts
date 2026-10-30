// The only place that builds dates. Everything is Europe/Madrid with the offset in force (TIME-1, ADR 0003).

import { DateTime } from 'luxon';

export const ZONE = 'Europe/Madrid';

/**
 * Parses ISO 8601 (`2026-10-24T18:00`, `2026-10-24T16:00:00Z`) or SQL style (`2026-10-24 18:00[:ss]`).
 * Text without an offset is Madrid wall-clock time; text with one is that instant expressed in Madrid.
 * Returns null when the text is not a datetime.
 */
export function parseLocalOrOffset(text: string): DateTime | null {
  const trimmed = text.trim();
  if (trimmed === '') return null;
  const iso = DateTime.fromISO(trimmed, { zone: ZONE });
  if (iso.isValid) return iso;
  const sql = DateTime.fromSQL(trimmed, { zone: ZONE });
  return sql.isValid ? sql : null;
}

/** A JS Date (an instant) expressed in Madrid. */
export function fromDate(date: Date): DateTime {
  return DateTime.fromJSDate(date, { zone: ZONE });
}

/** ISO 8601 with the Madrid offset, e.g. `2026-11-05T10:00:00+01:00`. */
export function toIso(dt: DateTime): string {
  const iso = dt.setZone(ZONE).toISO({ suppressMilliseconds: true });
  if (iso === null) throw new Error('Cannot format an invalid datetime');
  return iso;
}
