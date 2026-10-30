// PreToolUse (Edit | Write | MultiEdit): blocks edits to credential files and forbidden stream use in src/.
// Exit 2 blocks the tool call and shows stderr to the model. Exit 0 allows it.
// This catches the agent's normal edit path; pnpm check (tests/harness/source-hygiene.test.ts) is the real gate.

import { readFileSync } from 'node:fs';
import { guardEdit, parsePayload, type EditInput } from './lib.js';

const payload = parsePayload<{ tool_input: EditInput }>(readFileSync(0, 'utf8'));
const verdict = guardEdit(payload.tool_input ?? {}, process.env.CLAUDE_PROJECT_DIR ?? process.cwd());

if (!verdict.allow) {
  process.stderr.write(`${verdict.reason}\n`);
  process.exit(2);
}
