# ADR 0004 · Interpretation cascade

**Status:** accepted

## Context
Many replies are trivial ("Sí", "Yes", "OK", "Vale", `<NO RESPONSE>`). Sending them to a model adds cost, latency and variance for no benefit. Others need language understanding.

## Decision
1. Regex fast path for trivial replies and the timeout marker.
2. Otherwise `claude-haiku-5-5` via `messages.parse` with a Zod schema. Dates are returned as local `{date, time}` fields; code attaches Europe/Madrid.
3. Validation failure after one re-ask → `unclear`.

Model choice is decided by data: a golden set of about 40 Spanish and English phrases (clear, ambiguous, contradictory, relative dates, exclusions) is run against the regex baseline, Haiku and Sonnet. The README reports accuracy, cost and latency per tier and the share of messages resolved without a model.

## Consequences
The "when to use AI" question is answered with numbers. A non-plain acceptance containing contrast or negation words is restated before closing, which protects against a model dropping a constraint.
