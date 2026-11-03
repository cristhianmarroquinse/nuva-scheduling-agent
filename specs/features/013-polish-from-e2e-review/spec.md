# 013 · Polish from the e2e review

**Status:** planned
**Product requirements:** REQ-RES-2, REQ-TO-4, REQ-IN-2, REQ-IN-3, REQ-NG-7, REQ-OUT-2
**Invariants touched:** ORD-1, COM-1, COM-2, LLM-2 (unchanged)
**Amends:** 001 AC-1.4 (an id with inner spaces is usable), 001 urgency parsing (case-insensitive), 005 review sentences (readable slot)

## Why

The independent review of the e2e runs of 2026-11-03 listed smaller problems an evaluator would notice: the REASON at end of input ("No reply was received before the end of input.") does not say who was awaited or what was agreed, although the README says reasons name the party; review sentences print raw ISO timestamps; a CSV row with `critical` in lower case closed a gas leak as `invalid_work_order`; a row with an id containing a space produced no result at all, while the take-home requires one per order; the model's answers addressed the handyman as "usted" next to templates that use "tú", and repeated the slot that the template reminder repeats right after.

## Acceptance criteria (EARS)

- **AC-1** WHEN stdin ends with an order open, THE REASON SHALL name who was awaited and what was agreed: "Input ended while waiting for the {party}; the {other} had accepted the proposed visit ({slot})." or "Input ended with no agreement; neither party had accepted the proposed visit ({slot})."
- **AC-2** EVERY review sentence that mentions the proposed visit SHALL state it as weekday, date and time range in Madrid time (as the English templates do), not as an ISO timestamp. `SCHEDULED_FOR` keeps ISO 8601 (REQ-RES-1).
- **AC-3** THE urgency SHALL be read ignoring case and surrounding spaces (`critical`, ` HIGH `); other values remain invalid.
- **AC-4** A `work_order_id` with inner spaces SHALL be usable; leading and trailing spaces are trimmed; an id containing `|` or a control character, or an empty one, stays unusable (it cannot be addressed on the protocol).
- **AC-5** THE answer prompt SHALL ask for "tú" to the handyman and "usted" to a Spanish-speaking tenant, and SHALL tell the model not to restate the proposed date or time, because the message adds a reminder of the slot; `ANSWER_PROMPT_VERSION` rises.

## Scenarios

| Scenario | Covers | Expected |
|---|---|---|
| `013-eof-reasons` | AC-1, AC-2 | three orders at EOF: none accepted, tenant accepted, handyman accepted; three distinct sentences |
| `013-urgency-case` | AC-3 | `critical` and ` High ` rows are scheduled-capable orders |
| `013-id-with-space` | AC-4 | `WO 7` gets proposals, a reply addressed as `WO 7|tenant …` is read, one result |

Every existing scenario whose expected REASON is the end-of-input or timeout sentence changes; the commit verifies that nothing else changed.

## Decisions

- **Reasons name the party and the state, in readable time** (2026-11-03, review). ISO stays for `SCHEDULED_FOR`, which a machine reads.
- **Lenient urgency, ids with spaces** (2026-11-03, review): both were a whole order lost for a cosmetic difference in the CSV.

## Open questions

None.
