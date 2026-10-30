# ADR 0006 · Spec-driven development harness

**Status:** accepted

## Context
The product is built with Claude Code. Without structure, agent-written code drifts from requirements and its errors surface late.

## Decision
A small, explicit harness in the repository: specs and invariants as the source of truth, rules that bound the agent, skills for the spec → plan → implement → converge flow, scoped review agents, hooks that block unsafe edits and refuse "done" while `pnpm check` is red, and sensors (invariant coverage, replay, evaluation, simulator). A bounded repair loop is added in phase 2. Details in [planning/03](../planning/03-harness-engineering.md).

## Consequences
The harness is part of the deliverable and must stay small and readable. The README reports what it produced, and separates autonomous fixes from manual ones.
