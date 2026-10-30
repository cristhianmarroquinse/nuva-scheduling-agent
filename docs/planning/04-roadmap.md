# 04 · Roadmap

| Phase | Content | Exit criterion |
|---|---|---|
| **0 · Harness** | `CLAUDE.md`, `specs/000-product.md`, `INVARIANTS.md`, ADRs, 7 rules, skills `/spec` `/plan` `/implement` `/ship`, edit guards, typecheck and definition-of-done hooks, `pnpm check` with invariant coverage | `pnpm check` green with the harness's own tests; hooks verified with real payloads; an independent review of ADRs and harness passed. The first phase 1 feature is the end-to-end dry run of `/spec → /plan → /implement` |
| **1 · Product v1** | Event-sourced core, calendar, policy, protocol, templates, traces, interpretation cascade, Docker, scenarios with a fake interpreter, golden set (regex vs Haiku vs Sonnet), README with "Where AI is used and why", committed example trace. Skills and agents of phase 1 | All scenarios pass; zero invariant violations; tag **`v1`**, which is submittable on its own |
| **2 · Evolution** | Tiered escalation behind `AGENT_TIER` ([ADR 0005](../adr/0005-tiered-agent-escalation.md)); adversarial simulator; bounded repair loop; metrics in the README | Tier enabled by default only if the full suite passes with zero violations and the hard scenarios improve; otherwise it ships disabled and documented |

Phase 2 work happens on top of `v1`, so the stable version is never at risk. Anything in phase 2 that does not meet its exit criterion ships disabled and is documented as a next step.
