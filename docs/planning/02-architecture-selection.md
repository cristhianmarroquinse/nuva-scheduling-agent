# 02 · Architecture selection

## Options I considered

| Option | Idea | My call |
|---|---|---|
| **A. Deterministic core, LLM as interpreter** | The LLM turns free text into a validated structure; code owns state, calendar, acceptance and results | **Chosen** |
| **B. Tool-calling agent over a rules layer** | The LLM drives negotiation and writes messages through tools; tools enforce invariants | Rejected as the base. A tenant's text could reach the handyman, acceptance would become a model judgement, and one evaluation run could differ from the next. I kept some of its ideas |
| **C. Tiered escalation** | A for most messages; hard ones go to a bounded agent turn | Phase 2, behind a flag ([ADR 0005](../adr/0005-tiered-agent-escalation.md)) |
| **D. No LLM** | Regex and rules only | Cannot read "only afternoons this week" or "any day except Tuesday". I keep it as the baseline that shows where the LLM is actually needed ([ADR 0004](../adr/0004-interpretation-cascade.md)) |

The deciding factor: the spec has hard rules (explicit acceptance, no overlap, one result per order) and soft input (free text). Rules belong in code that can be tested. The model belongs where the input is open-ended.

## What I reused from previous work

From production LLM systems I worked on:

- One-shot model calls validated against a schema, with a bounded re-ask and a fail-closed result.
- "LLM extracts, code decides." In an ERP invoice-drafting tool I built, duplicate detection and tax mapping are rules, and the model only supplies extracted values.
- A first-valid-call-wins guard for terminal states.
- Retries only for transient errors, never nested.
- Per-call trace fields, an explicit Europe/Madrid timezone with an injectable "now", and invariants written as falsifiable sentences that tests cite by ID.

## What stress-testing changed

| Defect found | Message sequence that breaks it | Fix |
|---|---|---|
| Handyman constraints applied to one order only | `WO-002\|handyman Mañana no puedo nada` while WO-001 holds tomorrow | Constraint `scope: this_wo \| all`. Global blackouts release and re-propose overlapping holds |
| Availability as points, not ranges | "after 17:00" | Windows `{start, end}`; code fits the 2-hour slot |
| A bare "Sí" matched to a newer proposal than the one it answered | Handyman answers v1 after v2 was sent | No bare-yes acceptance while two or more versions are unanswered; a one-line confirmation instead. Every re-proposal cancels the previous one in writing |
| Exact-match acceptance looped | "Yes, Thursday is fine" ≠ "Thursday 10:00" | Accept when the proposal fits the stated window |
| Constraint silently dropped on an acceptance | "Yes, but not Thursday" | Contrast or negation words trigger a one-line restatement before closing (deterministic) |
| The model can emit UTC (`10:00Z`, which is 11:00 in Madrid) | Wrong hour scheduled | The model returns local `{date, time}`; code attaches the timezone |
| LLM-written reply with a blank line splits a protocol frame | Evaluator mis-parses | The output writer normalises every body |
| End of input while lines are still queued | Open orders closed before their replies are processed | End of input is queued as the last event |
| `<NO RESPONSE>` from a party we were not waiting on | Counted as a timeout | Counts only for an awaited party; resets on any real reply |
| Business hours applied to the other party's offers | "20:00 puedo" rejected; a gas leak waits for Monday | Hours constrain only my proposals. Critical can be same day, 08–21, weekends included |
| Traces were a log next to mutable state | State could not be rebuilt | Event-sourced core ([ADR 0002](../adr/0002-event-sourced-core.md)) |
| Questions counted toward the escalation cap | A curious tenant ends in review | Questions are answered and do not count |

## Alignment with industry practice

The shape I chose is common, not novel:

- An LLM that interprets while deterministic flows execute business logic is how Rasa CALM works. Salesforce's Agentforce made the same move with its hybrid reasoning, by its own description.
- Durable-execution platforms such as Temporal treat an event history as the source of truth. My event log is the single-process version.

My deliberate deviation: escalation triggers are deterministic signals, not the model's self-reported confidence.

## Final architecture

```
stdin ─► line reader ─► serial queue (events)
          │
          ├─ protocol parse (malformed → trace, ignore)
          ├─ terminal or unknown order → trace, ignore
          ├─ regex fast path: sí/yes/ok/vale/<NO RESPONSE>
          └─ otherwise: claude-haiku-5-5 messages.parse → Zod
                 {intent, constraints[{kind, scope, windows{date,time}}], question?, crossRef?, quote}
          ▼
 deterministic validation (Europe/Madrid, proposal ⊆ window, contrast words → restate)
          ▼
 state = fold(apply, events)   ← pure; events are facts only
          ▼
 policy.decide(state) → propose | hold | release | preempt | reply | finalize
          ▼
 calendar: one handyman, 2h slots, no overlap, urgency preempts holds only
          ▼
 protocol writer (stdout, templates) + JSONL events and projections (/app/traces)
```

1. **Startup.**
   - Read `/app/work_orders.csv` (read-only; schema `work_order_id,work_order,address,description,reported_at,urgency`; quoted fields supported).
   - Infer each order's language deterministically from the description and title (stopword and diacritic score; English on a tie). The decision is traced.
   - Allocate a first slot per order in urgency order (Critical > High > Medium > Low; ties by `reported_at`).
   - Emit the initial proposal for **every** order, to both tenant and handyman, without waiting for any reply.
   - A Critical tenant's first message adds a safety line ("if there is immediate danger, call 112").
2. **Event-sourced core.** Events are facts only (`run_started` with `sim_now`, `csv_loaded`, `msg_in`, `interpretation`, `llm_error`, `eof`). Holds, messages, decisions and results are derived. Replaying traces needs no model calls.
3. **Interpretation cascade.** Regex first, then Haiku with structured output and local date-time fields, then `unclear`.
4. **Acceptance decided by code.**
   - Acceptance = intent accept AND the proposal fits the stated window.
   - Confirm on ambiguity: a bare yes with two or more unanswered versions, or contrast or negation words.
   - An order is finalised only when tenant and handyman accepted the **same proposal version** and its hold is still live.
5. **Calendar and hours.**
   - One handyman, 2-hour visits, no overlap.
   - My proposals start on the hour, at least one hour after the next full hour. Critical: any day, 08:00–21:00. Other urgencies: Monday–Friday, 09:00–19:00. In both cases the visit must end inside the window.
   - Nothing is proposed before an order's `reported_at`.
   - Times offered by the parties are accepted between 07:00 and 22:00.
   - Urgency preempts holds only. Scheduled slots never move.
6. **Negotiation.**
   - A counter-proposal produces a new concrete slot sent to both parties, which cancels the previous one in writing.
   - Unclear or contradictory replies get one clarification; a second consecutive one goes to review.
   - Three proposals declined or countered by a party → `no_mutual_slot`. Re-proposals the system causes (preemption, handyman blackouts) do not count.
   - Questions are answered and do not count.
   - Availability withdrawn before closing releases the hold and triggers a new proposal.
   - A reply about another order (`crossRef`) gets a clarification; if it stays unresolved → `cross_reference`.
7. **Timeouts (`<NO RESPONSE>`).**
   - Counts only for a party we are waiting on, and resets on any real reply from that party.
   - First timeout → a reminder with varied wording. Second → `no_response`.
   - The handyman always gets the reminder.
   - A Critical tenant's first timeout goes straight to review, with a reason that states what is known (for example, the handyman's available slot).
8. **Messages.**
   - Templates: handyman always in Spanish; tenant in the order's language.
   - Every date is absolute, with weekday and time range in Madrid time ("jueves 5 de noviembre de 2026, de 10:00 a 12:00 (hora de Madrid)"). Proposals and confirmations include the work-order title.
   - The first party to accept gets a short acknowledgement.
   - The LLM only answers questions, to the sender, from a closed list of facts.
   - The output writer guarantees one frame per message (`WOID:<id>|ROLE:<role>`, body, blank line) and normalises bodies.
9. **Terminal results.**
   - Exactly one per order. When scheduled, confirmations go to both parties first, then `WOID:<id>|RESULT:scheduled` + `SCHEDULED_FOR:<ISO 8601 with Madrid offset>`.
   - Otherwise `WOID:<id>|RESULT:requires_review` + `REASON:<short human-readable sentence>`. The reason code comes from a closed set (`no_response`, `no_mutual_slot`, `contradictory_replies`, `interpretation_failed`, `llm_unavailable`, `cross_reference`, `invalid_work_order`) and goes to the traces with a handoff summary.
   - Input for a finished order is traced and ignored.
   - End of input closes any open order as `no_response`.
   - When every order has a terminal result, the process flushes its traces and exits with code 0, so an evaluator waiting for the container to finish never hangs.
10. **Traces.**
    - JSONL under `/app/traces`. Every line has `timestamp`, `work_order_id` (null for run-level events), `event_type` and `detail`.
    - Together, facts and projections cover incoming and outgoing messages, state changes, decisions and terminal results.
    - Runtime logs also go to files there. Nothing but the protocol reaches stdout, and nothing reaches stderr: the container sets `NODE_NO_WARNINGS=1`, and the streams module redirects anything else written to stderr into the tracer.
11. **Never crash.** Transient errors are retried by the SDK, then the message becomes `unclear`, then `llm_unavailable`. Malformed lines, unknown orders and invalid roles are traced and ignored.
