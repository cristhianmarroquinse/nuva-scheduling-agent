# Testing strategy

Pick the test level before writing code.

| Change | Required tests |
|---|---|
| Core logic (calendar, policy, fold) | Unit tests on the pure functions, citing invariant IDs |
| Behaviour visible on the protocol | A scenario: CSV + stdin lines + expected frames and results |
| Interpretation (regex or model) | Golden-set cases; the real model only in `eval/`, never in `pnpm test` |
| Bug fix | A failing scenario or unit test that reproduces it, before the fix |
| Model boundary | Adversarial inputs: injection text, wrong offsets, dropped constraints |

Rules:

- `pnpm test` never calls the network. The interpreter is injected; tests use the fake one.
- Freeze time with an explicit `sim_now`. Include at least one case across the 2026-10-25 DST change.
- Every EARS requirement in a feature spec maps to at least one scenario.
- Assert observable outputs (frames, results, trace events), not private internals.
- A test that passes on the first run without a code change proves nothing. Check that it fails without the change.
