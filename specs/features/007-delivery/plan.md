# 007 · Plan: Delivery (Docker image, README, example trace)

**Spec:** [spec.md](spec.md)

## Summary

No product code changes. A build configuration compiles `src/` alone to `dist/`; a two-stage Dockerfile runs typecheck, the whole test suite and the build in the first stage and ships only `dist/`, production dependencies and `package.json` in the second, as the `node` user with Node warnings suppressed. A small script (`pnpm example`) runs the real agent on the inputs under `traces/examples/` and stores the stdout and the trace next to them; the author runs it once with the key. Three text-level tests pin the Dockerfile, the README and the committed example, and the example's facts are replayed in `pnpm test`. The README is rewritten for the delivered product.

## Design

### Files

| File | Purpose |
|---|---|
| `tsconfig.build.json` | Extends `tsconfig.json`: `include: ["src"]`, `rootDir: "src"`, `outDir: "dist"`, `noEmit: false`. Nothing from `tests/`, `eval/` or `scripts/` is compiled (AC-1.7). |
| `package.json` | Scripts `build` (`tsc -p tsconfig.build.json`), `start` (`node dist/main.js`), `example` (`tsx scripts/example.ts`). |
| `Dockerfile` | Stage `build` from `node:22-bookworm-slim` (official image, full ICU): `corepack enable`, `pnpm install --frozen-lockfile`, copy `src tests scripts eval specs/INVARIANTS.md tests/fixtures` and the config files, `pnpm typecheck && pnpm test && pnpm build`, then `pnpm prune --prod`. Stage `runtime` from the same base: `NODE_ENV=production`, `NODE_NO_WARNINGS=1`, copy `package.json`, `node_modules`, `dist` from `build`, `mkdir /app/traces`, `chown node`, `USER node`, `ENTRYPOINT ["node", "dist/main.js"]`. The build stage never sets `ANTHROPIC_API_KEY`; the scenarios select the fake interpreter themselves. |
| `.dockerignore` | Keeps excluding `.env`, `traces/`, `node_modules/`, `dist/`, `.git/`, `.claude/`, `CLAUDE.md`, `docs/`; `specs/` becomes `specs/*` with `!specs/INVARIANTS.md`, because `tests/harness/invariants.test.ts` reads it. `eval/` is needed by `tests/eval/`. |
| `scripts/example.ts` | Spawns `node --import tsx src/main.ts` with `WORK_ORDERS_PATH=traces/examples/work_orders.csv`, `TRACES_DIR` pointing at a temporary directory, `AGENT_NOW` from `traces/examples/env`, stdin from `traces/examples/stdin.txt`, the real interpreter (no `AGENT_INTERPRETER`), the key from the environment. Writes `traces/examples/stdout.txt` and moves the single JSONL file to `traces/examples/run.jsonl`. Refuses to run without `ANTHROPIC_API_KEY`. A developer tool outside `src/`. |
| `traces/examples/` | `work_orders.csv` (four orders: a Critical gas smell in Spanish, a Medium leaking tap in English, a Low squeaky door in Spanish, a High boiler in English), `stdin.txt` (acceptances, a counter, a question, a timeout, a decline then an acceptance), `env` (`AGENT_NOW=2026-11-04T10:00`), `stdout.txt`, `run.jsonl`, `README.md` describing the exchange order by order. |
| `README.md` | Rewritten: status and `v1`; build and run; input and output formats; environment variables and the fixture rule; design in brief with pointers to the feature specs; "Where AI is used and why" with the table from `eval/REPORT.md`; assumptions and trade-offs; known limitations and phase 2; how it was built (pipeline, rules, hooks, `pnpm check`, invariant coverage, features 001–007, test count); pointers. |
| `tests/delivery/dockerfile.test.ts` | Text checks on `Dockerfile` and `.dockerignore` (AC-1.1, AC-1.3, AC-1.4, AC-1.6, AC-1.7). |
| `tests/delivery/readme.test.ts` | Required sections, commands, pointers; the per-tier accuracies quoted in the README equal those in `eval/REPORT.md` (AC-2.1–AC-2.6). |
| `tests/delivery/example-trace.test.ts` | The committed example: four fields per line (TRACE-1); facts replayed with `fold` reproduce `stdout.txt` (TRACE-2); the trace shows an acceptance, a `scheduled` result, a `repropose` with cause `counter`, an `answered` decision, a `remind` decision and a Critical order (AC-3.1, AC-3.3). |

### Why no product change

The agent already reads `/app/work_orders.csv`, writes `/app/traces`, redirects stderr, flushes stdout and exits with its code (001). The container only has to run it under the right user and environment.

### Dependencies

None new.

## Constitution check

| Check | Status |
|---|---|
| Model output only enters as a validated interpretation event (LLM-1) | ✅ Not touched |
| Model text only to the sender, from closed facts (LLM-2) | ✅ Not touched |
| Nothing but protocol on stdout; nothing on stderr (OUT-1) | ✅ `NODE_NO_WARNINGS=1` in the image plus the existing stderr redirect; the example's `stdout.txt` is checked by replay |
| Time through the time module, Europe/Madrid, injected clock (TIME-1) | ✅ The image sets no `TZ`; the product uses Europe/Madrid explicitly. The example run fixes `AGENT_NOW` |
| State derived from facts; no projection fed back as input (ADR 0002) | ✅ The example trace is replayed from its facts in a test |
| Exactly one terminal result per order; nothing after it (ORD-1, ORD-2) | ✅ Not touched |
| No overlap; scheduled visits never move (SCHED-1, SCHED-3) | ✅ Not touched |
| No new dependency or abstraction without a requirement asking for it | ✅ No package; `scripts/example.ts` answers REQ-DL-3 |
| Consistent with every accepted ADR | ✅ ADR 0006 asks the README to report what the harness produced; this feature writes that section |

## Complexity tracking

| Deviation | Why it is needed | Simpler alternative rejected because |
|---|---|---|
| none | | |

## Test plan

| Test | Covers |
|---|---|
| `tests/delivery/dockerfile.test.ts` | AC-1.1 (two stages; typecheck, test and build in the first), AC-1.3 and AC-1.7 (runtime copies only `dist`, `node_modules`, `package.json`; `.dockerignore` excludes `.env`, traces, harness; `tsconfig.build.json` includes `src` only), AC-1.4 (`NODE_NO_WARNINGS=1`, entrypoint `dist/main.js`, `WORKDIR /app`), AC-1.6 (`USER node`, traces directory owned by `node`) |
| `tests/delivery/readme.test.ts` | AC-2.1 (commands, formats, variables, fixture rule), AC-2.2 (design pointers to specs 001–005), AC-2.3 (section title, tier table equal to the report), AC-2.4 (each listed decision named), AC-2.5 (limitations, phase 2, pointers), AC-2.6 (pipeline, `pnpm check`, feature list, test count) |
| `tests/delivery/example-trace.test.ts` | AC-3.1, AC-3.3, **TRACE-1**, **TRACE-2** |
| Manual (author): `docker build -t agent .`, build with a broken test, `docker run` with the example, `docker run --rm --entrypoint ls agent /app` | AC-1.2, AC-1.4, AC-1.5, AC-1.6, AC-1.3 |
| Manual (author, with the key): `pnpm example` | AC-3.2, AC-3.4 |

**Leaving the baseline:** none (empty).

## Risks

- **Build time.** The scenario suite spawns about 90 processes with `tsx`; in Docker it takes a few minutes. Acceptable for a build that doubles as the acceptance gate.
- **Bind-mount permissions on Linux.** The container runs as uid 1000; a host traces directory owned by another uid would not be writable. The README says to create the directory first and offers `--user "$(id -u):$(id -g)"` as the alternative.
- **Example wording drifts.** Regenerating the example with the model changes model-written text; the replay test compares the committed pair, never a fresh run, so the test stays stable and the README says the example is one real run.
- **README numbers drift from the report.** The README test parses both and fails when they differ, so a re-run of the eval forces a README update.
- **Docker is available on the author's machine** (28.1); the manual checks are run there and recorded in the ship message.
