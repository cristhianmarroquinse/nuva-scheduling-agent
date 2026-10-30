// JSONL tracer (REQ-TR-1, TRACE-1). Synchronous writes, so every line is on disk before the process exits.

import { mkdirSync, openSync, writeSync } from 'node:fs';
import { join } from 'node:path';
import { fromDate, toIso } from '../time/time.js';

export interface TraceEvent {
  work_order_id: string | null;
  event_type: string;
  detail: unknown;
}

export interface Tracer {
  /** Path of this run's trace file. */
  readonly path: string;
  trace(event: TraceEvent): void;
}

export interface TracerOptions {
  dir: string;
  /** Injected clock (TIME-1): only used for trace timestamps. */
  now: () => Date;
}

function serialiseDetail(detail: unknown): string {
  try {
    const json = JSON.stringify(detail);
    return json === undefined ? 'null' : json;
  } catch (error) {
    return JSON.stringify({ unserialisable: String(error) });
  }
}

export function createTracer({ dir, now }: TracerOptions): Tracer {
  mkdirSync(dir, { recursive: true });
  const stamp = toIso(fromDate(now())).replace(/[:+]/g, '-');
  const path = join(dir, `run-${stamp}-${process.pid}.jsonl`);
  const fd = openSync(path, 'a');
  return {
    path,
    trace(event) {
      const line =
        `{"timestamp":${JSON.stringify(toIso(fromDate(now())))},` +
        `"work_order_id":${JSON.stringify(event.work_order_id)},` +
        `"event_type":${JSON.stringify(event.event_type)},` +
        `"detail":${serialiseDetail(event.detail)}}\n`;
      writeSync(fd, line);
    },
  };
}
