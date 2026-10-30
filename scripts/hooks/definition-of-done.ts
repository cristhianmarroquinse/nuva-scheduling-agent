// Stop: when code, tests, scripts, specs or config changed, runs `pnpm check` and refuses to finish while it is red.
// It blocks once per stop sequence (stop_hook_active), so a persistent failure is reported instead of looping.

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { describeFailure, needsCheck, parsePayload, porcelainPaths } from './lib.js';

const payload = parsePayload<{ stop_hook_active: boolean }>(readFileSync(0, 'utf8'));
if (payload.stop_hook_active) process.exit(0);

const cwd = process.env.CLAUDE_PROJECT_DIR ?? process.cwd();

let status: string;
try {
  status = execFileSync('git', ['status', '--porcelain'], { cwd, stdio: 'pipe' }).toString();
} catch {
  process.exit(0); // not a git repository: nothing to compare, do not block
}
if (!needsCheck(porcelainPaths(status))) process.exit(0);

try {
  execFileSync('pnpm', ['-s', 'check'], { cwd, stdio: 'pipe' });
} catch (error) {
  process.stderr.write(
    `pnpm check is red, so the task is not done. Fix it, or explain why it cannot be fixed now.\n${describeFailure(error).slice(-4000)}\n`,
  );
  process.exit(2);
}
