# Invariants

Properties that must hold for every input. Each one is a single falsifiable statement. Tests cite the ID in the title of a `describe`, `it` or `test` call in a `*.test.ts` file; comments and skipped tests do not count. `pnpm invariants` fails when an ID is neither cited nor listed in [`coverage-baseline.json`](coverage-baseline.json), and when an ID is added back to the baseline.

Format: `- **ID (short name).** Statement.` IDs are never reused or renumbered.

## Orders

- **ORD-1 (one terminal result).** No work order ever receives more than one terminal result, and when the process exits (all orders closed, or end of input processed) every work order in the CSV has exactly one.
- **ORD-2 (terminal is final).** After an order's terminal result, the system emits no further message or result for that order.

## Acceptance

- **ACC-1 (explicit agreement).** An order is `scheduled` only if the tenant and the handyman both accepted the same proposal version, and that proposal's hold is live.
- **ACC-2 (confirm before result).** A `scheduled` result is preceded by a confirmation to the tenant and a confirmation to the handyman for that order.
- **ACC-3 (reported slot).** `SCHEDULED_FOR` equals the start of the accepted proposal.

## Scheduling

- **SCHED-1 (no overlap).** No two scheduled visits overlap, and no two live holds overlap.
- **SCHED-2 (duration).** Every proposed, held and scheduled visit lasts exactly 2 hours.
- **SCHED-3 (scheduled never moves).** A scheduled visit is never released, preempted or changed.
- **SCHED-4 (priority).** A hold is only taken over by an order of strictly higher urgency.
- **SCHED-5 (not before reported).** No visit is proposed or scheduled before the order's `reported_at` or the reference time recorded at startup.

## Communication

- **COM-1 (handyman language).** Every message to the handyman is in Spanish.
- **COM-2 (tenant language).** Every message to a tenant is in the language inferred for that order.
- **COM-3 (absolute dates).** Every proposal and confirmation states an absolute date with weekday and time range.

## Output

- **OUT-1 (protocol only).** stdout contains only well-formed protocol frames and terminal results; stderr is empty.
- **OUT-2 (frame shape).** Each outgoing message is `WOID:<id>|ROLE:<role>`, a body without blank lines, and a terminating blank line.

## Time

- **TIME-1 (zone).** Every datetime emitted or reasoned about is in Europe/Madrid with the offset in force at that instant.

## Model boundary

- **LLM-1 (no direct state).** Model output only enters the system as a validated interpretation event; it never sets state, holds or results directly.
- **LLM-2 (sender only).** Model-written text is only sent to the party whose message it answers.

## Traces

- **TRACE-1 (fields).** Every trace line is valid JSON with `timestamp`, `work_order_id`, `event_type` and `detail`.
- **TRACE-2 (replay).** Replaying the recorded facts reproduces the same state, outgoing messages and results without calling the model.

## Runtime

- **RUN-1 (no crash).** No input line, CSV content or model failure terminates the process before every order has a terminal result.
- **RUN-2 (startup).** On stdout, the initial frames for every order precede any frame caused by a stdin line.
- **RUN-3 (timeouts counted fairly).** A `<NO RESPONSE>` only counts against a party the system is waiting on.
