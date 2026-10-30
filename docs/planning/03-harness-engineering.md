# 03 · Harness engineering

## Why

The product is an AI system, and I also build it with AI. To make that reliable rather than fast-and-loose, I set up a **harness**: the rules, skills, review agents, hooks and checks around the coding agent. I use it with a **spec-driven** method, where specs and invariants are the source of truth and the agent implements against them.

The point is not speed. It is that agent-written code must respect explicit invariants, and that automated checks catch it when it does not.

## What I based it on

| Source | What I kept | What I left out |
|---|---|---|
| My previous workspaces | Scoped review agents, test-first bug fixing, ship-with-approval, rules against common agent failure modes, a guard hook | Team and infrastructure workflows; all text rewritten for this project |
| GitHub Spec Kit | The spec / plan / tasks structure. In particular the plan's **Constitution Check** (the plan must respect the invariants) and the ideas behind `clarify` and `converge` (compare code to spec, list what is missing) | The CLI and its folder layout: too much for a small repo |
| Anthropic's public skills repository | The skill format, and the habit of testing skills with prompts before trusting them | Unrelated skills |
| Anthropic's official Claude Code plugins | `ralph-loop`'s Stop-hook mechanism for the bounded repair loop; a silent-failure reviewer | Installing plugins wholesale |

## Catalogue

**Base documents:** `CLAUDE.md` (map, commands, non-negotiables), `specs/000-product.md`, `specs/INVARIANTS.md` (one falsifiable sentence per ID; tests cite IDs), `specs/features/NNN-*/` (spec, plan, tasks), `docs/adr/`.

**Rules** (`.claude/rules/`):
- `invariants-first`: no core change without a test citing the ID.
- `llm-boundary`: model output never mutates state directly; the LLM writes only to the sender.
- `protocol-purity`: only the protocol writer touches stdout.
- `time-handling`: Europe/Madrid and local date-time fields.
- `testing-strategy`
- `debugging-before-guessing`
- `behavioral-risks`

**Skills** (`.claude/skills/`):

| Skill | Phase |
|---|---|
| `/spec` (with a clarify pass), `/plan` (Constitution Check), `/implement` (failing test first), `/ship` | 0 |
| `/converge`, `/fix` (verdict: verified / partial / failed), `/scenario`, `/trace-debug`, `/eval`, `/review` | 1 |
| `/heal` (bounded repair loop) | 2 |

**Review agents:**
- `review-invariants`
- `review-llm-boundary`
- `review-protocol`
- `silent-failure-hunter`
- `review-architecture`
- `adversarial-evaluator`, which plays a difficult tenant or handyman (phase 2)

**Hooks** (a safety net on the agent's normal edit path; the real gate is `pnpm check`, which includes a source-hygiene test, because a hook on Edit/Write cannot see changes made through Bash):
- Block edits to `.env`, and block `console.` in `src/`.
- Typecheck after every edit.
- At stop, run `pnpm check`. A red result means the task is not done.
- In phase 2, during `/heal` only: protect `specs/` and the golden tests, and loop until green with capped iterations.

**Checks:**
- `pnpm check`: typecheck, unit tests, scenarios, invariant coverage.
- `scripts/replay.ts`: rebuild state from a trace.
- `eval/interpret-bakeoff.ts`
- `scripts/simulate.ts` (phase 2)

## How I use it

```
/spec → /plan → /implement → /review → /converge → /ship
```

**Bugs:** `/trace-debug` → `/scenario` to reproduce → `/fix`.

**Repair loop (phase 2):** the simulator runs the container and checks invariants in the traces. On a failure, a headless Claude Code run executes `/fix`: it adds a reproducing scenario, fixes, and must get `pnpm check` green. The result goes to a branch that I review; nothing merges automatically, and the loop cannot edit specs or golden tests.

## Reporting

The README will report specs written, scenarios, invariant coverage, defects found by the simulator, and defects fixed by the loop versus by me.
