import { describe, expect, it } from 'vitest';
import {
  affectsTypecheck,
  describeFailure,
  guardEdit,
  needsCheck,
  parsePayload,
  porcelainPaths,
} from '../../scripts/hooks/lib.js';

const ROOT = '/repo';

describe('edit guard hook', () => {
  it('blocks credential files but allows the example file', () => {
    expect(guardEdit({ file_path: '/repo/.env', content: 'X=1' }, ROOT).allow).toBe(false);
    expect(guardEdit({ file_path: '/repo/.env.local', content: 'X=1' }, ROOT).allow).toBe(false);
    expect(guardEdit({ file_path: '/repo/.env.example', content: 'X=' }, ROOT).allow).toBe(true);
  });

  it('blocks console and process streams in src/ for every edit shape', () => {
    expect(guardEdit({ file_path: '/repo/src/a.ts', content: 'console.log(1)' }, ROOT).allow).toBe(false);
    expect(guardEdit({ file_path: '/repo/src/a.ts', new_string: 'process.stderr.write("x")' }, ROOT).allow).toBe(false);
    expect(guardEdit({ file_path: '/repo/src/a.ts', new_string: 'process.stdout.write("x")' }, ROOT).allow).toBe(false);
    expect(guardEdit({ file_path: '/repo/src/a.ts', edits: [{ new_string: 'ok' }, { new_string: 'console .warn()' }] }, ROOT).allow).toBe(false);
  });

  it('lets only the streams module touch process streams, and never console', () => {
    expect(guardEdit({ file_path: '/repo/src/io/streams.ts', content: 'process.stdout.write(frame)' }, ROOT).allow).toBe(true);
    expect(guardEdit({ file_path: '/repo/src/io/streams.ts', content: 'console.log(frame)' }, ROOT).allow).toBe(false);
  });

  it('allows console outside src/ and clean code inside it', () => {
    expect(guardEdit({ file_path: '/repo/scripts/x.ts', content: 'console.log(1)' }, ROOT).allow).toBe(true);
    expect(guardEdit({ file_path: '/repo/src/a.ts', content: 'export const consoleLike = 1;' }, ROOT).allow).toBe(true);
  });
});

describe('typecheck hook', () => {
  it('runs for TypeScript sources and type-affecting config only', () => {
    expect(affectsTypecheck('/repo/src/a.ts')).toBe(true);
    expect(affectsTypecheck('/repo/src/a.mts')).toBe(true);
    expect(affectsTypecheck('/repo/tsconfig.json')).toBe(true);
    expect(affectsTypecheck('/repo/package.json')).toBe(true);
    expect(affectsTypecheck('/repo/README.md')).toBe(false);
  });
});

describe('definition-of-done hook', () => {
  it('runs the check only when code, tests, scripts, specs or config changed', () => {
    expect(needsCheck(['docs/planning/README.md'])).toBe(false);
    expect(needsCheck(['src/main.ts'])).toBe(true);
    expect(needsCheck(['package.json'])).toBe(true);
  });

  it('reads paths from git porcelain output, including renames', () => {
    expect(porcelainPaths(' M src/a.ts\n?? tests/b.test.ts\nR  old.ts -> specs/new.md\n')).toEqual([
      'src/a.ts',
      'tests/b.test.ts',
      'specs/new.md',
    ]);
  });
});

describe('hook robustness', () => {
  it('treats empty or malformed payloads as empty', () => {
    expect(parsePayload('')).toEqual({});
    expect(parsePayload('{not json')).toEqual({});
    expect(parsePayload('{"stop_hook_active":true}')).toEqual({ stop_hook_active: true });
  });

  it('describes a spawn failure even when the child produced no output', () => {
    expect(describeFailure(new Error('spawn pnpm ENOENT'))).toBe('spawn pnpm ENOENT');
    expect(describeFailure({ stdout: Buffer.from('error TS2322'), message: 'x' })).toBe('error TS2322');
  });
});
