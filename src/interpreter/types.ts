// The interpreter seam: the fold asks, the runner answers through an injected interpreter (ADR 0001, ADR 0004).

import type { Slot } from '../calendar/calendar.js';
import type { Role } from '../io/frames.js';
import type { Language } from '../time/format.js';

/** What the fold knows when it asks for an interpretation of a message. */
export interface InterpretRequest {
  woid: string;
  /** `seq` of the `msg_in` fact the reply came in. */
  seq: number;
  /** The sender. */
  role: Role;
  body: string;
  /** The tenant's language; the handyman's is always Spanish. */
  language: Language;
  /** The latest proposal sent to the sender, if any. */
  proposal: { version: number; slot: Slot } | null;
  /** Reference time, ISO 8601 with the Madrid offset. */
  simNow: string;
}

export interface Prompt {
  system: string;
  user: string;
  version: string;
}

/** What a model (or the fake) returns: raw output to be validated, plus call metadata for the trace. */
export interface ModelOutput {
  raw: unknown;
  model: string;
  latencyMs: number;
  tokens: { input: number; output: number };
}

export interface Interpreter {
  /** Rejects when the call fails after the SDK's own retries (REQ-RB-1). */
  interpret(request: InterpretRequest, prompt: Prompt): Promise<ModelOutput>;
}
