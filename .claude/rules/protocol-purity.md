---
paths:
  - "src/**"
---

# Protocol purity

The terminal belongs to the evaluator (OUT-1, OUT-2, REQ-OUT-4).

- Only `src/io/streams.ts` touches `process.stdout` and `process.stderr`. It owns the protocol writer and, at startup, redirects anything written to stderr into the tracer.
- No `console.*` anywhere in `src/`, not even in comments. Diagnostics go to the tracer, which writes under `/app/traces`.
- The container runs with `NODE_NO_WARNINGS=1`, so runtime warnings never reach stderr. Uncaught errors are caught at the entry point and traced.
- The writer emits `WOID:<id>|ROLE:<role>`, the body, and a blank line. It normalises bodies (no blank lines inside, trimmed), so one call is always one frame.
- Results are `WOID:<id>|RESULT:scheduled` + `SCHEDULED_FOR:<ISO 8601>` or `WOID:<id>|RESULT:requires_review` + `REASON:<sentence>`.
- Confirmations to both parties are written before a `scheduled` result (ACC-2).

The edit hook catches violations on the agent's normal edit path. The real gate is `tests/harness/source-hygiene.test.ts` in `pnpm check`, plus a scenario that asserts the spawned process leaves stderr empty.
