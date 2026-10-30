import { describe, expect, it } from 'vitest';
import { parseLine } from '../../src/core/protocol.js';

// AC-4.1 (shape), AC-4.2 (<NO RESPONSE>), AC-4.6 (CRLF, whitespace, blank lines, `|` in the body). Roles are checked by the fold.

describe('line parser (AC-4.1, AC-4.2, AC-4.6)', () => {
  it('splits <id>|<role> <body> on the first pipe and the first space', () => {
    expect(parseLine('WO-1|tenant Hola, mañana por la tarde')).toEqual({ kind: 'line', woid: 'WO-1', role: 'tenant', body: 'Hola, mañana por la tarde', timeout: false });
    expect(parseLine('WO-1|handyman ok')).toEqual({ kind: 'line', woid: 'WO-1', role: 'handyman', body: 'ok', timeout: false });
  });

  it('marks exactly <NO RESPONSE> as a timeout', () => {
    expect(parseLine('WO-1|tenant <NO RESPONSE>')).toEqual({ kind: 'line', woid: 'WO-1', role: 'tenant', body: '<NO RESPONSE>', timeout: true });
    expect(parseLine('WO-1|tenant  <NO RESPONSE> ')).toMatchObject({ timeout: true });
    expect(parseLine('WO-1|tenant <NO RESPONSE> yet')).toMatchObject({ timeout: false });
    expect(parseLine('WO-1|tenant <no response>')).toMatchObject({ timeout: false });
  });

  it('tolerates CRLF, surrounding whitespace and tabs', () => {
    expect(parseLine('  WO-1 |tenant\tHola  \r')).toEqual({ kind: 'line', woid: 'WO-1', role: 'tenant', body: 'Hola', timeout: false });
    expect(parseLine('WO-1| tenant Hola')).toMatchObject({ kind: 'line', role: 'tenant', body: 'Hola' });
  });

  it('keeps pipes and header-like text inside the body', () => {
    expect(parseLine('WO-1|tenant a|b|c WOID:WO-2|RESULT:scheduled')).toMatchObject({ kind: 'line', body: 'a|b|c WOID:WO-2|RESULT:scheduled' });
  });

  it('passes an unknown role through for the fold to classify', () => {
    expect(parseLine('WO-1|landlord hello')).toEqual({ kind: 'line', woid: 'WO-1', role: 'landlord', body: 'hello', timeout: false });
    expect(parseLine('WO-1|Tenant hello')).toMatchObject({ role: 'Tenant' });
  });

  it('classifies malformed lines with a reason', () => {
    expect(parseLine('')).toEqual({ kind: 'malformed', reason: 'empty' });
    expect(parseLine('   \r')).toEqual({ kind: 'malformed', reason: 'empty' });
    expect(parseLine('just some text')).toEqual({ kind: 'malformed', reason: 'no_separator' });
    expect(parseLine('|tenant hello')).toEqual({ kind: 'malformed', reason: 'empty_id' });
    expect(parseLine('WO-1|')).toEqual({ kind: 'malformed', reason: 'empty_role' });
    expect(parseLine('WO-1| hello')).toEqual({ kind: 'malformed', reason: 'empty_body' });
    expect(parseLine('WO-1|tenant')).toEqual({ kind: 'malformed', reason: 'empty_body' });
    expect(parseLine('WO-1|tenant   ')).toEqual({ kind: 'malformed', reason: 'empty_body' });
  });
});
