import { describe, expect, it } from 'vitest';
import { scenarioFailures, scenarioRun, stdoutBlocks } from './runner.js';

// Protocol-visible behaviour of feature 012: a request for a person, a strong complaint or abuse hands the order to the
// office (REQ-NG-14).

const SPAWN_TIMEOUT = 20_000;

async function run(name: string) {
  const { scenario, output } = await scenarioRun(name);
  expect(scenarioFailures(scenario, output)).toEqual([]);
  return { output, frames: stdoutBlocks(output.stdout) };
}

describe('US1 · asking for a person hands the order to a human', () => {
  it('012-tenant-asks-for-person: the tenant is told the office will contact them, the order closes as escalated, the handyman never sees the words (AC-1.1, AC-1.2, AC-1.3, LLM-2, ORD-1)', async () => {
    const { output, frames } = await run('012-tenant-asks-for-person');
    expect(frames.some((frame) => frame.startsWith('WOID:WO-1|ROLE:tenant') && frame.includes('someone will contact you'))).toBe(true);
    expect(output.stdout).not.toContain('robot');
  }, SPAWN_TIMEOUT);

  it('012-handyman-escalates: the handyman gets the Spanish acknowledgement and the order closes (AC-1.2, COM-1)', async () => {
    const { frames } = await run('012-handyman-escalates');
    expect(frames.some((frame) => frame.startsWith('WOID:WO-1|ROLE:handyman') && frame.includes('Paso tu mensaje a la oficina'))).toBe(true);
  }, SPAWN_TIMEOUT);

  it('012-question-not-escalated: a question about the visit is answered and the order stays open (AC-1.4)', async () => {
    await run('012-question-not-escalated');
  }, SPAWN_TIMEOUT);
});
