# 003 · Tasks: Interpretation boundary and acceptance

Format: `- [ ] T### [P?] [US#] Description (file path)`. `[P]` = can run in parallel (different files, no dependency on an unfinished task).

## Phase 1 · Foundations

- [x] T001 Add `@anthropic-ai/sdk` and `zod` (package.json)
- [x] T002 Implement: `interpretation` and `llm_error` fact shapes (src/core/facts.ts); review sentences for `contradictory_replies`, `interpretation_failed`, `llm_unavailable` (src/core/reasons.ts)
- [x] T003 [P] Test: a hold of kind `scheduled` is still avoided by `nextSlot` (tests/unit/calendar.test.ts)
- [x] T004 [P] Implement: `Hold.kind` (src/calendar/calendar.ts, src/core/state.ts)
- [x] T005 [P] Implement: the scenario runner sets `AGENT_INTERPRETER=fake` for every spawned run (tests/scenarios/runner.ts)

## Phase 2 · US1 A reply becomes a validated interpretation, never a decision (P1)

Tests first; each must fail before its implementation task.

- [x] T010 [US1] Test: schema accepts valid outputs; rejects offsets, `Z`, zone names, bad dates, oversized quotes; strips unknown fields (AC-1.2, AC-1.6, AC-1.9) (tests/unit/schema.test.ts)
- [x] T011 [US1] Implement: schema, `validateInterpretation`, `PROMPT_VERSION` (src/interpreter/schema.ts)
- [x] T012 [P] [US1] Test: fast path for the closed list in es/en with punctuation and case; null otherwise (AC-1.3) (tests/unit/fast-path.test.ts)
- [x] T013 [P] [US1] Implement: fast path (src/interpreter/fast-path.ts)
- [x] T014 [P] [US1] Test: prompt holds the reply only inside the data block, names the proposal and `sim_now`, excludes other text (AC-1.8) (tests/unit/prompt.test.ts)
- [x] T015 [P] [US1] Implement: prompt builder (src/interpreter/prompt.ts)
- [x] T016 [US1] Test: `interpretReply` with a scripted interpreter: fast path skips the model; valid output → fact with `source: 'model'`; invalid output retried once then `unclear` with the problem; `model_call` lines with model, prompt version, latency, tokens, outcome; a thrown error propagates (AC-1.4, AC-1.5, AC-1.7) (tests/unit/interpreter.test.ts)
- [x] T017 [US1] Implement: `Interpreter` types, `interpretReply` (src/interpreter/interpreter.ts); fake interpreter (src/interpreter/fake.ts)
- [x] T018 [US1] Implement: Anthropic adapter with `messages.parse` and `zodOutputFormat`, model `claude-haiku-5-5` (src/interpreter/anthropic.ts); interpreter selection in the entry point (src/main.ts)
- [x] T019 [US1] Test: `msg_in` with classification `message` on an open order with a proposal emits one `interpret` request; timeouts, closed orders and orders without a proposal emit none; a hostile `interpretation` fact (foreign fields, intent for a closed order) changes nothing beyond the rules (AC-1.1, AC-1.9; title cites LLM-1) (tests/unit/state.test.ts)
- [x] T020 [US1] Implement: `interpret` request output in `receiveLine`; `interpretation` and `llm_error` handling skeleton with `ignored_fact` for closed orders (src/core/state.ts); runner awaits the request and records the fact or the error, tracing `model_call` lines (src/runtime/run.ts)

## Phase 3 · US2 Acceptance is decided by code (P1)

- [x] T030 [US2] Test: `evaluateAcceptance` for date equal, range containing, range not containing, point equal to start, point different, exclusion present (AC-2.1, AC-2.2, AC-2.3) (tests/unit/acceptance.test.ts)
- [x] T031 [US2] Implement: acceptance evaluation (src/policy/acceptance.ts)
- [x] T032 [P] [US2] Test: acknowledgement, confirmation request, confirmations to tenant and handyman in es/en with title, weekday date and range (AC-2.4, AC-2.6; titles cite COM-1, COM-2, COM-3) (tests/unit/templates.test.ts)
- [x] T033 [P] [US2] Implement: the five templates (src/messages/templates.ts)
- [x] T034 [US2] Test: first acceptance → acknowledgement and `accepted` decision; repeated acceptance → `already_accepted`, nothing sent; mismatch → nothing sent; constraint → confirmation request then a bare accept counts; both accept → tenant and handyman confirmations before the `scheduled` result whose `SCHEDULED_FOR` is the hold start; the scheduled hold stays at eof; a different version never schedules (AC-2.4–AC-2.8, AC-4.2; titles cite ACC-1, ACC-2, ACC-3, ORD-1) (tests/unit/state.test.ts)
- [x] T035 [US2] Implement: acceptance rules, confirmations, `scheduled` closure, scheduled hold kept at eof (src/core/state.ts)
- [x] T036 [US2] Scenarios `003-both-accept` (cites ACC-1, ACC-2, ACC-3), `003-accept-with-range`, `003-accept-mismatch`, `003-accept-with-constraint`, `003-accept-twice`, `003-accept-then-eof` (cites ORD-1), `003-scheduled-dst` (cites TIME-1), `003-closed-order-line` (cites ORD-2) (tests/scenarios/003-*.txt, tests/scenarios/003.test.ts)

## Phase 4 · US3 Unclear replies get one chance, then review (P1)

- [x] T040 [US3] Test: clarification template in es/en restates the slot (AC-3.1) (tests/unit/templates.test.ts)
- [x] T041 [US3] Test: first unclear → clarification; second → `interpretation_failed`; `unclear` then `contradictory` → `contradictory_replies`; a clear reply resets the streak; one model failure → clarification, two consecutive → `llm_unavailable`; a valid reply resets the failure count; review reasons traced (AC-3.1–AC-3.5) (tests/unit/state.test.ts)
- [x] T042 [US3] Implement: unclear streaks, model-failure count, review closures with hold release (src/core/state.ts); clarification template (src/messages/templates.ts)
- [x] T043 [US3] Scenarios `003-unclear-twice`, `003-contradictory`, `003-unclear-reset`, `003-model-invalid-output` (cites LLM-1), `003-model-failure` (tests/scenarios/003-*.txt, tests/scenarios/003.test.ts)

## Phase 5 · US4 Replies the system does not act on yet are recorded (P1)

- [x] T050 [US4] Test: `decline`, `counter`, `question`, `withdraw`, `cross_reference` → `deferred` decision with the intent, nothing sent, streak reset (AC-4.1) (tests/unit/state.test.ts)
- [x] T051 [US4] Implement: deferred rule (src/core/state.ts)
- [x] T052 [US4] Scenario `003-deferred-intents` (tests/scenarios/003-deferred-intents.txt, tests/scenarios/003.test.ts)
- [x] T053 [P] [US4] Test: replay of `003-both-accept` and `003-model-invalid-output`, with `model_call` excluded from the projection comparison (AC-4.3, TRACE-2) (tests/scenarios/replay.test.ts)
- [x] T054 [P] [US4] Test: trace shape over every 003 scenario, plus "no `scheduled` result without two `accept` interpretations for its version" across all 003 scenarios (TRACE-1) (tests/scenarios/003.test.ts)
- [x] T055 [US4] Update 001/002 scenarios whose trivial bodies (`Sí`, `Vale`) now trigger acceptance: make the bodies non-trivial or extend the expectations (tests/scenarios/001-*.txt, tests/scenarios/002-queued-input-first.txt, tests/unit/state.test.ts)

## Phase 6 · Polish

- [x] T090 Remove ACC-1, ACC-2, ACC-3, LLM-1 from `specs/coverage-baseline.json`
- [x] T091 Re-read the spec; confirm every AC has a passing test; set `Status: implemented` (specs/features/003-interpretation-acceptance/spec.md)
- [x] T092 `pnpm check` green; confirm no test imports `src/interpreter/anthropic.ts`

## Dependencies

- T011 (schema) precedes T016/T017 (interpreter) and T030 (acceptance uses the validated type).
- T020 (request output and runner) precedes every scenario: without it no interpretation is ever recorded.
- T035 (acceptance rules) precedes T036; T042 precedes T043; T051 precedes T052.
- T055 runs after T020, when the fake starts acting on trivial bodies; `pnpm check` may be red between T020 and T055 only for those scenarios.
