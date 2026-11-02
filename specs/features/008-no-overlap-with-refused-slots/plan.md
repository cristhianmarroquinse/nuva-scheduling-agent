# 008 · Plan: Re-proposals never overlap a refused slot

**Spec:** [spec.md](spec.md)

## Summary

Each order remembers the slots of the proposals refused in it (declined, countered or withdrawn from, by either party). When the re-proposal routine falls back to "the next free slot" because no stated availability fits, it passes those slots to the calendar search as slots to avoid, next to the handyman's blackouts. The search for stated availability is unchanged, so an explicit statement still wins. No new fact, event type, module or dependency: the refused set is a projection folded from the facts that already exist, so replay (TRACE-2) keeps working. The committed example run contains the bug (WO-1004: 14:00 declined, 15:00 proposed), so it is regenerated.

## Design

### Modules

| Module | Pure | Change |
|---|---|---|
| `src/core/state.ts` | yes | `OrderState.refused: Slot[]`, empty at load. `refusal()` appends `current.proposal.slot` before the limit check (AC-1.1), so every decline, counter (mismatched acceptance and no-fit counter included) and withdrawal records it. `reproposeOrder()` fallback calls `nextSlot({ …, after: proposal.slot, blocked: [...blackouts, ...target.refused] })` (AC-1.2); `slotInside` and `takeoverCandidate` keep `blocked: blackouts` only (AC-1.3). |
| `src/calendar/calendar.ts` | yes | Doc comment only: `blocked` is "slots to avoid (handyman blackouts, slots refused in the order)". The search already skips any candidate overlapping a blocked slot by instant, which covers DST. |
| everything else | — | Unchanged. |

Why `blocked` and not a new parameter: it already means "never propose a slot overlapping these", compared by instant, and is applied to the same search. A second parameter with identical semantics would be a duplicate.

### Facts and projections

No new fact. `refused` is a projection of `interpretation` facts through `refusal()`, like `refusals`. Per order only (AC-1.4): it lives on `OrderState`, never on `State`. Preemption and blackout re-proposals do not call `refusal()`, so they add nothing to it (REQ-NG-9), but their fallback search reads it (AC-1.2). The `decision { outcome: 'repropose', cause, party, version, start, end }` event is unchanged (AC-1.5); a reader verifies the rule by comparing each such decision with the earlier `repropose` decisions of the same order whose versions were refused.

### Affected expectations

Two committed artefacts encode the old reading of 004 AC-1.1 and change because 008 amends it, not because a test is weakened:

- `tests/scenarios/004-decline-reproposes.txt`: v1 Wed 12:00–14:00 declined → v2 13:00–15:00 becomes 14:00–16:00 (and `SCHEDULED_FOR`).
- `traces/examples/`: WO-1004 v2 Wed 15:00–17:00 becomes 16:00–18:00 (WO-1002 has already moved to Thursday, so 16:00 is free). Its stdin line `WO-1004|tenant Yes, 15:00 is fine` becomes `Yes, 16:00 is fine` so the story still ends `scheduled`; the run is regenerated with `pnpm example` (real model) and its README paragraph updated.

Any other scenario whose expected output changes is listed in the implementation commit with the AC that changes it; an unexplained change is a bug.

## Constitution check

| Check | Status |
|---|---|
| Model output only enters as a validated interpretation event (LLM-1) | ✅ the model is not involved; the rule reads intents already validated |
| Model text only to the sender, from closed facts (LLM-2) | ✅ untouched |
| Nothing but protocol on stdout; nothing on stderr (OUT-1) | ✅ untouched |
| Time through the time module, Europe/Madrid, injected clock (TIME-1) | ✅ overlap is compared by instant through the existing calendar functions |
| State derived from facts; no projection fed back as input (ADR 0002) | ✅ `refused` is folded from `interpretation` facts; replay reproduces it |
| Exactly one terminal result per order; nothing after it (ORD-1, ORD-2) | ✅ untouched |
| No overlap; scheduled visits never move (SCHED-1, SCHED-3) | ✅ the search only adds exclusions; holds and scheduled visits are handled as before |
| No new dependency or abstraction without a requirement asking for it | ✅ one field, one argument reused |
| Consistent with every accepted ADR | ✅ ADR 0001 (code decides), 0002 (projection of facts), 0003 (reference time) unaffected |

## Complexity tracking

| Deviation | Why it is needed | Simpler alternative rejected because |
|---|---|---|
| — | — | — |

## Test plan

| Test | Covers |
|---|---|
| `tests/unit/state.test.ts` (new cases) | AC-1.1 (decline, counter, mismatched acceptance, withdrawal each add the slot; preemption and blackout do not), AC-1.2 (fallback avoids every refused slot, not only the last), AC-1.3 (stated availability may land on a refused slot), AC-1.4 (another order may take a slot refused elsewhere); **SCHED-1**, **SCHED-2** on every new hold |
| `tests/unit/calendar.test.ts` (new case) | AC-1.2 at the calendar level: refused slots passed as `blocked` across the DST change (Sunday 25 October 2026) are avoided by instant; **TIME-1** |
| `tests/scenarios/008-decline-no-overlap.txt` | AC-1.1, AC-1.2, AC-1.5; the motivating run |
| `tests/scenarios/008-decline-end-of-day.txt` | AC-1.2 (rollover to the next weekday) |
| `tests/scenarios/008-non-contiguous.txt` | AC-1.1, AC-1.2, AC-1.3 |
| `tests/scenarios/008-withdraw-no-overlap.txt` | AC-1.1, AC-1.2 |
| `tests/scenarios/008-no-fit-counter.txt` | AC-1.1, AC-1.2 |
| `tests/scenarios/008-explicit-wins.txt` | AC-1.3 |
| `tests/scenarios/008-per-order.txt` | AC-1.4 |
| `tests/scenarios/008-preempted-avoids-refused.txt` | AC-1.2 for a system-caused re-proposal |
| `tests/scenarios/008.test.ts` | Runs the 008 scenarios; titles cite the ACs and **SCHED-1** |
| `tests/scenarios/008.test.ts` (cross-scenario check) | Success criterion 1: no fallback re-proposal in any 004, 005 or 008 scenario overlaps a slot refused earlier in that order |
| `tests/delivery/example-trace.test.ts` (unchanged) | The regenerated example still replays (**TRACE-2**) and covers its story |

Pending invariants leaving the baseline: none (the baseline is already empty). No invariant is added; the guarantee is a product requirement (REQ-NG-11).

Every test that encodes the new rule must fail on the current code before the change.

## Risks

- **The regenerated example depends on the model.** Its wording may change; its decisions should not. If an interpretation differs from the previous run, the example README is updated to match the trace, not the other way round.
- **Longer searches.** Skipping refused slots can push a re-proposal to the next day earlier than before; this is the intended behaviour and is bounded by the existing search limit of 002.
- **Explicit statements may loop.** A party can name a slot the other refused; the other may refuse it again. The per-party limit of three refusals still bounds it.
