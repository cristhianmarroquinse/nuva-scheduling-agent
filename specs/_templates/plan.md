# NNN · Plan: [Feature name]

**Spec:** [spec.md](spec.md)

## Summary

What will change, in three to five lines.

## Design

Modules touched, new types, events (facts) and projections, pure functions. Keep facts and projections separate (ADR 0002).

## Constitution check

Every item must be ✅ or carry a justification in Complexity tracking.

| Check | Status |
|---|---|
| Model output only enters as a validated interpretation event (LLM-1) | |
| Model text only to the sender, from closed facts (LLM-2) | |
| Nothing but protocol on stdout; nothing on stderr (OUT-1) | |
| Time through the time module, Europe/Madrid, injected clock (TIME-1) | |
| State derived from facts; no projection fed back as input (ADR 0002) | |
| Exactly one terminal result per order; nothing after it (ORD-1, ORD-2) | |
| No overlap; scheduled visits never move (SCHED-1, SCHED-3) | |
| No new dependency or abstraction without a requirement asking for it | |
| Consistent with every accepted ADR | |

## Complexity tracking

| Deviation | Why it is needed | Simpler alternative rejected because |
|---|---|---|

## Test plan

Which invariants and acceptance criteria are covered by which unit tests and scenarios. Which pending invariants leave the baseline.

## Risks

- …
