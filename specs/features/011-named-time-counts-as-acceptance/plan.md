# 011 · Plan: A time a party names counts as their acceptance

**Spec:** [spec.md](spec.md)

## Design

- `src/core/state.ts`, `reproposeOrder`: when `options.party` is set, the slot came from `slotInside` or a takeover of the stated windows (not `no_fit`), and some stated time is a point equal to the slot start or a range equal to the slot (`namesExactly(times, slot)` in `src/policy/acceptance.ts`), the new version starts with `accepted = { [party]: version }` and that party's `unanswered` is not incremented. The `decision { outcome: 'repropose' }` carries `accepted_by: party`. That party gets `reproposalNoted` instead of the re-proposal question.
- `src/messages/templates.ts`: `reproposalNoted({ language, to, title, slot })`, Spanish to the handyman and the order's language to the tenant.
- `README.md`: the REQ-NG-3 confirmation rule and the named-time rule.

No new fact; the acceptance is a projection of the same interpretation (ACC-1 still requires the other party's own acceptance of that version).

## Constitution check

All nine checks ✅.

## Test plan

- `tests/unit/acceptance.test.ts`: `namesExactly` (point, exact range, longer range, date alone, other day).
- `tests/unit/state.test.ts`: AC-1.1 to AC-1.5; ACC-1, RUN-3.
- `tests/unit/templates.test.ts`: `reproposalNoted` in both languages, absolute date (COM-3).
- Scenarios `tests/scenarios/011-*.txt` and `011.test.ts`.
- Existing scenarios whose namer was asked again change; each is listed in the commit.
