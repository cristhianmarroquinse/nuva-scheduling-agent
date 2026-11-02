# ADR 0002 · Event-sourced core

**Status:** accepted

## Context
Traces must allow reconstructing the coordination. A log that is written next to mutable state can drift from it, and cannot rebuild state after a failure.

## Decision
`state = fold(apply, events)`. Events are facts only: `run_started` (including `sim_now`), `csv_loaded`, `msg_in`, `interpretation` (the validated model output), `llm_error`, `eof`. Holds, outgoing messages, decisions, state changes and terminal results are derived by the fold and written as projections for readers, never fed back as input. Every trace line, fact or projection, carries `timestamp`, `work_order_id` (null for run-level events), `event_type` and `detail`, as the spec requires. In phase 2, agent tool calls are model output and are therefore recorded as facts ([ADR 0005](0005-tiered-agent-escalation.md)).

## Consequences
- Replaying a trace rebuilds state deterministically without calling the model, which replaces recorded cassettes.
- "Exactly one terminal result" and "no overlap" are properties of a pure function and can be tested directly.
- In production the event log would move to a durable store (Temporal or a Postgres table) with one workflow per order.
- Storing derived data as events would create two sources of truth, so it is not allowed.

## Amendment (feature 004)
`answer`, the validated model-written reply to a question (REQ-NG-7), is a seventh fact type, for the same reason `interpretation` is one: it is model output, and replay must reproduce the frame it produced without calling the model.
