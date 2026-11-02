# CLAUDE.md

Scheduling agent for property maintenance: coordinates handyman visits between tenants and one handyman over stdin/stdout until each work order is `scheduled` or `requires_review`.

## Sources of truth (read before changing behaviour)

| What | Where |
|---|---|
| What the system must do | `specs/000-product.md` (REQ-* IDs) |
| What must never break | `specs/INVARIANTS.md` (ORD-*, ACC-*, SCHED-*, COM-*, OUT-*, TIME-*, LLM-*, TRACE-*, RUN-*) |
| Why it is built this way | `docs/adr/` |
| Per-feature work | `specs/features/NNN-*/` (spec, plan, tasks) |

If a change contradicts a spec, an invariant or an ADR, stop and say so. Do not silently work around it.

## Commands

```bash
pnpm check        # typecheck + tests + invariant coverage; must be green before any task is done
pnpm test         # vitest
pnpm typecheck    # tsc --noEmit
pnpm invariants   # every invariant cited by a test or pending in specs/coverage-baseline.json
```

## Non-negotiables

1. Code decides; the model only interprets. Model output enters the system as a validated interpretation event and nothing else (LLM-1).
2. stdout carries only protocol frames and results; nothing goes to stderr. Use the tracer, never `console.*`, in `src/`; only `src/io/streams.ts` touches process streams (OUT-1).
3. All time is Europe/Madrid via the time module. Never write offsets by hand (TIME-1).
4. State is derived from events. Facts are events; holds, messages, decisions and results are projections (ADR 0002).
5. A change to core behaviour starts with a failing test that cites the invariant or requirement ID.
6. `specs/coverage-baseline.json` only shrinks.

## Workflow

`/spec` → `/plan` → `/implement` → `/ship`. Rules in `.claude/rules/` apply to all work.

Hooks in `.claude/settings.json` catch mistakes on the normal edit path (credentials, process streams in `src/`, type errors) and refuse to finish while `pnpm check` is red. They are a safety net, not the boundary: `pnpm check` is the gate, and nothing should be done through Bash to get around a hook.

## Stack

Node 22, TypeScript (strict, NodeNext; relative imports end in `.js`), pnpm, Vitest, tsx.

## Language

Everything committed to this repository is in English: code, comments, tests, specs, plans, ADRs, commit messages and docs. Only the product's messages to tenants and the handyman are in Spanish or English as the specs require.
