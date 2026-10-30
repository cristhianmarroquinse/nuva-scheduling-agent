# Planning record

How I decided what to build and how to build it, before writing product code.

| Document | What it covers |
|---|---|
| [01-problem-analysis.md](01-problem-analysis.md) | What the take-home asks, what is evaluated, and its non-obvious requirements |
| [02-architecture-selection.md](02-architecture-selection.md) | The options I weighed, what I chose, and what changed after stress-testing it |
| [03-harness-engineering.md](03-harness-engineering.md) | How I set up the development workspace so that agent-written code stays inside explicit rules |
| [04-roadmap.md](04-roadmap.md) | Phases and exit criteria |

The individual decisions are in [`../adr/`](../adr/).

## How I used AI in planning

I used Claude Code as a research and review tool, not as the decision maker:

- **Research.** Current patterns for LLM systems that coordinate people under hard business rules, and how established platforms structure them.
- **Reuse.** Searching my previous production code for patterns I had already proven, such as structured LLM output with validation, terminal-state guards and timezone handling.
- **Stress-testing.** Once I had a design, I asked independent reviewers to attack it: two agents arguing opposite architectures, then a third, on a different model, whose only job was to find message sequences that break it.

The reviews found real defects, listed in [02](02-architecture-selection.md#what-stress-testing-changed). I fixed most of them. I also rejected or narrowed several suggestions:

- **Reference time.** A reviewer suggested always anchoring "now" to the CSV dates. I rejected that as the default, because the evaluator types relative dates against the real present and a scheduler should not propose past dates. A later review showed that a stale sample CSV with scripted replies would break a clock-only rule, so I kept the clock but added a narrow exception: when every order is more than a week old, the CSV is treated as a fixture and "now" is its latest date ([ADR 0003](../adr/0003-reference-time.md)).
- **Re-confirming acceptances.** A reviewer proposed re-confirming every acceptance that is not a plain "yes". I limited it to replies containing contrast or negation words, so "Yes, Thursday is fine" still closes in one round.
- **Critical orders.** I kept immediate review when a Critical order's tenant does not respond: someone has to phone. I accepted that the handyman always gets one reminder.
- **A tool-calling agent as the base.** It would show off more "agent". I chose against it because it puts correctness in the model's hands. It stays as an optional, bounded tier ([ADR 0005](../adr/0005-tiered-agent-escalation.md)).
- **Scope.** I left out recorded cassettes, an LLM judge and generator-based property tests, even though reviewers suggested them. The event log already makes every run replayable, and scenario tests cover the invariants; the extra machinery would add code to review without adding confidence.
