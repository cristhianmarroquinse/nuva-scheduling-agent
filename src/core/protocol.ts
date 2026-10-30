// Incoming line syntax: `<work_order_id>|<role> <body>` (REQ-IN-5, REQ-IN-6). Pure. Role validity is the fold's call.

export type MalformedReason = 'empty' | 'no_separator' | 'empty_id' | 'empty_role' | 'empty_body';

export type ParsedLine =
  | { kind: 'line'; woid: string; role: string; body: string; timeout: boolean }
  | { kind: 'malformed'; reason: MalformedReason };

export const NO_RESPONSE = '<NO RESPONSE>';

/** Splits on the first `|` and the first whitespace after it; CR and surrounding whitespace are ignored (AC-4.6). */
export function parseLine(raw: string): ParsedLine {
  const line = raw.trim();
  if (line === '') return { kind: 'malformed', reason: 'empty' };
  const separator = line.indexOf('|');
  if (separator === -1) return { kind: 'malformed', reason: 'no_separator' };
  const woid = line.slice(0, separator).trim();
  if (woid === '') return { kind: 'malformed', reason: 'empty_id' };
  const rest = line.slice(separator + 1).trim();
  if (rest === '') return { kind: 'malformed', reason: 'empty_role' };
  const space = rest.search(/\s/);
  const role = space === -1 ? rest : rest.slice(0, space);
  const body = space === -1 ? '' : rest.slice(space).trim();
  if (body === '') return { kind: 'malformed', reason: 'empty_body' };
  return { kind: 'line', woid, role, body, timeout: body === NO_RESPONSE };
}
