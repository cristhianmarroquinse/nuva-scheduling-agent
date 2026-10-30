---
name: spec
description: Write or clarify a feature specification with EARS acceptance criteria and a scenario list. Use when starting any new feature or behaviour change, before planning or coding.
argument-hint: Feature description, or the path of an existing spec to clarify
---

# Spec

Produce `specs/features/NNN-<slug>/spec.md` from `specs/_templates/spec.md`. A spec states *what* and *why*, never *how*.

## Steps

1. **Ground.** Read `specs/000-product.md`, `specs/INVARIANTS.md` and the ADR index. List the `REQ-*` and invariant IDs this feature touches. If the feature contradicts any of them, stop and report the conflict.
2. **Number.** Use the next free `NNN` in `specs/features/`.
3. **Draft.**
   - User stories with priority (P1 first). Each story must be testable on its own.
   - Acceptance criteria in EARS form (`WHEN … THE system SHALL …`, `IF … THEN …`, `WHILE …`). One behaviour per criterion.
   - Edge cases: ambiguous, contradictory, changing and missing replies; other orders running at the same time; DST; the 2-hour visit window.
   - A scenario table that maps every criterion to at least one scenario.
   - Measurable success criteria, assumptions, and `[NEEDS CLARIFICATION]` markers for anything unknown.
4. **Clarify.** If there are markers, ask the user at most five targeted questions, one at a time, each with a recommended answer and its trade-off. Write each answer back into the spec and remove its marker.
5. **Check.**
   - No implementation detail (modules, libraries, data structures) in the spec.
   - Every criterion is observable on the protocol or in traces.
   - No conflict with `000-product.md`, invariants or ADRs.
   - Then set `Status: clarified`.

## Output

The path of the spec, the IDs it touches, and any remaining open questions.
