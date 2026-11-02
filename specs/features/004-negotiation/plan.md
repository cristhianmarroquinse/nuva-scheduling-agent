# 004 · Plan: Negotiation

**Spec:** [spec.md](spec.md)

## Summary

Replaces the `deferred` rule of 003 with the negotiation policy: declines, counters, mismatched acceptances and withdrawals make a new proposal (version +1, hold moved, both parties told the previous one is cancelled), chosen inside the party's stated availability when one fits; three refusals by one party close the order as `no_mutual_slot`; questions trigger a second, validated model call whose text goes to the asker only and is recorded as an `answer` fact; cross-references get one clarification, then review. Adds a pure availability module, four templates, one fact type, one interpreter method, and extends the fold's per-order state.

## Design

### Modules

| Module | Pure | Responsibility |
|---|---|---|
| `src/policy/availability.ts` (new) | yes | `windowsFrom(times, exclusions)` → sorted `Window { start, end }[]` in Madrid: date only → 07:00–22:00; `start`+`end` → that range; `start` only → a point (window of exactly 2 h from `start`); `end` only → 07:00–`end`; all clamped to 07:00–22:00 (REQ-SC-4). Exclusions by `date`/`weekday` drop windows on that day; by `start`+`end` cut that range on the matching date (or every window when no date). `slotInside(windows, { earliest, holds })` → first on-the-hour 2-hour slot inside a window, at or after `earliest`, overlapping no hold; `null` when none (AC-1.2–AC-1.5). |
| `src/calendar/calendar.ts` | yes | `nextSlot` gains an optional `after: Slot` (search starts after it) for "the next free slot after the declined one" (AC-1.1). |
| `src/interpreter/schema.ts` | yes | `PROMPT_VERSION` → `2`; `ANSWER_PROMPT_VERSION = '1'`. No schema change: `times`/`exclusions` already carry what 004 reads. |
| `src/interpreter/prompt.ts` | yes | The times instruction now says: "after HH:MM" → `start` HH:MM and `end` 22:00; "before HH:MM" → `start` 07:00 and `end` HH:MM; a single time → `start` only. So a `start`-only entry is always a point, as acceptance (003) already assumes. |
| `src/interpreter/answer.ts` (new) | yes | `AnswerRequest { woid, seq, role, language, body, question, facts: Facts, slot, otherPartyText? }`, `Facts` (closed: title, where, slot wording, duration, urgency, "one handyman", how to reply). `buildAnswerPrompt(request)` (facts and question as data blocks, AC-5.6). `validateAnswer(text, request)` → ok or problem: non-empty, ≤ 400 chars after whitespace normalisation, single paragraph, every `HH:MM`/`H:MM`/`Hh` time is the slot start or end, every numeric or ISO date is the slot date, no verbatim run (≥ 12 chars) of the other party's last message (AC-5.3). |
| `src/interpreter/types.ts` | yes | `Interpreter.answer(request, prompt): Promise<ModelOutput>` (raw is the text). |
| `src/interpreter/fake.ts` | yes | `answer`: the JSON body's string field `answer` → raw; `answer: "@fail"` → rejects; missing → raw `null` (invalid). |
| `src/interpreter/anthropic.ts` | no | `answer`: plain `messages.create`, text block out, same model, `max_tokens` 300. |
| `src/interpreter/interpreter.ts` | yes | `answerQuestion(request, interpreter)` → `{ fact: AnswerFact, calls }`; validation failure or error → fact with `text: null` and `outcome: 'invalid' \| 'error'`; one attempt (a wrong answer is not re-asked: the fixed sentence is the safe fallback). |
| `src/core/facts.ts` | yes | `answer { seq, woid, role, prompt_version, outcome: 'ok' \| 'invalid' \| 'error', text: string \| null, problem? }`. Added to `FACT_TYPES`. |
| `src/core/reasons.ts` | yes | Sentences for `no_mutual_slot(party)` and `cross_reference(party)`. |
| `src/messages/templates.ts` | yes | `reproposalToTenant({ language, title, slot, unavailableNote })`, `reproposalToHandyman({ title, address, slot, unavailableNote })` ("the previous proposal is cancelled" sentence first), `crossReferenceClarification({ language, to, title, slot })`, `answerReply({ language, to, title, slot, answer })` (answer or the fixed sentence, then the slot reminder and how to reply), `officeWillCheck({ language, to })`. |
| `src/core/state.ts` | yes | `OrderState` gains `refusals: Record<Role, number>`, `unanswered: Record<Role, number>` (versions sent since the party's last reply), `lastBody: Partial<Record<Role, string>>`; `unclearStreak[party]` gains `crossReference: boolean`. New `Output` kind `{ kind: 'answer', request: AnswerRequest }`. Rules below. |
| `src/runtime/run.ts` | no | Handles `answer` outputs like `interpret`: calls `answerQuestion`, traces `model_call { purpose: 'answer', … }`, records the `answer` fact. |
| `docs/adr/0002-event-sourced-core.md` | — | One amendment line: `answer` (the validated model-written reply to a question) is the seventh fact type, for the same reason `interpretation` is one. |

### Facts and projections

| Fact | Projections and stdout |
|---|---|
| `msg_in` (message, open order) | as before; `lastBody[party]` updated |
| `interpretation` | `decision` always; then per rule: `hold_released { reason: 'reproposed' }`, `hold_taken`, two `msg_out` + frames (re-proposal), or `msg_out` + frame (confirmation request, clarification, cross-reference clarification), or `state_change` + `result` (review), or an `answer` request output |
| `answer` | `decision { outcome: 'answered', source: 'model' \| 'template' }`, `msg_out` + frame to the asker only |
| `eof` | unchanged |

### Rules in `step` for an `interpretation` (party = sender, order open with a proposal)

0. `lastBody` is already set by `msg_in`. Reset `llmFailures`. If the intent is not unclear/contradictory/cross_reference, reset the party's streak.
1. **Bare-yes guard (AC-2.3):** intent `accept`, `times` empty, `unanswered[party] ≥ 2` → confirmation request, `awaitingConfirmation[party]`, decision `needs_confirmation { reason: 'unanswered_versions' }`. Then `unanswered[party] = 0` (every rule below also zeroes it).
2. **accept:** as 003, except `mismatch` → treated as a counter (rule 4).
3. **decline:** `refuse(party)`; if the limit is not reached → `repropose({ cause: 'decline', after: current slot })`.
4. **counter** (and mismatched accept): `refuse(party)`; windows from `times`/`exclusions`; `slotInside` → `repropose({ cause: 'counter', slot })`, else `repropose({ cause: 'no_fit', after: current slot, noteTo: party })`.
5. **withdraw:** forget `accepted[party]`; `refuse(party)`; `repropose` with the counter rule if `times` given, else `{ cause: 'withdraw', after: current slot }`.
6. **question:** decision `question`; output `answer` request with the facts list, the slot, and the other party's `lastBody`.
7. **cross_reference:** streak +1 with `crossReference = true`; count 1 → cross-reference clarification; count ≥ 2 → review with the precedence of AC-6.3.
8. **unclear / contradictory:** as 003, with the review code chosen by precedence: `contradictory_replies` > `cross_reference` > `interpretation_failed`.

`refuse(party)`: `refusals[party] += 1`; when it reaches 3 → release the tentative hold, close `requires_review` `no_mutual_slot`, decision `review`, and the caller stops.

`repropose({ cause, slot | after, noteTo? })`: release the current tentative hold (`hold_released` reason `reproposed`), take the new hold (`nextSlot({ after })` or the given slot), version +1, `accepted = {}`, `awaitingConfirmation = {}`, `unanswered` +1 for both parties, decision `repropose { cause, party, version, start, end }`, frames to tenant then handyman (the note goes only to `noteTo`).

`answer` fact: order open → `decision { outcome: 'answered', source }`, frame to `fact.role` with `answerReply` (model text when `outcome: 'ok'`, else the fixed sentence); closed order → `ignored_fact`.

### Replacing 003's deferred rule

The `deferred` decision disappears. `003-deferred-intents` and its test are removed (its AC-4.1 is superseded; the 003 spec gets a one-line note). `002-queued-input-first` keeps its question bodies: the answers now follow the startup frames, which is exactly what RUN-2 requires; its test is loosened to "the first six blocks are the initial proposals, every result comes after".

### Dependencies

None new.

## Constitution check

| Check | Status |
|---|---|
| Model output only enters as a validated interpretation event (LLM-1) | ✅ The answer text is validated and recorded as an `answer` fact; the fold decides what frame to send; nothing else reads it |
| Model text only to the sender, from closed facts (LLM-2) | ✅ `answerReply` is sent to `fact.role` only; the prompt carries only the closed facts and the asker's text; the validator rejects foreign dates and the other party's words |
| Nothing but protocol on stdout; nothing on stderr (OUT-1) | ✅ Answer text passes through `formatFrame` (normalised, one frame) |
| Time through the time module, Europe/Madrid, injected clock (TIME-1) | ✅ Windows and slots via Luxon in `src/time/` and the calendar; no clock reads |
| State derived from facts; no projection fed back as input (ADR 0002) | ⚠️ A seventh fact type, `answer`; see Complexity tracking |
| Exactly one terminal result per order; nothing after it (ORD-1, ORD-2) | ✅ `close()` unchanged; answers and withdrawals for closed orders are ignored |
| No overlap; scheduled visits never move (SCHED-1, SCHED-3) | ✅ `slotInside` and `nextSlot` reject every hold, scheduled ones included; re-proposals touch only the order's own tentative hold |
| No new dependency or abstraction without a requirement asking for it | ✅ No package; `availability.ts` answers REQ-NG-4/REQ-SC-4; `answer.ts` answers REQ-NG-7 |
| Consistent with every accepted ADR | ✅ ADR 0001 (model answers questions from a closed facts block behind a validator), 0003, 0004; ADR 0002 amended by one line |

## Complexity tracking

| Deviation | Why it is needed | Simpler alternative rejected because |
|---|---|---|
| `answer` fact type beyond the six ADR 0002 lists | The model's answer is model output; replay must reproduce the frame without calling the model, which is ADR 0002's own goal, so it has to be a recorded fact like `interpretation` | Deriving the frame from the `interpretation` alone would require calling the model on replay (violates TRACE-2); storing the text inside the `interpretation` fact would mix two model calls with different prompts and outcomes into one record |

## Test plan

| Test | Covers |
|---|---|
| `tests/unit/availability.test.ts` | AC-1.2, AC-1.3, AC-1.4, AC-1.5 (date-only, range, point, after/before, clamp to 07–22, exclusions, past window, holds, 2026-10-25) and **SCHED-1**, **SCHED-2**, **SCHED-5** titles |
| `tests/unit/calendar.test.ts` (new case) | AC-1.1 (`nextSlot` with `after`) |
| `tests/unit/answer.test.ts` | AC-5.1, AC-5.3, AC-5.6 (facts list, prompt data blocks, validator accept/reject cases) |
| `tests/unit/interpreter.test.ts` (new cases) | AC-5.4 (`answerQuestion`: ok, invalid, error; call traces) |
| `tests/unit/templates.test.ts` (new cases) | AC-2.1, AC-5.2, AC-6.1 wording in es/en; **COM-1**, **COM-2**, **COM-3** |
| `tests/unit/state.test.ts` (new cases) | AC-1.1, AC-1.6, AC-1.7, AC-1.8, AC-2.1–AC-2.4, AC-3.1–AC-3.4, AC-4.1, AC-4.2, AC-5.5, AC-6.1–AC-6.3; **ACC-1**, **ORD-1**, **ORD-2**, **LLM-2** (answer frame recipient) |
| `tests/scenarios/004.test.ts` + `tests/scenarios/004-*.txt` | Every scenario of the spec table; **LLM-2** on `004-question-answered`; TIME-1 on `004-counter-dst`; SCHED-1 on `004-counter-held` |
| `tests/scenarios/replay.test.ts` | TRACE-2 for `004-counter-range`, `004-question-answered` |
| Updated: `tests/scenarios/003.test.ts`, `002.test.ts`, `002-queued-input-first.txt` | Superseded deferred rule; RUN-2 assertion loosened |

**Leaving the baseline:** LLM-2. Staying: SCHED-3, SCHED-4, RUN-3.

## Risks

- **Prompt version bump.** The times instruction changes, so `PROMPT_VERSION` becomes `2`; recorded traces say which version produced each interpretation.
- **Answer validator strictness.** Real answers that mention the slot time in another format ("10am") would be rejected and replaced by the fixed sentence; safe but curt. The golden-set feature will tune it.
- **Counter from a party with no proposal.** Cannot happen: every open order has a proposal from startup, and a review closes the order.
- **Hourly search inside windows is bounded** by the window itself; `nextSlot` keeps its 366-day guard.
- **Scenario churn.** `003-deferred-intents` is deleted and the queued-input scenario's stdout is regenerated; both are deliberate consequences of the spec, not regressions.
