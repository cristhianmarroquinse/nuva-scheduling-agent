---
name: ship
description: Verify and commit the current change with the user's approval. Use when a task or feature is ready to commit.
argument-hint: Optional commit message hint
disable-model-invocation: true
---

# Ship

## Steps

1. **Inspect.** `git status` and `git diff`. Make sure no `.env`, `traces/` output (other than `traces/examples/`), `node_modules` or stray files are included.
2. **Verify.** Run `pnpm check`. If it is red, stop and report; never commit red.
3. **Consistency.**
   - Covered invariants are removed from `specs/coverage-baseline.json`.
   - Spec status and task checkboxes match the code.
   - A new architectural decision has an ADR.
4. **Propose.**
   - Show the user the file list and a Conventional Commits message (`feat:`, `fix:`, `test:`, `docs:`, `chore:`).
   - The subject is at most 72 characters; the body explains why and names the spec or invariant IDs.
5. **Commit** only after the user approves. Never push and never amend without being asked.
