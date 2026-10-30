---
paths:
  - "src/**"
  - "tests/**"
---

# Time handling

All time is Europe/Madrid, with the offset in force at each instant (TIME-1). Madrid moved from +02:00 to +01:00 on 2026-10-25; tests must cover both sides.

- Use the project's time module (Luxon underneath). Never build dates with `new Date(string)` without a zone, and never hardcode offsets.
- The reference time comes from the `run_started` event (`sim_now`): the container clock, or `AGENT_NOW` when set (ADR 0003). Never call the clock elsewhere; inject it.
- Outgoing text states absolute dates with weekday and time range, in Madrid time (COM-3).
- `SCHEDULED_FOR` is ISO 8601 with the Madrid offset, e.g. `2026-11-05T10:00:00+01:00`.
- No wall-clock waiting, timers or timeouts in the agent (REQ-TO-5). Timeouts arrive as `<NO RESPONSE>`.
