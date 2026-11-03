# 009 · Tasks: Stated constraints are honoured, and notes are true

Format: `- [ ] T### [P?] [US#] Description (file path)`.

## Phase 1 · Pure policy

- [ ] T001 [P] [US1] Test + implement `constraintWindows` (AC-1.2, TIME-1) (tests/unit/availability.test.ts, src/policy/availability.ts)
- [ ] T002 [P] [US3] Test + implement `nearestOnDate` (AC-3.1, AC-3.2) (tests/unit/availability.test.ts, src/policy/availability.ts)
- [ ] T003 [P] [US4] Test + implement overlapping exclusion → mismatch (AC-4.1) (tests/unit/acceptance.test.ts, src/policy/acceptance.ts)
- [ ] T004 [P] [US4] Test + implement "tampoco" fast path (AC-4.4) (tests/unit/fast-path.test.ts, src/interpreter/fast-path.ts)

## Phase 2 · The fold

- [ ] T010 [US1] [US2] [US3] [US4] Tests: constraints recorded and avoided, explicit statement wins, note only with stated times, nearest same day, contradictory with times as counter (tests/unit/state.test.ts)
- [ ] T011 Implement in the fold (src/core/state.ts)
- [ ] T012 Scenarios for every row of the spec table (tests/scenarios/009-*.txt, tests/scenarios/009.test.ts)
- [ ] T013 Update the 004/005 expectations moved by AC-3.1 and AC-2.1; verify only times and notes differ

## Phase 3 · Interpretation

- [ ] T020 [US4] Prompt rules and `PROMPT_VERSION` 4, with its unit test (src/interpreter/prompt.ts, tests/unit/prompt.test.ts)
- [ ] T021 [US4] Golden-set cases; regenerate the report with the real model (eval/golden-set.json, eval/REPORT.md)

## Phase 4 · Delivery and polish

- [ ] T030 Regenerate the committed example if its replay fails (traces/examples/)
- [ ] T031 README: assumptions (constraints, nearest slot, notes), test count
- [ ] T090 `pnpm check` green; spec `Status: implemented`
