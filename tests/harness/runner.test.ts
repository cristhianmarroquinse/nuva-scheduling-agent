import { describe, expect, it } from 'vitest';
import { parseScenario, scenarioFailures, type RunOutput } from '../../tests/scenarios/runner.js';

// The scenario runner's `# stdout results` flag: compare only the result blocks, keep the frame shape check.

const FRAME = 'WOID:WO-1|ROLE:tenant\nHello.\n\n';
const RESULT = 'WOID:WO-1|RESULT:requires_review\nREASON:No reply was received before the end of input.\n\n';

function output(stdout: string): RunOutput {
  return { stdout, stderr: '', code: 0, trace: [], rawTrace: '' };
}

describe('scenario runner stdout expectations', () => {
  // As in the scenario files: the section holds the block and its terminating blank line.
  const resultsOnly = parseScenario('x', `# stdout results\n${RESULT}# exit\n0\n`);
  const exact = parseScenario('y', `# stdout\n${RESULT}# exit\n0\n`);

  it('`# stdout results` matches the result blocks and ignores frames', () => {
    expect(scenarioFailures(resultsOnly, output(FRAME + RESULT))).toEqual([]);
    expect(scenarioFailures(resultsOnly, output(RESULT))).toEqual([]);
  });

  it('`# stdout results` still fails on a different result or a malformed frame', () => {
    expect(scenarioFailures(resultsOnly, output(FRAME))).not.toEqual([]);
    expect(scenarioFailures(resultsOnly, output('WOID:WO-1|ROLE:tenant\n\n\n' + RESULT))).not.toEqual([]);
  });

  it('a plain `# stdout` keeps matching exactly', () => {
    expect(scenarioFailures(exact, output(RESULT))).toEqual([]);
    expect(scenarioFailures(exact, output(FRAME + RESULT))).not.toEqual([]);
  });
});
