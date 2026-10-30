// The only module that touches the process streams (OUT-1, REQ-OUT-4).

import { createInterface } from 'node:readline';

/** Writes protocol text to stdout. Callers pass complete frames or results from `frames.ts`. */
export function writeOutput(text: string): void {
  process.stdout.write(text);
}

/** Resolves once everything written so far has left the process (pipes are asynchronous on some platforms). */
export function flushOutput(): Promise<void> {
  return new Promise((resolve) => {
    process.stdout.write('', () => resolve());
  });
}

/**
 * Replaces `process.stderr.write` so warnings, stray writes and anything else aimed at stderr reach `sink`
 * instead of the terminal (AC-6.5). Write callbacks are still honoured.
 */
export function installStderrRedirect(sink: (text: string) => void): void {
  const redirected: typeof process.stderr.write = (chunk: unknown, ...rest: unknown[]) => {
    sink(typeof chunk === 'string' ? chunk : String(chunk));
    const callback = rest.find((arg): arg is () => void => typeof arg === 'function');
    if (callback) callback();
    return true;
  };
  process.stderr.write = redirected;
}

/**
 * Lines from stdin in arrival order (REQ-IN-8). The iterator is attached synchronously, so lines that arrive
 * while the caller is still starting up or processing an earlier line are buffered, never dropped.
 */
export function stdinLines(): AsyncIterableIterator<string> {
  const reader = createInterface({ input: process.stdin, crlfDelay: Infinity, terminal: false });
  return reader[Symbol.asyncIterator]();
}
