# 013 · Plan

- `src/core/reasons.ts`: `endOfInputSentence({ awaited, slot, accepted })`; `noResponseSentence` and `criticalNoResponseSentence` use `slotText(slot, 'en')`.
- `src/core/state.ts`: EOF uses `endOfInputSentence` from the order's proposal and acceptances.
- `src/orders/validate.ts`: urgency normalised (`trim`, first letter upper, rest lower) before the closed-set check; `usableId` allows inner spaces.
- `src/interpreter/answer.ts`: two prompt sentences; `ANSWER_PROMPT_VERSION` → 2.
- Tests: unit (reasons, validate, answer prompt), scenarios `013-*`, regenerated REASON lines in existing scenarios (verified line by line), the committed example (its REASON line changes; replay regenerates stdout).
- Constitution check: all nine ✅.
