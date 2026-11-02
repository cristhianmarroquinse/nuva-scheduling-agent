# 005 · Tasks: Timeouts, preemption and handyman blackouts

Format: `- [ ] T### [P?] [US#] Description (file path)`. `[P]` = can run in parallel (different files, no dependency on an unfinished task).

## Phase 1 · Foundations

- [ ] T001 Test: `scope` accepted (`this_order`, `all`), defaulted to `this_order`, rejected otherwise; prompt names the scope rule; `PROMPT_VERSION` is `3` (tests/unit/schema.test.ts, tests/unit/prompt.test.ts)
- [ ] T002 Implement: `scope` in both schemas, prompt instruction, version bump; update the pins in tests and scenarios (src/interpreter/schema.ts, src/interpreter/prompt.ts, tests/unit/interpreter.test.ts, tests/scenarios/003-accept-with-range.txt)
- [ ] T003 [P] Test: `nextSlot` and `slotInside` skip `blocked` slots (AC-3.3) (tests/unit/calendar.test.ts, tests/unit/availability.test.ts)
- [ ] T004 [P] Implement: `blocked` in both searches; export `URGENCY_RANK` (src/calendar/calendar.ts, src/policy/availability.ts)
- [ ] T005 [P] Test: `noResponseSentence` and `criticalNoResponseSentence` name the party, the slot and the other party's acceptance (AC-1.4, AC-1.6) (tests/unit/reasons.test.ts)
- [ ] T006 [P] Implement: the two sentences (src/core/reasons.ts)
- [ ] T007 [P] Test: `reminder` in es/en for tenant and handyman restating the slot; re-proposal `note` variants `unavailable`, `preempted`, `blackout` (AC-1.3, AC-2.3, AC-3.2; titles cite COM-1, COM-2, COM-3); migrate the 004 cases to `note: 'unavailable'` (tests/unit/templates.test.ts)
- [ ] T008 [P] Implement: `reminder`, `note` on the re-proposal templates (src/messages/templates.ts)

## Phase 2 · US1 A silent party is reminded once, then the order goes to review (P1)

Tests first; each must fail before its implementation task.

- [ ] T010 [US1] Test: awaited party → count and reminder; not awaited (already accepted) → `timeout_ignored`, nothing sent; second timeout → `no_response` with the sentence naming the party and the other's acceptance, hold released; a real reply resets the count; Critical tenant → immediate review with the handyman's state; Critical handyman → reminder; both silent → one result; timeouts never touch `refusals` (AC-1.1–AC-1.8; titles cite RUN-3, ORD-1, ORD-2) (tests/unit/state.test.ts)
- [ ] T011 [US1] Implement: `timeouts` on `OrderState`, timeout rule in `receiveLine`, reset on interpretation and llm_error (src/core/state.ts)
- [ ] T012 [US1] Scenarios `005-timeout-reminder`, `005-timeout-twice`, `005-timeout-reset`, `005-timeout-not-waiting` (cites RUN-3), `005-timeout-critical-tenant`, `005-timeout-critical-handyman`, `005-timeout-closed` (tests/scenarios/005-*.txt, tests/scenarios/005.test.ts)

## Phase 3 · US2 Higher urgency takes over tentative holds, never scheduled visits (P1)

- [ ] T020 [US2] Test: `takeoverCandidate` returns the earliest tentative hold of strictly lower urgency inside the windows, never equal/higher urgency, never scheduled, never one overlapping another hold or a blackout (AC-2.1, AC-2.2; titles cite SCHED-3, SCHED-4) (tests/unit/availability.test.ts)
- [ ] T021 [US2] Implement: `takeoverCandidate` (src/policy/availability.ts)
- [ ] T022 [US2] Test: counter by a Critical order onto a Low hold takes it over: decision `takeover`, victim released as `preempted`, victim re-proposed to its next free slot with the note and no refusal count, acceptances of the victim forgotten; equal urgency → no-fit; scheduled visit → no-fit and the visit untouched; a victim's re-proposal never takes over in turn; a hostile sequence never releases a scheduled hold (AC-2.1–AC-2.6; titles cite SCHED-3, SCHED-4, ACC-1, SCHED-1) (tests/unit/state.test.ts)
- [ ] T023 [US2] Implement: `reproposeOrder` generalisation with `cause`, `allowTakeover`, `countRefusal`; takeover branch (src/core/state.ts)
- [ ] T024 [US2] Scenarios `005-preempt-counter` (cites SCHED-4), `005-preempt-equal`, `005-preempt-scheduled` (cites SCHED-3) (tests/scenarios/005-*.txt, tests/scenarios/005.test.ts)

## Phase 4 · US3 The handyman's unavailability applies to every order (P1)

- [ ] T030 [US3] Test: `blackoutWindows` for a date (whole day), a date with times, a weekday → next occurrence from the reference time only, across 2026-10-25 (AC-3.1, AC-3.7) (tests/unit/availability.test.ts)
- [ ] T031 [US3] Implement: `blackoutWindows` (src/policy/availability.ts)
- [ ] T032 [US3] Test: a handyman fact with `scope: 'all'` records the blackout, re-proposes every overlapping tentative hold of other orders outside it without counting, keeps and flags a scheduled visit, then handles the current order's own intent avoiding the blackout; later proposals avoid it; `scope: 'this_order'` and tenant facts create none (AC-3.1–AC-3.6; titles cite SCHED-3) (tests/unit/state.test.ts)
- [ ] T033 [US3] Implement: `State.blackouts`, blackout rule, `blocked` passed to every search (src/core/state.ts)
- [ ] T034 [US3] Scenarios `005-blackout-day`, `005-blackout-scheduled` (cites SCHED-3), `005-blackout-this-order`, `005-blackout-weekday`, `005-blackout-dst` (cites TIME-1) (tests/scenarios/005-*.txt, tests/scenarios/005.test.ts)

## Phase 5 · Consolidation

- [ ] T040 Test: across every 005 scenario, no `hold_released` names a scheduled hold, every `takeover` names a strictly lower victim urgency, and no frame follows a timeout from a party that had accepted (SCHED-3, SCHED-4, RUN-3) (tests/scenarios/005.test.ts)
- [ ] T041 [P] Test: replay of `005-preempt-counter` and `005-blackout-day` (TRACE-2) (tests/scenarios/replay.test.ts)

## Phase 6 · Polish

- [ ] T090 Remove RUN-3, SCHED-3, SCHED-4 from `specs/coverage-baseline.json` (it becomes empty)
- [ ] T091 Re-read the spec; confirm every AC has a passing test; set `Status: implemented` (specs/features/005-timeouts-preemption-blackouts/spec.md)
- [ ] T092 `pnpm check` green; confirm no test imports `src/interpreter/anthropic.ts`

## Dependencies

- T004 (`blocked`) precedes T021, T023 and T033.
- T008 (templates) precedes T011 (reminder) and T023 (notes).
- T023 (`reproposeOrder`) precedes T033 (blackout moves reuse it).
- T002 changes `PROMPT_VERSION`; the pins in `tests/unit/interpreter.test.ts` and `003-accept-with-range.txt` are updated in the same task so `pnpm check` stays green.
