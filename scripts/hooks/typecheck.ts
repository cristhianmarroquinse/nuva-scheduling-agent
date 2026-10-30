// PostToolUse (Edit | Write | MultiEdit): typechecks the project after a file that can affect types changes.
// Exit 2 reports the errors to the model so it fixes them before moving on.

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { affectsTypecheck, describeFailure, parsePayload } from './lib.js';

const payload = parsePayload<{ tool_input: { file_path?: string } }>(readFileSync(0, 'utf8'));
if (!affectsTypecheck(payload.tool_input?.file_path ?? '')) process.exit(0);

try {
  execFileSync('pnpm', ['-s', 'typecheck'], { cwd: process.env.CLAUDE_PROJECT_DIR ?? process.cwd(), stdio: 'pipe' });
} catch (error) {
  process.stderr.write(`Typecheck failed:\n${describeFailure(error).slice(0, 4000)}\n`);
  process.exit(2);
}
