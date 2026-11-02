# 005 · Timeouts, preemption and handyman blackouts

**Status:** implemented
**Product requirements:** REQ-TO-1, REQ-TO-2, REQ-TO-3, REQ-SC-5, REQ-SC-6, REQ-NG-9 (system-caused re-proposals do not count), REQ-OUT-2, REQ-OUT-3, REQ-TR-2
**Invariants touched:** RUN-3, SCHED-3, SCHED-4, SCHED-1, SCHED-2, SCHED-5, ORD-1, ORD-2, COM-1, COM-2, COM-3, ACC-1, TRACE-2
**Deferred:** the golden-set evaluation against the real model, the Dockerfile and the README with a committed trace → delivery features

## Why

Three things still make the agent behave worse than a careful office clerk. A party that stops answering is never reminded and never written off, so the order sits until end of input. A gas leak reported after a squeaky door cannot take the earlier slot, because holds are first come, first served after startup. And when the handyman says "tomorrow I can't do anything", only the order he wrote on hears it. This feature closes the three gaps and empties the invariant baseline: timeouts count only against the party being awaited (RUN-3), a tentative hold is taken over only by strictly higher urgency (SCHED-4), and a scheduled visit never moves, whatever happens (SCHED-3).

## User stories

### US1 · A silent party is reminded once, then the order goes to review (P1)

As the evaluator, I want `<NO RESPONSE>` to produce a reminder the first time and a review the second, only for the party the agent is actually waiting on, so that nobody is penalised for a silence that was not theirs.

**Independent test:** scripted `<NO RESPONSE>` lines for each party in each state; reminders, reviews and ignored timeouts match the rules.

**Acceptance criteria (EARS):**

- **AC-1.1** THE system SHALL be waiting on a party WHEN the order is open AND that party has not accepted the current proposal version, or has been asked a confirmation or clarification it has not answered; after a party accepts, the system waits only on the other party.
- **AC-1.2** WHEN `<NO RESPONSE>` arrives from a party the system is waiting on, THE system SHALL count one timeout for that party; otherwise THE system SHALL trace the timeout as not counted and send nothing (RUN-3).
- **AC-1.3** WHEN a party's timeout count reaches one, THE system SHALL send that party a reminder in their language restating the proposed slot and how to reply (COM-1, COM-2, COM-3).
- **AC-1.4** WHEN a party's timeout count reaches two, THE system SHALL release the hold and close the order as `requires_review` with reason `no_response` and a sentence naming the silent party and the state of the proposal (slot, whether the other party accepted).
- **AC-1.5** WHEN a real reply (any intent) arrives from a party, THE system SHALL reset that party's timeout count.
- **AC-1.6** WHEN the tenant of a `Critical` order times out while the system is waiting on them, THE system SHALL close the order at once as `requires_review` with reason `no_response` and a sentence that states what is known: the proposed slot and whether the handyman accepted it.
- **AC-1.7** THE handyman's timeouts on a `Critical` order SHALL follow AC-1.3 and AC-1.4.
- **AC-1.8** A `<NO RESPONSE>` for a closed order SHALL be traced and ignored (ORD-2); a reminder or a review SHALL NOT count toward the refusal limit of 004.

### US2 · Higher urgency takes over tentative holds, never scheduled visits (P1)

As the office, I want a critical job to get the slot a low-priority job was merely holding, but never a slot that was already confirmed, so that urgency wins without breaking promises.

**Independent test:** two orders; the higher-urgency one counters onto the lower one's held hour; the hold changes hands and the lower order is re-proposed without being penalised; the same with a scheduled visit changes nothing.

**Acceptance criteria (EARS):**

- **AC-2.1** WHEN an order states availability (counter, mismatched acceptance or withdrawal with times) AND no free slot fits it AND a slot inside it is held tentatively by an order of strictly lower urgency, THE system SHALL take that slot over: the higher-urgency order gets it as its new proposal, and the lower-urgency order is re-proposed. Declines and re-proposals without stated availability never take over a hold.
- **AC-2.2** THE system SHALL NOT take over a hold of equal or higher urgency, nor a scheduled visit (SCHED-3, SCHED-4); when the only fitting slots are such, the no-fit rule of 004 applies.
- **AC-2.3** WHEN an order is re-proposed because its hold was taken over, THE system SHALL send both its parties the cancellation and the new slot as in 004, with a sentence saying the slot had to be given to a more urgent job, and SHALL NOT count the re-proposal toward either party's refusal limit (REQ-NG-9).
- **AC-2.4** THE system SHALL trace a takeover as a decision naming both orders, the slot and both urgencies.
- **AC-2.5** WHEN the preempted order is re-proposed, THE system SHALL choose its next free slot after the lost one under the calendar rules of 002, without taking over any hold in turn.
- **AC-2.6** A scheduled visit SHALL never be released, moved or taken over by any later event: takeover, blackout or re-proposal (SCHED-3).

### US3 · The handyman's unavailability applies to every order (P1)

As the handyman, I want to say once that I cannot work tomorrow and have every tentative visit moved, so that I do not have to repeat it per order.

**Acceptance criteria (EARS):**

- **AC-3.1** WHEN the handyman's reply states unavailability that applies beyond the current order (for example "mañana no puedo nada", "I'm off on Friday"), THE system SHALL record it as a blackout: the stated days and hours, read as in 004 (a day alone is the whole day).
- **AC-3.2** WHEN a blackout is recorded, THE system SHALL release every tentative hold that overlaps it and re-propose each affected order to its next free slot outside the blackout, telling both parties the previous proposal is cancelled because the handyman is unavailable; these re-proposals count toward nobody's refusal limit.
- **AC-3.3** THE system SHALL NOT propose any later slot, for any order, that overlaps a recorded blackout.
- **AC-3.4** IF a scheduled visit overlaps a new blackout, THEN THE system SHALL keep it (SCHED-3) and trace a `blackout_conflict` for the office.
- **AC-3.5** THE order the handyman wrote on SHALL also be handled by its own intent (decline or counter) under 004, and its new slot SHALL avoid the blackout.
- **AC-3.6** A statement about the handyman's availability that applies to this order only SHALL NOT create a blackout.
- **AC-3.7** A blackout given as a weekday without a date SHALL apply to the next occurrence of that weekday from the reference time, and to that one only.

## Edge cases

- Tenant accepted v1; handyman `<NO RESPONSE>` twice: reminder, then `no_response` naming the handyman and stating that the tenant had accepted the slot.
- Tenant `<NO RESPONSE>` after the tenant accepted: not counted; traced.
- Handyman `<NO RESPONSE>` while the handyman has a confirmation request pending: counted.
- `<NO RESPONSE>`, then a decline, then `<NO RESPONSE>`: the count was reset; one reminder for the new version.
- Critical order, tenant `<NO RESPONSE>` first: immediate review with the slot and the handyman's state; the handyman gets nothing more (ORD-2).
- Critical order, handyman `<NO RESPONSE>` first: a reminder.
- Both parties silent: tenant reminder, handyman reminder, then whichever times out again closes the order; one result only (ORD-1).
- Low order holds Thursday 10:00; Critical order counters "Thursday morning": Thursday 10:00 goes to the Critical order, the Low order is re-proposed and told why, its refusal count unchanged.
- Medium order counters onto a Medium hold: no takeover; no-fit rule.
- Critical order counters onto a scheduled Low visit: no takeover (SCHED-3); no-fit rule.
- Preempted order's parties had accepted v1: acceptances forgotten with the new version (ACC-1).
- Handyman on WO-1: "mañana no puedo nada" when WO-2 holds tomorrow: WO-2 re-proposed outside tomorrow, WO-1 re-proposed by its own decline; both outside tomorrow; neither party's limit moves.
- Handyman: "el jueves no puedo, pero el viernes a las 9 sí" scoped to all: Thursday blackout for everyone; this order countered to Friday 09:00.
- Blackout overlapping a scheduled visit: visit kept, `blackout_conflict` traced.
- Blackout stated as a weekday: next occurrence only (AC-3.7).
- Blackout across 2026-10-25: windows and new slots carry the right offsets (TIME-1).
- Blackout that empties the next days: the preempted or blacked-out orders get the first free slot after it, however far.

## Scenarios

| Scenario / test | Covers | Input (summary) | Expected |
|---|---|---|---|
| Policy unit tests (`tests/unit/state.test.ts`) | AC-1.1–AC-1.8, AC-2.1–AC-2.6, AC-3.2–AC-3.6; **RUN-3**, **SCHED-3**, **SCHED-4**, ORD-1, ORD-2, ACC-1 | Timeout, takeover and blackout sequences | Counts, reminders, reviews, holds, versions |
| Calendar unit tests (`tests/unit/calendar.test.ts`, `availability.test.ts`) | AC-3.3 | Blackouts in slot search | No slot inside a blackout |
| `005-timeout-reminder` | AC-1.2, AC-1.3 | Handyman `<NO RESPONSE>` | Reminder in Spanish restating the slot |
| `005-timeout-twice` | AC-1.4 | Tenant accepts; handyman `<NO RESPONSE>` ×2 | Reminder, then `no_response` naming the handyman and the accepted slot |
| `005-timeout-reset` | AC-1.5 | `<NO RESPONSE>`, decline, `<NO RESPONSE>` | Two reminders, no review |
| `005-timeout-not-waiting` | AC-1.2, **RUN-3** | Tenant accepts, tenant `<NO RESPONSE>` ×3 | Nothing sent; traced as not counted; order still open |
| `005-timeout-critical-tenant` | AC-1.6 | Critical; handyman accepts; tenant `<NO RESPONSE>` | Immediate `no_response` stating the slot and the handyman's acceptance |
| `005-timeout-critical-handyman` | AC-1.7 | Critical; handyman `<NO RESPONSE>` | Reminder |
| `005-timeout-closed` | AC-1.8 | `<NO RESPONSE>` after `scheduled` | Traced `closed_order` |
| `005-preempt-counter` | AC-2.1, AC-2.3, AC-2.4, AC-2.5, **SCHED-4** | Low holds Thu 10:00; Critical counters Thu 09:00–12:00 | Critical gets 10:00; Low re-proposed with the note; Low refusals 0 |
| `005-preempt-equal` | AC-2.2 | Medium counters onto a Medium hold | No takeover; no-fit note |
| `005-preempt-scheduled` | AC-2.2, AC-2.6, **SCHED-3** | Critical counters onto a scheduled Low visit | No takeover; the visit stays |
| `005-blackout-day` | AC-3.1, AC-3.2, AC-3.3, AC-3.5 | Two orders held tomorrow; handyman on WO-1: scripted decline with scope all for tomorrow | Both re-proposed outside tomorrow; nobody's limit moves |
| `005-blackout-scheduled` | AC-3.4, **SCHED-3** | Scheduled visit tomorrow; blackout tomorrow | Visit kept; `blackout_conflict` traced |
| `005-blackout-this-order` | AC-3.6 | Handyman counter scoped to this order | Other order untouched |
| `005-blackout-weekday` | AC-3.7 | Blackout "Thursday" without a date | Next Thursday only |
| `005-blackout-dst` | AC-3.2, TIME-1 | Blackout across 2026-10-25 | New slots with the right offsets |
| Replay (`tests/scenarios/replay.test.ts`) | TRACE-2 | `005-preempt-counter`, `005-blackout-day` | Same frames and results from facts |

## Success criteria

- Across all 005 scenarios, no `<NO RESPONSE>` from a party that had accepted the current version produces a frame or a count.
- No `scheduled` visit ever appears in a `hold_released` trace.
- Every takeover trace names a higher urgency taking from a strictly lower one.
- RUN-3, SCHED-3 and SCHED-4 are cited by passing tests and `coverage-baseline.json` is empty.

## Assumptions

- Reminder wording is one fixed template per language and recipient; the "varied wording" idea from the planning notes is not needed by any requirement.
- The interpretation schema gains a `scope` field (`this_order` or `all`) that the model fills for the handyman's replies; tenants' replies are always `this_order`. The prompt version rises.
- A blackout is a fact of the calendar: it is derived from the interpretation, kept for the rest of the run, and never expires within it.
- "What is known" in the Critical review sentence is the proposed slot and the handyman's acceptance state; nothing from free text.
- Preempted and blacked-out orders get their next free slot after the lost one under the 002 rules, not inside any earlier stated availability.

- Takeover happens only when a higher-urgency party stated availability that nothing free fits; declines and re-proposals without availability take the next free slot without bumping anyone. Fewer cancellations for low-urgency parties; urgency still wins the contested hour.
- A weekday blackout without a date covers the next occurrence only, matching how the phrase is used; recurring unavailability has to be repeated.

## Open questions

None.
