// Facts: the only events that are inputs to the fold (ADR 0002). Everything else is a projection.

import type { Interpretation } from '../interpreter/schema.js';
import type { Role } from '../io/frames.js';

export type ReferenceSource = 'agent_now' | 'clock' | 'fixture';

/** A CSV record keyed by header column, exactly as read. */
export type RawRow = Record<string, string>;

export type InterpretationSource = 'regex' | 'model' | 'fake';

export type Fact =
  | {
      type: 'run_started';
      /** Reference time, ISO 8601 with the Madrid offset (ADR 0003). */
      sim_now: string;
      source: ReferenceSource;
      clock_now: string;
      agent_now: string | null;
    }
  | { type: 'csv_loaded'; rows: RawRow[] }
  | { type: 'msg_in'; seq: number; raw: string }
  | {
      /** The validated interpretation of the message with `seq` (ADR 0004, LLM-1). */
      type: 'interpretation';
      seq: number;
      woid: string;
      role: Role;
      source: InterpretationSource;
      prompt_version: string;
      result: Interpretation;
    }
  | {
      /** The model failed after the SDK's retries for the message with `seq` (REQ-RB-1). */
      type: 'llm_error';
      seq: number;
      woid: string;
      role: Role;
      message: string;
    }
  | { type: 'eof' };

export type FactType = Fact['type'];

/** Every fact type of ADR 0002, including the ones later features record. Trace lines with any other `event_type` are projections. */
export const FACT_TYPES: readonly string[] = ['run_started', 'csv_loaded', 'msg_in', 'interpretation', 'llm_error', 'eof'];

/** The fact a trace line records, or null when the line is a projection (TRACE-2: replay folds facts only). */
export function factFromTrace(line: { event_type: string; detail: unknown }): Fact | null {
  if (!FACT_TYPES.includes(line.event_type)) return null;
  const detail = line.detail !== null && typeof line.detail === 'object' ? (line.detail as Record<string, unknown>) : {};
  return { type: line.event_type, ...detail } as Fact;
}
