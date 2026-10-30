import { describe, expect, it } from 'vitest';
import { parseCsv } from '../../src/orders/csv.js';

// AC-1.2: the header, quoted fields (commas, double quotes, line breaks inside quotes) and any number of rows.

describe('CSV parser (AC-1.2)', () => {
  it('splits plain rows on commas and newlines, ignoring the trailing newline', () => {
    expect(parseCsv('a,b,c\n1,2,3\n')).toEqual([
      ['a', 'b', 'c'],
      ['1', '2', '3'],
    ]);
  });

  it('keeps commas, escaped double quotes and line breaks inside quoted fields', () => {
    expect(parseCsv('id,text\n1,"a, b"\n2,"say ""hi"""\n3,"line one\nline two"\n')).toEqual([
      ['id', 'text'],
      ['1', 'a, b'],
      ['2', 'say "hi"'],
      ['3', 'line one\nline two'],
    ]);
  });

  it('accepts CRLF line endings and a UTF-8 BOM', () => {
    expect(parseCsv('﻿a,b\r\n1,2\r\n')).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ]);
    expect(parseCsv('a,b\r\n1,"x\r\ny"\r\n')).toEqual([
      ['a', 'b'],
      ['1', 'x\r\ny'],
    ]);
  });

  it('keeps empty fields and a last row without a newline', () => {
    expect(parseCsv('a,b,c\n,,\n1,,3')).toEqual([
      ['a', 'b', 'c'],
      ['', '', ''],
      ['1', '', '3'],
    ]);
  });

  it('skips blank lines between records', () => {
    expect(parseCsv('a,b\n\n1,2\n\n')).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ]);
  });

  it('returns no rows for empty text', () => {
    expect(parseCsv('')).toEqual([]);
    expect(parseCsv('\n')).toEqual([]);
  });

  it('does not choke on an unterminated quote: the rest of the text is that field', () => {
    expect(parseCsv('a,b\n1,"open')).toEqual([
      ['a', 'b'],
      ['1', 'open'],
    ]);
  });
});
