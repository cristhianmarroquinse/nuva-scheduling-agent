# 014 · Plan

| Path | Content |
|---|---|
| `eval/e2e/scenario.ts` | `E2eScenario`, `Expect` types; `HEADER`; `setNames` |
| `eval/e2e/sets/core.ts`, `language.ts`, `calendar.ts`, `protocol.ts` | the 93 scenarios, moved from the scratch harness, typed strictly |
| `eval/e2e/check.ts` | pure `checkRun(scenario, { stdout, stderr, code, trace })` → failures (AC-1.3) |
| `eval/e2e/run.ts` | CLI: selection, key check, spawn `dist/main.js`, outputs, summary, exit code (AC-1.2, AC-1.4, AC-1.5) |
| `eval/e2e/results/latest-<set>.json` | committed summaries |
| `eval/e2e/README.md` | how to run, what it checks, how to read a failure |
| `package.json` | `"e2e": "pnpm build && tsx eval/e2e/run.ts"` |
| `.gitignore`, `.dockerignore` | `eval/e2e/out/` |
| `tests/eval/e2e-check.test.ts` | AC-2.1, AC-2.2 |

Constitution check: all nine ✅ (no product code changes).
