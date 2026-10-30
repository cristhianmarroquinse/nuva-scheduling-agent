# 01 · Problem analysis

## The task in one paragraph

Build a scheduling agent for a property-maintenance company. For every work order in a read-only CSV, coordinate a visit between the tenant and the single handyman over stdin/stdout until the order ends as `scheduled` (both parties explicitly accepted the same date and time) or `requires_review` (with a short reason). Delivered as a Docker container, with JSONL traces under `/app/traces`. An Anthropic account is provided.

## What is evaluated

| Criterion | What it really checks |
|---|---|
| Outcomes | Each order ends with the correct result, exactly once, and never changes afterwards |
| Communication | Right language (handyman always Spanish, tenant in the order's language), concise, unambiguous dates |
| Scheduling correctness | Nothing is scheduled without an explicit yes from both to the same slot; no overlaps |
| Robustness | Ambiguous, contradictory, changing and missing replies |
| Human intervention | Knowing when *not* to decide: `requires_review` is a feature, not a failure |
| Engineering | Structure, state handling, error handling |
| Traces | The coordination can be reconstructed from the files |

The spec states the intent directly: *"We care about how the agent coordinates, makes decisions, handles ambiguity, manages multiple conversations, and decides when human review is needed."* I read it as a test of judgement about where to use an LLM, not of how much LLM is used.

## Non-obvious requirements

1. **"Explicitly accepted"** means a yes to a concrete slot. "Tomorrow after 17:00 works" is a constraint, not an acceptance; a concrete slot must be proposed and confirmed.
2. **Daylight saving time.** Europe/Madrid moved from +02:00 to +01:00 on 2026-10-25, and the spec examples use +02:00. Offsets must come from a timezone library, never be hardcoded.
3. **Priority versus irreversibility.** Higher urgency wins competing availability, but a terminal result can never change. A low-urgency order that closes early cannot be moved later, so tentative holds that a higher urgency can take over are needed before anything is confirmed.
4. **One shared handyman.** He can accept the same hour for two orders, and a message about one order ("I'm sick tomorrow") can affect all of them.
5. **Reference time.** "Tomorrow" needs a "now". Wall-clock *waiting* is forbidden, reading the clock is not. See [ADR 0003](../adr/0003-reference-time.md).
6. **`<NO RESPONSE>` can repeat** and can arrive for a party we are not waiting on.
7. **Critical orders** (the example is a gas leak) raise a safety question: a handyman visit may not be the right first response.
8. **The terminal is reserved for the protocol.** SDK warnings, runtime warnings or a stray log line break the evaluator's parser.
9. **Input edge cases:** unknown or finished work orders, invalid roles, malformed lines, stdin closing while messages are still queued, LLM API failures. None may crash the process.
10. **Concurrency.** Input can arrive while a model call is in flight. Processing must not race on the shared calendar.
11. **Language.** There is no language column; it must be inferred.

## Spec coverage

Every requirement in the take-home and where the design addresses it. Section numbers refer to the final architecture in [02](02-architecture-selection.md#final-architecture).

| Requirement (take-home) | Addressed in |
|---|---|
| Outcomes are only `scheduled` or `requires_review` | 02 §9 |
| Read-only CSV at `/app/work_orders.csv`, given schema, must work with other orders | 02 §1 |
| Start coordination for all orders at startup; initial messages without waiting | 02 §1 |
| Stay ready for messages about any unfinished order, in any order; evaluator can always type | 02 §2, serial queue in the diagram |
| Schedule only when both explicitly accepted the same date and time | 02 §4, [ADR 0001](../adr/0001-deterministic-core-llm-interpreter.md) |
| Confirm to both parties before the result; report the agreed datetime | 02 §9 |
| `requires_review` with a short reason when coordination cannot complete reliably | 02 §6, §7, §9 |
| Exactly one terminal result; nothing more for that order afterwards | 02 §9, [ADR 0002](../adr/0002-event-sourced-core.md) |
| One handyman, 2-hour visits, no overlap | 02 §5 |
| Higher urgency wins competing availability (Critical, High, Medium, Low) | 02 §1, §5 |
| Handyman in Spanish; tenant in the order's language | 02 §1, §8 |
| Europe/Madrid; unambiguous dates | 02 §5, §8, [ADR 0003](../adr/0003-reference-time.md) |
| Multiple active orders; responses in any order | 02 §2, serial queue |
| `<NO RESPONSE>` as a timeout, possibly repeated; no wall-clock timeouts | 02 §7 |
| Outgoing frame `WOID:<id>\|ROLE:<role>`, body, blank line; ROLE is the recipient | 02 §8 |
| Incoming `<id>\|<role> <body>`; role is the sender | 02 diagram (protocol parse), §11 |
| Result formats `RESULT:scheduled` + `SCHEDULED_FOR`, `RESULT:requires_review` + `REASON` | 02 §9 |
| JSONL traces under `/app/traces` with timestamp, work order ID, event type, detail; covering incoming, outgoing, state changes, decisions, results | 02 §10, ADR 0002 |
| Commit traces from at least one complete run | [04](04-roadmap.md), phase 1 |
| Nothing but the protocol on stdout or stderr; runtime logs under `/app/traces` | 02 §10 |
| Scenarios: clear, ambiguous, contradictory, availability changes, conflicts, missing responses, simultaneous conversations | 02 §4–§7, scenario suite in [03](03-harness-engineering.md) |
| Dockerfile at the root; Docker is the only prerequisite; build and run commands | README, phase 1 |
| `.env` for `ANTHROPIC_API_KEY`, never committed | README, `.gitignore` |
| Assumptions and trade-offs in the README | Phase 1; this planning record and the ADRs are its source |
