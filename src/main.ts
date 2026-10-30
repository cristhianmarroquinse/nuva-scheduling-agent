// Entry point. Redirects stderr before anything else loads, traces uncaught errors, runs, exits.

import { flushOutput, installStderrRedirect, stdinLines, writeOutput } from './io/streams.js';
import type { TraceEvent } from './trace/tracer.js';

// Until the tracer exists, events are parked here and flushed into the trace file as soon as it opens.
const parked: TraceEvent[] = [];
let report = (event: TraceEvent): void => {
  parked.push(event);
};
const describe = (error: unknown): Record<string, unknown> =>
  error instanceof Error ? { message: error.message, stack: error.stack } : { message: String(error) };

installStderrRedirect((text) => report({ work_order_id: null, event_type: 'stderr', detail: { text } }));
process.on('uncaughtException', (error) => report({ work_order_id: null, event_type: 'uncaught_exception', detail: describe(error) }));
process.on('unhandledRejection', (reason) => report({ work_order_id: null, event_type: 'unhandled_rejection', detail: describe(reason) }));

const { createTracer } = await import('./trace/tracer.js');
const { run } = await import('./runtime/run.js');

const tracer = createTracer({ dir: process.env['TRACES_DIR'] ?? '/app/traces', now: () => new Date() });
report = (event) => tracer.trace(event);
for (const event of parked.splice(0)) report(event);

const code = await run({
  csvPath: process.env['WORK_ORDERS_PATH'] ?? '/app/work_orders.csv',
  agentNow: process.env['AGENT_NOW'],
  clockNow: () => new Date(),
  lines: stdinLines(),
  write: writeOutput,
  tracer,
});
tracer.trace({ work_order_id: null, event_type: 'run_finished', detail: { exit_code: code } });
await flushOutput();
process.exit(code);
