# 001 · Plan: I/O protocol and startup foundations

**Spec:** [spec.md](spec.md)

## Summary

First code in `src/`. Adds the time module, the CSV loader and validator, language inference, the event log with a pure `step`/`fold` core, the line parser, the frame writer, the tracer, the streams module and the runner that wires them: read CSV → record `run_started` and `csv_loaded` → process stdin lines one at a time → on `eof`, close what is open → exit. No messages to tenants or the handyman; the only stdout output is `requires_review` results. Adds a spawned-process scenario runner under `tests/scenarios/`.

## Design

### Modules

| Module | Pure | Responsibility |
|---|---|---|
| `src/time/time.ts` | yes | Europe/Madrid via Luxon: `ZONE`, `parseLocalOrOffset(text)` (ISO 8601 or `YYYY-MM-DD HH:mm[:ss]`; no offset → Madrid wall clock; offset → that instant in Madrid), `toIso(dt)`. The only place that builds dates. |
| `src/time/reference.ts` | yes | `resolveReferenceTime({ clockNow, agentNow, reportedAts })` → `{ simNow, source: 'agent_now' \| 'clock' \| 'fixture', agentNowInvalid? }`. Implements AC-3.1–3.4. The clock is an argument. |
| `src/orders/csv.ts` | yes | `parseCsv(text)` → `string[][]`. RFC 4180: quoted fields, `""` escapes, commas and line breaks inside quotes, CRLF, BOM. |
| `src/orders/validate.ts` | yes | `readRows(table)` → header error, or `{ rows }` (records keyed by header). `validateRows(rows)` → `{ orders: WorkOrder[], rejected: { id, line, problem }[], ignored: { line, reason: 'no_id' \| 'duplicate' }[], entries }`, where `entries` lists every row classified in CSV order (the fold walks it so results keep CSV order). Trims IDs; an id with whitespace, `\|` or control characters is "no usable id". |
| `src/orders/language.ts` | yes | `inferLanguage(title, description)` → `{ language: 'es' \| 'en', evidence: { es, en, matches } }`. Stopword and diacritic score; tie → `en`. |
| `src/core/facts.ts` | yes | Fact union (ADR 0002): `run_started { sim_now, source, clock_now, agent_now }`, `csv_loaded { rows }`, `msg_in { seq, raw }`, `eof {}`. `interpretation` and `llm_error` are declared in later features. |
| `src/core/protocol.ts` | yes | `parseLine(raw)` → `{ kind: 'line', woid, role, body, timeout }` or `{ kind: 'malformed', reason }`. Splits on the first `\|` and the first space; strips CR and surrounding whitespace; empty line → malformed `empty`. |
| `src/core/state.ts` | yes | `State` (`simNow`, `orders: Map<id, OrderState>`, `ended`), `OrderState` (`order`, `language`, `status: 'open' \| 'closed'`, `result?`). `step(state, fact)` → `{ state, outputs }`; `fold(facts)` reduces `step`. `allTerminal(state)`. |
| `src/core/reasons.ts` | yes | Closed reason codes from `000-product.md` and their `REASON` sentences (`invalid_work_order` names the field; `no_response`). Single line, English. |
| `src/io/frames.ts` | yes | `normaliseBody`, `formatFrame(woid, role, body)`, `formatResult(result)`. Bodies and reasons are normalised; header-like lines in a body stay inside the body (AC-6.4). |
| `src/trace/tracer.ts` | no | `createTracer({ dir, now })`: one JSONL file per run under `dir`, synchronous appends (so every line is on disk before exit), `trace({ work_order_id, event_type, detail })`. |
| `src/io/streams.ts` | no | Only module touching `process.stdout`/`process.stderr`. `installStderrRedirect(tracer)` (replaces `process.stderr.write`, so warnings and stray writes become `stderr` trace lines), `writeOutput(text)`, `stdinLines()` (readline async iterator; buffers lines that arrive while one is processed). |
| `src/runtime/run.ts` | no | `run({ csvPath, env, clockNow, lines, write, tracer })` → exit code. Sequence below. Catches an exception from any `step`, traces `run_error` and keeps going (RUN-1). |
| `src/main.ts` | no | Entry: stderr redirect and `uncaughtException`/`unhandledRejection` handlers first (events are parked until the tracer opens, then flushed), dynamic import of the rest, `run`, `flushOutput`, `process.exit(code)`. Paths: `WORK_ORDERS_PATH` (default `/app/work_orders.csv`), `TRACES_DIR` (default `/app/traces`). |

### Runner sequence

1. Read the CSV file (read-only). Missing, unreadable or wrong header → trace `run_error`, return 1 (AC-1.6).
2. `validateRows` → reported-at instants → `resolveReferenceTime` → append `run_started`, then `csv_loaded`.
3. `for await` over `lines`: each line becomes `msg_in { seq, raw }` and goes through `step`. Lines that arrived during steps 1–2 are buffered by readline and processed in order (AC-4.4).
4. After every step, if `allTerminal(state)`, return 0 without waiting for stdin (AC-5.2).
5. When the iterator ends, append `eof` and return 0.

Every fact is traced before it is stepped. Each `step` output is either `{ kind: 'stdout', text }` (written through `write`) or `{ kind: 'trace', event_type, work_order_id, detail }`.

### Facts and projections

| Fact | `step` derives (projections) |
|---|---|
| `run_started` | sets `simNow` |
| `csv_loaded` | `row_ignored` (no id, duplicate); `language_inferred` per valid order; for invalid rows `state_change` (→ closed) and `result` + stdout result (`invalid_work_order`), in CSV order |
| `msg_in` | `line_classified { classification: 'message' \| 'timeout' \| 'malformed' \| 'unknown_order' \| 'invalid_role' \| 'closed_order', role?, reason? }`; no stdout (AC-4.5) |
| `eof` | for every open order, in CSV order: `state_change`, `result` + stdout result (`no_response`) |

Validation and language inference run inside `step` on the recorded rows, so a replay recomputes them; the facts only hold what was read. A replay (`tests/scenarios/replay.test.ts`) reads a trace file, keeps lines whose `event_type` is a fact type, and folds them.

### Dependencies

- `luxon` + `@types/luxon`: required by ADR 0003 and TIME-1 (DST handled by the library).
- No CSV library: the parser is about 40 lines, pure and fully tested; REQ-IN-2 needs no more.

## Constitution check

| Check | Status |
|---|---|
| Model output only enters as a validated interpretation event (LLM-1) | ✅ No model call in this feature; `interpretation` is reserved as a fact type |
| Model text only to the sender, from closed facts (LLM-2) | ✅ No model text; no messages to parties at all |
| Nothing but protocol on stdout; nothing on stderr (OUT-1) | ✅ Only `streams.ts` touches streams; stderr redirected to the tracer; spawned scenario asserts it |
| Time through the time module, Europe/Madrid, injected clock (TIME-1) | ✅ `time.ts` is the only date builder; `clockNow` injected into `run` and the tracer |
| State derived from facts; no projection fed back as input (ADR 0002) | ✅ Four fact types; validation, language and results are derived by `step`; replay folds facts only |
| Exactly one terminal result per order; nothing after it (ORD-1, ORD-2) | ✅ `step` closes only `open` orders; closed-order lines are classified and ignored |
| No overlap; scheduled visits never move (SCHED-1, SCHED-3) | ✅ N/A: no calendar until 002 |
| No new dependency or abstraction without a requirement asking for it | ⚠️ `WORK_ORDERS_PATH` / `TRACES_DIR` overrides (see below); Luxon is required by ADR 0003 |
| Consistent with every accepted ADR | ✅ ADR 0002 (facts), 0003 (reference time); 0001/0004/0005 not exercised |

## Complexity tracking

| Deviation | Why it is needed | Simpler alternative rejected because |
|---|---|---|
| `WORK_ORDERS_PATH` and `TRACES_DIR` env overrides, defaulting to the `/app` paths | Scenarios spawn the real entry point with a temporary CSV and traces directory | Writing to `/app` on the dev machine needs root and makes tests share state; testing only in Docker makes `pnpm check` depend on Docker |

## Test plan

Scenarios live in `tests/scenarios/001-*.txt` with sections `# csv`, `# env`, `# stdin`, `# stdout`, `# exit`, `# trace` (expected event types and detail subsets). `tests/scenarios/runner.ts` spawns `tsx src/main.ts` with a temp CSV and traces dir. Test titles are literals, because only literal titles count as citations.

| Test | Covers |
|---|---|
| `tests/unit/time.test.ts` | AC-1.7, AC-3.4 (offsets on both sides of 2026-10-25) |
| `tests/unit/reference.test.ts` | AC-3.1–AC-3.3 (injected clock; set, invalid, fresh, stale, one row in the future) |
| `tests/unit/csv.test.ts` | AC-1.2 |
| `tests/unit/validate.test.ts` | AC-1.3, AC-1.4, AC-1.5, AC-1.6 (header) |
| `tests/unit/language.test.ts` | AC-2.1, AC-2.2, AC-2.3 |
| `tests/unit/protocol.test.ts` | AC-4.2, AC-4.6 |
| `tests/unit/frames.test.ts` | AC-6.1–AC-6.4, **OUT-2** |
| `tests/unit/state.test.ts` | AC-4.1, AC-4.3, AC-4.5, AC-5.1, AC-5.3, **ORD-1**, **ORD-2** (hostile fact sequences: duplicate `eof`, lines after closure) |
| `tests/unit/tracer.test.ts` | AC-7.1 |
| `tests/scenarios/001.test.ts` | Every scenario in the spec table, including AC-1.1 (CSV byte-identical), AC-6.5 (`001-clean-streams`), AC-7.1 and AC-7.2 (`001-trace-shape`); titles cite **ORD-1**, **ORD-2**, **OUT-1**, **TRACE-1**, **RUN-1** |
| `tests/scenarios/replay.test.ts` | AC-7.3, **TRACE-2** |
| `tests/harness/source-hygiene.test.ts` (new case) | AC-5.4, REQ-TO-5: no `setTimeout`/`setInterval`/`setImmediate` in `src/` |

**Leaving the baseline:** ORD-1, ORD-2, OUT-1, OUT-2, TRACE-1, TRACE-2, RUN-1. TIME-1 stays pending until 002 emits proposals.

## Risks

- **Spawned tests are slow** (≈0.3 s each with tsx). About 15 scenarios is acceptable; if it grows, add an in-process runner over `run` with fake streams.
- **Exit while stdin is open** relies on `process.exit` after synchronous trace writes; a scenario keeps stdin open to prove it.
- **The stderr redirect is installed after module loading**, so a warning emitted during import would escape. `main.ts` installs it first, before importing the rest dynamically; the forced-warning scenario checks it.
- **Language heuristics on short titles** may be weak; ties fall back to English by design, and evidence is traced for tuning.
