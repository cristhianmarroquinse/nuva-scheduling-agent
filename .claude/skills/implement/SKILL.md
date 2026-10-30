---
name: implement
description: Implement the tasks of a planned feature test-first, keeping pnpm check green. Use after /plan.
argument-hint: Path to specs/features/NNN-*/tasks.md, optionally a task range (e.g. T010-T015)
---

# Implement

Execute `tasks.md` in order. Do not skip ahead, and do not add work that no task lists.

## For each task

1. Re-read the acceptance criterion or invariant it serves.
2. **Test tasks.**
   - Write the test, citing the AC and invariant IDs.
   - Run it and confirm it **fails for the expected reason**. If it passes, the test is wrong or the behaviour already exists; report it rather than continue.
3. **Implementation tasks.**
   - Write the smallest change that makes the failing test pass.
   - Follow `.claude/rules/`: no `console.*` in `src/`, time only through the time module, and model output only as validated interpretation events.
4. Run `pnpm check`. Fix failures before moving on.
5. Tick the task in `tasks.md`.

## When the feature is done

1. Remove the invariants it now covers from `specs/coverage-baseline.json`.
2. Re-read the spec. Every acceptance criterion needs a passing test; list any that do not and add tasks for them.
3. Set the spec to `Status: implemented` and run `pnpm check` one last time.

## Stop and ask when

- a task contradicts the spec, an invariant or an ADR;
- a fix would require changing a test's expectation rather than the code;
- the same failure survives two attempts. Use the debugging rule.
