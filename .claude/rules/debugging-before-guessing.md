# Debugging before guessing

- Reproduce first: a failing scenario, a unit test, or a replay of the trace that shows the problem.
- Read the trace for the order (`msg_in`, `interpretation`, `decision`, `state_change`) and find the first event where reality diverges from expectation. Fix there, not downstream.
- State the cause in one sentence before changing code. If you cannot, you have not found it yet.
- One hypothesis at a time. Revert experiments that did not confirm it.
- Never "fix" a symptom by widening a regex, raising a cap or adding a special case without a test that shows why.
