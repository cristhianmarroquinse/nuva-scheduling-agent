# 005 · Plan: Timeouts, preemption and handyman blackouts

**Spec:** [spec.md](spec.md)

## Summary

Three additions to the fold, no new fact type. A `<NO RESPONSE>` line is acted on directly by `step` (it needs no interpretation): it counts only against a party whose acceptance of the current version is missing, produces a reminder, then a review, and an immediate review for a Critical tenant. The 004 re-proposal routine learns to take over a strictly lower-urgency tentative hold when stated availability fits nothing free, and to re-propose the victim without penalty. Handyman replies with `scope: 'all'` (a new schema field) record blackout windows in the state; every overlapping tentative hold is re-proposed, scheduled visits are kept and traced, and the calendar search avoids blackouts from then on.

## Design

### Modules

| Module | Pure | Responsibility |
|---|---|---|
| `src/interpreter/schema.ts` | yes | `scope: z.enum(['this_order', 'all'])` optional in both schemas, default `this_order` on validation. `PROMPT_VERSION` → `3`. |
| `src/interpreter/prompt.ts` | yes | Instruction: for the handyman, `scope` is `all` when the unavailability applies to all his work ("mañana no puedo nada", "estoy enfermo", "el viernes libro"), `this_order` otherwise; the tenant's replies are always `this_order`. |
| `src/calendar/calendar.ts` | yes | `nextSlot` gains `blocked?: readonly Slot[]` (blackouts): a candidate overlapping any blocked slot is skipped like a hold. `URGENCY_RANK` exported for the takeover rule. |
| `src/policy/availability.ts` | yes | `slotInside` gains `blocked?: readonly Slot[]`. `blackoutWindows(exclusions, simNow)` → `Slot[]`: a date alone is the whole day (00:00–24:00), a date with times is that range, a weekday without a date is the next occurrence of that weekday at or after the reference time (AC-3.7); clamped to nothing (blackouts may cover any hour). `takeoverCandidate(windows, { earliest, holds, blocked, urgencies })` → the earliest tentative hold whose slot lies inside a window, at or after `earliest`, overlaps no other hold or blackout, and belongs to an order of strictly lower urgency (SCHED-4), or `null`. |
| `src/core/reasons.ts` | yes | `noResponseSentence({ party, slot, otherAccepted })` and `criticalNoResponseSentence({ slot, handymanAccepted })`, both one line, naming the slot in ISO form. |
| `src/messages/templates.ts` | yes | `reminder({ language, to, title, slot })`. Re-proposal templates take `note?: 'unavailable' \| 'preempted' \| 'blackout'` instead of the boolean (same wording for `unavailable`; new sentences for the other two). |
| `src/core/state.ts` | yes | `OrderState.timeouts: Record<Role, number>`; `State.blackouts: Slot[]`. `receiveLine` applies the timeout rule for classification `timeout` on an open order. `repropose` is generalised to `reproposeOrder(env, target, options)` so a victim can be re-proposed from another order's step; `options.cause` gains `preempted` and `blackout`, and `options.allowTakeover` (false for victims and blackout moves). Blackout handling runs at the start of `applyInterpretation` for handyman facts with `scope: 'all'` and exclusions. |
| `src/runtime/run.ts`, `src/main.ts` | no | Unchanged. |

### Facts and projections

No new fact. New projections:

| Trigger | Projections and stdout |
|---|---|
| `msg_in` timeout, awaited party | `decision { outcome: 'remind' \| 'review' \| 'timeout_ignored', party, timeouts }`; reminder frame, or `hold_released` + `state_change` + `result` + stdout result |
| takeover inside `repropose` | `decision { outcome: 'takeover', from, slot, urgency, victim_urgency }`, `hold_released { reason: 'preempted' }` on the victim, `hold_taken` for the taker, then the victim's `decision { outcome: 'repropose', cause: 'preempted' }`, `hold_taken`, two `msg_out` + frames |
| handyman fact with `scope: 'all'` | `blackout_recorded { windows }`, per affected tentative hold: `hold_released { reason: 'blackout' }`, `decision { cause: 'blackout' }`, `hold_taken`, two frames; per overlapping scheduled visit: `blackout_conflict { slot }` |

### Rules

**Timeout (`<NO RESPONSE>` from party P on an open order with a proposal):**
1. Awaited = `accepted[P] !== proposal.version`. If not awaited → decision `timeout_ignored`, nothing sent (RUN-3).
2. `timeouts[P] += 1`. If the order is `Critical` and P is the tenant → decision `review`, release the tentative hold, close `no_response` with `criticalNoResponseSentence` (AC-1.6).
3. If `timeouts[P] === 1` → decision `remind`, send `reminder` to P. If `≥ 2` → decision `review`, release, close `no_response` with `noResponseSentence` (AC-1.4).
4. Any `interpretation` or `llm_error` from P sets `timeouts[P] = 0` (AC-1.5). Timeouts never touch `refusals` (AC-1.8).

**Takeover (inside `repropose`, only when `availability !== null` and `allowTakeover`):** after `slotInside` returns null, `takeoverCandidate` over the other orders' tentative holds; if found, release the victim's hold (`preempted`), take the slot for the current order (version +1 as usual, cause `counter`/`withdraw` as the caller said, decision `takeover` first), then `reproposeOrder(victim, { cause: 'preempted', after: lostSlot, allowTakeover: false, countRefusal: false })`. If no candidate, the 004 no-fit rule applies.

**Blackout (handyman `interpretation` with `scope: 'all'` and non-empty `exclusions`):** compute windows from the exclusions with `blackoutWindows`; append to `state.blackouts`; trace `blackout_recorded`. For every other open order whose tentative hold overlaps a window: `reproposeOrder(order, { cause: 'blackout', after: lost slot, allowTakeover: false, countRefusal: false })`. For every scheduled hold overlapping: trace `blackout_conflict`. Then continue with the fact's own intent for the current order; `nextSlot`/`slotInside` receive `blocked: state.blackouts` everywhere.

**Scheduled visits (SCHED-3):** every release path filters `kind === 'tentative'`; `takeoverCandidate` only looks at tentative holds; `review` and `endInput` already keep scheduled holds. A unit test folds a hostile sequence (takeover attempt, blackout, review) over a scheduled order and asserts its hold is untouched.

### Dependencies

None new.

## Constitution check

| Check | Status |
|---|---|
| Model output only enters as a validated interpretation event (LLM-1) | ✅ `scope` is one more validated field; blackouts are derived by the fold from the fact |
| Model text only to the sender, from closed facts (LLM-2) | ✅ No new model text; reminders and notes are templates |
| Nothing but protocol on stdout; nothing on stderr (OUT-1) | ✅ All frames via `send`/`formatFrame` |
| Time through the time module, Europe/Madrid, injected clock (TIME-1) | ✅ Blackout windows and the next weekday are computed from `sim_now` with Luxon in `src/time/` and `availability.ts` |
| State derived from facts; no projection fed back as input (ADR 0002) | ✅ `timeouts` and `blackouts` are projections of `msg_in` and `interpretation` facts; replay reproduces them |
| Exactly one terminal result per order; nothing after it (ORD-1, ORD-2) | ✅ `close()` unchanged; closed orders ignore timeouts (classified `closed_order` already) |
| No overlap; scheduled visits never move (SCHED-1, SCHED-3) | ✅ Takeover and blackout only touch tentative holds; `blocked` slots are treated as occupied in every search |
| No new dependency or abstraction without a requirement asking for it | ✅ `takeoverCandidate` and `blackoutWindows` answer REQ-SC-5 and REQ-SC-6 |
| Consistent with every accepted ADR | ✅ ADR 0001 (code decides takeovers and timeouts), 0002, 0003 (`sim_now` anchors weekday blackouts), 0004 (schema field, prompt version bump) |

## Complexity tracking

| Deviation | Why it is needed | Simpler alternative rejected because |
|---|---|---|
| none | | |

## Test plan

| Test | Covers |
|---|---|
| `tests/unit/schema.test.ts`, `prompt.test.ts` (new cases) | `scope` validated and defaulted; prompt instruction present; version `3` |
| `tests/unit/calendar.test.ts`, `availability.test.ts` (new cases) | AC-3.3, AC-3.7 (`blocked` in `nextSlot` and `slotInside`; `blackoutWindows` for date, date+times, weekday → next occurrence, 2026-10-25); `takeoverCandidate` (lower urgency only, tentative only, inside window, earliest) with **SCHED-3**, **SCHED-4** titles |
| `tests/unit/reasons.test.ts` (new) | AC-1.4, AC-1.6 sentences |
| `tests/unit/templates.test.ts` (new cases) | AC-1.3 reminder es/en; AC-2.3 and AC-3.2 notes; **COM-1**, **COM-2**, **COM-3** |
| `tests/unit/state.test.ts` (new cases) | AC-1.1–AC-1.8 with **RUN-3**, ORD-1, ORD-2; AC-2.1–AC-2.6 with **SCHED-3**, **SCHED-4**, ACC-1, SCHED-1; AC-3.1–AC-3.6 |
| `tests/scenarios/005.test.ts` + `tests/scenarios/005-*.txt` | Every scenario of the spec table; titles cite **RUN-3** (`005-timeout-not-waiting`), **SCHED-4** (`005-preempt-counter`), **SCHED-3** (`005-preempt-scheduled`, `005-blackout-scheduled`), TIME-1 (`005-blackout-dst`) |
| `tests/scenarios/005.test.ts` (cross-scenario) | No `hold_released` ever names a scheduled hold; every `takeover` names a strictly lower victim urgency; no frame after a timeout from a party that had accepted |
| `tests/scenarios/replay.test.ts` | TRACE-2 for `005-preempt-counter`, `005-blackout-day` |
| Updated: `tests/unit/templates.test.ts` (004 cases) | `unavailableNote: true` → `note: 'unavailable'` |

**Leaving the baseline:** RUN-3, SCHED-3, SCHED-4. The baseline becomes empty.

## Risks

- **Prompt version 3.** The `scope` instruction changes the interpretation prompt; traces carry the version.
- **Scope misjudged by the model.** A tenant-like "no puedo mañana" from the handyman scoped `all` would move other orders; the golden-set feature measures this. The fold only honours `scope: 'all'` from the handyman.
- **Blackout breadth.** A date-only blackout blocks the whole day for every order; that is what "mañana no puedo nada" means. Partial days need times from the model.
- **Cascades.** A takeover re-proposes the victim without takeover rights, and a blackout move never takes over, so one event moves at most one level; no loops.
- **Hostile sequences on scheduled visits** are covered by a dedicated fold test, since SCHED-3 is the invariant most at risk in this feature.
