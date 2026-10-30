# ADR 0003 · Reference time

**Status:** accepted (amended after the phase 0 review, before any implementation)

## Context
Relative expressions ("mañana", "next Thursday") need a "now". The spec forbids wall-clock *waiting* and timeouts, not reading the clock. The spec example (reported 7 Oct, scheduled "tomorrow, 8 October") reflects when the example was written. The evaluator may, however, reuse a fixed CSV and scripted replies that name absolute dates relative to the CSV.

## Decision
- `now` = the container clock in Europe/Madrid, overridable with `AGENT_NOW`.
- **Fixture rule:** if `AGENT_NOW` is unset and every order's `reported_at` is more than 7 days old, `now` = the latest `reported_at`, and the decision is traced. A stale CSV is a simulation fixture, and scripted replies will be anchored to it.
- `now` is recorded in the `run_started` event as `sim_now`.
- No slot is proposed before an order's `reported_at` or before `now`. The earliest proposal starts at least one hour after the next full hour.
- Date arithmetic uses Luxon with the `Europe/Madrid` zone, so the 2026-10-25 offset change is handled by the library, not by hand.

## Rejected alternatives
- **Always anchor to the latest `reported_at`.** With a fresh CSV, it ignores the real present the evaluator types against. With mixed dates, it delays older urgent orders.
- **Always use the clock.** With a stale fixture CSV, every scripted absolute date would be in the past, and orders would end in review for no real reason.

## Consequences
All outgoing messages state absolute dates with the weekday, so relative expressions in replies resolve against the same reference the evaluator sees. Explicit past dates in replies are detected and answered with the next valid slot.

## Amendment
The fixture rule was added after an independent review showed that a clock-only reference fails against a scripted evaluator replaying the spec's sample dates.
