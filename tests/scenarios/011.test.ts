import { describe, expect, it } from 'vitest';
import { scenarioFailures, scenarioRun, stdoutBlocks } from './runner.js';

// Protocol-visible behaviour of feature 011: the exact time a party names counts as their acceptance (ACC-1, RUN-3).

const SPAWN_TIMEOUT = 20_000;

async function run(name: string) {
  const { scenario, output } = await scenarioRun(name);
  expect(scenarioFailures(scenario, output)).toEqual([]);
  return { output, frames: stdoutBlocks(output.stdout) };
}

describe('US1 · the party who named the time is not asked again', () => {
  it('011-handyman-names-time: the take-home example "Mañana a las 10:00 puedo" plus one yes from the tenant schedules the visit (AC-1.1, AC-1.2, AC-1.5, ACC-1, ACC-2)', async () => {
    const { frames } = await run('011-handyman-names-time');
    const toHandyman = frames.filter((frame) => frame.startsWith('WOID:WO-1|ROLE:handyman'));
    expect(toHandyman.some((frame) => frame.includes('Anotamos la visita que propones') && frame.includes('Calle Mayor 1'))).toBe(true);
    expect(toHandyman.filter((frame) => frame.includes('¿Te viene bien?'))).toHaveLength(1); // only the initial proposal
  }, SPAWN_TIMEOUT);

  it('011-tenant-names-time-handyman-yes: the tenant is never asked again; the handyman keeps the two-versions confirmation (AC-1.1, AC-1.3; REQ-NG-3)', async () => {
    const { frames } = await run('011-tenant-names-time-handyman-yes');
    expect(frames.filter((frame) => frame.startsWith('WOID:WO-1|ROLE:tenant') && frame.includes('Does that work for you?'))).toHaveLength(1);
  }, SPAWN_TIMEOUT);

  it('011-range-not-acceptance: a wider range leaves the choice to the agent, so both are asked (AC-1.4)', async () => {
    const { output } = await run('011-range-not-acceptance');
    expect(output.stdout).not.toContain('We have noted the visit you suggested');
  }, SPAWN_TIMEOUT);

  it('011-named-time-timeout: the namer is not awaited, so his silence is not counted (AC-1.3, RUN-3)', async () => {
    await run('011-named-time-timeout');
  }, SPAWN_TIMEOUT);
});
