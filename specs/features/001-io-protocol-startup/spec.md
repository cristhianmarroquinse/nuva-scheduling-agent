# 001 · I/O protocol and startup foundations

**Status:** clarified
**Product requirements:** REQ-IN-1, REQ-IN-2, REQ-IN-3, REQ-IN-4, REQ-IN-5, REQ-IN-6, REQ-IN-7, REQ-IN-8, REQ-OUT-1, REQ-OUT-4, REQ-RES-2, REQ-RES-3, REQ-TO-4, REQ-TO-5, REQ-TO-6, REQ-TR-1, REQ-TR-2 (incoming messages, state changes, results), REQ-TR-3, REQ-TM-1, REQ-TM-2, REQ-RB-2
**Invariants touched:** ORD-1, ORD-2, OUT-1, OUT-2, TIME-1, TRACE-1, TRACE-2, RUN-1
**Deferred to 002 (calendar and initial proposals):** REQ-ST-1, REQ-ST-2, REQ-ST-3, REQ-ST-4, REQ-SC-1, REQ-SC-2, REQ-SC-3, REQ-OUT-2, REQ-OUT-3; invariants SCHED-*, COM-*, RUN-2

## Why

The evaluator drives the agent only through the CSV, stdin and stdout. Every later feature depends on the same foundations: reading and validating the orders, knowing each tenant's language, a recorded reference time, a clean terminal, a safe way to read input, a trace from which the run can be rebuilt, and a run that always ends with one result per order. This feature delivers those foundations with no throwaway behaviour: it sends no messages to tenants or the handyman. Startup frames arrive once, in their final form, with the calendar in 002.

## User stories

### US1 · Orders are loaded and validated (P1)

As the evaluator, I want the agent to load every order from the CSV and close unusable rows for review instead of crashing, so that one bad row never stops the run.

**Independent test:** a CSV with valid, invalid and duplicate rows and an immediate EOF; the traces list the loaded orders, and stdout has one `requires_review` result per order.

**Acceptance criteria (EARS):**

- **AC-1.1** WHEN the process starts, THE system SHALL read `/app/work_orders.csv` and SHALL NOT modify it.
- **AC-1.2** THE system SHALL accept the header `work_order_id,work_order,address,description,reported_at,urgency`, quoted fields (including commas, double quotes and line breaks inside quotes), and any number of rows.
- **AC-1.3** IF a row has a missing or empty `work_order`, an empty or unparseable `reported_at`, or an `urgency` other than `Critical`, `High`, `Medium`, `Low`, THEN THE system SHALL trace the problem and close that order with `WOID:<id>|RESULT:requires_review` and a `REASON` line (code `invalid_work_order`).
- **AC-1.4** IF a row has no usable `work_order_id`, THEN THE system SHALL trace it and emit nothing for it.
- **AC-1.5** IF a `work_order_id` appears in more than one row, THEN THE system SHALL keep the first row, and trace and ignore the others.
- **AC-1.6** IF the CSV file is missing, unreadable or has a different header, THEN THE system SHALL trace the error, write nothing to stdout or stderr, and exit with code 1.
- **AC-1.7** THE system SHALL read a `reported_at` without an offset as Europe/Madrid wall-clock time, and one with an offset as that instant expressed in Europe/Madrid.

### US2 · Each order's tenant language is known (P1)

As a tenant, I want the agent to know my language from what I reported, so that later messages reach me in it.

**Independent test:** a CSV with a Spanish order, an English order and an order with no language evidence; the traces record `es`, `en` and `en` with their evidence.

**Acceptance criteria (EARS):**

- **AC-2.1** THE system SHALL infer each valid order's tenant language, Spanish or English, from its description and title, without calling the model.
- **AC-2.2** IF the evidence for both languages is equal, THEN THE system SHALL choose English.
- **AC-2.3** THE system SHALL trace each order's inferred language together with the evidence for the decision.

### US3 · The reference time is explicit and recorded (P1)

As the evaluator, I want "now" fixed and recorded at startup, so that every date the agent later states is reproducible.

**Independent test:** run the same CSV with `AGENT_NOW` set, unset with fresh dates, and unset with stale dates; the recorded reference time follows each rule.

**Acceptance criteria (EARS):**

- **AC-3.1** THE system SHALL take the reference time from the container clock in Europe/Madrid, or from `AGENT_NOW` when it is set, and SHALL record it once at startup.
- **AC-3.2** IF `AGENT_NOW` is not set AND every valid order's `reported_at` is more than 7 days before the clock, THEN THE system SHALL use the latest `reported_at` as the reference time and trace that decision.
- **AC-3.3** IF `AGENT_NOW` is set but cannot be parsed, THEN THE system SHALL trace it and proceed as if it were unset.
- **AC-3.4** THE system SHALL record the reference time with the Europe/Madrid offset in force at that instant.

### US4 · Incoming lines are read safely and in order (P1)

As the evaluator, I want to type lines for any order at any time and have malformed input ignored rather than crash the agent.

**Independent test:** pipe a mix of valid, malformed, unknown-order, invalid-role, `<NO RESPONSE>` and closed-order lines into the line reader; each is traced with its classification, in arrival order, and none produces stdout output.

**Acceptance criteria (EARS):**

- **AC-4.1** WHEN a stdin line has the form `<work_order_id>|<role> <body>`, with `role` `tenant` or `handyman` (the sender) and an open order, THE system SHALL record it as an incoming message for that order and sender.
- **AC-4.2** WHEN the body is exactly `<NO RESPONSE>`, THE system SHALL record it as a timeout from that sender.
- **AC-4.3** IF a line is malformed, names an unknown order or an invalid role, or refers to an order that already has a terminal result, THEN THE system SHALL trace it with the reason and emit nothing for it.
- **AC-4.4** THE system SHALL process lines one at a time in arrival order, and SHALL accept new lines while an earlier line is still being processed.
- **AC-4.5** WHEN a valid incoming message is recorded, THE system SHALL emit nothing in response (negotiation arrives in later features).
- **AC-4.6** THE system SHALL tolerate Windows line endings, surrounding whitespace, blank lines and `|` characters inside the body.

### US5 · The run always ends cleanly (P1)

As the evaluator, I want every order to end with exactly one result and the process to exit, so that my harness never hangs.

**Independent test:** start with N orders and close stdin; stdout holds exactly N results and the process exits 0.

**Acceptance criteria (EARS):**

- **AC-5.1** WHEN stdin ends, THE system SHALL first process every line already received, then close every unfinished order with `WOID:<id>|RESULT:requires_review` and a `REASON` line stating that no reply was received (code `no_response`).
- **AC-5.2** WHEN every order has a terminal result, THE system SHALL flush its traces and exit with code 0, without waiting for stdin to end.
- **AC-5.3** THE system SHALL emit exactly one terminal result per order, and nothing for that order afterwards.
- **AC-5.4** THE system SHALL NOT use wall-clock waiting, timers or timeouts.

### US6 · The terminal belongs to the protocol (P1)

As the evaluator, I want stdout to carry only well-formed frames and results and stderr to stay empty, so that my parser never breaks.

**Independent test:** the message writer, exercised directly with hostile bodies, always produces one well-formed frame; a spawned run leaves stderr empty.

**Acceptance criteria (EARS):**

- **AC-6.1** THE system SHALL write each message as `WOID:<id>|ROLE:<role>`, a newline, the body, and a blank line, where `role` is the recipient.
- **AC-6.2** THE system SHALL normalise every body so that it is trimmed and contains no blank lines, so that one message is always exactly one frame.
- **AC-6.3** THE system SHALL write a result as `WOID:<id>|RESULT:requires_review` and `REASON:<sentence>`, or `WOID:<id>|RESULT:scheduled` and `SCHEDULED_FOR:<ISO 8601 with Europe/Madrid offset>`, followed by a blank line. `REASON` is a single line.
- **AC-6.4** IF a body or reason contains a line that looks like a frame or result header, THEN THE system SHALL still produce exactly one frame or result, whose header is the one the system chose.
- **AC-6.5** THE system SHALL write nothing to stdout other than frames and results, and nothing to stderr, including runtime warnings and uncaught errors; anything else written to stderr goes to the traces.

### US7 · The run can be reconstructed from its traces (P1)

As the evaluator, I want traces from which each order's handling can be rebuilt, so that I can audit decisions.

**Independent test:** run a scenario, then replay its recorded facts; the replay yields the same terminal results without reading stdin or the CSV.

**Acceptance criteria (EARS):**

- **AC-7.1** THE system SHALL write every trace line as JSON with `timestamp`, `work_order_id` (null for run-level events), `event_type` and `detail`, to files under `/app/traces`.
- **AC-7.2** THE system SHALL trace the run start (with the reference time), the loaded orders, every incoming line, the end of input, every state change and every terminal result.
- **AC-7.3** WHEN the recorded facts of a run are replayed, THE system SHALL reproduce the same order states and terminal results.

## Edge cases

- Empty CSV (header only): no output, exit code 0 immediately (AC-5.2).
- Every row invalid: one result per invalid row, then exit 0 without waiting for stdin (AC-5.2).
- Quoted description with a blank line or frame-like text (`WOID:…`): stored as data; never reaches a frame header (AC-6.4).
- `reported_at` with a `+02:00` offset before 2026-10-25 and `+01:00` after: both read correctly (AC-1.7, TIME-1).
- Reference time from `AGENT_NOW=2026-10-24T18:00` (no offset): recorded as `+02:00`; `2026-10-26T09:00` as `+01:00` (AC-3.4).
- Stale CSV with one row in the future: the fixture rule does not apply, since not every row is stale (AC-3.2).
- Lines arriving before the CSV is loaded: queued, and processed after loading (AC-4.4).
- Stdin ends while lines are still queued: they are processed before the `no_response` closures (AC-5.1).
- A line for an order closed as `invalid_work_order`: traced and ignored (AC-4.3, ORD-2).
- Order IDs with surrounding whitespace in the CSV or in a line: trimmed before matching.
- Description text that reads like instructions: data only; no model call happens in this feature.

## Scenarios

Protocol-visible behaviour is covered by scenarios (`tests/scenarios/001-*.txt`); the writer and the line reader are also tested directly.

| Scenario / test | Covers | Input (summary) | Expected |
|---|---|---|---|
| `001-eof-closes-all` | AC-1.1, AC-5.1, AC-5.3 | 3 valid orders, EOF | 3 `requires_review` (`no_response`); CSV byte-identical; exit 0 |
| `001-quoted-csv` | AC-1.2 | Quoted commas, quotes, line breaks; EOF | All orders loaded (traced) and closed |
| `001-invalid-rows` | AC-1.3, AC-1.4, AC-1.5 | Bad urgency, empty title, bad date, no id, duplicate id; EOF | One `invalid_work_order` per bad row; nothing for no-id; duplicate traced once |
| `001-all-invalid-exits` | AC-5.2 | Only invalid rows; stdin left open | Results, then exit 0 without EOF |
| `001-empty-csv` | AC-5.2 | Header only | No output; exit 0 |
| `001-csv-unusable` | AC-1.6 | Missing file; wrong header | Empty stdout and stderr; error traced; exit 1 |
| `001-reported-at-zones` | AC-1.7, TIME-1 | Rows with and without offsets around 2026-10-25 | Traced instants in Madrid with the correct offsets |
| `001-language` | AC-2.1, AC-2.2, AC-2.3 | Spanish, English, no-evidence orders | `es`, `en`, `en` traced with evidence |
| `001-reference-time` | AC-3.1–AC-3.4 | `AGENT_NOW` set / invalid / unset with fresh and stale CSVs | Recorded reference time per rule; fixture decision traced |
| `001-bad-lines` | AC-4.1–AC-4.3, AC-4.5, AC-4.6 | Valid, malformed, unknown order, invalid role, `<NO RESPONSE>`, CRLF, `\|` in body | Each traced with its classification; no stdout before EOF |
| `001-closed-order-line` | AC-4.3, AC-5.3, ORD-2 | Line for an `invalid_work_order` order | Traced and ignored; no second result |
| `001-queue-order` | AC-4.4, AC-5.1 | Burst of lines then EOF, written before startup ends | Traced in arrival order; closures after all lines |
| Writer unit tests | AC-6.1–AC-6.4, OUT-2 | Bodies with blank lines, whitespace, `\r\n`, header-like lines; multi-line reasons | One frame / result each, exact shape |
| `001-clean-streams` | AC-6.5, OUT-1 | Spawned run with a dependency warning and a thrown error forced | stderr empty; stdout only frames/results; error in traces |
| `001-trace-shape` | AC-7.1, AC-7.2, TRACE-1 | Any scenario | Every line has the four fields; required events present |
| `001-replay` | AC-7.3, TRACE-2 | Replay of `001-invalid-rows` and `001-bad-lines` traces | Same states and results |
| No-timer check | AC-5.4 | Source | No timer or wall-clock waiting in `src/` |

## Success criteria

- For any CSV with N usable order IDs and an immediate EOF, stdout contains exactly N terminal results and the process exits 0.
- Across all 001 scenarios, stderr is empty and every stdout block parses as a frame or a result.
- Every trace line is valid JSON with the four required fields.
- Replaying any 001 scenario's facts reproduces its results exactly.
- ORD-1, ORD-2, OUT-1, OUT-2, TRACE-1, TRACE-2 and RUN-1 are cited by passing tests and removed from `coverage-baseline.json`.

## Assumptions

- Language inference is deterministic and needs no model call (02 §1).
- The CSV is read once per run and never re-read.
- `AGENT_NOW` uses ISO 8601; without an offset it is Madrid wall-clock time.
- When stdin ends, the `no_response` closures follow CSV order.
- The `REASON` sentence for `invalid_work_order` names the problem (for example "Unknown urgency 'Urgent'"), never echoing more than the offending field.

## Open questions

None.
