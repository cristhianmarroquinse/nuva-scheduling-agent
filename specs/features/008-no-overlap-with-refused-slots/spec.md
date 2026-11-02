# 008 · Re-proposals never overlap a refused slot

**Status:** planned
**Product requirements:** REQ-NG-11 (new), REQ-NG-1, REQ-NG-4, REQ-NG-5, REQ-NG-9, REQ-SC-2, REQ-SC-3, REQ-SC-5, REQ-SC-6
**Invariants touched:** SCHED-1, SCHED-2, SCHED-5 (unchanged; every new slot must still satisfy them)
**Amends:** 004 AC-1.1 ("the next free slot after the declined one") and AC-4.1; 005 AC-2.5 and AC-3.2 inherit the new rule

## Why

A manual run showed the agent burning a tenant's three refusals on almost the same two hours. The tenant declined Wednesday 14:00–16:00 and got 15:00–17:00, declined that and got 16:00–18:00, declined again and the order went to review as `no_mutual_slot`. Each new proposal overlapped the one just refused, because "the next free slot after the declined one" was read as "starting one hour after it starts". A person who cannot make 14:00–16:00 most likely cannot make 15:00–17:00 either, so the agent closed for human review an order that might have had a solution, on weak evidence. The take-home leaves the choice of the next slot to us; it evaluates "sensible handling" of availability changes and "appropriate use of `requires_review`". This feature makes every slot the agent chooses on its own avoid the slots already refused in that order, so that three refusals mean three genuinely different options.

## User stories

### US1 · After a refusal, the agent offers a genuinely different slot (P1)

As a tenant or the handyman, I want the next proposal after I say no to be a time that does not overlap anything already refused for this job, so that I am not asked about nearly the same two hours again.

**Independent test:** one Medium order; the tenant declines three times without stating availability; the proposals are Wednesday 12:00–14:00, 14:00–16:00, 16:00–18:00 and no two overlap; the third decline closes the order as `no_mutual_slot`.

**Acceptance criteria (EARS):**

- **AC-1.1** THE system SHALL treat a proposal version as refused in an order WHEN either party declined it, countered it (including a mismatched acceptance and a counter with no fit) or withdrew from it, as counted by 004 AC-3.1.
- **AC-1.2** WHEN the system chooses the next free slot for an order on its own (a decline without stated availability, a withdrawal without stated availability, a counter whose availability has no free fit, a preemption, a blackout), THE system SHALL choose the first slot that starts after the start of the current proposal, satisfies the calendar rules of 002 and the hold and blackout rules of 004 and 005, AND overlaps no refused proposal of that order. This replaces 004 AC-1.1's "next free slot after the declined one".
- **AC-1.3** WHEN a party states availability (a counter, a mismatched acceptance or a withdrawal with times) AND a free slot fits it, THE system SHALL choose that slot under 004 AC-1.2 to AC-1.5 even if it overlaps a refused proposal of that order: an explicit statement wins over an earlier refusal.
- **AC-1.4** THE system SHALL NOT count refusals toward the refused set of any other order; the rule is per order.
- **AC-1.5** THE trace of every system-chosen re-proposal SHALL let a reader verify the rule: the `decision` event keeps its cause, party, version and slot as in 004 AC-2.4.

## Edge cases

- Decline of a slot that ends at the close of the window (Medium Wednesday 17:00–19:00): the next slot is the next weekday at 09:00.
- Refusals that are not contiguous: a Medium order refuses Wed 12:00–14:00, 14:00–16:00 and 16:00–18:00 (split between both parties, so no limit is reached), the tenant then names "Wednesday at 13:00" (honoured, AC-1.3) and the handyman declines it; the next slot starts after 13:00 but every Wednesday hour overlaps a refused slot, so it is Thursday 09:00–11:00 (today it would be 14:00–16:00).
- Preemption: the lost slot now belongs to the higher-urgency order, so it is not free anyway; the preempted order's earlier refusals are still avoided.
- Blackout: the blacked-out window is avoided as before; refused slots of each moved order are avoided too.
- DST: a refused slot on Sunday 25 October 2026 is compared by instant, not by wall clock.
- An explicit statement equal to a slot refused by the other party (the handyman declined Wed 14:00, then the tenant says "Wednesday at 14:00"): proposed again under AC-1.3; the handyman may decline again, which counts as his refusal.
- A refused slot never blocks other orders: another order may still be proposed that time.

## Scenarios

| Scenario | Covers | stdin (summary) | Expected |
|---|---|---|---|
| `008-decline-no-overlap` | AC-1.1, AC-1.2, AC-1.5 | Medium, `AGENT_NOW` Wed 10:00; tenant declines three times | v2 Wed 14:00–16:00, v3 Wed 16:00–18:00; then `no_mutual_slot` |
| `008-decline-end-of-day` | AC-1.2 | Medium; v1 moved to Wed 17:00–19:00 by a counter; tenant declines | Next slot Thu 09:00–11:00 |
| `008-non-contiguous` | AC-1.1, AC-1.2, AC-1.3 | Medium; handyman declines v1 Wed 12:00; tenant declines v2 14:00; tenant counters "Wednesday at 13:00"; handyman declines v4 | v4 Wed 13:00–15:00; v5 Thu 09:00–11:00 |
| `008-withdraw-no-overlap` | AC-1.1, AC-1.2 | Tenant accepts v1, then withdraws without times | v2 does not overlap v1 |
| `008-no-fit-counter` | AC-1.1, AC-1.2 | Tenant counters with a time that has no free fit | Fallback slot does not overlap v1; note "not available" to the tenant |
| `008-explicit-wins` | AC-1.3 | Handyman declines v1 Wed 12:00; tenant counters "Wednesday at 12:00" | v3 is Wed 12:00–14:00 again |
| `008-per-order` | AC-1.4 | High WO-1 (v1 Wed 12:00), Low WO-2 (v1 Wed 14:00); WO-2 tenant declines; then WO-1 tenant declines | WO-2 v2 Wed 16:00; WO-1 v2 Wed 14:00–16:00 (refused only by WO-2) |
| `008-preempted-avoids-refused` | AC-1.2 | Low order refused Wed 16:00 earlier; a High order takes over its hold | Low's re-proposal overlaps neither the lost slot nor its refused one |

## Success criteria

- In every scenario of 004, 005 and 008, no system-chosen re-proposal overlaps a refused proposal of the same order (checked from `decision` and `msg_in` events in the trace).
- The manual run that motivated this feature (Low order, three plain declines from Wed 14:00) proposes 14:00, 16:00 and Thu 09:00 instead of 14:00, 15:00 and 16:00.
- `pnpm check` is green; no invariant is weakened and the coverage baseline does not grow.

## Assumptions

- The rule applies only to slots the agent chooses on its own. Availability a party states explicitly is honoured even when it overlaps an earlier refusal, because people change their minds and the earlier refusal may have come from the other party.
- A refused slot is avoided for the rest of the order's life, not only right after the refusal.
- Refusals by either party count: the handyman declining a slot makes it a poor proposal for the tenant too, because the visit needs both.
- System-caused re-proposals (preemption, blackout) are not refusals and do not add to the refused set (REQ-NG-9).
- No calendar horizon changes: a search that skips refused slots can only move later, and the search limit of 002 is unchanged.

## Decisions

- **No overlap with refused slots** (decided 2026-11-03 after a manual run). The take-home only requires that visits never overlap each other; it says nothing about which slot to offer after a refusal. Three options were considered: avoid every refused slot of the order (chosen), avoid only the last refused slot, or jump to the next working day after each refusal. The first is the simplest rule that guarantees three genuinely different options before `no_mutual_slot`; the second gives the same result in the common case but can return to an old refused slot after a counter or a system re-proposal; the third delays visits even when free hours remain the same day.
- **An explicit statement wins over a refusal** (decided 2026-11-03). When a party names a time, it is proposed if free, even if it overlaps a slot refused earlier in the order.

## Open questions

None.
