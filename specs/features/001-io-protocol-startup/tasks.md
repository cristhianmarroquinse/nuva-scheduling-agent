# 001 · Tasks: I/O protocol and startup foundations

Format: `- [ ] T### [P?] [US#] Description (file path)`. `[P]` = can run in parallel (different files, no dependency on an unfinished task).

## Phase 1 · Foundations

- [x] T001 Add `luxon` and `@types/luxon` (package.json)
- [x] T002 Test: Madrid parsing with and without offsets on both sides of 2026-10-25; ISO output with the offset in force (tests/unit/time.test.ts)
- [x] T003 Implement: time module (src/time/time.ts)
- [x] T004 [P] Test: frame shape, body normalisation, header-like lines in bodies, single-line `REASON`, both result shapes; title cites OUT-2 (tests/unit/frames.test.ts)
- [x] T005 [P] Implement: frame writer (src/io/frames.ts)
- [x] T006 [P] Test: tracer writes one JSON line per call with the four fields, to a file under the given dir, with the injected clock (tests/unit/tracer.test.ts)
- [x] T007 [P] Implement: tracer (src/trace/tracer.ts)
- [x] T008 Implement: fact types (src/core/facts.ts) and reason codes and sentences (src/core/reasons.ts)
- [x] T009 Implement: `State`, `step`, `fold`, `allTerminal` for `run_started` only (src/core/state.ts)
- [x] T010 Implement: streams module (stdout writer, stdin line iterator, stderr redirect) (src/io/streams.ts)
- [x] T011 Implement: runner skeleton and entry point with path overrides (src/runtime/run.ts, src/main.ts)
- [x] T012 Implement: scenario file parser and spawned-process runner (tests/scenarios/runner.ts)

## Phase 2 · US1 Orders are loaded and validated (P1)

- [x] T020 [P] [US1] Test: RFC 4180 cases (quotes, `""`, commas and line breaks in quotes, CRLF, BOM, trailing newline) (tests/unit/csv.test.ts)
- [x] T021 [P] [US1] Implement: CSV parser (src/orders/csv.ts)
- [x] T022 [US1] Test: header check; each invalid-row problem; no-id; duplicate keeps the first; ID trimming (tests/unit/validate.test.ts)
- [x] T023 [US1] Implement: `readRows`, `validateRows` (src/orders/validate.ts)
- [x] T024 [US1] Test: `csv_loaded` → `invalid_work_order` results in CSV order, `row_ignored` projections (tests/unit/state.test.ts)
- [x] T025 [US1] Implement: `csv_loaded` in `step` (src/core/state.ts)
- [x] T026 [US1] Scenarios `001-quoted-csv`, `001-invalid-rows`, `001-empty-csv`, `001-csv-unusable` (missing file and wrong header, exit 1), and the CSV-unchanged check (tests/scenarios/, tests/scenarios/001.test.ts)
- [x] T027 [US1] Implement: CSV read and header error path in the runner (src/runtime/run.ts)

## Phase 3 · US2 Each order's tenant language is known (P1)

- [x] T030 [P] [US2] Test: Spanish, English, diacritics only, no evidence → `en`, exact tie → `en`, evidence returned (tests/unit/language.test.ts)
- [x] T031 [P] [US2] Implement: language inference (src/orders/language.ts)
- [x] T032 [US2] Implement: `language_inferred` projection in `csv_loaded` (src/core/state.ts); scenario `001-language` (tests/scenarios/)

## Phase 4 · US3 The reference time is explicit and recorded (P1)

- [x] T040 [P] [US3] Test: `AGENT_NOW` set (with and without offset), invalid, unset fresh, unset stale, stale with one future row; offset in force (tests/unit/reference.test.ts)
- [x] T041 [P] [US3] Implement: reference time resolution (src/time/reference.ts)
- [x] T042 [US3] Implement: `run_started` with `sim_now` and source in the runner (src/runtime/run.ts); scenarios `001-reference-time`, `001-reported-at-zones` (tests/scenarios/)

## Phase 5 · US4 Incoming lines are read safely and in order (P1)

- [x] T050 [P] [US4] Test: valid lines, `<NO RESPONSE>`, malformed shapes, invalid role, CRLF, whitespace, empty line, `|` in body (tests/unit/protocol.test.ts)
- [x] T051 [P] [US4] Implement: line parser (src/core/protocol.ts)
- [x] T052 [US4] Test: `msg_in` classification for message, timeout, unknown order, invalid role, closed order; no stdout output; title cites ORD-2 (tests/unit/state.test.ts)
- [x] T053 [US4] Implement: `msg_in` in `step` (src/core/state.ts)
- [x] T054 [US4] Scenarios `001-bad-lines`, `001-closed-order-line` (cites ORD-2), `001-queue-order` (tests/scenarios/)
- [x] T055 [US4] Implement: serial line loop with `msg_in { seq, raw }` in the runner (src/runtime/run.ts)

## Phase 6 · US5 The run always ends cleanly (P1)

- [x] T060 [US5] Test: `eof` closes open orders in CSV order with `no_response`; second `eof` and lines after closure emit nothing; `allTerminal`; title cites ORD-1 (tests/unit/state.test.ts)
- [x] T061 [US5] Implement: `eof` in `step` (src/core/state.ts)
- [x] T062 [US5] Scenarios `001-eof-closes-all` (cites ORD-1), `001-all-invalid-exits` (stdin left open) (tests/scenarios/)
- [x] T063 [US5] Implement: `eof` and exit-when-all-terminal in the runner (src/runtime/run.ts, src/main.ts)
- [x] T064 [P] [US5] Test: no timers or wall-clock waiting in `src/`, citing REQ-TO-5 (tests/harness/source-hygiene.test.ts)

## Phase 7 · US6 The terminal belongs to the protocol (P1)

- [x] T070 [US6] Scenario `001-clean-streams`: forced warning, stray stderr write and thrown error via a `--import` fixture; stderr empty, stdout only frames/results, errors in traces; title cites OUT-1 (tests/scenarios/, tests/fixtures/noisy.mjs)
- [x] T071 [US6] Implement: early stderr redirect and uncaught-error handlers (src/main.ts, src/io/streams.ts)
- [x] T072 [US6] Hostile-input run: long, binary and frame-like lines plus a hostile CSV; every order gets one result, exit 0; title cites RUN-1 (tests/scenarios/001.test.ts)
- [x] T073 [US6] Implement: per-step error catch with `run_error` (src/runtime/run.ts)

## Phase 8 · US7 The run can be reconstructed from its traces (P1)

- [x] T080 [US7] Test: every trace line of every 001 scenario has the four fields and the required event types; title cites TRACE-1 (tests/scenarios/001.test.ts)
- [x] T081 [US7] Test: replaying the facts of `001-invalid-rows` and `001-bad-lines` traces reproduces their states and results; title cites TRACE-2 (tests/scenarios/replay.test.ts)
- [x] T082 [US7] Implement: fact-type filter for replay (src/core/facts.ts)

## Phase 9 · Polish

- [x] T090 Remove ORD-1, ORD-2, OUT-1, OUT-2, TRACE-1, TRACE-2, RUN-1 from `specs/coverage-baseline.json`
- [x] T091 Re-read the spec; confirm every AC has a passing test; set `Status: implemented` (specs/features/001-io-protocol-startup/spec.md)
- [x] T092 `pnpm check` green

## Dependencies

- T003 before everything that handles dates (T023, T041, T042).
- T008–T012 before any scenario (T026 onwards).
- T021 → T023 → T025; T031 → T032; T041 → T042; T051 → T053.
- Phases 2–6 extend `src/core/state.ts` and `src/runtime/run.ts` in turn, so they run in sequence; their `[P]` pure-module tasks can start as soon as Phase 1 is done.
- T090 after every test that cites those IDs is green.
