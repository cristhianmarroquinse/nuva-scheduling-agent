# ADR 0005 · Tiered agent escalation (phase 2)

**Status:** proposed

## Context
Some messages exceed a single structured interpretation: several intents, references to another order, soft preferences, exclusions. Templates handle them conservatively.

## Decision
Behind `AGENT_TIER=on`, messages matching deterministic triggers (multi-intent, `crossRef`, preference or exclusion constraints, validator failure, two consecutive `unclear`) escalate to one bounded agent turn. Tools: `getContext`, `findSlots`, `proposeSlot`, `recordConstraint` (with quoted evidence), `replyToSender`, `requestReview`. No finalize tool and no acceptance tool: acceptance and terminal results stay in the core. Six tool calls at most; template fallback. Every tool call is recorded as an event, so runs remain replayable.

The tier is enabled by default only if the full scenario suite passes with zero invariant violations and the hard scenarios improve. Otherwise it ships disabled and documented.

## Consequences
Shows a bounded agent where language is open-ended, without giving the model control over correctness. Adds latency (about 3–6 s) on escalated messages only.
