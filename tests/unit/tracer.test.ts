import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createTracer } from '../../src/trace/tracer.js';

// AC-7.1: every trace line is JSON with timestamp, work_order_id, event_type and detail, in a file under the traces dir.

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'tracer-'));
  dirs.push(dir);
  return dir;
}

describe('tracer (AC-7.1)', () => {
  it('writes one JSON line per call with the four fields, timestamped by the injected clock in Madrid', () => {
    const dir = tempDir();
    const tracer = createTracer({ dir: join(dir, 'traces'), now: () => new Date('2026-10-24T16:00:00Z') });
    tracer.trace({ work_order_id: null, event_type: 'run_started', detail: { sim_now: 'x' } });
    tracer.trace({ work_order_id: 'WO-1', event_type: 'state_change', detail: { to: 'closed' } });

    const files = readdirSync(join(dir, 'traces'));
    expect(files).toHaveLength(1);
    const lines = readFileSync(tracer.path, 'utf8').split('\n');
    expect(lines.at(-1)).toBe('');
    expect(lines.slice(0, -1).map((line) => JSON.parse(line))).toEqual([
      { timestamp: '2026-10-24T18:00:00+02:00', work_order_id: null, event_type: 'run_started', detail: { sim_now: 'x' } },
      { timestamp: '2026-10-24T18:00:00+02:00', work_order_id: 'WO-1', event_type: 'state_change', detail: { to: 'closed' } },
    ]);
  });

  it('never throws on a detail that cannot be serialised, and still writes the four fields', () => {
    const dir = tempDir();
    const tracer = createTracer({ dir, now: () => new Date('2026-10-26T08:00:00Z') });
    const circular: Record<string, unknown> = {};
    circular['self'] = circular;
    expect(() => tracer.trace({ work_order_id: null, event_type: 'odd', detail: circular })).not.toThrow();
    const [line] = readFileSync(tracer.path, 'utf8').split('\n');
    const parsed = JSON.parse(line ?? '') as Record<string, unknown>;
    expect(Object.keys(parsed).sort()).toEqual(['detail', 'event_type', 'timestamp', 'work_order_id']);
    expect(parsed['timestamp']).toBe('2026-10-26T09:00:00+01:00');
  });
});
