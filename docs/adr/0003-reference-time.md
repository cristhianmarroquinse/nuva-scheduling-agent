# ADR 0003 · Reference time

**Status:** accepted

## Context
Relative expressions ("mañana", "next Thursday") need a "now". The spec forbids wall-clock *waiting* and timeouts, not reading the clock. The spec example (reported 7 Oct, scheduled "tomorrow, 8 October") reflects when the example was written.

## Decision
`now` = the container clock in Europe/Madrid, overridable with `AGENT_NOW`. No slot is proposed before an order's `reported_at`, and the earliest proposal starts at least one hour after the next full hour. Recorded in the `run_started` event as `sim_now`. A trace warning is written when orders are more than 7 days old (likely a sample CSV).

## Rejected alternative
Anchoring to the latest `reported_at`. With a sample CSV it would propose dates in the past relative to the evaluator, who types relative expressions against the real present. With a mixed CSV it would delay older urgent orders.

## Consequences
All outgoing messages state absolute dates with the weekday, so relative expressions in replies resolve against the same clock the evaluator uses. Explicit past dates in replies are detected and answered with the next valid slot.
