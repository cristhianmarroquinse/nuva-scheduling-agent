# 008 · Tasks: Re-proposals never overlap a refused slot

Format: `- [ ] T### [P?] [US#] Description (file path)`. `[P]` = can run in parallel (different files, no dependency on an unfinished task).

## Phase 1 · Foundations

- [ ] T001 [P] [US1] Test: refused slots passed as `blocked` are avoided by instant, including across the DST change on Sunday 25 October 2026 (AC-1.2, TIME-1) (tests/unit/calendar.test.ts)
- [ ] T002 [US1] Doc comment: `blocked` covers blackouts and slots refused in the order (src/calendar/calendar.ts)

## Phase 2 · US1 (P1)

Tests first; each must fail before T013.

- [ ] T010 [P] [US1] Test: decline, counter, mismatched acceptance and withdrawal each add the current slot to the order's refused set; preemption and blackout do not (AC-1.1) (tests/unit/state.test.ts)
- [ ] T011 [P] [US1] Test: the fallback avoids every refused slot of the order, not only the last; stated availability may land on a refused slot; a slot refused in one order stays available to another; every new hold lasts 2 hours and overlaps no other live hold (AC-1.2, AC-1.3, AC-1.4, SCHED-1, SCHED-2) (tests/unit/state.test.ts)
- [ ] T012 [P] [US1] Scenarios: `008-decline-no-overlap`, `008-decline-end-of-day`, `008-non-contiguous`, `008-withdraw-no-overlap`, `008-no-fit-counter`, `008-explicit-wins`, `008-per-order`, `008-preempted-avoids-refused`, and their runner with titles citing the ACs and SCHED-1 (tests/scenarios/008-*.txt, tests/scenarios/008.test.ts)
- [ ] T013 [US1] Implement: `OrderState.refused`, appended in `refusal()`, passed with the blackouts as `blocked` to the fallback `nextSlot` in `reproposeOrder()` (AC-1.1–AC-1.4) (src/core/state.ts)
- [ ] T015 [US1] Test: across every 004, 005 and 008 scenario trace, no `repropose` decision chosen by the fallback overlaps a slot refused earlier in the same order (success criterion 1, AC-1.2) (tests/scenarios/008.test.ts)
- [ ] T014 [US1] Update the expectation that encodes the old reading of 004 AC-1.1: v2 14:00–16:00 instead of 13:00–15:00 (tests/scenarios/004-decline-reproposes.txt); run the whole suite and list in the commit any other changed expectation with the AC that changes it

## Phase 3 · Delivery artefacts

- [ ] T020 [US1] Example stdin: `WO-1004|tenant Yes, 15:00 is fine` → `Yes, 16:00 is fine` (traces/examples/stdin.txt)
- [ ] T021 [US1] Regenerate the example with the real model: `pnpm example` (traces/examples/stdout.txt, traces/examples/run.jsonl)
- [ ] T022 [US1] Update the WO-1004 paragraph to match the new trace (traces/examples/README.md)
- [ ] T023 [P] [US1] README: add the decision to "Assumptions and trade-offs" and refresh the test count (README.md)

## Phase 4 · Polish

- [ ] T090 Coverage baseline: nothing to remove (already empty); confirm it did not grow (specs/coverage-baseline.json)
- [ ] T091 `pnpm check` green
- [ ] T092 Re-read spec, plan and tasks; set the spec to `Status: implemented` (specs/features/008-no-overlap-with-refused-slots/spec.md)

## Dependencies

- T013 after T010, T011, T012 (they must fail first).
- T014 after T013; T015 after T014 (it reads the updated 004 scenario).
- T020 → T021 → T022, all after T013 (the example is produced by the new code).
- T023 after T021 (test count and wording reflect the final state).
- T091 after everything; T092 last.
