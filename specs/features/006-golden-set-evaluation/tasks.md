# 006 · Tasks: Golden set and interpretation evaluation

Format: `- [ ] T### [P?] [US#] Description (file path)`. `[P]` = can run in parallel (different files, no dependency on an unfinished task).

## Phase 1 · Foundations

- [ ] T001 Add `eval` to the TypeScript includes and the `eval` script (tsconfig.json, package.json)
- [ ] T002 [P] Test: the adapter is imported only by `src/main.ts` and files under `eval/` (AC-2.7) (tests/harness/source-hygiene.test.ts)

## Phase 2 · US1 A labelled golden set covers what the product acts on (P1)

Tests first; each must fail before its implementation task.

- [ ] T010 [US1] Test: `checkGoldenSet` rejects fewer than 40 entries, a missing language, an intent under 3 entries, fewer than 5 hostile tags, a duplicate id, and an expectation with an offset or `Z`; accepts a valid set (AC-1.1, AC-1.2, AC-1.3, AC-1.4) (tests/eval/golden-set.test.ts)
- [ ] T011 [US1] Implement: `GoldenEntrySchema`, `loadGoldenSet`, `checkGoldenSet` (eval/lib/golden.ts)
- [ ] T012 [US1] Write the golden set: at least 40 entries meeting AC-1.2, Spanish and English, every intent ≥ 3, relative dates, ranges, exclusions, idioms, scope-all handyman statements, contradictions, ≥ 5 hostile (eval/golden-set.json)
- [ ] T013 [US1] Test: the committed set passes `checkGoldenSet` and every expectation validates under the production schema (AC-1.4) (tests/eval/golden-set.test.ts)

## Phase 3 · US2 One command scores a tier (P1)

- [ ] T020 [US2] Test: `scoreEntry` intent and full match with normalised times, exclusions and scope; `summarise` shares, p50/p95 over model calls only, tokens and cost from `PRICES` (AC-2.3, AC-2.4) (tests/eval/score.test.ts)
- [ ] T021 [US2] Implement: `Outcome`, `scoreEntry`, `summarise`, `PRICES` (eval/lib/score.ts)
- [ ] T022 [US2] Test: `runTier('regex')` over the committed set with an interpreter that throws on any call: no call happens, unresolved entries are counted, metrics equal `summarise` (AC-2.1, AC-2.7) (tests/eval/regex-tier.test.ts)
- [ ] T023 [US2] Implement: `runTier` for `regex` (fast path) and model tiers (`interpretReply` through the production cascade, latency and tokens from the calls, failures counted as `unclear`) (eval/lib/run.ts)
- [ ] T024 [US2] Implement: the CLI: `--tier`, key check with a one-line message and exit 1, adapter with the tier's model, write `latest-<tier>.json`, rebuild the report, print the summary (AC-2.2, AC-2.5, AC-2.6) (eval/run.ts)

## Phase 4 · US3 The decision is written down (P1)

- [ ] T030 [US3] Test: `latestFile(tier)`, the report table columns, prompt version and date per run, the mismatch list of each model tier, the optional reading section, the report rebuilt from whatever latest files exist (AC-2.5, AC-3.1, AC-3.2, AC-3.4) (tests/eval/report.test.ts)
- [ ] T031 [US3] Implement: `latestFile`, `renderReport`, reading section from `eval/reading.md` (eval/lib/report.ts)
- [ ] T032 [US3] Run `pnpm eval --tier regex` and commit `eval/results/latest-regex.json` and `eval/REPORT.md`; the README citation (AC-3.3) belongs to 007 (eval/results/, eval/REPORT.md)
- [ ] T033 [US3] Manual, by the user with `ANTHROPIC_API_KEY`: `pnpm eval --tier haiku` and `pnpm eval --tier sonnet`; then commit the two latest files and the regenerated report (AC-2.2, AC-2.6) (eval/results/, eval/REPORT.md)
- [ ] T034 [US3] Write the reading: three to five sentences on what the numbers say about the default tier, with the labelled-by-hand caveat (AC-3.1) (eval/reading.md); regenerate the report

## Phase 5 · Polish

- [ ] T090 Baseline unchanged (empty); nothing to remove
- [ ] T091 Re-read the spec; confirm every AC has a passing test or a committed artefact; set `Status: implemented` (specs/features/006-golden-set-evaluation/spec.md)
- [ ] T092 `pnpm check` green; confirm `pnpm test` made no network call (no `eval/run.ts` import under `tests/`)

## Dependencies

- T011 precedes T012/T013 (the set is validated by the checker as it is written).
- T021 precedes T022/T023; T023 precedes T024 and T032.
- T031 precedes T032; T032 precedes T033; T033 precedes T034.
- T033 needs the user's key and is the only step that touches the network; everything before it is verifiable offline.
