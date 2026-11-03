# 011 · A time a party names counts as their acceptance

**Status:** implemented
**Product requirements:** REQ-NG-2, REQ-NG-3, REQ-NG-4, REQ-NG-6, REQ-TO-1
**Invariants touched:** ACC-1, ACC-2, RUN-3 (unchanged: both parties still accept the same version before scheduling)
**Amends:** 004 AC-2.1 and AC-2.2 (both acceptances are forgotten on a re-proposal, except the one of the party whose exact time it is)

## Why

In the take-home's own example the handyman writes "Mañana a las 10:00 puedo." The agent proposes exactly Thursday 10:00 to both parties and then asks the handyman again whether Thursday 10:00 works for him, so every counter-proposal costs an extra round and an evaluator who does not answer it sees the order go to review at end of input. The e2e review of 2026-11-03 also found that the confirmation asked after two unanswered versions (REQ-NG-3) is not documented in the README.

## User stories

### US1 · The party who named the time is not asked again (P1)

As a tenant or the handyman, I want the visit I proposed, when the agent takes it exactly, to count as agreed by me, so that only the other party has to answer.

**Acceptance criteria (EARS):**

- **AC-1.1** WHEN a party's reply states a point time, or a range of exactly two hours, AND the system re-proposes exactly that visit, THE system SHALL record that party as having accepted the new version.
- **AC-1.2** THAT party SHALL receive, instead of a question, a message that says the previous proposal is cancelled, states the slot and says the agent is waiting for the other party; the other party receives the usual re-proposal.
- **AC-1.3** THAT party SHALL NOT be counted as having an unanswered version for it (REQ-NG-3), and SHALL NOT be awaited for timeouts on it (REQ-TO-1, RUN-3).
- **AC-1.4** A range longer than the visit, a date alone, the nearest slot when the time did not fit (009 AC-3.1), a takeover onto a different time, or a system-caused re-proposal SHALL NOT count as an acceptance.
- **AC-1.5** WHEN the other party accepts that version, THE order SHALL be scheduled with confirmations to both (ACC-1, ACC-2).

### US2 · The confirmation rule is documented (P2)

- **AC-2.1** THE README SHALL state that a bare yes from a party who received two or more proposal versions without answering gets a one-line confirmation of the latest slot, and why.

## Scenarios

| Scenario | Covers | stdin (summary) | Expected |
|---|---|---|---|
| `011-handyman-names-time` | AC-1.1, AC-1.2, AC-1.5 | The take-home example: handyman "Mañana a las 10:00 puedo"; tenant "Yes, Thursday at 10 is fine" | scheduled Thu 10:00 without asking the handyman again |
| `011-tenant-names-time-handyman-yes` | AC-1.1, AC-1.3 | Tenant counters "Thursday at 10"; handyman "Vale" (two versions unanswered) → confirmation; "Sí" | scheduled; the tenant is never asked again |
| `011-range-not-acceptance` | AC-1.4 | Tenant counters "Thursday afternoon" | both asked, as before |
| `011-named-time-timeout` | AC-1.3 | Handyman names a time; `<NO RESPONSE>` from the handyman | not counted (traced as not awaited) |

## Success criteria

- The take-home example line "Mañana a las 10:00 puedo" followed by one acceptance from the tenant schedules the order.
- `pnpm check` green.

## Decisions

- **A named time counts as the namer's yes** (decided 2026-11-03 with the user). The confirmation after two unanswered versions stays for everyone else and is documented.

## Open questions

None.
