# NNN · Tasks: [Feature name]

Format: `- [ ] T### [P?] [US#] Description (file path)`. `[P]` = can run in parallel (different files, no dependency on an unfinished task).

## Phase 1 · Foundations

- [ ] T001 …

## Phase 2 · US1 (P1)

Tests first; each must fail before its implementation task.

- [ ] T010 [US1] Test: … (tests/…)
- [ ] T011 [US1] Implement: … (src/…)

## Phase 3 · US2 (P2)

- [ ] T020 …

## Phase 4 · Polish

- [ ] T090 Remove covered invariants from `specs/coverage-baseline.json`
- [ ] T091 `pnpm check` green

## Dependencies

- …
