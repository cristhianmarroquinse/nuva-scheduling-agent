# 010 · Plan: Blackout moves respect priority

**Spec:** [spec.md](spec.md)

## Design

Only `src/core/state.ts` changes. `applyInterpretation` becomes a thin wrapper around the existing body (`applyReply`), which now receives a `deferred` list:

- The blackout block collects every open order with a tentative hold in the windows, releases all those holds (`hold_released { reason: 'blackout' }`), ranks them with the allocation comparator used by `priorityOrder`, re-proposes the ones that rank above the writer's order, and pushes the rest to `deferred` (AC-1.1, AC-1.2).
- The wrapper re-proposes the deferred orders, in rank order, on the state returned by the writer's own reply (cause `blackout`, no takeover) (AC-1.3).
- The blackout condition accepts `exclusions.length === 0` when the intent is `decline` or `withdraw`, using the current proposal's date, and traces `blackout_recorded { windows, exclusions, inferred: true }` (AC-2.1, AC-2.2).

No new fact: the moves are projections of the same `interpretation` fact, so replay is unchanged (TRACE-2).

## Constitution check

All nine checks ✅: no model change, no new dependency, state still folded from facts, scheduled visits untouched, no takeover added.

## Test plan

- `tests/unit/state.test.ts`: AC-1.1, AC-1.2 (writer in the middle, first, last), AC-1.3, AC-2.1, AC-2.2; SCHED-1, SCHED-3.
- Scenarios `tests/scenarios/010-*.txt` and `010.test.ts`.
- Existing 005 blackout tests: any change of order is listed in the commit.
