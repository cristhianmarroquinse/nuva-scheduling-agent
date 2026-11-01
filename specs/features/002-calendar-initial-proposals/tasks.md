# 002 · Tasks: Calendar and initial proposals

Format: `- [ ] T### [P?] [US#] Description (file path)`. `[P]` = can run in parallel (different files, no dependency on an unfinished task).

## Phase 1 · Foundations

- [x] T001 Test: `weekdayDate`, `hourMinute`, `timeRange` in es and en, on both sides of 2026-10-25 (`+02:00` and `+01:00` instants); title cites TIME-1 (tests/unit/format.test.ts)
- [x] T002 Implement: locale formatting module (src/time/format.ts)
- [x] T003 [P] Test: `# stdout results` flag compares only result blocks, keeps the frame shape check, and a plain `# stdout` still matches exactly (tests/harness/runner.test.ts)
- [x] T004 [P] Implement: `results` flag in `parseScenario` and `scenarioFailures` (tests/scenarios/runner.ts)

## Phase 2 · US2 Proposed slots respect the calendar rules (P1)

Tests first; each must fail before its implementation task.

- [x] T020 [US2] Test: `earliestStart` (on the hour → +2 h, 18:30 → 20:00, future `reported_at` rounded up), `fitsWindow` for Critical (any day, 08–21) and others (Mon–Fri, 09–19, end inside), `nextSlot` skips the weekend, skips held slots, lasts 2 h and starts on the hour, DST weekend (24–26 Oct 2026), 12 allocations spill over three days (AC-2.1, AC-2.2, AC-2.3, AC-2.4, AC-2.5, AC-2.6); titles cite SCHED-1, SCHED-2, SCHED-5 (tests/unit/calendar.test.ts)
- [x] T021 [US2] Implement: `Slot`, `Hold`, `earliestStart`, `fitsWindow`, `overlaps`, `nextSlot` (src/calendar/calendar.ts)

## Phase 3 · US1 Every order gets a first slot in urgency order (P1)

- [x] T030 [US1] Test: `priorityOrder` sorts Critical, High, Medium, Low; ties by earlier `reported_at`; identical ties keep input order (AC-1.2) (tests/unit/calendar.test.ts)
- [x] T031 [US1] Implement: `priorityOrder` (src/calendar/calendar.ts)
- [x] T032 [US1] Test: `csv_loaded` after `run_started` allocates one hold per open order in priority order with `hold_taken { version: 1, start, end }`, non-overlapping; invalid rows get no hold; `eof` emits `hold_released` before each `no_response` closure and clears `holds`; a folded sequence never holds overlapping slots (AC-1.1, AC-1.3, AC-1.4, AC-1.5, AC-4.3; title cites SCHED-1) (tests/unit/state.test.ts)
- [x] T033 [US1] Implement: `holds` in `State`, `proposal` in `OrderState`, allocation in `loadCsv`, release in `endInput` (src/core/state.ts)

## Phase 4 · US3 Both parties receive the proposal, each in their language (P1)

- [x] T040 [US3] Test: tenant body in es and en with weekday date, range and title; handyman body in Spanish with title, urgency label and address; no description in either; one confirm-or-availability sentence; 112 clause only for Critical tenants, in each language, never for the handyman; multi-line title inlined (AC-3.2–AC-3.7; titles cite COM-1, COM-2, COM-3) (tests/unit/templates.test.ts)
- [x] T041 [US3] Implement: templates (src/messages/templates.ts)
- [x] T042 [US3] Test: `csv_loaded` emits, after the invalid-row results, a tenant frame then a handyman frame per order in allocation order, each with a `msg_out { to, language, version, start, end, body }` trace; a `msg_in` for a proposed order still emits nothing (AC-3.1, AC-3.8, AC-4.2, AC-4.4) (tests/unit/state.test.ts)
- [x] T043 [US3] Implement: frames and `msg_out` in `loadCsv` (src/core/state.ts)
- [x] T044 [US3] Scenarios `002-languages` (cites COM-1, COM-2, COM-3), `002-handyman-frame`, `002-critical-112`, `002-dst-weekend` (cites TIME-1) (tests/scenarios/002-*.txt, tests/scenarios/002.test.ts)
- [x] T045 [US1] Scenarios `002-urgency-order` (cites SCHED-1), `002-invalid-row-no-proposal`, `002-many-orders` (cites SCHED-1) (tests/scenarios/002-*.txt, tests/scenarios/002.test.ts)
- [x] T046 [US3] Test: one `msg_out` per stdout frame, with recipient, language, version and slot, across every 002 scenario (AC-3.8) (tests/scenarios/002.test.ts)

## Phase 5 · US4 Startup frames come first and the run still ends cleanly (P1)

- [x] T050 [US4] Scenario `002-queued-input-first`: lines and EOF written before start; all frames first in allocation order, then `no_response` results; `hold_released` traced (AC-4.1, AC-4.2, AC-4.3, AC-4.4; cites RUN-2) (tests/scenarios/002-queued-input-first.txt, tests/scenarios/002.test.ts)
- [x] T051 [US4] Update 001 scenarios to the startup frames: full expected frames where the reference time is deterministic (`001-quoted-csv`, `001-invalid-rows`, `001-language`, `001-reference-time-stale`), `# stdout results` for every scenario whose CSV uses `${NOW}`; filter result blocks in the hostile-input and trace-shape tests (tests/scenarios/001-*.txt, tests/scenarios/001.test.ts)
- [x] T052 [P] [US4] Test: replay of `002-urgency-order` reproduces holds, frames and results (TRACE-2) (tests/scenarios/replay.test.ts)
- [x] T053 [P] [US4] Test: trace shape over every 002 scenario, reusing the 001 checks (TRACE-1) (tests/scenarios/002.test.ts)

## Phase 6 · Polish

- [x] T090 Remove SCHED-1, SCHED-2, SCHED-5, COM-1, COM-2, COM-3, TIME-1, RUN-2 from `specs/coverage-baseline.json`
- [x] T091 Re-read the spec; confirm every AC has a passing test; set `Status: implemented` (specs/features/002-calendar-initial-proposals/spec.md)
- [x] T092 `pnpm check` green

## Dependencies

- Phase 2 (calendar) precedes Phase 3 (allocation in the fold) because `step` needs `nextSlot`; both stories are P1, so the dependency order is used.
- T033 produces holds and traces only; the stdout frames arrive with T043, after the templates exist. Scenarios (T044–T046, T050) come after T043, because their stdout includes frames.
- T051 is deliberately after T043: the 001 scenarios fail from T043 on and are brought back in T051. `pnpm check` is red between T043 and T051; finish both before stopping.
- T002 (formatting) precedes T041 (templates); T004 (runner flag) precedes T051.
