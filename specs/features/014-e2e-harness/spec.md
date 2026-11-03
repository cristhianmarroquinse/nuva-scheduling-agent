# 014 · End-to-end harness with the real model

**Status:** implemented
**Product requirements:** none (development tooling); it checks REQ-* and invariants from the outside
**Invariants touched:** none changed; the harness re-checks ORD-1, ORD-2, ACC-2, ACC-3, SCHED-1, SCHED-2, SCHED-5, TIME-1, COM-1, COM-2, COM-3, OUT-1, OUT-2, LLM-2, TRACE-1, RUN-1 and REQ-NG-11 on every run

## Why

Features 008–013 came from running the agent the way the evaluator will: a CSV, scripted replies on stdin, the real model, and a check of every frame and trace line. That harness and its 93 scenarios lived outside the repository, in a temporary directory, so the evidence behind six features could not be re-run. The test suite cannot replace it: `pnpm test` uses the fake interpreter by design (no network), so only a real-model run shows how a prompt change moves readings, as the regression found on 2026-11-03 showed.

## User stories

### US1 · Re-run the end-to-end scenarios with one command (P1)

As a developer, I want `pnpm e2e` to run the scripted scenarios against the built agent and the real model and report, per scenario, the failures of each invariant check and each expected result.

**Acceptance criteria (EARS):**

- **AC-1.1** THE repository SHALL contain the scenario sets (core, language, calendar, protocol) as data with, per scenario, the CSV rows, the stdin lines, the reference time, a one-line purpose and the expected result per order (or none, when the outcome is open).
- **AC-1.2** `pnpm e2e` SHALL build the agent, run every scenario (or the ones selected by set or name) through `dist/main.js` with the key from `.env`, and write each run's CSV, stdin, stdout and trace under an ignored output directory.
- **AC-1.3** THE runner SHALL check every run black-box: exit 0 and empty stderr, frame shape, exactly one result per order and nothing after it, confirmations to both parties before `scheduled`, no overlapping holds, 2-hour holds not before the reference time or `reported_at`, Madrid offsets, `SCHEDULED_FOR` equal to the traced result, the recipient's language, absolute dates in proposals, the 112 clause for Critical tenants, no verbatim forwarding of a party's text to the other, and no system-chosen re-proposal overlapping a refused slot.
- **AC-1.4** THE runner SHALL write a summary of the latest run per set (pass/fail, failures, model calls, tokens) to a committed results file, and exit non-zero when a scenario fails.
- **AC-1.5** WITHOUT a key, THE runner SHALL stop with a message and SHALL NOT run anything; `pnpm test` SHALL NOT call it.

### US2 · The checker itself is tested (P1)

- **AC-2.1** THE checks of AC-1.3 SHALL be a pure function, unit-tested in `pnpm test` with synthetic outputs that pass and that break each check.
- **AC-2.2** `pnpm test` SHALL verify that every scenario set loads, names are unique, and every expected order id exists in its CSV.

## Edge cases

- Expectations written before a later feature changed the behaviour are updated with the feature that changed them, as for any test.
- Model nondeterminism: a failure is re-run before it is believed; the summary records the run as it happened.

## Success criteria

- `pnpm e2e` on the final code of 2026-11-03 passes every scenario whose outcome is decided by code, and every failure that remains is listed with its cause in the summary.
- `pnpm check` green and offline.

## Decisions

- **Tooling under `eval/`, outside the product** (2026-11-03, with the user): like `pnpm eval`, it needs the key and the network, so it never runs in `pnpm test` or the Docker build.

## Open questions

None.
