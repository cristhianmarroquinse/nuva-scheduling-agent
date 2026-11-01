# 002 · Plan: Calendar and initial proposals

**Spec:** [spec.md](spec.md)

## Summary

Adds a pure calendar (2-hour slots, business windows, no overlap), a priority order for allocation, and the first message templates in Spanish and English. The allocation and the frames are derived inside `step` when `csv_loaded` is folded, right after validation, so the runner does not change and a replay reproduces the holds and frames. Every order that survives validation gets a tentative hold and two frames (tenant, handyman) at startup; end of input releases the holds and closes as before. Because stdout now starts with frames, the 001 scenarios are updated to the new startup output.

## Design

### Modules

| Module | Pure | Responsibility |
|---|---|---|
| `src/time/format.ts` (new) | yes | Locale wording of instants, Europe/Madrid: `weekdayDate(dt, language)` ("jueves 5 de noviembre de 2026" / "Thursday 5 November 2026"), `hourMinute(dt)` (`HH:MM`), `timeRange(start, end, language)` ("de 10:00 a 12:00" / "10:00 to 12:00"). Luxon stays inside `src/time/`. |
| `src/calendar/calendar.ts` (new) | yes | `Slot { start, end }` (ISO strings with the Madrid offset), `Hold { orderId, version, slot }`. `earliestStart(simNow, reportedAt)` = later of (next full hour strictly after `simNow`) + 1 h and `reportedAt` rounded up to the hour. `fitsWindow(slot, urgency)`: Critical any day 08:00–21:00; others Mon–Fri 09:00–19:00; start and end inside. `overlaps(a, b)`. `nextSlot({ from, urgency, holds })`: first on-the-hour 2-hour slot at or after `from` that fits the window and overlaps no hold (walks hour by hour; no horizon). `priorityOrder(orders)`: Critical, High, Medium, Low; ties by earlier `reportedAt`, then by input index. |
| `src/messages/templates.ts` (new) | yes | `initialProposalToTenant({ language, title, slot, critical })` and `initialProposalToHandyman({ title, address, urgency, slot })` → body text. Spanish urgency labels (Crítica, Alta, Media, Baja). The 112 clause is appended only when `critical`. Bodies are single-paragraph; the title is inlined as one line (the writer normalises anyway). |
| `src/core/state.ts` | yes | `OrderState` gains `proposal?: { version: number; slot: Slot }`. `State` gains `holds: Hold[]`. In `loadCsv`, after the validation loop: `priorityOrder` over the open orders, `nextSlot` for each, push the hold, set `proposal` v1, emit `hold_taken`, then the two frames with their `msg_out` traces. In `endInput`, before each `no_response` closure: `hold_released { version, reason: 'closed' }` and the hold removed. |
| `src/runtime/run.ts`, `src/main.ts` | no | Unchanged. `run_started` already precedes `csv_loaded`, so `simNow` is available to the fold, and the line loop starts only after `csv_loaded` is stepped (RUN-2 by construction). |
| `tests/scenarios/runner.ts` | — | New `# stdout results` flag: the expected section is compared with the concatenation of the result blocks only; frame blocks are still shape-checked. Needed by 001 scenarios whose reference time is the real clock. |

### Facts and projections

No new fact. `csv_loaded` now also derives:

| Projection | Detail |
|---|---|
| `hold_taken` | `{ version: 1, start, end }` per allocated order, in allocation order |
| `msg_out` | `{ to: 'tenant' \| 'handyman', language, version, start, end, body }` per frame, plus the stdout frame |

`eof` derives, per open order before its `state_change`: `hold_released { version, reason: 'closed' }`.

Stdout order at startup: `invalid_work_order` results in CSV order (validation loop, as in 001), then for each order in allocation order the tenant frame and the handyman frame. The spec fixes only that frames precede anything caused by input (AC-4.1) and that frames follow allocation order (AC-4.2).

### Allocation

```
earliest(order) = max(nextFullHourAfter(simNow) + 1h, ceilHour(reportedAt))
for order in priorityOrder(openOrders):
  slot = nextSlot({ from: earliest(order), urgency, holds })
  holds.push({ orderId, version: 1, slot })
```

`nextSlot` advances one hour at a time from `from`, in Madrid local time, until a slot fits the window and overlaps nothing. Days and hours are computed with Luxon in `Europe/Madrid`, so the 2026-10-25 change needs no special case; the windows never contain 02:00–03:00, so no slot spans the transition.

### Templates (content, not final wording)

- Tenant (es/en): greeting, the title, the proposal with weekday date and range "(hora de Madrid)" / "(Madrid time)", one sentence asking to confirm or give other availability; Critical adds the 112 clause.
- Handyman (es): the title, urgency label, address, the proposal with weekday date and range, one sentence asking to confirm or give availability.
- Neither includes the description (AC-3.5). Re-proposals in later features reuse these functions with a `previousCancelled` flag.

## Constitution check

| Check | Status |
|---|---|
| Model output only enters as a validated interpretation event (LLM-1) | ✅ No model call; templates only |
| Model text only to the sender, from closed facts (LLM-2) | ✅ No model text |
| Nothing but protocol on stdout; nothing on stderr (OUT-1) | ✅ Frames go through `formatFrame` and the existing `stdout` output; nothing else changes |
| Time through the time module, Europe/Madrid, injected clock (TIME-1) | ✅ Calendar and formatting use `src/time/`; `simNow` comes from `run_started`; no clock read |
| State derived from facts; no projection fed back as input (ADR 0002) | ✅ Holds, proposals and frames are derived in `step` from `csv_loaded` and `sim_now`; replay reproduces them |
| Exactly one terminal result per order; nothing after it (ORD-1, ORD-2) | ✅ `close()` unchanged; frames are only emitted for open orders at load time |
| No overlap; scheduled visits never move (SCHED-1, SCHED-3) | ✅ `nextSlot` rejects overlaps with every hold; nothing is scheduled yet, so SCHED-3 is not exercised (stays pending by decision in the spec) |
| No new dependency or abstraction without a requirement asking for it | ✅ No new package. Two new modules (calendar, templates) answer REQ-SC-1…3 and REQ-OUT-2/3. The runner's `results` flag is test harness, see Complexity tracking |
| Consistent with every accepted ADR | ✅ ADR 0003 earliest-slot rule and `sim_now`; ADR 0002 projections; ADR 0001 code owns proposals |

## Complexity tracking

| Deviation | Why it is needed | Simpler alternative rejected because |
|---|---|---|
| `# stdout results` flag in the scenario runner | Nine 001 scenarios take their reference time from the real clock (`${NOW}`, or `AGENT_NOW` with `${NOW}` rows); their startup frames now carry clock-dependent dates, so an exact stdout match is impossible | Fixing `AGENT_NOW` in those scenarios would defeat the ones that test the clock path (AC-3.1, AC-3.3 of 001); asserting nothing about stdout would lose the result checks |

## Test plan

Unit tests cite invariants in literal titles. Scenarios run with `AGENT_NOW` fixed unless they test the clock.

| Test | Covers |
|---|---|
| `tests/unit/format.test.ts` | Weekday dates and ranges in es/en, on both sides of 2026-10-25; **TIME-1** |
| `tests/unit/calendar.test.ts` | AC-1.2 (priority order), AC-2.1–AC-2.6 (earliest start on the hour, 18:30 Friday, 18:30 Critical, weekend, future `reported_at`, full days spill, DST weekend); **SCHED-1**, **SCHED-2**, **SCHED-5** |
| `tests/unit/templates.test.ts` | AC-3.2–AC-3.7 (language per recipient, date wording, title, address and urgency only to the handyman, no description, confirm sentence, 112 only for Critical tenants, in each language); **COM-1**, **COM-2**, **COM-3** |
| `tests/unit/state.test.ts` (new cases) | AC-1.1, AC-1.3, AC-1.4, AC-1.5, AC-3.1, AC-3.8, AC-4.2, AC-4.3, AC-4.4 (holds and proposals derived on `csv_loaded`, invalid rows get nothing, tenant then handyman frames in allocation order, `msg_out` traces, `hold_released` on `eof`, lines for proposed orders emit nothing); **SCHED-1** on a folded sequence |
| `tests/harness/runner.test.ts` (new) | The `results` flag compares result blocks only and still rejects a malformed frame |
| `tests/scenarios/002.test.ts` + `tests/scenarios/002-*.txt` | Every scenario in the spec table; titles cite **SCHED-1** (`002-urgency-order`, `002-many-orders`), **TIME-1** (`002-dst-weekend`), **COM-1/2/3** (`002-languages`), **RUN-2** (`002-queued-input-first`); the trace-frames test checks one `msg_out` per frame across all 002 scenarios |
| `tests/scenarios/replay.test.ts` | TRACE-2 for `002-urgency-order` (holds, frames and results reproduced) |
| `tests/scenarios/001-*.txt`, `tests/scenarios/001.test.ts` | Updated to the startup frames: deterministic scenarios (fixture rule or stale rows) get the full expected frames; clock-dependent ones use `# stdout results`; the hostile and trace-shape tests filter result blocks before matching ids |

**Leaving the baseline:** SCHED-1, SCHED-2, SCHED-5, COM-1, COM-2, COM-3, TIME-1, RUN-2. Staying: SCHED-3, SCHED-4, ACC-*, LLM-*, RUN-3.

## Risks

- **001 expectations change on purpose.** Every 001 scenario's stdout gains frames. This is the spec'd behaviour change, not a regression; `/implement` must update those files rather than stop at the "changing a test expectation" rule. The 001 trace and result checks stay intact.
- **ICU data.** Spanish weekday and month names come from Node's Intl. Official Node builds ship full ICU; `format.test.ts` asserts the Spanish words so a small-ICU runtime fails the build. The Dockerfile (delivery feature) must use an official `node:22` image.
- **Template text is frozen by scenarios.** Any wording change later means touching every scenario's stdout. Acceptable: the wording is a product decision and the scenarios are its record.
- **Allocation cost.** `nextSlot` walks hour by hour and checks every hold; with N orders that is O(N² · hours). For realistic CSVs (tens of orders) it is negligible; `002-many-orders` (12 orders) guards the behaviour, not the speed.
- **Ties on `reported_at`.** Input index breaks ties, so allocation is deterministic across runs and replays.
