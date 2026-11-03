# 012 · Escalate to a person

**Status:** implemented
**Product requirements:** REQ-NG-14 (new), REQ-RES-2, REQ-NG-7
**Invariants touched:** ORD-1, ORD-2, LLM-1, LLM-2 (unchanged)

## Why

The take-home evaluates "appropriate use of requires_review". In the e2e runs of 2026-11-03 a tenant who wrote "Quiero hablar con una persona, no con un robot" was answered "the office will check" and the order stayed open until end of input: the agent promised a human and never handed over. An abusive tenant was simply re-proposed another slot. Both are cases a careful coordinator hands to a person.

## User stories

### US1 · Asking for a person, or being upset, hands the order to a human (P1)

As a tenant or the handyman, I want my request to talk to a person to be passed on, so that someone actually contacts me.

**Acceptance criteria (EARS):**

- **AC-1.1** THE interpretation SHALL have an intent `escalate`: the sender asks to speak with a person or the office, complains strongly about the service, or is abusive.
- **AC-1.2** WHEN a reply is interpreted as `escalate`, THE system SHALL tell the sender, in their language, that their message is passed to the office and someone will contact them, and SHALL close the order as `requires_review` with reason code `escalated` and a sentence naming the party.
- **AC-1.3** THE other party SHALL NOT receive the sender's words (LLM-2); the order's tentative hold is released as for any review.
- **AC-1.4** A question the facts do not cover SHALL keep being answered with "the office will check" (REQ-NG-7); only an explicit request for a person, a strong complaint or abuse escalates.

## Scenarios

| Scenario | Covers | stdin (summary) | Expected |
|---|---|---|---|
| `012-tenant-asks-for-person` | AC-1.1, AC-1.2, AC-1.3 | handyman accepted; tenant `escalate` | tenant told the office will contact them; `requires_review` `escalated`; handyman gets no tenant text |
| `012-handyman-escalates` | AC-1.2 | handyman `escalate` | Spanish message to the handyman; review |
| `012-question-not-escalated` | AC-1.4 | "Is there parking?" | answered, order stays open |

Golden-set cases: "Quiero hablar con una persona, no con un robot", "This is ridiculous, I want to speak to your manager", an abusive reply → `escalate`.

## Success criteria

- The e2e scenarios `proto-human-request` and `proto-abusive` of 2026-11-03 end as `requires_review` with code `escalated`.
- `pnpm check` green; golden-set accuracy on the earlier cases does not drop.

## Decisions

- **Asking for a person, a strong complaint or abuse closes in review** (decided 2026-11-03 with the user). One intent and one reason code cover the three: the human who picks it up reads the trace.

## Open questions

None.
