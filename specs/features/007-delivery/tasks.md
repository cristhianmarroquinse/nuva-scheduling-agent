# 007 · Tasks: Delivery (Docker image, README, example trace)

Format: `- [ ] T### [P?] [US#] Description (file path)`. `[P]` = can run in parallel (different files, no dependency on an unfinished task).

## Phase 1 · Foundations

- [x] T001 Add `tsconfig.build.json` (src only, to dist) and the `build`, `start` and `example` scripts; verify `pnpm build` emits `dist/main.js` that starts (tsconfig.build.json, package.json)

## Phase 2 · US1 The image builds only if the product is correct (P1)

Tests first; each must fail before its implementation task.

- [x] T010 [US1] Test: Dockerfile has two stages; the build stage runs typecheck, test and build; the runtime stage copies only `dist`, `node_modules` and `package.json`, sets `NODE_NO_WARNINGS=1`, `WORKDIR /app`, `USER node` and the entrypoint; `.dockerignore` excludes `.env`, `traces/`, `.claude/`, `docs/` but keeps `specs/INVARIANTS.md`; `tsconfig.build.json` includes `src` only (AC-1.1, AC-1.3, AC-1.4, AC-1.6, AC-1.7) (tests/delivery/dockerfile.test.ts)
- [x] T011 [US1] Implement: `Dockerfile` and the `.dockerignore` changes (Dockerfile, .dockerignore)
- [x] T012 [US1] Manual: `docker build -t agent .` on the clean tree without a key; then break one test, confirm the build fails, restore it (AC-1.2)
- [x] T013 [US1] Manual: `docker run --rm --entrypoint ls agent /app` shows only `dist`, `node_modules`, `package.json`; run the image with the example CSV and stdin, empty stderr, traces in the mount, exit 0 (AC-1.3, AC-1.4, AC-1.5, AC-1.6)

## Phase 3 · US3 One complete run is committed and replays (P1)

- [x] T020 [US3] Write the example inputs: `work_orders.csv` (Critical es, Medium en, Low es, High en), `stdin.txt` (acceptances, a counter, a question, a timeout, a decline then an acceptance), `env` with `AGENT_NOW` (traces/examples/)
- [x] T021 [US3] Implement: `scripts/example.ts`, refusing to run without the key, writing `stdout.txt` and `run.jsonl` (scripts/example.ts)
- [x] T022 [US3] Manual, by the user with `ANTHROPIC_API_KEY`: `pnpm example`; review the exchange (AC-3.2, AC-3.4)
- [x] T023 [US3] Test: the committed trace has the four fields per line, replays to the committed stdout, and shows an acceptance, a scheduled result, a counter re-proposal, an answered question, a reminder and a Critical order (AC-3.1, AC-3.3; title cites TRACE-1, TRACE-2) (tests/delivery/example-trace.test.ts)
- [x] T024 [US3] Write `traces/examples/README.md` describing the exchange order by order (traces/examples/README.md)

## Phase 4 · US2 The README explains how to run it (P1)

- [x] T030 [US2] Test: the README has the status, the commands, the formats, the variables and the fixture rule; the design pointers; the "Where AI is used and why" section whose per-tier accuracies equal `eval/REPORT.md`; every listed assumption; limitations and phase 2; the pipeline, `pnpm check`, the feature list 001–007 and the test count (AC-2.1–AC-2.6) (tests/delivery/readme.test.ts)
- [x] T031 [US2] Write the README (README.md)

## Phase 5 · Polish

- [x] T090 Baseline unchanged (empty); nothing to remove
- [x] T091 Re-read the spec; confirm every AC has a passing test or a recorded manual check; set `Status: implemented` (specs/features/007-delivery/spec.md)
- [x] T092 `pnpm check` green; `docker build` green; tag `v1` after `/ship 007` (by the user)

## Dependencies

- T001 precedes T011 (the Dockerfile runs `pnpm build`).
- T011 precedes T012 and T013; T013 needs the example inputs of T020.
- T020 and T021 precede T022; T022 precedes T023 and T024 (the test and the description need the real run).
- T031 needs the test count after T023 and T030 exist; T030 precedes T031.
