# 009 · Plan: Stated constraints are honoured, and notes are true

**Spec:** [spec.md](spec.md)

## Summary

Exclusions in a refusal become per-order constraint windows, folded from the existing `interpretation` facts like the refused slots of 008, and the system-chosen fallback avoids them. The re-proposal routine distinguishes "the reply stated times" from "the reply carried an interpretation": only stated times open windows, trigger takeover and earn the "not available" note. Before the fallback, a reply with times on a specific date gets the nearest free slot that day. Acceptance treats an exclusion that overlaps the proposal as a mismatch; a contradictory reply with times is a counter; the prompt and the fast path learn three readings. No new fact, module or dependency.

## Design

| Module | Pure | Change |
|---|---|---|
| `src/policy/availability.ts` | yes | `constraintWindows(exclusions, simNow, days = 14): Slot[]` (AC-1.2): dated or weekday exclusions as in `blackoutWindows`; undated times repeated on each of the next 14 days. `nearestOnDate(stated, { earliest, holds, blocked }): Slot \| null` (AC-3.1): on-the-hour 2-hour slots inside 07:00–22:00 of each stated date, free of holds and blocked slots, at or after `earliest`, ordered by distance to the stated interval (a point is start..start+2h, a date alone the whole day), ties by start. |
| `src/policy/acceptance.ts` | yes | `evaluateAcceptance` returns `mismatch` when an exclusion overlaps the proposal on its date (date, weekday or undated; whole day or its time range) (AC-4.1). |
| `src/core/state.ts` | yes | `OrderState.constraints: Slot[]`. `refusal()` appends `constraintWindows(result.exclusions)` (AC-1.1); declines and withdrawals now pass their interpretation. `reproposeOrder()`: `stated = availability?.times.length > 0`; windows, takeover and `no_fit` only when stated (AC-2.1, AC-2.2); then `nearestOnDate` (AC-3.1); then the fallback with `blocked: [...blackouts, ...refused, ...constraints]` (AC-1.3). `contradictory` with times goes to `refusal(ctx, 'counter', result)` with a `decision { outcome: 'correction' }` (AC-4.2). |
| `src/interpreter/fast-path.ts` | yes | `tampoco`, `tampoco puedo` → decline (AC-4.4). |
| `src/interpreter/prompt.ts` | yes | Two rules (AC-4.3); `PROMPT_VERSION` → 4. |
| `eval/golden-set.json` | — | Three cases from the spec. |

The `cause` traced for a counter without times stays `counter`; the note is decided by `stated`, not by the cause.

## Constitution check

| Check | Status |
|---|---|
| Model output only enters as a validated interpretation event (LLM-1) | ✅ exclusions come from validated interpretations; code decides |
| Model text only to the sender, from closed facts (LLM-2) | ✅ untouched |
| Nothing but protocol on stdout; nothing on stderr (OUT-1) | ✅ |
| Time through the time module, Europe/Madrid, injected clock (TIME-1) | ✅ windows built per Madrid day from `sim_now` |
| State derived from facts; no projection fed back as input (ADR 0002) | ✅ `constraints` folded from facts |
| Exactly one terminal result per order; nothing after it (ORD-1, ORD-2) | ✅ |
| No overlap; scheduled visits never move (SCHED-1, SCHED-3) | ✅ only adds exclusions to searches |
| No new dependency or abstraction without a requirement asking for it | ✅ |
| Consistent with every accepted ADR | ✅ ADR 0004 (cascade): the fast path stays "bare yes/no" |

## Complexity tracking

| Deviation | Why it is needed | Simpler alternative rejected because |
|---|---|---|
| — | — | — |

## Test plan

- `tests/unit/availability.test.ts`: `constraintWindows` (date, weekday, undated over 14 days, DST day), `nearestOnDate` (21:30 → 20:00, held day → null, ties).
- `tests/unit/acceptance.test.ts`: overlapping exclusion → `mismatch`; non-overlapping → `needs_confirmation`.
- `tests/unit/fast-path.test.ts`: "Tampoco", "tampoco puedo".
- `tests/unit/state.test.ts`: AC-1.1, AC-1.3, AC-1.4, AC-2.1, AC-2.2, AC-3.1, AC-3.2, AC-4.1, AC-4.2; SCHED-1, SCHED-2 on every hold.
- `tests/unit/prompt.test.ts`: the two rules and the version.
- Scenarios `tests/scenarios/009-*.txt` and `009.test.ts`, one per row of the spec table.
- Existing expectations that encode "next free slot after a no-fit" (004 AC-1.6) change where the stated day has a free slot; each is listed in the commit with the AC.
- `eval/golden-set.json` + `pnpm eval --tier haiku` to regenerate `eval/REPORT.md` (real model, outside `pnpm test`).

## Risks

- More 004/005 expectations move (no-fit now prefers the stated day). Verified the same way as in 008: only times may differ.
- The committed example may change if a reply in it states exclusions; it is replayed and regenerated if so.
