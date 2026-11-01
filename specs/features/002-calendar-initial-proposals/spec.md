# 002 · Calendar and initial proposals

**Status:** implemented
**Product requirements:** REQ-ST-1, REQ-ST-2, REQ-ST-3, REQ-ST-4, REQ-SC-1, REQ-SC-2, REQ-SC-3, REQ-NG-1 (initial proposal to both parties), REQ-OUT-2, REQ-OUT-3, REQ-TR-2 (outgoing messages, decisions)
**Invariants touched:** SCHED-1, SCHED-2, SCHED-5, COM-1, COM-2, COM-3, TIME-1, RUN-2
**Deferred to later features:** acceptance and confirmations (ACC-*, REQ-RES-1), negotiation on replies (REQ-NG-2…10), preemption and blackouts (REQ-SC-5, REQ-SC-6, SCHED-3, SCHED-4), timeouts (REQ-TO-1…3, RUN-3), the model boundary (LLM-*)

## Why

Nothing can be negotiated until both parties have a concrete slot in front of them. The evaluator expects every order to start on its own at container start, with a proposal that already respects the single handyman, the 2-hour visit, the business hours and the urgency order. Built on 001, this feature adds the calendar and the first message of every order, written once in its final form: the same proposal text later features reuse for re-proposals. No reply is interpreted yet; a run still ends with `no_response` closures at end of input.

## User stories

### US1 · Every order gets a first slot in urgency order (P1)

As the evaluator, I want each usable order to receive one concrete slot at startup, allocated Critical first, so that urgent orders get the earliest visits.

**Independent test:** a CSV with one order of each urgency and an immediate EOF; the traces show four non-overlapping proposals, the Critical one earliest, then High, Medium, Low.

**Acceptance criteria (EARS):**

- **AC-1.1** WHEN the CSV is loaded, THE system SHALL allocate one proposed slot to every order that is still open after validation, before reading any stdin line.
- **AC-1.2** THE system SHALL allocate slots in urgency order `Critical`, `High`, `Medium`, `Low`; ties by earlier `reported_at`, then by CSV order.
- **AC-1.3** THE system SHALL give each order the earliest slot that satisfies AC-2.1 to AC-2.4 and does not overlap a slot already allocated in this run.
- **AC-1.4** THE system SHALL record each allocation as a tentative hold, traced with the order, the proposal version (`1`) and the slot start and end with the Europe/Madrid offset.
- **AC-1.5** IF an order was closed at load time (`invalid_work_order`), THEN THE system SHALL allocate nothing and send nothing for it.

### US2 · Proposed slots respect the calendar rules (P1)

As the handyman, I want every proposed visit to be 2 hours, inside my working hours and never overlapping another visit, so that the plan is feasible as written.

**Independent test:** calendar unit tests over fixed reference times, including one on each side of 2026-10-25, plus a scenario whose stdout shows the slots.

**Acceptance criteria (EARS):**

- **AC-2.1** THE system SHALL propose visits that last exactly 2 hours and start on the hour.
- **AC-2.2** THE system SHALL propose no visit starting earlier than one hour after the next full hour following the reference time recorded at startup, and none starting before the order's `reported_at`.
- **AC-2.3** WHEN the order is `Critical`, THE system SHALL propose only visits that start and end between 08:00 and 21:00 Europe/Madrid, on any day of the week.
- **AC-2.4** WHEN the order is `High`, `Medium` or `Low`, THE system SHALL propose only visits that start and end between 09:00 and 19:00 Europe/Madrid, Monday to Friday.
- **AC-2.5** THE system SHALL never hold two slots that overlap, for any two orders.
- **AC-2.6** THE system SHALL compute every slot in Europe/Madrid with the offset in force at that instant, so that slots on either side of 2026-10-25 carry `+02:00` and `+01:00` respectively.

### US3 · Both parties receive the proposal, each in their language (P1)

As a tenant, I want a first message in my language that names my issue and proposes a concrete day and time, so that I can answer yes or suggest another time.

**Independent test:** a Spanish order and an English order; stdout holds a tenant frame in each language and a handyman frame in Spanish for both, every one stating the absolute date with weekday and time range.

**Acceptance criteria (EARS):**

- **AC-3.1** WHEN a slot is allocated to an order, THE system SHALL write one frame to the tenant and one frame to the handyman for that order, without waiting for any reply.
- **AC-3.2** THE system SHALL write the tenant frame in the language inferred for the order, and the handyman frame in Spanish.
- **AC-3.3** THE system SHALL state the proposed slot in both frames as an absolute date with weekday, day, month, year and the time range `HH:MM` to `HH:MM`, in Madrid time, in the language of the frame.
- **AC-3.4** THE system SHALL include the work-order title in both frames.
- **AC-3.5** THE system SHALL include the order's address and urgency in the handyman frame, and SHALL NOT include the description in either frame.
- **AC-3.6** THE system SHALL ask each party, in one sentence, to confirm the slot or to state other availability.
- **AC-3.7** WHEN the order is `Critical`, THE first tenant frame SHALL contain one short clause advising to call 112 in case of immediate danger, in the tenant's language; frames to other orders and to the handyman SHALL NOT contain it.
- **AC-3.8** THE system SHALL trace every outgoing frame with recipient, language, proposal version and slot.

### US4 · Startup frames come first and the run still ends cleanly (P1)

As the evaluator, I want all initial frames on stdout before anything caused by my input, and the same clean end as before, so that my harness can read the plan before it answers.

**Independent test:** lines and EOF written to stdin before the process starts; stdout begins with every initial frame, followed only by the `no_response` results.

**Acceptance criteria (EARS):**

- **AC-4.1** THE system SHALL write every initial frame before any frame or result caused by a stdin line or by end of input, even when input is already queued at startup.
- **AC-4.2** THE system SHALL write the initial frames in allocation order (AC-1.2), tenant frame then handyman frame for each order, so that stdout and the traces share one order.
- **AC-4.3** WHEN stdin ends, THE system SHALL close every open order as in 001 (`no_response`), and each hold SHALL be traced as released.
- **AC-4.4** WHEN a line arrives for an order with an open proposal, THE system SHALL trace it as in 001 and emit nothing (replies are interpreted in a later feature).

## Edge cases

- Reference time exactly on the hour (10:00:00): the next full hour is 11:00, so the earliest start is 12:00.
- Reference time 18:30 on a Friday, non-Critical order: 19:00 and 20:00 do not fit; the slot is Monday 09:00–11:00.
- Reference time 18:30, Critical order: 20:00–22:00 ends after 21:00; the slot is 08:00–10:00 next day, including Saturday or Sunday.
- Reference time Saturday 24 October 2026 20:00 (`+02:00`): Critical slot Sunday 25 October 08:00–10:00 (`+01:00`); High slot Monday 26 October 09:00–11:00 (`+01:00`).
- Two Critical orders: the second takes the next free slot of the same day (10:00–12:00), not a later day.
- A `Low` order reported before a `Critical` one: the Critical order still gets the earlier slot (AC-1.2).
- `reported_at` after the reference time (a stale CSV with one fresh row): the slot starts no earlier than the next hour at or after `reported_at`.
- Identical urgency and `reported_at`: CSV order decides.
- Title with line breaks, frame-like text or `|`: it appears inside the body as one line; the frame stays well-formed (001 AC-6.4).
- Many orders (for example 30 non-Critical): slots spill into following working days; no order is left without a slot and none is sent to review for lack of a slot.
- Header-only CSV or every row invalid: no proposal, same behaviour as 001.
- Mixed languages: tenant frames differ per order; every handyman frame is Spanish (COM-1, COM-2).
- A line for a proposed order arriving before the proposals were written: still processed after the startup frames (AC-4.1, RUN-2).

## Scenarios

Calendar rules are covered by unit tests on fixed reference times; protocol-visible behaviour by scenarios (`tests/scenarios/002-*.txt`) run with `AGENT_NOW` fixed.

| Scenario / test | Covers | Input (summary) | Expected |
|---|---|---|---|
| `002-urgency-order` | AC-1.1, AC-1.2, AC-1.3, AC-1.4, AC-3.1, SCHED-1 | One order per urgency, Low reported first; EOF | Four proposals, Critical earliest, none overlapping; holds traced; results after frames |
| `002-invalid-row-no-proposal` | AC-1.5 | One valid, one invalid row; EOF | Frames only for the valid order; `invalid_work_order` result for the other |
| Calendar unit tests | AC-2.1–AC-2.5, SCHED-1, SCHED-2, SCHED-5 | Reference times on the hour, 18:30 Friday, weekend, future `reported_at`, full days | Earliest valid slot per rule; no overlap across a sequence of allocations |
| `002-dst-weekend` | AC-2.3, AC-2.4, AC-2.6, TIME-1 | `AGENT_NOW=2026-10-24T20:00`, one Critical and one High; EOF | Critical Sunday 25 Oct 08:00 `+01:00`; High Monday 26 Oct 09:00 `+01:00`; both in frames and traces |
| `002-languages` | AC-3.2, AC-3.3, AC-3.4, AC-3.6, COM-1, COM-2, COM-3 | Spanish order and English order; EOF | Tenant frames in `es` and `en`, handyman frames in Spanish, each with weekday, date, range and title |
| `002-handyman-frame` | AC-3.5 | One order with address; EOF | Handyman frame names title, address and urgency; neither frame contains the description |
| `002-critical-112` | AC-3.7 | One Critical (es), one Critical (en), one High; EOF | 112 clause in both Critical tenant frames, in each language; absent elsewhere |
| Trace-frames test (`tests/scenarios/002.test.ts`) | AC-3.8, REQ-TR-2 | Every 002 scenario | One `msg_out` trace per frame with recipient, language, version and slot |
| `002-queued-input-first` | AC-4.1, AC-4.2, AC-4.3, AC-4.4, RUN-2 | Three orders; lines for two of them and EOF written before start | All six frames first, in allocation order; `no_response` results last; holds traced as released |
| `002-many-orders` | AC-1.3, AC-2.5, SCHED-1 | 12 non-Critical orders, `AGENT_NOW` Monday 07:00 | Five slots Monday, five Tuesday, two Wednesday; no overlap |
| Replay (`tests/scenarios/replay.test.ts`) | TRACE-2 | `002-urgency-order` | Folding the facts reproduces holds, frames and results |

## Success criteria

- For any CSV with N usable orders, stdout starts with exactly 2·N frames before any result, and every order's hold is traced with a 2-hour slot inside its window.
- Across all 002 scenarios, no two traced holds overlap, and every slot start is at least one hour after the next full hour following `sim_now` and not before the order's `reported_at`.
- Every date in a frame carries the weekday and the time range, and every traced instant carries the Madrid offset in force on that date.
- SCHED-1, SCHED-2, SCHED-5, COM-1, COM-2, COM-3, TIME-1 and RUN-2 are cited by passing tests and removed from `coverage-baseline.json`.

## Assumptions

- The calendar has no horizon: an order takes the first free slot however far ahead it is. The product spec defines no "no slot available" outcome, and the single-handyman capacity makes one unnecessary for realistic CSV sizes.
- "The next full hour" is strictly after the reference time: at 10:00:00 it is 11:00, so the earliest start is 12:00.
- The earliest start for an order is the later of the reference-time bound and `reported_at` rounded up to the hour; the window rules then apply.
- Holds taken at startup are tentative. Nothing in this feature releases or moves them except end of input; takeover by higher urgency and release on withdrawal arrive with REQ-SC-5 and REQ-NG-5.
- The initial proposal does not say "any previous proposal is cancelled", since there is none. Re-proposals in later features add that sentence to the same template.
- Message wording is fixed by templates per language and held constant by the scenarios; the spec fixes the content elements, not the exact sentences.
- SCHED-3 and SCHED-4 stay in `coverage-baseline.json`: no visit can become `scheduled` and no hold can be taken over until acceptance (REQ-RES-1) and preemption (REQ-SC-5) exist. Covering them here would mean takeover code that no 002 behaviour exercises.
- The handyman's first message carries the title, the address and the urgency. The tenant's description is free text from the CSV and is never forwarded to the other party.
- Startup frames are written in allocation order rather than CSV order, so a reader sees the urgent orders first and the trace order equals the stdout order.

## Open questions

None.
