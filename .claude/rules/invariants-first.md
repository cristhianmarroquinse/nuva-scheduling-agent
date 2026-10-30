# Invariants first

`specs/INVARIANTS.md` lists what must hold for every input. They are the contract the evaluator checks.

- Before changing code in `src/`, identify which invariant or requirement (`REQ-*`) the change touches.
- Write or update a test that cites that ID (in the test name or a comment) and fails for the current behaviour, then change the code.
- When a test starts covering a pending invariant, remove the ID from `specs/coverage-baseline.json` in the same change. The baseline never grows.
- Never weaken, delete or reword an invariant to make a test pass. If an invariant looks wrong, stop and raise it.
- A new guarantee gets a new ID at the end of its section. IDs are never reused or renumbered.
