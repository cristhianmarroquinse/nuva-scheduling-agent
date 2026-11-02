# 004 · Negotiation

**Status:** planned
**Product requirements:** REQ-NG-1, REQ-NG-3 (unanswered versions), REQ-NG-4, REQ-NG-5, REQ-NG-7, REQ-NG-9, REQ-NG-10, REQ-SC-4, REQ-OUT-2, REQ-OUT-3, REQ-TR-2 (decisions, model calls)
**Invariants touched:** LLM-2, SCHED-1, SCHED-2, SCHED-5, COM-1, COM-2, COM-3, ACC-1, ORD-1, ORD-2, TRACE-2
**Deferred to 005:** timeouts and reminders (REQ-TO-1…3, RUN-3), preemption between orders (REQ-SC-5, SCHED-3, SCHED-4), handyman unavailability that applies to every order (REQ-SC-6)

## Why

After 003 a reply is either a yes or a dead end: a decline, a counter-proposal, a question or a reference to another order is recorded and the order waits until end of input. Real conversations are made of exactly those replies. This feature closes the loop: a decline or a counter produces a new concrete proposal to both parties, questions are answered without counting against anyone, withdrawals release the slot and start again, and an order that cannot converge after three refusals, or that keeps drifting to another order, goes to review with the right reason. The model writes text for the first time, only to answer a question, only to the person who asked, and only from a closed list of facts.

## User stories

### US1 · A decline or counter-proposal leads to a new concrete proposal (P1)

As a tenant, I want to say "not then, Thursday afternoon works" and receive a concrete new slot, so that I never have to guess what to answer.

**Independent test:** scripted counters with a date, a range, a point time, a past date and an impossible window; each yields one new proposal to both parties, inside the stated availability when one fits.

**Acceptance criteria (EARS):**

- **AC-1.1** WHEN a party declines the current proposal without stating availability, THE system SHALL propose the next free slot after the declined one, under the calendar rules of 002, to both parties.
- **AC-1.2** WHEN a party states availability (one or more dates, ranges or point times), THE system SHALL propose the earliest free 2-hour slot that starts on the hour inside that availability, to both parties.
- **AC-1.3** THE system SHALL accept availability stated by a party between 07:00 and 22:00 on any day, including weekends and outside the business windows of 002, provided the whole visit fits between 07:00 and 22:00 (REQ-SC-4).
- **AC-1.4** THE system SHALL read a date without time as that day from 07:00 to 22:00, "after HH:MM" as HH:MM to 22:00, "before HH:MM" as 07:00 to HH:MM, and a point time as a visit starting exactly then.
- **AC-1.5** THE system SHALL never propose a slot that starts before the reference time plus the notice of 002 or before the order's `reported_at`, or that overlaps a hold or a scheduled visit (SCHED-1, SCHED-5); stated availability in the past is treated as not fitting.
- **AC-1.6** IF no free slot fits the stated availability, THEN THE system SHALL propose the next free slot under the calendar rules of 002, to both parties, and the message to the party who stated the availability SHALL say that the requested times are not available; it counts as a counter by that party (AC-3.1).
- **AC-1.7** WHEN an `accept` interpretation does not match the proposal (AC-2.2 of 003), THE system SHALL treat it as a counter-proposal with the stated times.
- **AC-1.8** WHEN the handyman declines or counters, THE system SHALL apply the same rules; his stated availability applies to this order only (every-order unavailability is 005).

### US2 · Every new proposal cancels the previous one for both parties (P1)

As the handyman, I want each new proposal to tell me the previous one is off, so that I never hold two slots for the same visit.

**Acceptance criteria (EARS):**

- **AC-2.1** WHEN the system makes a new proposal, THE system SHALL release the previous hold, take a hold for the new slot, raise the proposal version, and send the new proposal to the tenant (in the order's language) and to the handyman (in Spanish), each stating that the previous proposal is cancelled and giving the new absolute date with weekday and time range (COM-1, COM-2, COM-3).
- **AC-2.2** WHEN a new proposal is made, THE system SHALL forget both parties' acceptances; an order is scheduled only when both accept the new version (ACC-1).
- **AC-2.3** IF a party has two or more proposal versions they have not answered AND they reply with a bare acceptance, THEN THE system SHALL ask that party a one-line confirmation of the latest slot before counting it (REQ-NG-3); an acceptance that names the latest slot's date or time counts at once.
- **AC-2.4** THE system SHALL trace every new proposal as a decision with its cause (`decline`, `counter`, `no_fit`, `withdraw`) and the party that caused it.

### US3 · Three refusals end the order for review (P1)

As the evaluator, I want an order whose tenant or handyman has refused or countered three proposals to go to review, so that the office steps in instead of an endless exchange.

**Acceptance criteria (EARS):**

- **AC-3.1** THE system SHALL count, per party, the proposals that party has declined, countered (including a mismatched acceptance and a counter with no fit) or withdrawn from.
- **AC-3.2** IF a party's count reaches three, THEN THE system SHALL NOT make a new proposal and SHALL close the order as `requires_review` with reason `no_mutual_slot` and a sentence naming the party.
- **AC-3.3** THE system SHALL NOT count questions, clarifications or confirmation requests toward that limit.
- **AC-3.4** THE system SHALL NOT count re-proposals the system itself causes (preemption and blackouts in 005) toward that limit.

### US4 · Withdrawals release the slot and start again (P2)

As a tenant, I want to be able to take back my yes before the visit is confirmed, so that a change of plans does not book a visit I cannot attend.

**Acceptance criteria (EARS):**

- **AC-4.1** WHEN a party withdraws before the order is scheduled, THE system SHALL forget that party's acceptance, count it as a refusal by that party (AC-3.1) and, unless the limit is reached, make a new proposal to both parties (AC-2.1); if the reply states availability, the new slot is chosen inside it, otherwise it is the next free slot.
- **AC-4.2** IF a party withdraws after the order is scheduled, THEN THE system SHALL trace it and send nothing (ORD-2).

### US5 · Questions are answered from known facts, by the model, to the asker only (P1)

As a handyman, I want a quick answer when I ask whether there is parking, so that I do not have to call the office for every detail.

**Independent test:** a scripted question with a scripted model answer; the answer frame goes to the asker, nothing goes to the other party, the proposal stays open and no counter moves.

**Acceptance criteria (EARS):**

- **AC-5.1** WHEN a reply is interpreted as a question, THE system SHALL ask the model for an answer written from a closed facts list only: the order title, the address (to the handyman) or the fact that the visit is at the tenant's address (to the tenant), the proposed slot, the 2-hour duration, the urgency, that one handyman will come, and how to reply; anything else is answered with a fixed sentence that the office will check.
- **AC-5.2** THE system SHALL send the answer only to the party who asked, in their language (handyman: Spanish), together with a reminder of the proposed slot and a request to confirm or give availability (LLM-2).
- **AC-5.3** THE system SHALL validate the model's answer before sending: one paragraph of at most 400 characters, no dates or times other than the proposed slot, no text of the other party; IF validation fails or the model fails, THEN THE system SHALL send the fixed "will check with the office" sentence with the same reminder.
- **AC-5.4** THE system SHALL trace the answer call with model, prompt version, latency, tokens and outcome, and SHALL record the answer sent as a fact so that replay reproduces the frame without calling the model.
- **AC-5.5** A question SHALL NOT count toward the refusal limit, SHALL NOT change the proposal, and SHALL reset the asker's unclear streak.
- **AC-5.6** THE system SHALL place the asker's text and the facts in the request as data, never as instructions, and SHALL NOT include the other party's text.

### US6 · A reply about another order is clarified, then reviewed (P2)

**Acceptance criteria (EARS):**

- **AC-6.1** WHEN a reply refers to a different order, THE system SHALL ask the sender, in their language, to answer about this order's visit, restating the title and the proposed slot.
- **AC-6.2** IF the next reply from the same party again refers to another order, THEN THE system SHALL close the order as `requires_review` with reason `cross_reference`.
- **AC-6.3** WHEN a cross-reference and an unclear or contradictory reply occur consecutively from the same party, THE system SHALL close with `contradictory_replies` if either was contradictory, otherwise `cross_reference` if either was a cross-reference, otherwise `interpretation_failed`.

## Edge cases

- Tenant: "Thursday afternoon" for a Wednesday proposal: the model returns the window (for example 15:00–20:00); v2 is Thursday at the earliest free hour inside it.
- Tenant: "at 20:00" on a weekday: accepted (07:00–22:00), visit 20:00–22:00 (AC-1.3).
- Tenant: "at 21:00": the visit would end at 23:00, no fit → AC-1.6.
- Tenant: "Sunday morning" for a Medium order: accepted on a Sunday (party-stated availability is not limited to business days).
- Tenant: "tomorrow" when tomorrow is already full of holds: next free slot inside tomorrow's 07:00–22:00 if any, else no fit.
- Tenant counters with yesterday: no fit.
- Handyman already accepted v1, tenant counters: v2 to both, handyman's acceptance forgotten; the handyman answers "Sí" to v2 with one unanswered version (v1 was answered): counts.
- Tenant never answered v1, handyman declines, v2 sent; tenant replies "yes": two unanswered versions → confirmation question (AC-2.3); tenant replies "yes, Thursday 10:00" naming v2: counts.
- Decline, decline, decline by the tenant: third one closes as `no_mutual_slot`; the handyman receives no new proposal.
- Two counters by the tenant and one by the handyman: no review (limits are per party).
- Question then a decline: the question did not count; the decline is the first refusal.
- Question answered, then end of input: `no_response`; the answer did not change the proposal.
- Model answer contains "come at 9:00" for a 10:00 proposal: rejected; fixed sentence sent.
- Model answer quotes the other party or exceeds 400 characters: rejected.
- Model fails on the answer call: fixed sentence; the failure is traced; it does not count as a model failure of the interpretation streak.
- Cross-reference then unclear: `cross_reference`; cross-reference then contradictory: `contradictory_replies`.
- Withdraw after scheduled: traced `closed_order`, nothing sent.
- Counter that lands across 2026-10-25: the new slot carries the new offset (TIME-1).
- Re-proposal for one order never touches another order's holds (SCHED-1); if the only slot inside the window is held by another order, it is not free (preemption arrives in 005).

## Scenarios

| Scenario / test | Covers | Input (summary) | Expected |
|---|---|---|---|
| Window unit tests (`tests/unit/availability.test.ts`) | AC-1.2, AC-1.3, AC-1.4, AC-1.5 | Stated times → windows; slot search with holds, past windows, 07:00–22:00 bounds | Earliest fitting slot or none |
| Policy unit tests (`tests/unit/state.test.ts`) | AC-1.1, AC-1.6, AC-1.7, AC-2.1–AC-2.4, AC-3.1–AC-3.3, AC-4.1, AC-4.2, AC-5.5, AC-6.1–AC-6.3, ACC-1, ORD-1, ORD-2 | Interpretation sequences | Versions, holds, acceptances, counters, reasons |
| Answer unit tests (`tests/unit/answer.test.ts`) | AC-5.1, AC-5.3, AC-5.6 | Facts list, prompt assembly, validator cases | Facts only; rejects foreign dates, other party's text, length |
| `004-decline-reproposes` | AC-1.1, AC-2.1, AC-2.2, AC-2.4 | Handyman accepts v1; tenant `No` | v2 to both with "previous cancelled"; holds moved; both must accept again |
| `004-counter-range` | AC-1.2, AC-2.1 | Tenant: Thursday 15:00–20:00 | v2 Thursday 15:00–17:00 |
| `004-counter-point-evening` | AC-1.3 | Tenant: at 20:00 | v2 20:00–22:00 |
| `004-counter-date-weekend` | AC-1.3, AC-1.4 | Tenant: Sunday | v2 Sunday 07:00–09:00 or the earliest free hour |
| `004-counter-past` | AC-1.5, AC-1.6 | Tenant: a past date | Next free slot; "not available" note to the tenant |
| `004-counter-no-fit` | AC-1.6 | Tenant: at 21:00 | Next free slot; note |
| `004-counter-held` | AC-1.5, SCHED-1 | Two orders; tenant of B asks for A's held hour | Next free slot inside the window, not A's |
| `004-mismatch-accept` | AC-1.7 | Tenant: "yes, Thursday 10:00" for Wednesday | Treated as counter: v2 Thursday 10:00 |
| `004-handyman-counter` | AC-1.8 | Handyman: "mañana a las 9" | v2 to both |
| `004-two-versions-bare-yes` | AC-2.3 | Tenant silent on v1; handyman declines; tenant "Yes" | Confirmation question; then "yes, Thursday 10:00" schedules |
| `004-three-refusals` | AC-3.1, AC-3.2 | Tenant: decline, counter, decline | `no_mutual_slot` after the third; handyman gets nothing more |
| `004-limits-per-party` | AC-3.1 | Two tenant counters, one handyman counter | Still open |
| `004-question-not-counted` | AC-3.3, AC-5.5 | Question, then two declines | Still open after the two declines |
| `004-withdraw` | AC-3.1, AC-4.1, AC-4.2 | Tenant yes; tenant withdraws; later both accept; tenant withdraws again | v2 after the withdrawal, counted as one refusal; after scheduled, nothing |
| `004-question-answered` | AC-5.1, AC-5.2, AC-5.4, LLM-2 | Handyman asks about parking with a scripted answer | Answer frame to the handyman only; proposal unchanged |
| `004-question-answer-rejected` | AC-5.3 | Scripted answer with a foreign time; then one with the other party's words; then a failing call | Fixed sentence each time; failures traced |
| `004-cross-reference` | AC-6.1, AC-6.2, AC-6.3 | Cross-ref, clarification, cross-ref again | `cross_reference` |
| `004-counter-dst` | AC-1.2, TIME-1 | Counter across 2026-10-25 | New slot with `+01:00` |
| Replay (`tests/scenarios/replay.test.ts`) | TRACE-2 | `004-counter-range`, `004-question-answered` | Same frames from facts; no model call |

## Success criteria

- Across all 004 scenarios, every proposal after the first is sent to both parties, names the cancellation, and its hold replaces the previous one; no two live holds overlap.
- No order receives a fourth proposal caused by the same party; `no_mutual_slot` always follows exactly three refusals or counters by one party.
- Every model-written answer frame has the asker as recipient; no frame to the other party contains model-written text (LLM-2).
- LLM-2 is cited by passing tests and removed from `coverage-baseline.json`.

## Assumptions

- The interpretation schema of 003 already carries `times`, `exclusions`, `question` and `cross_reference`; 004 adds no new intent. Exclusions on a counter narrow the window (for example "Thursday but not before 15:00").
- Availability stated by a party is honoured only for the party's own order in 004; a handyman statement that applies to all orders is 005.
- The answer is a second, separate model call with its own prompt version; scenarios script it through the fake (the JSON body's `answer` field) and the real adapter uses the same model as 003.
- A withdrawal after a party accepted but before scheduling forgets only that party's acceptance; the other party's stands until the new version replaces it.
- The sentence for `no_mutual_slot` names the party ("The tenant declined or countered three proposals.").
- When no free slot fits the stated availability, the system still proposes the next free slot and tells the party their times are unavailable, so every exchange ends in a concrete slot; the attempt counts as a counter.
- A withdrawal counts as a refusal toward the three-refusal limit, by decision: a party cannot withdraw without limit. REQ-NG-9 names declines and counters; this reading is stricter and is recorded here.

## Open questions

None.
