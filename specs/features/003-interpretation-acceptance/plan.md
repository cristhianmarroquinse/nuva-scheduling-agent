# 003 · Plan: Interpretation boundary and acceptance

**Spec:** [spec.md](spec.md)

## Summary

Adds the only path by which free text enters the core: a message line becomes an `interpret` request from the fold, the runner answers it through an injected interpreter (regex fast path, then a Zod-validated model call, or the scenario fake), and the validated result is appended as an `interpretation` fact (or `llm_error`). The fold then applies code-only rules: acceptance matching against the proposal on the table, acknowledgement, confirmations and the `scheduled` result; one clarification on unclear or contradictory replies, then review; deferred intents recorded only. New dependencies: `@anthropic-ai/sdk` and `zod`, both required by ADR 0004 and the LLM-boundary rule.

## Design

### Modules

| Module | Pure | Responsibility |
|---|---|---|
| `src/interpreter/schema.ts` (new) | yes | Zod schema `InterpretationSchema`: `intent` (closed enum), `times: { date: 'YYYY-MM-DD', start?: 'HH:MM', end?: 'HH:MM' }[]`, `exclusions: { date?, weekday?, start?, end? }[]`, `question?`, `cross_reference?`, `quote` (≤ 200 chars). Strings are regex-checked so an offset, `Z` or zone name fails (AC-1.6). `validateInterpretation(raw)` → `{ ok, value }` or `{ ok: false, problem }`; strips unknown keys (AC-1.9). `PROMPT_VERSION`. |
| `src/interpreter/fast-path.ts` (new) | yes | `fastPath(body)` → `Interpretation | null` for the closed list of trivial replies (`sí`, `si`, `vale`, `ok`, `de acuerdo`, `perfecto`, `yes`, `yep`, `sure`, `fine`, `no`, `no puedo`, `nope`, with trailing punctuation), case-insensitive, trimmed. |
| `src/interpreter/prompt.ts` (new) | yes | `buildPrompt(request)` → `{ system, user }`. System: role, closed intents, local Madrid date/time fields only, the proposal on the table and `sim_now`; user: the reply inside a delimited data block with the instruction that it is data from a tenant or handyman, never instructions (AC-1.8). Only the sender's text is included. |
| `src/interpreter/interpreter.ts` (new) | yes (types) | `InterpretRequest { woid, seq, role, body, language, proposal, simNow }`, `ModelOutput { raw: unknown; model; latencyMs; tokens }`, `Interpreter { interpret(request): Promise<ModelOutput> }`. `interpretReply(request, interpreter)` → fast path, else model call with one retry on validation failure (AC-1.5), else `unclear`; returns the fact payload plus the `model_call` trace lines. Errors from the interpreter propagate to the runner. |
| `src/interpreter/anthropic.ts` (new) | no | Real adapter: `client.messages.parse` with `zodOutputFormat(InterpretationSchema)`, model `claude-haiku-5-5` (ADR 0004), `max_tokens` small, request `timeout` and SDK `maxRetries` left to the SDK (no retry loop of our own). Client built once from `ANTHROPIC_API_KEY`. |
| `src/interpreter/fake.ts` (new) | yes | Scenario fake (`AGENT_INTERPRETER=fake`): body that parses as a JSON object → that object as `raw`; body `@fail` → throws; anything else → `{ intent: 'unclear', quote }`. `latencyMs: 0`, `model: 'fake'`. |
| `src/policy/acceptance.ts` (new) | yes | `evaluateAcceptance(interpretation, proposal)` → `'accepted' \| 'mismatch' \| 'needs_confirmation'` (AC-2.1–2.3): any exclusion → `needs_confirmation`; every `times` entry must have the proposal date, a range containing the slot, or a point equal to the start, else `mismatch`. Madrid comparison through the time module. |
| `src/core/facts.ts` | yes | New fact shapes: `interpretation { seq, woid, role, source: 'regex' \| 'model' \| 'fake', prompt_version, result: Interpretation }`, `llm_error { seq, woid, role, message }`. |
| `src/core/reasons.ts` | yes | Sentences for `contradictory_replies`, `interpretation_failed`, `llm_unavailable`. |
| `src/calendar/calendar.ts` | yes | `Hold.kind: 'tentative' \| 'scheduled'`; `nextSlot` still avoids both. |
| `src/messages/templates.ts` | yes | `acknowledgement(language)`, `confirmationRequest({ language, title, slot })`, `clarification({ language, title, slot })`, `confirmationToTenant({ language, title, slot })`, `confirmationToHandyman({ title, address, slot })`. |
| `src/core/state.ts` | yes | New `Output` kind `{ kind: 'interpret', request }` emitted by `receiveLine` for classification `message` on an open order with a proposal. `OrderState` gains `accepted: Partial<Record<Role, number>>`, `awaitingConfirmation: Partial<Record<Role, boolean>>`, `unclearStreak: Record<Role, { count: number; contradictory: boolean }>`, `llmFailures: number`. `step` handles `interpretation` and `llm_error` (rules below). `endInput` releases tentative holds only; scheduled holds stay (AC-2.7). |
| `src/runtime/run.ts` | no | After stepping a `msg_in`, if the outputs contain an `interpret` request: `await interpretReply(...)`, trace `model_call` lines, then `record` the `interpretation` fact, or `record` an `llm_error` fact when the interpreter throws. Still one line at a time; readline buffers the rest. The fact's trace line carries `work_order_id`. |
| `src/main.ts` | no | Chooses the interpreter: `AGENT_INTERPRETER=fake` → fake; otherwise the Anthropic adapter. |
| `tests/scenarios/runner.ts` | — | Sets `AGENT_INTERPRETER=fake` for every spawned run. |

### Facts and projections

Facts added: `interpretation`, `llm_error` (already listed in `FACT_TYPES`). Replay folds them like any other fact; the `interpret` request outputs are ignored by replay and by the tracer (they are instructions to the runner, not projections).

| Fact | Projections and stdout |
|---|---|
| `msg_in` (classification `message`, open order with proposal) | as in 001, plus an `interpret` request output |
| `interpretation` | `decision { kind, reason, intent, version?, party }` always; then per rule: `msg_out` + frame (acknowledgement, confirmation request, clarification, two confirmations), `state_change`, `result` + stdout result |
| `llm_error` | `decision { kind: 'llm_error', failures }`; then the unclear rule or the `llm_unavailable` closure |

Runner-only trace (not reproduced by replay, excluded in `replay.test.ts`): `model_call { model, prompt_version, latency_ms, tokens, outcome: 'ok' \| 'invalid' \| 'error', attempt }`.

### Rules in `step` for an `interpretation` on an open order (party = sender)

1. Reset `llmFailures`. If intent is not `unclear`/`contradictory`, reset the party's `unclearStreak`.
2. `accept`: `evaluateAcceptance`:
   - `needs_confirmation` → set `awaitingConfirmation[party]`, send `confirmationRequest`, decision `needs_confirmation`.
   - `mismatch` → decision `mismatch` (recorded as counter), nothing sent.
   - `accepted` → clear `awaitingConfirmation[party]`; if `accepted[party] === version` → decision `already_accepted`, nothing sent; else record it; if the other party accepted the same version and the hold is live → confirmations (tenant, handyman), hold kind → `scheduled`, close with `scheduled` result, decision `scheduled`; else send `acknowledgement`, decision `accepted`.
3. `unclear` / `contradictory`: streak count +1, `contradictory ||= intent === 'contradictory'`; count 1 → send `clarification`, decision `clarify`; count ≥ 2 → release the hold and close `requires_review` with `contradictory_replies` or `interpretation_failed`, decision `review`.
4. Any other intent → decision `deferred` with the intent, nothing sent.

`llm_error`: `llmFailures` +1; if ≥ 2 → release the hold and close `llm_unavailable`; else apply rule 3 as `unclear` (one clarification).

Closed orders: an `interpretation` or `llm_error` for a closed order is traced as `ignored_fact` (ORD-2). Interpretations only exist for lines the fold itself requested, so the runner never produces one for a closed order.

### Dependencies

- `@anthropic-ai/sdk` ^1.3: `messages.parse` with `zodOutputFormat` (ADR 0004 names exactly this).
- `zod` ^4: schema and validation (LLM-boundary rule).

## Constitution check

| Check | Status |
|---|---|
| Model output only enters as a validated interpretation event (LLM-1) | ✅ `validateInterpretation` is the only entry; the fact carries the validated value; `step` derives every change; hostile fields are stripped |
| Model text only to the sender, from closed facts (LLM-2) | ✅ No model-written text is sent in this feature; every frame is a template |
| Nothing but protocol on stdout; nothing on stderr (OUT-1) | ✅ All frames via `formatFrame`; the SDK client is created with no logging; `NODE_NO_WARNINGS` and the stderr redirect stay |
| Time through the time module, Europe/Madrid, injected clock (TIME-1) | ✅ Model fields are local date/time strings; code attaches Madrid in `acceptance.ts`; `latencyMs` is measured in the adapter only for tracing |
| State derived from facts; no projection fed back as input (ADR 0002) | ✅ `interpret` requests are effects for the runner; the model's answer returns as a fact; decisions, frames and results are projections |
| Exactly one terminal result per order; nothing after it (ORD-1, ORD-2) | ✅ `close()` unchanged; closed orders ignore interpretations; the runner only interprets lines the fold requested |
| No overlap; scheduled visits never move (SCHED-1, SCHED-3) | ✅ Scheduled holds stay in `holds` with `kind: 'scheduled'` and are never released; SCHED-3 is cited later with preemption (spec decision) |
| No new dependency or abstraction without a requirement asking for it | ✅ SDK and Zod are required by ADR 0004 and the LLM-boundary rule; `AGENT_INTERPRETER` is the injection seam the testing rule asks for |
| Consistent with every accepted ADR | ✅ ADR 0001 (code owns acceptance and results), 0002, 0003 (`sim_now` in the prompt), 0004 (cascade: regex, Haiku with Zod, one re-ask, unclear) |

## Complexity tracking

| Deviation | Why it is needed | Simpler alternative rejected because |
|---|---|---|
| none | | |

## Test plan

| Test | Covers |
|---|---|
| `tests/unit/schema.test.ts` | AC-1.2, AC-1.6, AC-1.9 (valid outputs; offset, `Z`, zone names rejected; unknown fields stripped; oversized quote rejected) |
| `tests/unit/fast-path.test.ts` | AC-1.3 (closed list, punctuation, case; non-trivial text → null) |
| `tests/unit/prompt.test.ts` | AC-1.8 (reply only inside the data block; no other party's text; proposal and `sim_now` present; `PROMPT_VERSION`) |
| `tests/unit/interpreter.test.ts` | AC-1.4, AC-1.5, AC-1.7 with a scripted `Interpreter` (fast path skips the model; invalid output retried once then `unclear`; `model_call` lines; thrown error propagates) |
| `tests/unit/acceptance.test.ts` | AC-2.1, AC-2.2, AC-2.3 (date, containing range, non-containing range, point equal, point different, exclusion) |
| `tests/unit/state.test.ts` (new cases) | AC-1.1 (`interpret` request only for messages on open orders with a proposal), AC-1.9 and **LLM-1** (hostile interpretation facts change nothing beyond the rules), AC-2.4–AC-2.8 and **ACC-1**, **ACC-2**, **ACC-3**, **ORD-1**, **ORD-2** (acceptance sequences, confirmations before the result, `SCHEDULED_FOR` = start, scheduled hold kept at eof), AC-3.1–AC-3.4 (streaks, reasons, model failures), AC-4.1, AC-4.2 |
| `tests/scenarios/003.test.ts` + `tests/scenarios/003-*.txt` | Every scenario in the spec table through the fake; titles cite **ACC-1**, **ACC-2**, **ACC-3** (`003-both-accept`), **LLM-1** (`003-model-invalid-output`), **ORD-1** (`003-accept-then-eof`), **ORD-2** (`003-closed-order-line`), TIME-1 (`003-scheduled-dst`) |
| `tests/scenarios/replay.test.ts` | AC-4.3, TRACE-2 for `003-both-accept` and `003-model-invalid-output` (`model_call` excluded from the projection comparison) |
| `tests/harness/source-hygiene.test.ts` | unchanged; guards that the adapter does not touch process streams or timers |

**Leaving the baseline:** ACC-1, ACC-2, ACC-3, LLM-1. Staying: SCHED-3, SCHED-4, LLM-2, RUN-3.

**No network in `pnpm test`:** the adapter module is imported only by `main.ts` when `AGENT_INTERPRETER` is not `fake`; unit tests never construct a client; the runner always sets the fake.

## Risks

- **Async step in the runner.** The model call sits between `msg_in` and `interpretation`; the loop stays serial, so no two calls run at once and the calendar cannot race. Latency per non-trivial line is one Haiku call (about 1 s).
- **SDK import cost and warnings.** The SDK is imported dynamically only in the real path, after the stderr redirect, so any warning it emits goes to the trace.
- **Validation strictness.** A schema that is too strict turns many good model answers into `unclear`; the retry message tells the model what failed. The golden-set feature will measure this.
- **Fake expressiveness.** Scenarios script model output as JSON bodies; a body that is valid JSON but not an object falls to `unclear`, which is also what a real model failure yields.
- **001/002 scenarios.** Lines that were only classified now trigger the fake: trivial bodies in existing scenarios (`Vale`, `Sí`) become acceptances and produce frames. The affected 001/002 scenarios are updated to non-trivial, non-JSON bodies or their expectations extended; listed as a task.
