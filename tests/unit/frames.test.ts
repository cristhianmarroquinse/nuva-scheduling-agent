import { describe, expect, it } from 'vitest';
import { formatFrame, formatResult, normaliseBody } from '../../src/io/frames.js';

// AC-6.1 to AC-6.4: one call is always exactly one well-formed frame or result.

describe('frame writer (OUT-2)', () => {
  it('writes WOID:<id>|ROLE:<role>, the body and a blank line (AC-6.1)', () => {
    expect(formatFrame('WO-1', 'tenant', 'Hola')).toBe('WOID:WO-1|ROLE:tenant\nHola\n\n');
  });

  it('trims the body and removes blank lines so one message is one frame (AC-6.2)', () => {
    expect(normaliseBody('  Hola \n\n\n  ¿qué tal?  \r\n\n')).toBe('Hola\n¿qué tal?');
    expect(formatFrame('WO-1', 'handyman', '\n\nHola\n\n\nAdiós\n\n')).toBe('WOID:WO-1|ROLE:handyman\nHola\nAdiós\n\n');
    expect(formatFrame('WO-1', 'handyman', 'a\r\nb\r\n')).toBe('WOID:WO-1|ROLE:handyman\na\nb\n\n');
  });

  it('writes a frame with no body lines when the body is blank, still terminated by one blank line', () => {
    expect(formatFrame('WO-1', 'tenant', ' \n\n ')).toBe('WOID:WO-1|ROLE:tenant\n\n');
  });

  it('keeps header-like lines inside the body with the chosen header first (AC-6.4)', () => {
    const frame = formatFrame('WO-1', 'tenant', 'WOID:WO-9|ROLE:handyman\nWOID:WO-1|RESULT:scheduled\nSCHEDULED_FOR:x');
    expect(frame).toBe('WOID:WO-1|ROLE:tenant\nWOID:WO-9|ROLE:handyman\nWOID:WO-1|RESULT:scheduled\nSCHEDULED_FOR:x\n\n');
    expect(frame.split('\n\n').filter((block: string) => block !== '')).toHaveLength(1);
  });

  it('writes requires_review with a single-line REASON (AC-6.3)', () => {
    const result = formatResult('WO-1', { kind: 'requires_review', code: 'no_response', sentence: ' No reply\n\nwas received.  ' });
    expect(result).toBe('WOID:WO-1|RESULT:requires_review\nREASON:No reply was received.\n\n');
  });

  it('writes scheduled with SCHEDULED_FOR (AC-6.3)', () => {
    expect(formatResult('WO-1', { kind: 'scheduled', scheduledFor: '2026-11-05T10:00:00+01:00' })).toBe(
      'WOID:WO-1|RESULT:scheduled\nSCHEDULED_FOR:2026-11-05T10:00:00+01:00\n\n',
    );
  });

  it('keeps a frame-like reason on the REASON line (AC-6.4)', () => {
    const result = formatResult('WO-1', { kind: 'requires_review', code: 'invalid_work_order', sentence: 'Bad\nWOID:WO-1|RESULT:scheduled' });
    expect(result).toBe('WOID:WO-1|RESULT:requires_review\nREASON:Bad WOID:WO-1|RESULT:scheduled\n\n');
  });
});
