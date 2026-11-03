# 010 · Blackout moves respect priority

**Status:** planned
**Product requirements:** REQ-SC-5, REQ-SC-6, REQ-ST-3
**Invariants touched:** SCHED-1, SCHED-3, SCHED-4 (unchanged)
**Amends:** 005 AC-3.2 (order of the moves) and AC-3.1 (a general decline without a date)

## Why

The end-to-end runs of 2026-11-03 found two blackout problems. When the handyman said "Hoy no puedo hacer ningún trabajo", the moved orders were re-proposed in CSV order, and the order he wrote on last, so a Low order took Thursday 09:00 and the High order got 11:00: the take-home says higher urgency takes priority. In another run the model returned the general scope without a date; the code needs a date to record a blackout, so the statement was silently treated as a decline of one order while the others stayed on a day the handyman had said he could not work.

## User stories

### US1 · Moved orders pick their new slot by priority (P1)

As the office, I want the most urgent of the orders moved by a blackout to get the first free slot, so that a blackout never inverts priority.

**Acceptance criteria (EARS):**

- **AC-1.1** WHEN a blackout releases several tentative holds, THE system SHALL release all of them first and then re-propose the affected orders in allocation order (urgency, then `reported_at`, as REQ-ST-3).
- **AC-1.2** THE order the handyman wrote on SHALL take its place in that order: affected orders that rank above it are re-proposed before its own reply is handled, and the rest after it.
- **AC-1.3** A blackout move SHALL still never take over a hold and never move a scheduled visit (005 AC-2.6, AC-3.4).

### US2 · A general refusal without a date is not lost (P2)

As the handyman, I want "hoy no puedo hacer ningún trabajo" to move my other visits that day even if no date was extracted, so that I do not have to repeat it per order.

**Acceptance criteria (EARS):**

- **AC-2.1** IF the handyman's reply has intent `decline` or `withdraw`, scope `all` and no exclusions, THEN THE system SHALL record a blackout for the whole day of the current proposal of the order he wrote on, and trace it with `inferred: true`.
- **AC-2.2** A reply with scope `all` and any other intent (for example an acceptance) SHALL NOT create a blackout.

## Edge cases

- Two affected orders of equal urgency: the earlier `reported_at` goes first; identical ties keep CSV order.
- The order the handyman wrote on outranks every affected order: it is handled first, then all moves follow, as today for that case.
- The handyman's own order has no hold inside the blackout: its intent is handled as usual, and the ranking still decides who goes first.

## Scenarios

| Scenario | Covers | stdin (summary) | Expected |
|---|---|---|---|
| `010-blackout-priority` | AC-1.1, AC-1.2 | CSV order Low, Medium, High, all on Wednesday; handyman on the Medium: "today nothing" | High Thu 09:00, Medium Thu 11:00, Low Thu 13:00 |
| `010-blackout-writer-first` | AC-1.2 | Handyman writes on the High order | High first, then Medium, then Low |
| `010-blackout-inferred-day` | AC-2.1 | Handyman decline, scope all, no exclusions | blackout of the proposal's day, `inferred: true`; other holds that day move |
| `010-scope-all-accept` | AC-2.2 | Handyman "Vale" read with scope all | no blackout |

## Success criteria

- The e2e scenario `cal-blackout-priority` from 2026-11-03 gives High 09:00, Medium 11:00, Low 13:00.
- `pnpm check` green.

## Assumptions

- Inferring the day of the current proposal is the conservative reading of an undated "I can't work": it only moves tentative holds that day, never a scheduled visit, and the inference is visible in the trace.

## Decisions

- **Priority applies to blackout moves** (decided 2026-11-03 with the user, after the e2e runs).
- **An undated general refusal blacks out the proposal's day** (decided 2026-11-03, default proposed to the user): silently losing the statement was worse than a visible, conservative inference.

## Open questions

None.
