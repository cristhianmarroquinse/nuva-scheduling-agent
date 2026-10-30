// RFC 4180 CSV parser (REQ-IN-2). Pure; small enough that no dependency is justified.

/**
 * Text → records of fields. Quoted fields may hold commas, `""` escapes and line breaks; CRLF and a leading BOM
 * are accepted; blank lines between records are skipped; an unterminated quote runs to the end of the text.
 */
export function parseCsv(text: string): string[][] {
  const source = text.startsWith('﻿') ? text.slice(1) : text;
  const records: string[][] = [];
  let record: string[] = [];
  let field = '';
  let quoted = false;
  let fieldStarted = false;

  const endRecord = (): void => {
    record.push(field);
    if (record.length > 1 || fieldStarted) records.push(record);
    record = [];
    field = '';
    fieldStarted = false;
  };

  for (let i = 0; i < source.length; i += 1) {
    const char = source[i]!;
    if (quoted) {
      if (char === '"') {
        if (source[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          quoted = false;
        }
      } else {
        field += char;
      }
    } else if (char === '"') {
      quoted = true;
      fieldStarted = true;
    } else if (char === ',') {
      record.push(field);
      field = '';
      fieldStarted = true;
    } else if (char === '\n' || char === '\r') {
      if (char === '\r' && source[i + 1] === '\n') i += 1;
      endRecord();
    } else {
      field += char;
      fieldStarted = true;
    }
  }
  if (record.length > 0 || fieldStarted) endRecord();
  return records;
}
