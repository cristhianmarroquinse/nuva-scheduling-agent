// Pure decision logic for the Claude Code hooks and the source-hygiene test, kept testable.

export interface EditInput {
  file_path?: string;
  content?: string;
  new_string?: string;
  edits?: { new_string?: string }[];
}

export type Verdict = { allow: true } | { allow: false; reason: string };

/** The only module allowed to touch the process streams (protocol writer and stderr redirection). */
export const STREAMS_MODULE = 'src/io/streams.ts';

const ENV_FILE = /(^|\/)\.env(\.[^/]*)?$/;
const ENV_EXAMPLE = /(^|\/)\.env\.example$/;
const CONSOLE = /\bconsole\s*\./;
const PROCESS_STREAM = /\bprocess\s*\.\s*(stdout|stderr)\b/;

function writtenText(input: EditInput): string {
  return [input.content, input.new_string, ...(input.edits ?? []).map((edit) => edit.new_string)]
    .filter((text): text is string => typeof text === 'string')
    .join('\n');
}

export function relativePath(filePath: string, projectDir: string): string {
  const prefix = projectDir.endsWith('/') ? projectDir : `${projectDir}/`;
  return filePath.startsWith(prefix) ? filePath.slice(prefix.length) : filePath;
}

/** Reasons a piece of src/ code breaks protocol purity (OUT-1). Empty when clean. */
export function sourceViolations(path: string, text: string): string[] {
  if (!path.startsWith('src/')) return [];
  const violations: string[] = [];
  if (CONSOLE.test(text)) {
    violations.push(`${path}: console.* is not allowed in src/, not even in comments; use the tracer (OUT-1).`);
  }
  if (path !== STREAMS_MODULE && PROCESS_STREAM.test(text)) {
    violations.push(`${path}: only ${STREAMS_MODULE} may use process.stdout or process.stderr (OUT-1).`);
  }
  return violations;
}

const TIMER = /\b(setTimeout|setInterval|setImmediate|timers\/promises|Atomics\s*\.\s*wait)\b/;

/** Reasons a piece of src/ code waits on the wall clock (REQ-TO-5). Empty when clean. Checked by the test suite, not the edit hook. */
export function timerViolations(path: string, text: string): string[] {
  if (!path.startsWith('src/')) return [];
  return TIMER.test(text) ? [`${path}: timers and wall-clock waiting are not allowed in src/; timeouts arrive as <NO RESPONSE> (REQ-TO-5).`] : [];
}

export function guardEdit(input: EditInput, projectDir: string): Verdict {
  const path = relativePath(input.file_path ?? '', projectDir);
  if (ENV_FILE.test(path) && !ENV_EXAMPLE.test(path)) {
    return { allow: false, reason: `${path} holds credentials and must not be edited by the agent. Ask the user to change it.` };
  }
  const [violation] = sourceViolations(path, writtenText(input));
  return violation ? { allow: false, reason: violation } : { allow: true };
}

/** Whether an edited file can affect the typecheck. */
export function affectsTypecheck(filePath: string): boolean {
  return /\.(ts|mts|cts|tsx)$/.test(filePath) || /(^|\/)(tsconfig\.json|package\.json)$/.test(filePath);
}

/** Paths whose changes mean the Stop hook must run the full check. */
export function needsCheck(changedPaths: string[]): boolean {
  return changedPaths.some((path) => /^(src|tests|scripts|specs)\/|^(package\.json|tsconfig\.json|vitest\.config\.ts)$/.test(path));
}

/** Paths from `git status --porcelain` output (handles renames). */
export function porcelainPaths(output: string): string[] {
  return output
    .split('\n')
    .filter((line) => line.length > 3)
    .map((line) => line.slice(3).split(' -> ').pop() ?? '');
}

/** Hook payloads arrive on stdin; an empty or malformed payload is treated as empty. */
export function parsePayload<T>(raw: string): Partial<T> {
  try {
    return JSON.parse(raw) as Partial<T>;
  } catch {
    return {};
  }
}

/** Readable description of a failed child process: its output, or the spawn error itself. */
export function describeFailure(error: unknown): string {
  const failure = error as { stdout?: Buffer; stderr?: Buffer; message?: string };
  const output = `${failure.stdout?.toString() ?? ''}${failure.stderr?.toString() ?? ''}`.trim();
  return output || failure.message || String(error);
}
