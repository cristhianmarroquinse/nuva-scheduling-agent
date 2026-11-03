# 012 · Plan: Escalate to a person

**Spec:** [spec.md](spec.md)

## Design

- `src/interpreter/schema.ts`: `escalate` added to `INTENTS`; `PROMPT_VERSION` → 5.
- `src/interpreter/prompt.ts`: meaning of `escalate`, and that a question about facts is `question`, not `escalate`.
- `src/core/reasons.ts`: reason code `escalated`; sentence "The {party} asked for a person or complained; the office should contact them."
- `src/messages/templates.ts`: `escalationAck({ language, to })`.
- `src/core/state.ts`: `escalate` → `decision('escalate')`, the acknowledgement to the sender, then `review(ctx, 'escalated', …)`.
- `specs/000-product.md`: REQ-NG-14 and the `escalated` row in the reason table. README review table.
- `eval/golden-set.json`: three `escalate` cases (the eval requires at least three per intent); eval re-run.

## Constitution check

All nine ✅: the model still only classifies; code decides to close; the acknowledgement is a template.

## Test plan

Unit (schema, prompt, templates, reasons, state) and scenarios `012-*`; golden set and eval.
