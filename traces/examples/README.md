# Example run

One complete run of the agent with the real model (`claude-haiku-5-5`, prompt version 3), reference time `AGENT_NOW=2026-11-04T10:00` (a Wednesday). Regenerate it with `pnpm example` and a key; the model's wording may change, the decisions should not.

| File | What it is |
|---|---|
| `work_orders.csv` | Four orders: a Critical gas smell (Spanish), a Medium leaking tap (English), a Low squeaky door (Spanish), a High boiler (English) |
| `stdin.txt` | The eleven lines typed by the tenants and the handyman, in order |
| `env` | The reference time |
| `stdout.txt` | Everything the agent wrote: frames and results |
| `run.jsonl` | The trace: facts (`run_started`, `csv_loaded`, `msg_in`, `interpretation`, `answer`, `eof`) and projections (`hold_taken`, `msg_out`, `decision`, `model_call`, `state_change`, `result`, …). `tests/delivery/example-trace.test.ts` replays its facts and reproduces `stdout.txt` without the model |

## Startup

Slots are allocated in urgency order from 12:00 (one hour after the next full hour): WO-1001 (Critical) Wednesday 12:00–14:00, WO-1004 (High) 14:00–16:00, WO-1002 (Medium) 16:00–18:00, WO-1003 (Low) Thursday 09:00–11:00. Each order gets a frame to the tenant in its language and one to the handyman in Spanish; the Critical tenant's frame ends with the 112 clause.

## The exchange, order by order

**WO-1001 · Olor a gas en la cocina (Critical, Spanish).** The tenant answers "Sí, perfecto, cuanto antes mejor": not a bare yes, so the model reads it (`accept`), and the tenant gets a brief acknowledgement. The handyman's "Vale" goes through the regex fast path. Both accepted version 1, so confirmations go to both and the order ends `scheduled` for Wednesday 12:00. Two lines, one model call.

**WO-1002 · Leaking kitchen tap (Medium, English).** The tenant counters: "Could you come Thursday afternoon instead? I work in the mornings." The model returns `counter` with Thursday 15:00–20:00; the code fits the visit at 15:00–17:00 (Thursday 09:00–11:00 is held by WO-1003), releases the Wednesday hold and sends version 2 to both parties, saying the previous proposal is cancelled. The handyman asks "¿Hay aparcamiento cerca del portal?": a `question`, answered by the model from the closed facts list; the facts say nothing about parking, so the answer says the office will check, followed by the templated reminder of the slot. Then "Sí, el jueves a las 15 me va bien": an acceptance naming the slot, which matches version 2. The tenant's "Yes" (fast path) completes it: `scheduled` for Thursday 15:00. Four lines, four model calls, one of them the answer.

**WO-1004 · No hot water (High, English).** The handyman declines ("No puedo a esa hora"); version 2 is the next free slot that does not overlap the refused 14:00–16:00 ([008](../../specs/features/008-no-overlap-with-refused-slots/spec.md)), Wednesday 16:00–18:00 (free again since WO-1002 moved to Thursday), sent to both. The tenant's `<NO RESPONSE>` counts, because the tenant has not accepted version 2: a reminder restating the slot. "Yes, 16:00 is fine" names the slot and is accepted; the handyman's "Vale" schedules it for Wednesday 16:00.

**WO-1003 · Puerta que chirría (Low, Spanish).** The handyman's `<NO RESPONSE>` is his first timeout: a reminder. Then stdin ends, and the order closes as `requires_review` with `no_response`; its hold is released.

## What to look for in the trace

- Every `interpretation` line is a validated fact; `decision` lines show what code did with it (`accepted`, `scheduled`, `repropose` with its cause, `question`, `answered`, `remind`).
- `model_call` lines carry the model, the prompt version, latency and tokens; the `purpose: answer` call is the only one whose text reaches a frame, and only the asker's.
- `hold_taken` and `hold_released` lines show the calendar moving; no two live holds overlap, and the three scheduled holds are never released.
