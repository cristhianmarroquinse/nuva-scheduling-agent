---
name: plan
description: Turn a clarified feature spec into a technical plan with a constitution check, then into ordered tasks. Use after /spec and before /implement.
argument-hint: Path to specs/features/NNN-*/spec.md
---

# Plan

Produce `plan.md` and `tasks.md` next to the spec, from `specs/_templates/plan.md` and `specs/_templates/tasks.md`.

## Steps

1. **Read.** The spec (must be `Status: clarified` with no open markers), the ADRs, the rules in `.claude/rules/`, and the current code it touches.
2. **Design.** Modules, types, events (facts) and projections, and pure functions. Prefer extending existing modules over new abstractions.
3. **Constitution check.** Fill every row of the template table. A row that is not ✅ needs an entry in *Complexity tracking*: the deviation, why it is needed, and why the simpler alternative was rejected. If a deviation contradicts an accepted ADR, stop: propose a new ADR to the user instead of proceeding.
4. **Test plan.** Map every acceptance criterion and touched invariant to a unit test or scenario. Name the pending invariants that will leave `specs/coverage-baseline.json`.
5. **Tasks.**
   - Order them: foundations, then one phase per user story, tests before implementation.
   - Mark `[P]` only for tasks on different files with no unfinished dependency.
   - Each task names its file path.
6. **Analyse.** Re-read spec, plan and tasks together and fix inconsistencies:
   - a criterion with no task;
   - a task with no criterion;
   - terminology that differs between the three files.
   Then set the spec to `Status: planned`.

## Output

Paths of `plan.md` and `tasks.md`, the constitution-check result, and the list of invariants the feature will cover.
