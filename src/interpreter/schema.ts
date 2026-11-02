// The closed schema for model output (ADR 0004, LLM-1). Dates and times are Madrid wall clock; code attaches the zone.

import { z } from 'zod';

export const PROMPT_VERSION = '3';
export const ANSWER_PROMPT_VERSION = '1';

export const INTENTS = ['accept', 'decline', 'counter', 'question', 'withdraw', 'cross_reference', 'contradictory', 'unclear'] as const;
export type Intent = (typeof INTENTS)[number];

/** Whether a stated unavailability applies to this order only or to all the handyman's work (REQ-SC-6). */
const SCOPES = ['this_order', 'all'] as const;
export type Scope = (typeof SCOPES)[number];

const WEEKDAYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'] as const;

/** `YYYY-MM-DD` only: an offset, a `Z` or a time inside the date fails (AC-1.6). */
const DATE = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'local date YYYY-MM-DD');
/** `HH:MM` only, 24 h: an offset, a `Z`, seconds or a zone name fails (AC-1.6). */
const TIME = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'local time HH:MM');

/** Stated availability: a date, a point time (`start` only) or a range (`start` and `end`). */
const StatedTime = z.object({ date: DATE, start: TIME.optional(), end: TIME.optional() });
/** Stated exclusion ("not Thursday", "not before 15:00"). */
const Exclusion = z.object({ date: DATE.optional(), weekday: z.enum(WEEKDAYS).optional(), start: TIME.optional(), end: TIME.optional() });

/** What the model must return. Arrays and nullable strings keep the JSON schema simple for structured output. */
export const ModelOutputSchema = z.object({
  intent: z.enum(INTENTS),
  times: z.array(StatedTime).max(10),
  exclusions: z.array(Exclusion).max(10),
  question: z.string().max(300).nullable(),
  cross_reference: z.string().max(100).nullable(),
  quote: z.string().max(200),
  scope: z.enum(SCOPES),
});

/** The validated interpretation that enters the fold. Unknown keys are stripped. */
export const InterpretationSchema = z.object({
  intent: z.enum(INTENTS),
  times: z.array(StatedTime).max(10).default([]),
  exclusions: z.array(Exclusion).max(10).default([]),
  question: z.string().max(300).optional(),
  cross_reference: z.string().max(100).optional(),
  quote: z.string().max(200),
  /** Absent means this order only. */
  scope: z.enum(SCOPES).optional(),
});

export type Interpretation = z.infer<typeof InterpretationSchema>;
export type StatedTimeValue = z.infer<typeof StatedTime>;
export type ExclusionValue = z.infer<typeof Exclusion>;

export type Validation = { ok: true; value: Interpretation } | { ok: false; problem: string };

/** Validates raw model (or fake) output. Null optional strings are treated as absent. */
export function validateInterpretation(raw: unknown): Validation {
  const input = raw !== null && typeof raw === 'object' ? withoutNulls(raw as Record<string, unknown>) : raw;
  const parsed = InterpretationSchema.safeParse(input);
  if (parsed.success) return { ok: true, value: parsed.data };
  const problem = parsed.error.issues.map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`).join('; ');
  return { ok: false, problem };
}

function withoutNulls(record: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(record).filter(([, value]) => value !== null));
}
