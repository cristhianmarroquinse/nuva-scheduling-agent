# Scheduling agent for property maintenance

Coordinates handyman visits between tenants and a single handyman over stdin/stdout until every work order is `scheduled` or `requires_review`.

> Status: **v1**. Phase 1 of the [roadmap](docs/planning/04-roadmap.md) is complete: every product requirement in [`specs/000-product.md`](specs/000-product.md) is implemented, every invariant in [`specs/INVARIANTS.md`](specs/INVARIANTS.md) is covered by a test, and the model choice is backed by an [evaluation](eval/REPORT.md). Phase 2 (a bounded agent tier) is not started.

## Approach in one line

Code decides; the LLM interprets free text, and the code distrusts that interpretation at the edges.

## Build and run

```bash
docker build -t agent .
mkdir -p traces
docker run --env-file .env -i --rm \
  -v "$(pwd)/work_orders.csv:/app/work_orders.csv:ro" \
  -v "$(pwd)/traces:/app/traces" \
  agent
```

`docker build` runs the typecheck and the whole test suite in its first stage, without a key and without network access to the model, and fails if any test fails. The runtime image holds only the compiled output and production dependencies and runs as the unprivileged `node` user. If the host directory `traces/` is owned by another user on Linux, add `--user "$(id -u):$(id -g)"`.

`.env` must contain `ANTHROPIC_API_KEY`. It is never committed. Without it the agent still runs: every model call fails, replies are treated as not understood, and orders end in review instead of crashing.

Environment variables:

| Variable | Meaning |
|---|---|
| `ANTHROPIC_API_KEY` | Credentials for the model. |
| `AGENT_NOW` | Overrides the reference time ("now"), for example `2026-11-04T10:00` (Europe/Madrid when no offset is given). Without it the container clock is used, with one exception: if every order was reported more than 7 days ago, the CSV is treated as a fixture and "now" becomes its latest `reported_at`, so scripted replies with absolute dates keep working ([ADR 0003](docs/adr/0003-reference-time.md)). The choice is traced. |
| `AGENT_INTERPRETER=fake` | Test seam: a fake interpreter that reads scripted JSON replies. Used by the test suite; never set it in production. |

### Input

`/app/work_orders.csv`, read once and never written:

```
work_order_id,work_order,address,description,reported_at,urgency
WO-1001,Olor a gas en la cocina,"Calle Mayor 12, 3ºA","Desde esta mañana hay un fuerte olor a gas.",2026-11-04T08:30:00,Critical
```

`urgency` is `Critical`, `High`, `Medium` or `Low`. Quoted fields, commas and line breaks inside quotes are accepted. An invalid row is traced and its order ends `requires_review` (`invalid_work_order`); a row without a usable id is ignored. The tenant's language (Spanish or English) is inferred from the title and description.

Incoming messages arrive on stdin, one per line:

```
<work_order_id>|<role> <message body>
WO-1001|tenant Sí, perfecto
WO-1001|handyman <NO RESPONSE>
```

`role` is the sender, `tenant` or `handyman`. `<NO RESPONSE>` is a timeout from that sender. Malformed lines, unknown orders, invalid roles and lines for finished orders are traced and ignored. Lines are processed one at a time, in arrival order, while new ones are accepted.

### Output

Only protocol frames and results go to stdout; stderr stays empty (runtime warnings and uncaught errors go to the traces).

```
WOID:<work_order_id>|ROLE:<role>
<message body, one paragraph>

WOID:<work_order_id>|RESULT:scheduled
SCHEDULED_FOR:2026-11-05T15:00:00+01:00

WOID:<work_order_id>|RESULT:requires_review
REASON:<one human-readable sentence>
```

`role` is the recipient. Every order gets exactly one result; nothing is emitted for it afterwards. When stdin ends, open orders close as `requires_review` (`no_response`); when every order has a result, the process flushes its traces and exits 0. Traces are JSONL files under `/app/traces`, one per run, every line with `timestamp`, `work_order_id`, `event_type` and `detail`.

A complete real run is committed under [`traces/examples/`](traces/examples/): the CSV, the stdin script, the stdout and the trace, with a [description](traces/examples/README.md) of the exchange. `pnpm example` regenerates it with the real model.

## Design in brief

- **Code decides, the model interprets.** Free text enters the system only as a validated interpretation event; the calendar, acceptance, re-proposals, timeouts and results are decided by code ([ADR 0001](docs/adr/0001-deterministic-core-llm-interpreter.md)).
- **Facts and replay.** State is a fold over facts (`run_started`, `csv_loaded`, `msg_in`, `interpretation`, `llm_error`, `answer`, `eof`); holds, messages, decisions and results are projections written to the trace. Replaying a trace's facts reproduces the run without calling the model, and the test suite does so ([ADR 0002](docs/adr/0002-event-sourced-core.md)).
- **Invariants as the contract.** Twenty-three falsifiable statements (one terminal result, no overlap, scheduled visits never move, strictly higher urgency only, model never sets state, Madrid time everywhere, and so on). `pnpm invariants` fails unless every one is cited by a passing test title.
- **Startup** ([001](specs/features/001-io-protocol-startup/spec.md), [002](specs/features/002-calendar-initial-proposals/spec.md)): orders are loaded and validated, the reference time is recorded, and every order gets a first 2-hour slot in urgency order, Critical first, with one frame to the tenant in their language and one to the handyman in Spanish. Critical tenants are told to call 112 in case of immediate danger. Business windows: Critical any day 08:00–21:00, others Monday to Friday 09:00–19:00, never before the order's `reported_at` or one hour after the next full hour.
- **Interpretation and acceptance** ([003](specs/features/003-interpretation-acceptance/spec.md)): a reply goes through a regex fast path for bare yes/no, else a schema-constrained model call with one re-ask; an acceptance counts only when the stated day and time fit the proposal; both parties accepting the same version schedules the visit after confirmations to both. Unclear or contradictory replies get one clarification, then review.
- **Negotiation** ([004](specs/features/004-negotiation/spec.md)): declines, counters and withdrawals produce a new proposal to both parties, inside the stated availability (07:00–22:00 any day) when one fits; three refusals by one party end in `no_mutual_slot`; questions are answered by the model from a closed facts list, to the asker only; references to another order get one clarification, then review.
- **Timeouts, preemption, blackouts** ([005](specs/features/005-timeouts-preemption-blackouts/spec.md)): a `<NO RESPONSE>` counts only against the party being awaited, reminder first, review second, immediate review for a Critical order's tenant; a strictly higher-urgency order takes over a lower one's tentative hold when its stated availability fits nothing free; a handyman's "I can't tomorrow" scoped to all his work moves every affected tentative visit and is avoided from then on. Scheduled visits never move.

## Where AI is used and why

The model is called in exactly two places, and nowhere else:

1. **Interpreting a reply** into a closed structure: intent (`accept`, `decline`, `counter`, `question`, `withdraw`, `cross_reference`, `contradictory`, `unclear`), stated times as local Madrid date and time fields, exclusions, and whether a handyman's unavailability applies to all his work. The output is validated against a Zod schema (offsets, `Z` times and unknown fields are rejected), re-asked once on failure, and otherwise recorded as `unclear`. Bare yes/no replies never reach the model.
2. **Answering a question** from a closed facts list (title, address or "your address", the proposed slot, the 2-hour duration, the urgency, who comes, how to reply). The answer is validated (one paragraph, at most 400 characters, no date or time other than the proposed slot, none of the other party's words) and sent only to the asker; otherwise a fixed "we will check with the office" sentence is sent.

The model never sets state, holds, acceptances or results, never sees the other party's text, and its replies are data in the prompt, never instructions. Everything else is templates and rules, which is what makes the invariants testable without a key.

Why Haiku, with numbers. A golden set of 50 labelled replies (Spanish and English, every intent, relative dates, ranges, exclusions, idioms, hostile text) was run against each tier through the production prompt, schema and validator; the full report with every mismatch is in [`eval/REPORT.md`](eval/REPORT.md) and `pnpm eval --tier <regex|haiku|sonnet>` regenerates it.

| Tier | Model | Intent accuracy | Full accuracy | Resolved by regex | p50 latency | Cost for the set |
|---|---|---|---|---|---|---|
| regex | — | 8% | 8% | 8% | — | $0 |
| haiku | claude-haiku-5-5 | 88% | 72% | 8% | 1.8 s | $0.014 |
| sonnet | claude-sonnet-5-5 | 92% | 78% | 8% | 1.5 s | $0.232 |

Haiku is the default: Sonnet is four points better at seventeen times the cost, and both miss the same four intents (two withdrawals read as declines, which the policy treats identically; two cross-references read as questions, which gets an answer from the facts instead of a clarification). Sonnet handles the hostile replies better; Haiku took a frame-like text as an acceptance, which still needs the other party before anything is scheduled. The labels are hand-written and two of them are arguable.

## Assumptions and trade-offs

- **Language inference** is a stopword and diacritics heuristic on the title and description, English on a tie; no model call. Good enough for the two languages the product supports.
- **No calendar horizon.** An order takes the first free slot however far ahead; the product spec defines no "no slot available" outcome.
- **Notice.** My proposals start at least one hour after the next full hour from the reference time, and never before `reported_at`. Times offered by a party are honoured between 07:00 and 22:00 any day, outside the business windows.
- **A withdrawal counts as a refusal** toward the three-refusal limit, so a party cannot withdraw without end. The product requirement names declines and counters only; this is stricter and deliberate.
- **No fit for stated availability** still produces the next free slot, with a note that the requested times are not available, so every exchange ends in a concrete proposal.
- **Takeover only on stated availability.** A higher-urgency order bumps a lower-urgency tentative hold only when its party asked for times that nothing free fits. Declines never bump anyone. Scheduled visits are never taken.
- **A weekday blackout** ("el jueves no puedo") covers the next occurrence only.
- **Reminders then review.** One reminder, then `no_response`; a Critical order's tenant goes to review at the first silence, with the slot and the handyman's state in the reason.
- **The handyman's and the tenant's text is never forwarded** to the other party, not even the CSV description; the handyman gets the title, the address and the urgency.
- **The answer validator is strict**: a real answer that writes the slot time in another format is replaced by the fixed office sentence. Safe but curt.
- **Reference time** comes from the container clock, `AGENT_NOW`, or the fixture rule above; nothing in the agent waits on wall-clock time or timers.
- **Prompt wording is versioned** (`PROMPT_VERSION`), and every model call is traced with model, prompt version, latency and tokens.

## Known limitations

- The model reads withdrawals as declines and cross-references as questions on this set; the consequences are mild (same re-proposal; an answer instead of a clarification), but a cross-reference that keeps being answered will end the order in `interpretation_failed` or `cross_reference` only after the streak rules kick in.
- Hostile text can be read as a one-party acceptance by Haiku; the other party must still accept, and the validator keeps the model from touching state in any other way.
- Exclusions with only a start or an end on a counter are read conservatively; "except Tuesdays" style recurring constraints are not modelled.
- The run is a single process with in-memory state; durability (a workflow engine or a database) is the production step described in ADR 0002.
- Phase 2 would add a bounded agent tier for multi-intent messages ([ADR 0005](docs/adr/0005-tiered-agent-escalation.md)), an adversarial simulator and a repair loop. None of it is started.

## How it was built

The repository holds two things: the product, and the development harness I built it with. Evaluating the product needs only Docker; the harness is there to show how it was built ([ADR 0006](docs/adr/0006-spec-driven-harness.md), [planning record](docs/planning/README.md)).

| Part | Paths | Purpose |
|---|---|---|
| **Product** | `src/`, `Dockerfile`, `package.json`, `tsconfig*.json`, `traces/examples/` | The scheduling agent and a committed example trace. Only its compiled output goes into the runtime image |
| **Tests** | `tests/` | Unit tests, spawned-process scenarios with the fake interpreter, replay tests, and `tests/harness/` for the harness's own checks. They run in the Docker build stage and in `pnpm check` |
| **Evaluation** | `eval/` | The golden set, the scorer and the report; `pnpm eval` runs a tier, the model tiers by hand with a key |
| **Development harness** | `CLAUDE.md`, `.claude/` (rules, skills, hooks), `specs/` (product spec, invariants, feature specs), `scripts/` | The rules and checks the coding agent works inside |
| **Decisions** | `docs/planning/`, `docs/adr/` | How the architecture was chosen, and the individual decisions |

Every feature went through the same pipeline with Claude Code: `/spec` (user stories and EARS criteria, clarified with at most five questions), `/plan` (design, a constitution check against the invariants and the ADRs, ordered tasks), `/implement` (each test written and seen failing before its code; `pnpm check` after every task) and `/ship` (inspection, verification, consistency, commit). Hooks block edits that would break protocol purity or type-check, and refuse to finish while `pnpm check` is red. `pnpm check` is typecheck, the test suite and invariant coverage, whose baseline file may only shrink; it is empty now.

Features, in order: 001 I/O protocol and startup; 002 calendar and initial proposals; 003 interpretation boundary and acceptance; 004 negotiation; 005 timeouts, preemption and handyman blackouts; 006 golden set and evaluation; 007 delivery. Each has its spec, plan and tasks under `specs/features/`. The suite holds 386 tests across unit, scenario, replay, evaluation, delivery and harness files, and runs in under a minute.

Where the agent was wrong during development, the tests were right: several times a scenario I had written expected a slot the calendar correctly refused (a neighbouring hold, a second unanswered version), and the fix was to the expectation, after checking the spec, never to the code.
