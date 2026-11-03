# End-to-end scenarios with the real model

`pnpm e2e` runs scripted conversations through the built agent (`dist/main.js`) and the real model, the way the evaluator will: a CSV, the tenant's and the handyman's replies on stdin, and every frame and trace line checked afterwards ([spec 014](../../specs/features/014-e2e-harness/spec.md)). `pnpm test` cannot do this: it uses the fake interpreter by design, so it proves the policy but not how the model reads real replies, or how a prompt change moves those readings.

```bash
pnpm e2e                                  # all sets; needs ANTHROPIC_API_KEY in .env
pnpm e2e --set calendar                   # one set: core, language, calendar or protocol
pnpm e2e --set protocol --only proto-csv  # scenarios whose name contains the text (does not overwrite the summary)
```

A full run is about 300 Haiku calls (well under one dollar) and a few minutes. Without a key it stops before running anything.

## The sets

| Set | Scenarios | What they cover |
|---|---|---|
| `core` | 36 | Acceptance, counters, declines, timeouts, questions, injection, preemption, blackouts, DST, invalid rows, many orders |
| `language` | 19 | The take-home's literal replies, relative dates, vague availability, slang, emoji, long and multi-intent replies, the other language |
| `calendar` | 17 | Five to eight orders of mixed urgency, priority and takeover chains, blackouts over several days, weekends, DST, future `reported_at` |
| `protocol` | 21 | The take-home's sample CSV and lines, `<NO RESPONSE>` patterns and variants, malformed lines, CSV oddities, huge and unicode bodies, leaks, prompt extraction, requests for a person |

Each scenario states its purpose in one line (`about`) and the expected result per order, or `null` when the outcome is legitimately open. The language, calendar and protocol sets were first designed by three agents in parallel, each predicting the outcomes from the take-home and the specs before running them; their findings became features 009–013.

## What every run is checked for

[`check.ts`](check.ts) reads only stdout, stderr, the exit code and the trace: exit 0 and empty stderr; frame shape; one result per order and nothing after it; confirmations to both parties right before `scheduled`; no overlapping holds; 2-hour holds, never before the reference time or `reported_at`; Madrid offsets and `SCHEDULED_FOR` equal to the traced result; each frame in its recipient's language; absolute dates in proposals; the 112 clause for Critical tenants; no party's words reaching the other; takeovers only by strictly higher urgency; and no system-chosen re-proposal overlapping a refused slot. The checker is unit-tested in `pnpm test` with a real fake-interpreter run broken one rule at a time (`tests/eval/e2e-check.test.ts`).

## Reading a failure

Each run is kept under `eval/e2e/out/<scenario>/` (ignored by git): `work_orders.csv`, `stdin.txt`, `stdout.txt` and `traces/`. Read the trace in order — `msg_in`, `interpretation`, `decision`, `hold_taken`/`hold_released`, `result` — and find the first event where reality diverges from the expectation. Re-run a failure before believing it: the model is not deterministic. Then decide whether the script was wrong (cite the rule that proves it), the model misread the reply (a prompt or fast-path change, checked on the golden set over at least two runs), or the agent is wrong (a spec, a failing test, a fix).

## Latest results

[`results/`](results/) holds the summary of the last full run of each set: date, prompt version, and per scenario the failures, model calls and tokens. On 2026-11-03, with prompt version 6, all 93 scenarios passed.
