# Scheduling agent for property maintenance

A scheduling agent for a property maintenance company. Each work order in a read-only CSV needs a 2-hour visit from the single handyman; the agent talks to the tenant (in the tenant's language) and to the handyman (in Spanish) over stdin and stdout, holds and moves visit slots on one shared calendar, and ends every order as `scheduled` or `requires_review` with a reason. Code makes every decision; Claude only turns free-text replies into a validated structure and answers questions from a closed list of facts.

Status: **v1**. Every requirement of the take-home is implemented, each of the 23 invariants in [`specs/INVARIANTS.md`](specs/INVARIANTS.md) is covered by a test, the image only builds when the whole suite passes, the model choice is backed by an [evaluation](eval/REPORT.md), and one real run is committed under [`traces/examples/`](traces/examples/).

## Try it in two minutes

```bash
docker build -t agent .                                  # runs typecheck + 445 tests inside; fails if any fails
cp traces/examples/work_orders.csv .                     # four orders of mixed urgency
cp .env.example .env                                     # then put your key in ANTHROPIC_API_KEY=
mkdir -p traces
docker run --env-file .env -i \
  -v "$(pwd)/work_orders.csv:/app/work_orders.csv:ro" \
  -v "$(pwd)/traces:/app/traces" \
  agent < traces/examples/stdin.txt
```

That is the run command from the take-home, fed with the committed example. The agent prints the first proposals for the four orders, reacts to the eleven scripted replies, writes the trace under `traces/`, and exits when every order has a result. Type instead of redirecting stdin to drive it yourself: one `<work_order_id>|<role> message` per line, `<NO RESPONSE>` as the body for a timeout.

Without a key the agent still starts and never crashes: every model call fails, the reply is treated as not understood, and after two failures in a row the order ends in review with reason `llm_unavailable`. Bare "yes" and "no" replies do not need the model and still schedule.

Environment variables:

| Variable | Meaning |
|---|---|
| `ANTHROPIC_API_KEY` | Credentials for the model, from `.env` (never committed; `.env.example` shows the shape). |
| `AGENT_NOW` | Overrides the reference time, for example `2026-11-04T10:00` (Europe/Madrid when no offset is given). Without it the container clock is used, with one exception that matters for the take-home's sample CSV: if every order was reported more than 7 days ago, the CSV is treated as a fixture and "now" becomes its latest `reported_at`, so "tomorrow" in a scripted reply means the day after the orders, not the day after the real date. The choice is traced in `run_started` ([ADR 0003](docs/adr/0003-reference-time.md)). |
| `AGENT_INTERPRETER=fake` | Test seam: scripted replies instead of the model. Used by the test suite only. |

## How it coordinates, decides and escalates

**Startup.** Orders are loaded and validated (an unusable row ends in review as `invalid_work_order`), the tenant's language is inferred from the title and description, and every usable order gets a first concrete slot in urgency order, Critical first and ties by `reported_at`. Each order gets one frame to the tenant and one to the handyman before any reply is read. A Critical tenant's first message adds one clause about calling 112 in case of immediate danger.

**Calendar.** One handyman, 2-hour visits on the hour, never overlapping. The agent's own proposals fall in business windows: Critical any day 08:00–21:00, other urgencies Monday to Friday 09:00–19:00, no earlier than the order's `reported_at` and at least one full hour after the next full hour. Times a party offers are honoured between 07:00 and 22:00 on any day, even outside those windows.

**Explicit agreement.** A reply counts as an acceptance only when its intent is `accept` *and* the day or time it names fits the proposal (a range must contain the visit, a point time must equal its start). "Yes, Thursday at 10" to a Wednesday proposal is a counter-proposal, not a yes. "Yes, but not Thursday" to a Wednesday proposal gets a one-line confirmation of the exact slot before it counts; "yes, but not before 13:00" to a 12:00 visit rules the visit out, so it is a counter-proposal, not a yes. An order is `scheduled` only when both parties accepted the same proposal version while its hold is live; confirmations go to both, then the result with `SCHEDULED_FOR`.

**Negotiation.** A decline, a counter-proposal or a withdrawal produces a new proposal to both parties, inside the stated availability when something fits, else the free slot closest to the stated time on the day the party named, else the next free slot that overlaps neither a proposal already refused in that order nor any day or time a party said they cannot do; the "times you suggested are not available" note goes only to a party who suggested times; the message says the previous proposal is cancelled. Questions are answered from a closed facts list and count toward nothing. A reply that references another work order gets one clarification.

**Several orders at once.** All orders share one calendar, and tentative holds are the coordination primitive: a proposal reserves its slot until it is accepted by both, moved, or released. Input lines for different orders interleave freely and are processed one at a time in arrival order. When a higher-urgency order's party asks for times and the only fitting slot is held tentatively by a strictly lower-urgency order, the hold changes hands and the other order is re-proposed and told why, without penalty. A scheduled visit is never moved by anything. The example shows it: WO-1002's counter lands at Thursday 15:00 because Thursday 09:00 is held by WO-1003 ([traces/examples/README.md](traces/examples/README.md)).

**Timeouts.** `<NO RESPONSE>` counts only against a party the agent is actually waiting on: the first one gets a reminder restating the slot, the second ends the order in review. The tenant of a Critical order goes to review at the first silence, with the slot and the handyman's state in the reason. Any real reply resets the count. Nothing waits on wall-clock time.

**Handyman unavailability.** When the handyman says something that applies to all his work ("mañana no puedo nada"), every tentative visit in that window is moved, in priority order (the most urgent order picks the first free slot, including the order he wrote on), and the window is avoided from then on; confirmed visits stay and the conflict is traced for the office. If he refuses in general but no date can be read, the day of the visit he was answering is blacked out, and the trace marks it as inferred ([spec 010](specs/features/010-blackout-priority/spec.md)).

### When an order goes to human review

| `REASON` code (in the trace) | Trigger |
|---|---|
| `no_response` | Two timeouts from the party being awaited; a Critical order's tenant times out once; or stdin ends with the order open |
| `no_mutual_slot` | One party declined, countered or withdrew from three proposals |
| `interpretation_failed` | Two consecutive replies from the same party could not be understood |
| `contradictory_replies` | Two consecutive problem replies from the same party, at least one contradictory ("yes… no, I can't") |
| `cross_reference` | Two consecutive replies about a different work order |
| `llm_unavailable` | The model failed twice in a row for the order |
| `invalid_work_order` | The CSV row cannot be used (bad urgency, unreadable date, empty title) |

The `REASON` line on stdout is one human-readable sentence naming the party and what is known; the code and the decision that produced it are in the trace. Every order gets exactly one result and nothing is emitted for it afterwards.

## Interface

`/app/work_orders.csv`, read once and never written:

```
work_order_id,work_order,address,description,reported_at,urgency
WO-1001,Olor a gas en la cocina,"Calle Mayor 12, 3ºA","Desde esta mañana hay un fuerte olor a gas.",2026-11-04T08:30:00,Critical
```

`urgency` is `Critical`, `High`, `Medium` or `Low`; `reported_at` may carry an offset or be Madrid wall-clock time. Quoted fields with commas and line breaks are accepted. A row without a usable id is ignored.

Stdin, one message per line, `role` being the sender:

```
<work_order_id>|<role> <message body>
WO-1001|tenant Sí, perfecto
WO-1001|handyman <NO RESPONSE>
```

Malformed lines, unknown orders, invalid roles and lines for finished orders are traced and ignored. Lines are read while earlier ones are being processed, so the evaluator can always type.

Stdout carries only frames and results, `role` being the recipient; stderr stays empty (runtime warnings and uncaught errors go to the traces):

```
WOID:<work_order_id>|ROLE:<role>
<message body, one paragraph, absolute date with weekday and time range in Madrid time>

WOID:<work_order_id>|RESULT:scheduled
SCHEDULED_FOR:2026-11-05T15:00:00+01:00

WOID:<work_order_id>|RESULT:requires_review
REASON:<one sentence>
```

Traces are JSONL files under `/app/traces`, one per run; every line has `timestamp`, `work_order_id` (null for run-level events), `event_type` and `detail`. They cover incoming lines, outgoing frames, every model call, every decision with its reason, holds taken and released, state changes and results. State is a fold over the recorded facts, so replaying a trace reproduces the run without the model; the committed example is replayed in the test suite ([ADR 0002](docs/adr/0002-event-sourced-core.md)). When the last order gets its result the process flushes the trace and exits 0.

## Where AI is used and why

The model is called in exactly two places:

1. **Interpreting a reply** into a closed structure: intent (`accept`, `decline`, `counter`, `question`, `withdraw`, `cross_reference`, `contradictory`, `unclear`), stated times as local Madrid date and time fields, exclusions, and whether a handyman's unavailability applies to all his work. The output is validated against a schema (offsets, `Z` times and unknown fields are rejected), re-asked once, and otherwise recorded as `unclear`. Bare yes/no replies are handled by a regex and never reach the model ([ADR 0004](docs/adr/0004-interpretation-cascade.md)).
2. **Answering a question** from a closed facts list (title, address or "your address", the proposed slot, the 2-hour duration, the urgency, who comes, how to reply). The answer is validated (one paragraph, at most 400 characters, no date or time other than the proposed slot, none of the other party's words) and sent only to the asker, followed by a templated reminder of the slot. If the facts do not cover the question the model is told to say the office will check, and if the answer fails validation a fixed sentence says so instead.

The model never sets state, holds, acceptances or results, never sees the other party's text, and the parties' replies are placed in the prompt as data, never as instructions. Everything else is templates and rules, which is why the invariants are tested without a key ([ADR 0001](docs/adr/0001-deterministic-core-llm-interpreter.md)).

Why Haiku, with numbers. A golden set of 57 labelled replies (Spanish and English, every intent, relative dates, ranges, exclusions, idioms, hostile text) was run against each tier through the production prompt, schema and validator. The full report with every mismatch is [`eval/REPORT.md`](eval/REPORT.md); `pnpm eval --tier <regex|haiku|sonnet>` regenerates it.

| Tier | Model | Intent accuracy | Full accuracy | Resolved by regex | p50 latency | Cost for the set |
|---|---|---|---|---|---|---|
| regex | — | 9% | 9% | 9% | — | $0 |
| haiku | claude-haiku-5-5 | 82% | 68% | 9% | 1.6 s | $0.017 |
| sonnet | claude-sonnet-5-5 | 88% | 70% | 9% | 1.3 s | $0.285 |

Haiku is the default: Sonnet is six points better on intent at seventeen times the cost, and both miss the same kinds of reply: a withdrawal read as a decline and cross-references read as questions (known limitations below), "Wednesday is impossible, any other weekday is fine" read as a counter instead of a decline, which the policy handles identically since 009, and two replies with no final position read as unclear instead of contradictory, which leads to the same clarification. Haiku misses a few more: a frame-like injection read as an acceptance (which still needs the other party before anything is scheduled) and a reply with a `12:00Z` time read as a counter. Prompt version 4 (2026-11-03) added three readings found by the end-to-end runs ("whenever suits you" is a yes, a later correction in the message wins, "el finde" becomes concrete dates); on the 48 earlier cases whose labels did not change it scores as well as version 3 or better (intent 42 → 42–43, full 36 → 37–38 over two runs). The labels are hand-written; two were relabelled because spec 009 changed what is correct ("Yes that's fine. No wait, I can't do Wednesday at all." is now a decline of Wednesday, not contradictory). The regex share is low on this set because it over-represents long replies; in practice bare yes/no replies are common.

## Assumptions and trade-offs

- **Language inference** is a stopword and diacritics heuristic on the title and description, English on a tie; no model call.
- **No calendar horizon.** An order takes the first free slot however far ahead; the take-home defines no "no slot available" outcome.
- **Notice.** The agent's own proposals start at least one full hour after the next full hour from the reference time, and no earlier than `reported_at`. Times offered by a party are honoured 07:00–22:00 on any day, even outside the business windows.
- **A withdrawal counts as a refusal** toward the three-refusal limit, so a party cannot withdraw without end. The take-home names declines and counters; this is stricter and deliberate.
- **No fit for stated availability** still produces a concrete proposal: the free slot closest to the stated time on the day the party named (for "only tonight at 21:30", 20:00–22:00), otherwise the next free slot, with a note that the requested times are not available ([spec 009](specs/features/009-honour-stated-constraints/spec.md)).
- **What a party rules out stays ruled out.** Days and times a party says they cannot do ("Wednesday is impossible", "only afternoons") are recorded for that order and every slot the agent picks avoids them; a time of day without a date ("not before 13:00") applies to every day for 14 days. Times a party names later are still honoured. Decided after end-to-end runs on 2026-11-03 in which the agent re-proposed a day the tenant had just excluded, with a false note.
- **A slot the agent picks never overlaps one already refused in that order** (declined, countered or withdrawn from, by either party), so three refusals mean three genuinely different options before `no_mutual_slot`: a decline of Wednesday 14:00–16:00 is followed by 16:00–18:00, not 15:00–17:00. The take-home only forbids overlapping visits; this was decided after a manual run in which the first version burned the three refusals on nearly the same two hours. Times a party names are still honoured even if they overlap an earlier refusal, because people change their minds ([spec 008](specs/features/008-no-overlap-with-refused-slots/spec.md)).
- **Takeover only on stated availability.** A higher-urgency order bumps a lower-urgency tentative hold only when its party asked for times that nothing free fits. Declines never bump anyone. Scheduled visits are never taken.
- **A weekday blackout** ("el jueves no puedo") covers the next occurrence only.
- **Reminders then review.** One reminder, then `no_response`; a Critical order's tenant goes to review at the first silence.
- **The handyman's and the tenant's text is never forwarded** to the other party, not even the CSV description; the handyman gets the title, the address and the urgency.
- **The answer validator is strict**: a real answer that writes the slot time in another format is replaced by the fixed office sentence. Safe but curt.
- **Reference time** comes from the container clock, `AGENT_NOW`, or the fixture rule above; nothing in the agent waits on wall-clock time or timers.
- **Prompt wording is versioned** (`PROMPT_VERSION`), and every model call is traced with model, prompt version, latency and tokens.

## Known limitations

- On the golden set the model reads withdrawals as declines and cross-references as questions. The first is harmless; the second means an order whose replies keep referring to another job gets answers instead of a clarification, and closes only on timeout or end of input, never by the streak rules.
- Hostile text can be read as a one-party acceptance by Haiku; the other party must still accept, and the validator keeps the model from touching state in any other way.
- Recurring constraints ("never on Tuesdays") are not modelled: a weekday exclusion covers its next occurrence, and a time-of-day exclusion lasts 14 days.
- The run is a single process with in-memory state; durability (a workflow engine or a database) is the production step described in ADR 0002.
- Phase 2 of the [roadmap](docs/planning/04-roadmap.md) would add a bounded agent tier for multi-intent messages ([ADR 0005](docs/adr/0005-tiered-agent-escalation.md)), an adversarial simulator and a repair loop.

## How it was built

The repository holds the product and the development harness it was built with. Evaluating the product needs only Docker; the harness is there to show how it was built ([ADR 0006](docs/adr/0006-spec-driven-harness.md), [planning record](docs/planning/README.md)).

| Part | Paths |
|---|---|
| Product | `src/`, `Dockerfile`, `package.json`, `tsconfig*.json`, `traces/examples/` |
| Tests (445, under a minute) | `tests/`: unit, spawned-process scenarios with the fake interpreter, replay, evaluation, delivery, and the harness's own checks; they also run in the Docker build stage |
| Evaluation | `eval/`: golden set, scorer, report; `pnpm eval` |
| Development harness | `CLAUDE.md`, `.claude/` (rules, skills, hooks), `specs/` (product spec, invariants, feature specs 001–010), `scripts/` |
| Decisions | `docs/planning/`, `docs/adr/` |

Each feature went through the same pipeline with Claude Code: `/spec` (user stories and EARS criteria, clarified with at most five questions), `/plan` (design, a constitution check against the invariants and ADRs, ordered tasks), `/implement` (every test written and seen failing before its code, `pnpm check` after every task) and `/ship`. `pnpm check` is typecheck, the test suite and invariant coverage, whose baseline may only shrink and is empty now; hooks refuse to finish while it is red. Features: 001 I/O protocol and startup; 002 calendar and initial proposals; 003 interpretation and acceptance; 004 negotiation; 005 timeouts, preemption and blackouts; 006 golden set and evaluation; 007 delivery. Specs with plan and tasks are under `specs/features/`; the behaviour is specified in [001](specs/features/001-io-protocol-startup/spec.md), [002](specs/features/002-calendar-initial-proposals/spec.md), [003](specs/features/003-interpretation-acceptance/spec.md), [004](specs/features/004-negotiation/spec.md) and [005](specs/features/005-timeouts-preemption-blackouts/spec.md).

Where the coding agent (Claude Code) was wrong during development, the tests were right: several scenario expectations it wrote asked for a slot the calendar correctly refused (a neighbouring hold, a second unanswered version), and the fix was to the expectation, after checking the spec, never to the code.
