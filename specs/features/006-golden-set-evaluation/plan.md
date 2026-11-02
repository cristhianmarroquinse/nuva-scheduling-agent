# 006 · Plan: Golden set and interpretation evaluation

**Spec:** [spec.md](spec.md)

## Summary

A new top-level `eval/` directory, outside `src/` and outside `pnpm test`, holds the labelled golden set, a pure scorer and report renderer, and a small CLI (`pnpm eval --tier regex|haiku|sonnet`) that runs the production cascade over the set and writes `eval/results/latest-<tier>.json` plus a regenerated `eval/REPORT.md`. The regex tier is offline and is exercised in `pnpm test`; the model tiers are run by hand with the API key and their results committed. Nothing in `src/` changes except that the adapter already accepts a model name.

## Design

### Modules

| Module | Pure | Responsibility |
|---|---|---|
| `eval/golden-set.json` | — | The data: `{ id, language, role, body, proposal: { version, slot }, simNow, tags: string[], expected: { intent, times?, exclusions?, scope? } }[]`. Tags name what the entry exercises (`relative`, `range`, `exclusion`, `idiom`, `scope_all`, `contradictory`, `hostile`, …). |
| `eval/lib/golden.ts` | yes | `GoldenEntrySchema` (Zod, reusing the production time regexes), `loadGoldenSet(path)`, `checkGoldenSet(entries)` → list of problems: fewer than 40, a language missing, an intent with fewer than 3 entries, fewer than 5 `hostile`, an expectation the production `InterpretationSchema` rejects, a duplicate id. |
| `eval/lib/score.ts` | yes | `Outcome { id, resolvedBy: 'regex' \| 'model' \| 'unresolved', obtained: Interpretation \| null, intentMatch, fullMatch, latencyMs?, tokens?, calls }`. `scoreEntry(entry, interpretation \| null, resolvedBy, calls)`: intent match, and full match after normalising times/exclusions (sorted, absent = empty) and scope (absent = `this_order`). `summarise(outcomes, tier)` → `Metrics { n, intentAccuracy, fullAccuracy, fastPathShare, modelShare, unresolvedShare, p50, p95, inputTokens, outputTokens, costUsd }`; `PRICES` per model with the date of the price list in a comment. |
| `eval/lib/report.ts` | yes | `latestFile(tier)` → `eval/results/latest-<tier>.json`; `RunFile { tier, model, promptVersion, date, metrics, outcomes }`; `renderReport(runs: RunFile[], reading?: string)` → Markdown: a table with the columns of AC-2.4 per tier, the prompt version and date per run, the mismatches of each model tier (id, body, expected intent, obtained intent), and the hand-written reading from `eval/reading.md` when present. |
| `eval/lib/run.ts` | no (model tiers) | `runTier({ tier, entries, interpreter })`: for `regex`, `fastPath(body)` per entry; for a model tier, `interpretReply(request, interpreter)` with the production prompt/schema/validator; builds `Outcome`s. The interpreter is injected, so the regex tier and the tests never touch the network. |
| `eval/run.ts` | no | CLI: parses `--tier`, refuses a model tier without `ANTHROPIC_API_KEY` (one line, exit 1), builds the adapter with the tier's model, runs, writes the latest file, rebuilds the report from every latest file present, prints the summary line. Uses `process.stdout` directly: it is a developer tool, not the agent. |
| `src/interpreter/anthropic.ts` | no | Unchanged: `createAnthropicInterpreter({ elapsed, model })` already takes a model. |
| `tsconfig.json`, `package.json` | — | `include` gains `eval`; script `"eval": "tsx eval/run.ts"`. |
| `tests/harness/source-hygiene.test.ts` | — | New case: `src/interpreter/anthropic.ts` is imported only by `src/main.ts` and files under `eval/` (AC-2.7). |

### Data flow

```
golden-set.json ─► loadGoldenSet ─► checkGoldenSet (pnpm test)
                                 └► runTier(tier, interpreter) ─► Outcome[] ─► summarise ─► latest-<tier>.json
                                                                                        └► renderReport(all latest) ─► REPORT.md
```

The eval never calls `step`: it measures the interpretation boundary only (ADR 0004). Its requests are built exactly like the fold builds them, from the entry's proposal and reference time.

### Models and prices

| Tier | Model | Input $/MTok | Output $/MTok |
|---|---|---|---|
| `haiku` | `claude-haiku-5-5` | 0.10 | 0.50 |
| `sonnet` | `claude-sonnet-5-5` | 2.00 | 10.00 |

Prices are the first-party list as of the plan date and live as a constant with that date in a comment; the report says the cost is an estimate.

### Dependencies

None new. Zod and the SDK are already present; `tsx` runs the CLI.

## Constitution check

| Check | Status |
|---|---|
| Model output only enters as a validated interpretation event (LLM-1) | ✅ The eval goes through `interpretReply`, so every model answer passes the production validator; the eval reads the resulting fact only |
| Model text only to the sender, from closed facts (LLM-2) | ✅ No frames are produced; the eval scores interpretations |
| Nothing but protocol on stdout; nothing on stderr (OUT-1) | ✅ The eval CLI is a separate entry point under `eval/`, never run by the agent; the hygiene test covers `src/` as before |
| Time through the time module, Europe/Madrid, injected clock (TIME-1) | ✅ Expected times are local Madrid values checked by the production regexes; the run date comes from an injected clock in the writer |
| State derived from facts; no projection fed back as input (ADR 0002) | ✅ Not touched |
| Exactly one terminal result per order; nothing after it (ORD-1, ORD-2) | ✅ Not touched |
| No overlap; scheduled visits never move (SCHED-1, SCHED-3) | ✅ Not touched |
| No new dependency or abstraction without a requirement asking for it | ✅ `eval/` is what ADR 0004 and the testing rule ask for; no package added |
| Consistent with every accepted ADR | ✅ ADR 0004 (golden set, tiers, README numbers); ADR 0001 (the eval cannot schedule anything) |

## Complexity tracking

| Deviation | Why it is needed | Simpler alternative rejected because |
|---|---|---|
| none | | |

## Test plan

| Test | Covers |
|---|---|
| `tests/eval/golden-set.test.ts` | AC-1.1, AC-1.2, AC-1.3, AC-1.4: the committed set passes `checkGoldenSet`; `checkGoldenSet` itself rejects a set that is too small, misses a language or an intent, has fewer than 5 hostile entries, or whose expectation carries an offset |
| `tests/eval/score.test.ts` | AC-2.3, AC-2.4: intent and full match with normalisation; shares, p50/p95 over model calls only, tokens and cost from the price table |
| `tests/eval/report.test.ts` | AC-2.5, AC-3.1, AC-3.2, AC-3.4: `latestFile`, the Markdown table columns, prompt version and date per run, the mismatch list, the optional reading section |
| `tests/eval/regex-tier.test.ts` | AC-2.1, AC-2.7: `runTier('regex')` in-process over the committed set with a rejecting interpreter: no call is made, unresolved entries counted, numbers equal `summarise` |
| `tests/harness/source-hygiene.test.ts` (new case) | AC-2.7: the adapter is imported only by `src/main.ts` and `eval/` |
| Manual (by the user, with the key): `pnpm eval --tier haiku`, `pnpm eval --tier sonnet` | AC-2.2, AC-2.6: the results and the report are committed afterwards |

**Leaving the baseline:** none (it is empty).

## Risks

- **The golden set is hand-labelled.** Labels can be wrong; the schema check catches shape errors only. Mismatches in the report are read with that in mind, and the reading section says so.
- **The real adapter runs for the first time.** A schema or `messages.parse` mismatch would show up as every entry being `unclear`; the summary line makes that obvious, and the SDK error is printed by the CLI.
- **Cost.** About 40 entries × 2 tiers × 1 call (2 on a re-ask) is well under a dollar.
- **Prompt version drift.** The report carries the prompt version; if the prompt changes later, the numbers must be regenerated, which the version field makes visible.
- **Reading section by hand.** It is written after the real runs and lives in `eval/reading.md`, so a regenerated report keeps it.
