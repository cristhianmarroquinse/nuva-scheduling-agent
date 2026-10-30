// Protocol frame and result formatting (OUT-2, REQ-OUT-1, REQ-RES-1, REQ-RES-2). Pure.

import type { ReasonCode } from '../core/reasons.js';

export type Role = 'tenant' | 'handyman';

export type Result =
  | { kind: 'requires_review'; code: ReasonCode; sentence: string }
  | { kind: 'scheduled'; scheduledFor: string };

/** Trimmed, no blank lines, LF only: one body is always exactly one frame (AC-6.2). */
export function normaliseBody(text: string): string {
  return text
    .split(/\r?\n|\r/)
    .map((line) => line.trim())
    .filter((line) => line !== '')
    .join('\n');
}

/** Whitespace runs, including line breaks, collapsed to one space (AC-6.3: `REASON` is a single line). */
export function singleLine(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

/** `WOID:<id>|ROLE:<role>`, the body, a blank line. Header-like body lines stay in the body (AC-6.4). */
export function formatFrame(woid: string, role: Role, body: string): string {
  const normalised = normaliseBody(body);
  return normalised === '' ? `WOID:${woid}|ROLE:${role}\n\n` : `WOID:${woid}|ROLE:${role}\n${normalised}\n\n`;
}

export function formatResult(woid: string, result: Result): string {
  if (result.kind === 'scheduled') {
    return `WOID:${woid}|RESULT:scheduled\nSCHEDULED_FOR:${result.scheduledFor}\n\n`;
  }
  return `WOID:${woid}|RESULT:requires_review\nREASON:${singleLine(result.sentence)}\n\n`;
}
