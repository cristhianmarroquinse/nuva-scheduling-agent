# ADR 0001 · Deterministic core, LLM as interpreter

**Status:** accepted

## Context
The agent must never schedule without explicit agreement, never overlap visits, and emit exactly one terminal result per order. Replies are free text in Spanish or English, often ambiguous or contradictory.

## Decision
The LLM only interprets incoming free text into a validated structure. Deterministic code owns state, the calendar, acceptance, policy, outgoing proposals and confirmations, and terminal results. The LLM writes free text only for answers to questions, addressed to the sender, from a closed facts block, behind a validator.

## Alternatives
- Tool-calling agent that drives negotiation over a rules layer: more flexible wording, but a tenant's text could reach the handyman, acceptance becomes a model judgement, results vary between runs, and there is more machinery to verify. See [planning/02](../planning/02-architecture-selection.md).
- No LLM: cannot read real constraints ("only afternoons this week", "any day except Tuesday"). Kept as the baseline in the evaluation.

## Consequences
Invariants are testable without an API key. Communication relies on templates plus bounded LLM answers. Hard multi-intent messages are handled conservatively until the phase 2 tier ([ADR 0005](0005-tiered-agent-escalation.md)).
