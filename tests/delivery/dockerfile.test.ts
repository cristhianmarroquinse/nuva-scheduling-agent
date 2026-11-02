import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// The delivered image (REQ-DL-1, REQ-DL-4): built only if typecheck and tests pass, shipped with compiled output only.

const dockerfile = (): string => readFileSync('Dockerfile', 'utf8');
const stages = (): { build: string; runtime: string } => {
  const parts = dockerfile().split(/^FROM /m).slice(1); // the first chunk is the header comment
  expect(parts).toHaveLength(2);
  return { build: parts[0]!, runtime: parts[1]! };
};

describe('Dockerfile (AC-1.1, AC-1.3, AC-1.4, AC-1.6, AC-1.7)', () => {
  it('exists at the repository root with a build stage and a runtime stage on an official Node 22 image', () => {
    expect(existsSync('Dockerfile')).toBe(true);
    const { build, runtime } = stages();
    expect(build).toMatch(/^node:22[^\n]* AS build/);
    expect(runtime).toMatch(/^node:22[^\n]* AS runtime/);
  });

  it('runs the typecheck, the whole test suite and the build in the build stage, without a key (AC-1.1)', () => {
    const { build } = stages();
    expect(build).toMatch(/pnpm typecheck && pnpm test && pnpm build/);
    expect(build).toMatch(/pnpm install --frozen-lockfile/);
    expect(build).toMatch(/pnpm prune --prod/);
    expect(dockerfile()).not.toMatch(/ANTHROPIC_API_KEY/);
  });

  it('ships only dist, production node_modules and package.json, as the node user, with Node warnings off (AC-1.3, AC-1.4, AC-1.6)', () => {
    const { runtime } = stages();
    const copies = [...runtime.matchAll(/^COPY --from=build \S+ (\S+)$/gm)].map((match) => match[1]).sort();
    expect(copies).toEqual(['./', './dist', './node_modules']);
    expect(runtime).toMatch(/^COPY --from=build \/app\/package\.json \.\/$/m);
    expect(runtime).not.toMatch(/COPY (src|tests|eval|specs|scripts)/);
    expect(runtime).toMatch(/^ENV [^\n]*NODE_NO_WARNINGS=1/m);
    expect(runtime).toMatch(/^WORKDIR \/app$/m);
    expect(runtime).toMatch(/^USER node$/m);
    expect(runtime).toMatch(/mkdir -p \/app\/traces/);
    expect(runtime).toMatch(/chown[^\n]*node[^\n]*\/app/);
    expect(runtime).toMatch(/^ENTRYPOINT \["node", "dist\/main\.js"\]$/m);
  });

  it('compiles src only and ignores secrets, traces and the harness in the build context (AC-1.3, AC-1.7)', () => {
    const buildConfig = JSON.parse(readFileSync('tsconfig.build.json', 'utf8')) as { include: string[]; compilerOptions: { rootDir: string; outDir: string } };
    expect(buildConfig.include).toEqual(['src']);
    expect(buildConfig.compilerOptions).toMatchObject({ rootDir: 'src', outDir: 'dist' });
    const ignore = readFileSync('.dockerignore', 'utf8').split('\n').map((line) => line.trim());
    for (const entry of ['.env', 'traces/*', '!traces/examples/', 'node_modules/', 'dist/', '.git/', '.claude/', 'CLAUDE.md', 'docs/', 'specs/*', '!specs/INVARIANTS.md']) {
      expect(ignore, entry).toContain(entry);
    }
    for (const needed of ['tests/', 'eval/', 'src/', 'scripts/']) {
      expect(ignore, `${needed} must reach the build stage`).not.toContain(needed);
    }
  });
});
