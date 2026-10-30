# 000 · Product specification

Source of truth for *what* the system does. *How* and *why* live in [`docs/adr/`](../docs/adr/). Hard guarantees live in [`INVARIANTS.md`](INVARIANTS.md). Requirements use EARS phrasing (WHEN / IF / WHILE … THE system SHALL …) so that each one maps to scenarios.

## Purpose

Coordinate a handyman visit for every work order between the order's tenant and the single handyman, over stdin/stdout, until each order ends as `scheduled` or `requires_review`.

## Inputs

### Work orders

- **REQ-IN-1.** THE system SHALL read work orders from `/app/work_orders.csv` and SHALL NOT write to it.
- **REQ-IN-2.** THE system SHALL accept the schema `work_order_id,work_order,address,description,reported_at,urgency`, including quoted fields, and any number of rows following it.
- **REQ-IN-3.** THE system SHALL accept `urgency` values `Critical`, `High`, `Medium`, `Low`. IF a row is invalid, THEN THE system SHALL trace it and close that order as `requires_review` instead of stopping.
- **REQ-IN-4.** THE system SHALL infer the tenant language (Spanish or English) of each order from its description and title, defaulting to English on a tie, and SHALL trace the decision.

### Incoming messages

- **REQ-IN-5.** THE system SHALL read lines `<work_order_id>|<role> <message body>` from stdin, where `role` (`tenant` or `handyman`) is the sender.
- **REQ-IN-6.** WHEN the body is exactly `<NO RESPONSE>`, THE system SHALL treat it as a timeout from that sender.
- **REQ-IN-7.** IF a line is malformed, names an unknown order or an invalid role, or refers to an order that already has a terminal result, THEN THE system SHALL trace it and ignore it.
- **REQ-IN-8.** THE system SHALL accept input at any time, including while it is processing; messages may refer to any unfinished order in any order.

## Startup

- **REQ-ST-1.** WHEN the container starts, THE system SHALL start coordination for every work order in the CSV.
- **REQ-ST-2.** WHEN the container starts, THE system SHALL emit the initial message or messages for every order without waiting for any reply.
- **REQ-ST-3.** THE system SHALL allocate initial proposals in urgency order (Critical, High, Medium, Low; ties by `reported_at`).
- **REQ-ST-4.** WHEN an order is Critical, THE first message to its tenant SHALL include one short clause advising emergency services (112) in case of immediate danger.

## Scheduling

- **REQ-SC-1.** THE system SHALL treat every visit as lasting 2 hours, with a single handyman for all orders, and SHALL never schedule overlapping visits.
- **REQ-SC-2.** THE system SHALL propose slots starting on the hour, no earlier than one hour after the next full hour from the reference time, and never before the order's `reported_at`.
- **REQ-SC-3.** THE system SHALL propose Critical visits on any day between 08:00 and 21:00, and other visits Monday to Friday between 09:00 and 19:00; the whole visit SHALL fit inside the window.
- **REQ-SC-4.** THE system SHALL accept times offered by tenant or handyman between 07:00 and 22:00, on any day.
- **REQ-SC-5.** WHEN orders compete for the same availability, THE system SHALL give it to the higher urgency by taking over lower-urgency tentative holds and re-proposing to the affected order. A scheduled visit SHALL never be moved.
- **REQ-SC-6.** WHEN the handyman declares unavailability that applies beyond the current order, THE system SHALL apply it to every order and re-propose the holds it affects.

## Negotiation and acceptance

- **REQ-NG-1.** THE system SHALL propose concrete slots (date and time range) and SHALL send each new proposal to both parties, stating that any previous proposal for that order is cancelled.
- **REQ-NG-2.** THE system SHALL treat a reply as an acceptance only WHEN it accepts the latest proposal sent to that party AND any date or time it states matches the proposed slot: a stated range must contain the slot, and a stated point time must equal its start.
- **REQ-NG-3.** IF a party has two or more unanswered proposal versions, or an acceptance also states a constraint, an exclusion or a different time (for example "yes, but not Thursday"), THEN THE system SHALL ask a one-line confirmation of the specific slot before counting it. Polite idioms such as "no problem" or "sin problema" SHALL NOT trigger it.
- **REQ-NG-4.** WHEN a reply proposes other availability, THE system SHALL pick a concrete slot inside it and propose it to both parties.
- **REQ-NG-5.** WHEN a party withdraws availability before the order is scheduled, THE system SHALL release the hold and propose again.
- **REQ-NG-6.** WHEN the first party accepts, THE system SHALL acknowledge it briefly while waiting for the other.
- **REQ-NG-7.** WHEN a reply asks a question, THE system SHALL answer it from a closed list of known facts (or say it will check with the office), and SHALL NOT count it toward any limit.
- **REQ-NG-8.** IF a reply is unclear or contradictory, THEN THE system SHALL ask one clarification; IF the next reply from that party is also unclear or contradictory, THEN THE system SHALL close the order as `requires_review` (reason `contradictory_replies` if either reply was contradictory, otherwise `interpretation_failed`).
- **REQ-NG-9.** IF three proposals for an order have been declined or countered by a party, THEN THE system SHALL close it as `requires_review`. Re-proposals caused by the system (preemption, handyman blackouts) SHALL NOT count.
- **REQ-NG-10.** IF a reply refers to a different order, THEN THE system SHALL ask the sender to clarify; IF it stays unresolved, THEN THE system SHALL close the order as `requires_review`.

## Timeouts

- **REQ-TO-1.** THE system SHALL count `<NO RESPONSE>` only for a party it is waiting on, and SHALL reset that count on any real reply from that party.
- **REQ-TO-2.** WHEN a party times out for the first time, THE system SHALL send a reminder; WHEN it times out again, THE system SHALL close the order as `requires_review`.
- **REQ-TO-3.** WHEN the tenant of a Critical order times out, THE system SHALL close the order as `requires_review` immediately, with a reason that states what is known.
- **REQ-TO-4.** WHEN stdin ends, THE system SHALL process all queued input first, then close every unfinished order as `requires_review`.
- **REQ-TO-6.** WHEN every order has a terminal result, THE system SHALL flush its traces and exit with code 0.
- **REQ-TO-5.** THE system SHALL NOT use wall-clock waiting or timers.

## Output

### Messages

- **REQ-OUT-1.** THE system SHALL write each outgoing message as `WOID:<work_order_id>|ROLE:<role>`, newline, the body, then a blank line; `role` is the recipient.
- **REQ-OUT-2.** THE system SHALL write to the handyman in Spanish and to the tenant in the order's language.
- **REQ-OUT-3.** THE system SHALL state every date as an absolute date with weekday and time range in Madrid time, and SHALL include the work-order title in proposals and confirmations.
- **REQ-OUT-4.** THE system SHALL write nothing to stdout except protocol frames and terminal results, and nothing to stderr, including runtime warnings from Node or dependencies.

### Terminal results

- **REQ-RES-1.** WHEN both parties have accepted the same proposal and its hold is live, THE system SHALL send a confirmation to the tenant and to the handyman, THEN emit `WOID:<id>|RESULT:scheduled` and `SCHEDULED_FOR:<ISO 8601 datetime with Europe/Madrid offset>`.
- **REQ-RES-2.** WHEN coordination cannot be completed reliably, THE system SHALL emit `WOID:<id>|RESULT:requires_review` and `REASON:<short human-readable sentence>`.
- **REQ-RES-3.** THE system SHALL emit exactly one terminal result per order, and nothing more for that order afterwards.

## Traces

- **REQ-TR-1.** THE system SHALL write JSONL traces under `/app/traces`; every line SHALL contain `timestamp`, `work_order_id` (null for run-level events), `event_type` and `detail`.
- **REQ-TR-2.** THE traces SHALL cover incoming messages, outgoing messages, state changes, decisions with their reason, model calls, and terminal results, so that the coordination of each order can be reconstructed.
- **REQ-TR-3.** THE system SHALL write all runtime logs to files under `/app/traces`.

## Robustness

- **REQ-RB-1.** IF the model call fails after the SDK retries, THEN THE system SHALL treat that reply as unclear; IF it keeps failing for an order, THEN THE system SHALL close it as `requires_review`.
- **REQ-RB-2.** THE system SHALL NOT crash on any input.

## Reference time

- **REQ-TM-1.** THE system SHALL use the container clock in Europe/Madrid as the reference time, overridable with `AGENT_NOW`, and SHALL record it at startup.
- **REQ-TM-2.** IF `AGENT_NOW` is not set AND every order's `reported_at` is more than 7 days before the clock, THEN THE system SHALL use the latest `reported_at` as the reference time and trace that decision (the CSV is treated as a fixture).

## Delivery

- **REQ-DL-1.** THE repository SHALL contain a Dockerfile at its root; `docker build -t agent .` and the documented `docker run` command SHALL be the only steps needed.
- **REQ-DL-2.** Credentials SHALL come from `.env` (`ANTHROPIC_API_KEY`), which SHALL NOT be committed.
- **REQ-DL-3.** THE repository SHALL include the traces of at least one complete run, and a README documenting assumptions and trade-offs.

## Review reasons

Closed set of reason codes recorded in traces. The `REASON` line is a sentence written for a human.

| Code | When |
|---|---|
| `no_response` | Repeated timeouts, a Critical tenant timeout, or end of input |
| `no_mutual_slot` | Three proposals declined or countered by a party |
| `contradictory_replies` | Two consecutive unclear-or-contradictory replies, at least one contradictory |
| `interpretation_failed` | Two consecutive unclear replies |
| `llm_unavailable` | The model keeps failing for this order |
| `cross_reference` | A reference to another order stays unresolved |
| `invalid_work_order` | The CSV row cannot be used |
