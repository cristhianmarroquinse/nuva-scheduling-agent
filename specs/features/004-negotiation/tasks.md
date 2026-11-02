# 004 · Tasks: Negotiation

Format: `- [ ] T### [P?] [US#] Description (file path)`. `[P]` = can run in parallel (different files, no dependency on an unfinished task).

## Phase 1 · Foundations

- [x] T001 Implement: `answer` fact shape and `FACT_TYPES` entry (src/core/facts.ts); sentences for `no_mutual_slot` and `cross_reference` (src/core/reasons.ts)
- [x] T002 [P] Test: `nextSlot` with `after` starts strictly after the given slot and still respects windows and holds (AC-1.1) (tests/unit/calendar.test.ts)
- [x] T003 [P] Implement: `after` option in `nextSlot` (src/calendar/calendar.ts)
- [x] T004 [P] Implement: times instruction ("after" → start+end 22:00, "before" → 07:00+end, single time → start only), `PROMPT_VERSION = '2'` (src/interpreter/prompt.ts, src/interpreter/schema.ts); update the prompt and interpreter tests that pin the version (tests/unit/prompt.test.ts, tests/unit/interpreter.test.ts)
- [x] T005 Docs: amendment line in ADR 0002 adding the `answer` fact (docs/adr/0002-event-sourced-core.md)

## Phase 2 · US1 A decline or counter-proposal leads to a new concrete proposal (P1)

Tests first; each must fail before its implementation task.

- [x] T010 [US1] Test: `windowsFrom` (date only, range, point, after/before, clamp 07:00–22:00, exclusions by weekday/date/range) and `slotInside` (earliest bound, past window, holds including scheduled ones, 2026-10-25); titles cite SCHED-1, SCHED-2, SCHED-5 (AC-1.2, AC-1.3, AC-1.4, AC-1.5) (tests/unit/availability.test.ts)
- [x] T011 [US1] Implement: availability module (src/policy/availability.ts)
- [x] T012 [P] [US1] Test: re-proposal templates to tenant (es/en) and handyman with the cancellation sentence, title, weekday date and range, and the optional "not available" note (AC-2.1, AC-1.6; titles cite COM-1, COM-2, COM-3) (tests/unit/templates.test.ts)
- [x] T013 [P] [US1] Implement: `reproposalToTenant`, `reproposalToHandyman` (src/messages/templates.ts)
- [x] T014 [US1] Test: decline → next free slot after the current one; counter with a fitting window → slot inside; counter with no fit → next free slot and note only to that party; mismatched accept → counter; handyman decline/counter → same rules; a re-proposal never takes a slot held by another order (AC-1.1, AC-1.2, AC-1.6, AC-1.7, AC-1.8; title cites SCHED-1) (tests/unit/state.test.ts)
- [x] T015 [US1] Implement: `repropose`, decline and counter rules replacing `deferred` for those intents (src/core/state.ts)

## Phase 3 · US2 Every new proposal cancels the previous one for both parties (P1)

- [x] T020 [US2] Test: a re-proposal releases the old hold (`reproposed`), takes a new one, raises the version, forgets both acceptances, sends tenant then handyman frames, traces the decision with cause and party; both must accept the new version to schedule; bare yes with two unanswered versions → confirmation request, then a yes naming the slot counts; `unanswered` resets on any reply (AC-2.1, AC-2.2, AC-2.3, AC-2.4; titles cite ACC-1, SCHED-1) (tests/unit/state.test.ts)
- [x] T021 [US2] Implement: `unanswered` counters, bare-yes guard, acceptance reset on re-proposal (src/core/state.ts)

## Phase 4 · US3 Three refusals end the order for review (P1)

- [x] T030 [US3] Test: refusals counted per party for decline, counter, mismatched accept, no-fit counter and withdraw; the third closes `no_mutual_slot` with the party named and no new proposal; questions, clarifications and confirmation requests do not count; counts survive re-proposals (AC-3.1, AC-3.2, AC-3.3, AC-3.4; title cites ORD-1) (tests/unit/state.test.ts)
- [x] T031 [US3] Implement: `refusals`, the limit and the review closure (src/core/state.ts)

## Phase 5 · US4 Withdrawals release the slot and start again (P2)

- [x] T040 [US4] Test: withdraw before scheduling forgets the party's acceptance, counts, and re-proposes (inside stated availability when given); withdraw after scheduling is ignored (AC-4.1, AC-4.2; title cites ORD-2) (tests/unit/state.test.ts)
- [x] T041 [US4] Implement: withdraw rule (src/core/state.ts)

## Phase 6 · US5 Questions are answered from known facts, by the model, to the asker only (P1)

- [x] T050 [US5] Test: facts list contents per recipient; prompt places facts and the question as data blocks and excludes the other party's text; validator accepts a plain answer and rejects empty, > 400 chars, multi-paragraph, foreign time, foreign date, the other party's words (AC-5.1, AC-5.3, AC-5.6) (tests/unit/answer.test.ts)
- [x] T051 [US5] Implement: `AnswerRequest`, `Facts`, `buildAnswerPrompt`, `validateAnswer`, `ANSWER_PROMPT_VERSION` (src/interpreter/answer.ts, src/interpreter/schema.ts)
- [x] T052 [US5] Test: `answerQuestion` with a scripted interpreter: ok, invalid, error; one attempt; call traces with purpose `answer` (AC-5.4) (tests/unit/interpreter.test.ts)
- [x] T053 [US5] Implement: `Interpreter.answer`, `answerQuestion`, fake `answer` (JSON `answer` field, `@fail`), adapter `answer` with `messages.create` (src/interpreter/types.ts, src/interpreter/interpreter.ts, src/interpreter/fake.ts, src/interpreter/anthropic.ts)
- [x] T054 [P] [US5] Test: `answerReply` and `officeWillCheck` wording in es/en for tenant and handyman, with the slot reminder (AC-5.2; titles cite COM-1, COM-2) (tests/unit/templates.test.ts)
- [x] T055 [P] [US5] Implement: `answerReply`, `officeWillCheck` (src/messages/templates.ts)
- [x] T056 [US5] Test: a question emits one `answer` request with the facts, the slot and the other party's last body, resets the streak and counts nothing; an `answer` fact sends one frame to the asker only (model text when ok, fixed sentence otherwise); an `answer` for a closed order is ignored (AC-5.2, AC-5.5; titles cite LLM-2, ORD-2) (tests/unit/state.test.ts)
- [x] T057 [US5] Implement: `lastBody` on `msg_in`, question rule, `answer` output kind and fact handling (src/core/state.ts); `answer` effect in the runner with `model_call { purpose: 'answer' }` (src/runtime/run.ts)

## Phase 7 · US6 A reply about another order is clarified, then reviewed (P2)

- [x] T060 [P] [US6] Test: cross-reference clarification wording in es/en restating title and slot (AC-6.1) (tests/unit/templates.test.ts)
- [x] T061 [P] [US6] Implement: `crossReferenceClarification` (src/messages/templates.ts)
- [x] T062 [US6] Test: first cross-reference → clarification; second → `cross_reference`; cross-reference then unclear → `cross_reference`; cross-reference then contradictory → `contradictory_replies` (AC-6.1, AC-6.2, AC-6.3) (tests/unit/state.test.ts)
- [x] T063 [US6] Implement: `crossReference` in the streak and the precedence of review codes (src/core/state.ts)

## Phase 8 · Scenarios and consolidation

- [x] T070 Scenarios `004-decline-reproposes`, `004-counter-range`, `004-counter-point-evening`, `004-counter-date-weekend`, `004-counter-past`, `004-counter-no-fit`, `004-counter-held` (cites SCHED-1), `004-mismatch-accept`, `004-handyman-counter`, `004-counter-dst` (cites TIME-1) (tests/scenarios/004-*.txt, tests/scenarios/004.test.ts)
- [x] T071 Scenarios `004-two-versions-bare-yes`, `004-three-refusals`, `004-limits-per-party`, `004-question-not-counted`, `004-withdraw` (tests/scenarios/004-*.txt, tests/scenarios/004.test.ts)
- [x] T072 Scenarios `004-question-answered` (cites LLM-2), `004-question-answer-rejected`, `004-cross-reference` (tests/scenarios/004-*.txt, tests/scenarios/004.test.ts)
- [x] T073 Test: across every 004 scenario, every `msg_out` whose source is the model goes to the role that asked, every proposal after the first has both frames and a moved hold, and no live holds overlap (LLM-2, SCHED-1) (tests/scenarios/004.test.ts)
- [x] T074 [P] Test: replay of `004-counter-range` and `004-question-answered` (TRACE-2) (tests/scenarios/replay.test.ts)
- [x] T075 Remove `003-deferred-intents` and its test; note in the 003 spec that AC-4.1 is superseded by 004 (tests/scenarios/003-deferred-intents.txt, tests/scenarios/003.test.ts, specs/features/003-interpretation-acceptance/spec.md)
- [x] T076 Regenerate `002-queued-input-first` stdout and loosen its test to "the first six blocks are the initial proposals, every result comes after" (tests/scenarios/002-queued-input-first.txt, tests/scenarios/002.test.ts)

## Phase 9 · Polish

- [x] T090 Remove LLM-2 from `specs/coverage-baseline.json`
- [x] T091 Re-read the spec; confirm every AC has a passing test; set `Status: implemented` (specs/features/004-negotiation/spec.md)
- [x] T092 `pnpm check` green; confirm no test imports `src/interpreter/anthropic.ts`

## Dependencies

- T011 (availability) and T003 (`after`) precede T015 (re-proposal rules).
- T015 precedes T021, T031, T041 (they refine the same rules in `state.ts`).
- T051 and T053 precede T057; T057 precedes T072.
- T075 and T076 happen as soon as T015 and T057 land, since their old expectations fail from then on; `pnpm check` is red for those two scenarios in between.
