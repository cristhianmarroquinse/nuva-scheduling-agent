// The golden set (ADR 0004): labelled replies every interpreter tier is scored against. Pure, except for the file read.

import { readFileSync } from 'node:fs';
import { z } from 'zod';
import { INTENTS, InterpretationSchema, type Interpretation } from '../../src/interpreter/schema.js';

export const MIN_ENTRIES = 40;
export const MIN_PER_INTENT = 3;
export const MIN_HOSTILE = 5;
export const HOSTILE_TAG = 'hostile';

const SlotSchema = z.object({ start: z.string().min(1), end: z.string().min(1) });

/** What the product needs from the reply: the interpretation minus the quote (which is free text). */
const ExpectedSchema = InterpretationSchema.omit({ quote: true });

export const GoldenEntrySchema = z.object({
  id: z.string().min(1),
  language: z.enum(['es', 'en']),
  role: z.enum(['tenant', 'handyman']),
  body: z.string().min(1),
  proposal: z.object({ version: z.number().int().positive(), slot: SlotSchema }),
  /** Reference time, ISO 8601 with the Madrid offset. */
  simNow: z.string().min(1),
  tags: z.array(z.string()),
  expected: ExpectedSchema,
});

export type GoldenEntry = z.infer<typeof GoldenEntrySchema>;
export type Expected = GoldenEntry['expected'];

export function loadGoldenSet(path: string): GoldenEntry[] {
  return z.array(GoldenEntrySchema).parse(JSON.parse(readFileSync(path, 'utf8')));
}

/** Coverage and shape problems of a set (AC-1.1–AC-1.4); an empty list means the set is usable. */
export function checkGoldenSet(entries: readonly GoldenEntry[]): string[] {
  const problems: string[] = [];
  if (entries.length < MIN_ENTRIES) problems.push(`only ${entries.length} entries; at least ${MIN_ENTRIES} are required`);
  for (const language of ['es', 'en'] as const) {
    if (!entries.some((entry) => entry.language === language)) problems.push(`no entries in language ${language}`);
  }
  for (const intent of INTENTS) {
    const count = entries.filter((entry) => entry.expected.intent === intent).length;
    if (count < MIN_PER_INTENT) problems.push(`intent ${intent} has ${count} entries; at least ${MIN_PER_INTENT} are required`);
  }
  const hostile = entries.filter((entry) => entry.tags.includes(HOSTILE_TAG)).length;
  if (hostile < MIN_HOSTILE) problems.push(`only ${hostile} hostile entries; at least ${MIN_HOSTILE} are required`);
  const seen = new Set<string>();
  for (const entry of entries) {
    if (seen.has(entry.id)) problems.push(`duplicate id ${entry.id}`);
    seen.add(entry.id);
    const shape = GoldenEntrySchema.safeParse(entry);
    if (!shape.success) {
      problems.push(`entry ${entry.id}: ${shape.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('; ')}`);
      continue;
    }
    const expectation: Interpretation = { ...entry.expected, quote: 'expected' };
    const validated = InterpretationSchema.safeParse(expectation);
    if (!validated.success) {
      problems.push(`entry ${entry.id}: expectation rejected by the production schema: ${validated.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('; ')}`);
    }
  }
  return problems;
}
