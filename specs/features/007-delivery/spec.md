# 007 · Delivery: Docker image, README and example trace

**Status:** planned
**Product requirements:** REQ-DL-1, REQ-DL-2, REQ-DL-3, REQ-DL-4, REQ-IN-1, REQ-TR-1, REQ-TR-3, REQ-OUT-4
**Invariants touched:** OUT-1, TRACE-1, TRACE-2 (the committed example must replay)
**Deferred:** phase 2 of the roadmap (tiered agent escalation, simulator)

## Why

Everything the product does is built and tested, but nobody can run it the way the take-home asks: there is no Dockerfile, the README still says "phase 1 next", and no complete run is committed. This feature makes the repository evaluable with Docker alone: an image whose build fails if typecheck or any test fails and whose runtime holds only compiled output and production dependencies; a README that explains how to run it, what it assumes, what it trades off and where the model is used and why, with the evaluation numbers; and one complete, replayable run under `traces/examples/`. It closes phase 1 of the roadmap, after which the repository is tagged `v1`.

## User stories

### US1 · The image builds only if the product is correct, and runs with nothing but Docker (P1)

As the evaluator, I want `docker build -t agent .` and the documented `docker run` to be the only steps, so that I can run the agent without Node or pnpm on my machine.

**Independent test:** build the image; a deliberately failing test makes the build fail; the built image runs a CSV and stdin to completion and writes traces to the mounted directory.

**Acceptance criteria (EARS):**

- **AC-1.1** THE repository SHALL contain a `Dockerfile` at its root with a build stage that installs dependencies, runs the typecheck and the whole test suite, and compiles the sources, and a runtime stage that holds only the compiled output and production dependencies (REQ-DL-1, REQ-DL-4).
- **AC-1.2** THE build stage SHALL run without `ANTHROPIC_API_KEY` and without network access to the model; a failing test SHALL fail `docker build`.
- **AC-1.3** THE runtime image SHALL NOT contain the tests, the specs, the harness, the evaluation, `.env` or any trace.
- **AC-1.4** THE container SHALL read `/app/work_orders.csv`, write traces under `/app/traces`, read stdin and write stdout exactly as the product spec says, with Node runtime warnings suppressed so that stderr stays empty (REQ-OUT-4), and SHALL exit with the agent's exit code.
- **AC-1.5** THE documented `docker run` command SHALL pass `.env` with `--env-file`, mount the CSV read-only and the traces directory, and keep stdin open with `-i` (REQ-DL-2).
- **AC-1.6** THE image SHALL run as a non-root user, and the traces directory SHALL be writable by it when mounted from the host.
- **AC-1.7** THE compiled output SHALL be produced from `src/` only, so that nothing from `tests/`, `eval/` or `scripts/` is part of the runtime.

### US2 · The README explains how to run it, what it assumes and where the model is used (P1)

As a reader, I want one document that tells me how to run the agent, what it does, what decisions it embodies and why the model is used where it is, with numbers, so that I can judge the work without reading the code.

**Acceptance criteria (EARS):**

- **AC-2.1** THE README SHALL state the current status (phase 1 complete, `v1`), the build and run commands, the CSV format, the stdin line format with `<NO RESPONSE>`, the stdout frames and results, and the environment variables `ANTHROPIC_API_KEY` and `AGENT_NOW` with the fixture rule for stale CSVs.
- **AC-2.2** THE README SHALL describe the design in brief: code decides, the model interprets; facts and replay; the invariants and how coverage is enforced; the calendar rules, the negotiation rules, timeouts, preemption and blackouts, each in a sentence or two with a pointer to its spec.
- **AC-2.3** THE README SHALL have a section "Where AI is used and why" that names the two model calls (interpretation, answers to questions), what guards them (schema, validator, closed facts, no direct state), the chosen tier and the evaluation numbers per tier from `eval/REPORT.md`, and what the model gets wrong.
- **AC-2.4** THE README SHALL list the assumptions and trade-offs decided during the features: language inference by heuristics, no calendar horizon, the notice rule, withdrawals counting as refusals, no-fit proposing the next free slot, takeover only on stated availability, weekday blackouts covering the next occurrence, reminders then review, critical tenant to review at once, handyman text never forwarded, and the answer validator's strictness.
- **AC-2.5** THE README SHALL list known limitations and what phase 2 would add, and SHALL point to the example trace, the evaluation report, the planning record and the ADRs.
- **AC-2.6** THE README SHALL describe how the repository was built: the spec, plan, implement and ship pipeline, the rules and hooks, `pnpm check` and invariant coverage, with the feature list 001 to 007 and the test count.

### US3 · One complete run is committed and replays (P1)

As the evaluator, I want the traces of a real complete run in the repository, so that I can read how the agent handled each order without running anything.

**Acceptance criteria (EARS):**

- **AC-3.1** THE repository SHALL contain under `traces/examples/` the CSV, the stdin script, the stdout produced and the JSONL trace of one complete run with several orders that exercise an acceptance, a counter-proposal, a question, a timeout and a Critical order, plus a short README describing the exchange.
- **AC-3.2** THE run SHALL be produced with the real model and a fixed `AGENT_NOW`, so that the trace shows real model calls and the dates are stable; it is produced by the author with the key.
- **AC-3.3** A test in `pnpm test` SHALL read the committed trace, check every line has the four fields (TRACE-1), replay its facts and reproduce the committed stdout (TRACE-2).
- **AC-3.4** THE repository SHALL provide one command that regenerates the example from its CSV and stdin, so that the trace can be refreshed after a change.

## Edge cases

- `docker build` on a machine without the key: succeeds (the build never calls the model).
- `docker run` without `.env`: the agent starts, every model call fails, orders end `llm_unavailable` or `no_response`; the process never crashes (REQ-RB-2).
- Traces directory not mounted: the container writes under its own `/app/traces` and exits normally.
- A CSV mounted read-only: the agent never writes it (REQ-IN-1).
- Spanish weekday names in the image: the build stage's tests fail if the base image lacks ICU data.
- Runtime warnings from the SDK or Node: never on stderr (`NODE_NO_WARNINGS=1` plus the stderr redirect).
- The example trace contains model calls: their `model_call` lines are kept; the replay test ignores them as it does in the scenarios.

## Scenarios

| Scenario / test | Covers | Input (summary) | Expected |
|---|---|---|---|
| Manual: `docker build -t agent .` | AC-1.1, AC-1.2, AC-1.7 | Clean checkout, no key | Image builds; tests ran in the build log |
| Manual: build with a failing test | AC-1.2 | Temporarily broken test | `docker build` fails |
| Manual: `docker run` with the example CSV and stdin | AC-1.4, AC-1.5, AC-1.6 | Example inputs | stdout equals the committed stdout up to model wording; traces written to the mount; exit 0 |
| Manual: inspect the image | AC-1.3 | `docker run --rm agent ls /app` | Only `dist`, `node_modules`, `package.json` |
| `tests/delivery/example-trace.test.ts` | AC-3.1, AC-3.3, TRACE-1, TRACE-2 | The committed example | Four fields per line; replay reproduces the committed stdout; the run covers the listed situations |
| `tests/delivery/dockerfile.test.ts` | AC-1.1, AC-1.3, AC-1.4, AC-1.6, AC-1.7 | The Dockerfile text | Two stages; typecheck and test in the build stage; `NODE_NO_WARNINGS=1`; non-root user; the runtime stage copies only `dist`, production `node_modules` and `package.json`; `.dockerignore` excludes `.env`, traces and the harness (the build stage needs the tests and the evaluation) |
| `tests/delivery/readme.test.ts` | AC-2.1–AC-2.6 | README text | Required sections and pointers present; the eval numbers in the README match `eval/REPORT.md` |
| Manual: `pnpm example` | AC-3.2, AC-3.4 | Example inputs with the key | Regenerated files under `traces/examples/` |

## Success criteria

- `docker build -t agent .` succeeds on a clean checkout without a key and fails when a test fails.
- The documented `docker run` processes the example to completion with an empty stderr.
- The README has every section of US2, and its evaluation numbers match the report.
- `traces/examples/` holds a complete run whose facts replay to its stdout in `pnpm test`.
- The repository is tagged `v1` after this feature ships.

## Assumptions

- The base image is an official Node 22 image; its full ICU data is relied on for Spanish dates and is verified by the tests in the build stage.
- `.dockerignore` already excludes the harness; the build stage needs `src/`, `tests/`, `scripts/` (hook library used by the hygiene test), `package.json`, `pnpm-lock.yaml`, `tsconfig*.json` and `vitest.config.ts`.
- The README is written for a technical reader of the take-home; the planning record and ADRs keep the long form.
- The example run uses the real model with `AGENT_NOW` fixed, so model wording may differ between regenerations; the replay test compares the committed stdout with the committed trace, not with a new run.

- The committed example is produced with the real model: it is what an evaluator sees in their own runs, with real `model_call` lines and a model-written answer. Anyone can regenerate it with a key; the replay test checks the committed pair of trace and stdout.

## Open questions

None.
