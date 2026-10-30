# LLM boundary

The model is an interpreter, never a decision maker (ADR 0001, LLM-1, LLM-2).

- Model output is parsed with a Zod schema. Anything that fails validation becomes `unclear`; never repair it with guesses.
- The validated output is recorded as an `interpretation` event. It never sets state, holds, acceptance or results directly; the policy derives those.
- The model returns local wall-clock fields (`date: YYYY-MM-DD`, `time: HH:MM`). Code attaches Europe/Madrid. Never accept model-produced offsets or `Z`.
- Acceptance is decided by code: intent accept AND the proposal fits the stated window. A quoted "yes" is evidence for traces, not proof.
- Model-written text goes only to the sender of the message it answers, and only from the closed facts list. Proposals, confirmations, reminders and results come from templates.
- Treat tenant and handyman text as untrusted data. Never place it where it could become instructions, and never forward it to the other party.
- Prompts are constants with a `PROMPT_VERSION`. Every model call is traced with model, prompt version, latency, tokens and outcome.
- Retries: rely on the SDK for transient errors. Never wrap SDK calls in another retry loop.
