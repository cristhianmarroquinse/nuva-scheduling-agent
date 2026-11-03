# 04 · Roadmap

| Phase | Content | Exit criterion |
|---|---|---|
| **0 · Harness** | `CLAUDE.md`, `specs/000-product.md`, `INVARIANTS.md`, ADRs, 7 rules, skills `/spec` `/plan` `/implement` `/ship`, edit guards, typecheck and definition-of-done hooks, `pnpm check` with invariant coverage | `pnpm check` green with the harness's own tests; hooks verified with real payloads; an independent review of ADRs and harness passed. The first phase 1 feature is the end-to-end dry run of `/spec → /plan → /implement` |
| **1 · Product v1** | Event-sourced core, calendar, policy, protocol, templates, traces, interpretation cascade, Docker, scenarios with a fake interpreter, golden set (regex vs Haiku vs Sonnet), README with "Where AI is used and why", committed example trace. Skills and agents of phase 1 | All scenarios pass; zero invariant violations; tag **`v1`**, which is submittable on its own |
| **2 · Evolution** | Tiered escalation behind `AGENT_TIER` ([ADR 0005](../adr/0005-tiered-agent-escalation.md)); adversarial simulator; bounded repair loop; metrics in the README | Tier enabled by default only if the full suite passes with zero violations and the hard scenarios improve; otherwise it ships disabled and documented |

Phase 2 work happens on top of `v1`, so the stable version is never at risk. Anything in phase 2 that does not meet its exit criterion ships disabled and is documented as a next step.

## After v1

Before phase 2, v1 was exercised the way the evaluator will use it, and every finding became a feature with its own spec (`/spec` → `/plan` → `/implement`), so each decision is recorded where the behaviour is specified.

| When | How it was found | Feature |
|---|---|---|
| 2026-11-02 | Manual run: three declines were answered with 14:00, 15:00 and 16:00, each overlapping the slot just refused | [008](../../specs/features/008-no-overlap-with-refused-slots/spec.md) re-proposals never overlap a refused slot |
| 2026-11-03 | End-to-end round 1: 93 scripted scenarios with the real model (the 36 originals plus edge cases on language, calendar and protocol designed by three parallel agents), and an independent review of the outputs against "What we evaluate" | [009](../../specs/features/009-honour-stated-constraints/spec.md) stated constraints and true notes; [010](../../specs/features/010-blackout-priority/spec.md) blackout priority; [011](../../specs/features/011-named-time-counts-as-acceptance/spec.md) a named time is the namer's yes; [012](../../specs/features/012-escalate-to-a-person/spec.md) escalate to a person; [013](../../specs/features/013-polish-from-e2e-review/spec.md) readable reasons, lenient CSV, answer language |
| 2026-11-03 | End-to-end round 2 on the final code: four orders no longer scheduled because prompt version 5 dropped the day and time from acceptances | 013, prompt version 6, golden cases g61–g64 |
| 2026-11-03 | The harness moved into the repository (`pnpm e2e`); its first full run found a point exclusion read as "from" and a bare "Voy" read as unclear | [014](../../specs/features/014-e2e-harness/spec.md), fix of 009; 93 of 93 scenarios pass |

Lesson kept for phase 2: the fake interpreter proves the policy, but only runs with the real model show how a prompt change moves readings, so every prompt change is checked on the golden set over at least two runs and against the end-to-end scenarios that motivated it.
