# 009 · Stated constraints are honoured, and notes are true

**Status:** planned
**Product requirements:** REQ-NG-12 (new), REQ-NG-13 (new), REQ-NG-2, REQ-NG-3, REQ-NG-4, REQ-NG-8, REQ-NG-11
**Invariants touched:** SCHED-1, SCHED-2, SCHED-5, LLM-1 (unchanged; every new slot must still satisfy them)
**Amends:** 003 AC-2.3 (an exclusion that rules out the proposal is not an acceptance), 004 AC-1.1 and AC-1.6 (exclusions and the nearest slot on the stated day), 008 AC-1.2 (the fallback also avoids stated exclusions)

## Why

The end-to-end runs of 2026-11-03 (93 scenarios, real model) found the agent ignoring what people said they could not do. "Wednesday is impossible for me, any other weekday is fine" was answered with "The times you suggested are not available" and a new proposal on Wednesday; "Entre semana imposible, el finde cuando queráis" got Wednesday too; "No puedo ese día" was followed by another slot the same day. The model extracted the exclusions correctly every time; the code dropped them: a decline is re-proposed without its exclusions, and a counter with exclusions but no times finds no window, falls to "no fit" and sends a note claiming the requested times are unavailable when none were requested. Three smaller readings made the same runs worse: "Yes, but not before 1pm" was asked to confirm the 12:00 slot it rules out; "Yes that works… actually no… Thursday at 11 instead?" was read as contradictory although the model extracted Thursday 11:00; "Only possible tonight at 21:30" was answered with 14:00 the same day instead of the nearest slot that fits that evening. The take-home evaluates outcomes, clear and truthful communication, and sensible handling of availability changes; these are all three.

## User stories

### US1 · What a party rules out stays ruled out (P1)

As a tenant or the handyman, I want a day or a time I said I cannot do never to be proposed again for this job, so that I do not have to repeat myself or burn my refusals.

**Independent test:** one order; the tenant declines with "Wednesday is impossible, any other weekday is fine"; the next proposal is not on Wednesday and carries no "not available" note.

**Acceptance criteria (EARS):**

- **AC-1.1** WHEN a decline, a counter, a withdrawal or a mismatched acceptance states exclusions, THE system SHALL record them as constraints of that order, by either party, for the rest of the order's life.
- **AC-1.2** THE system SHALL read a recorded exclusion as concrete Madrid windows: a date alone is that whole day; a weekday alone is its next occurrence from the reference time (as 005 AC-3.7); a date or weekday with times is that range on that day; times without a date or weekday (for example "not before 13:00", "only afternoons") apply to every day for 14 days from the reference time.
- **AC-1.3** WHEN the system chooses a slot on its own for an order (008 AC-1.2), THE slot SHALL overlap none of that order's constraint windows, in addition to the refused slots of 008.
- **AC-1.4** WHEN a party states availability, THE system SHALL choose inside it as in 004 AC-1.2, narrowed by that reply's own exclusions; earlier constraints of the order do not narrow a window the party states now (an explicit statement wins, as 008 AC-1.3).

### US2 · Notes are only sent when they are true (P1)

As a tenant, I want to be told "the times you suggested are not available" only when I suggested times, so that the agent never claims something I did not say.

**Acceptance criteria (EARS):**

- **AC-2.1** THE system SHALL add the "requested times are not available" note to a re-proposal only WHEN the reply stated at least one time or date window and none of it could be used.
- **AC-2.2** WHEN a counter states no times (only exclusions, or nothing usable), THE system SHALL re-propose as for a decline with those exclusions (AC-1.3), without the note; it still counts as a counter by that party (004 AC-3.1).

### US3 · The nearest slot on the stated day when the exact time does not fit (P2)

As a tenant who can only do one evening, I want the closest slot that evening rather than an unrelated one earlier, so that the proposal is close to what I asked.

**Acceptance criteria (EARS):**

- **AC-3.1** IF a reply states times on a specific date AND no free slot fits them AND no takeover applies (005 AC-2.1), THEN THE system SHALL propose the free slot on that date, between 07:00 and 22:00, that is closest to the stated window (ties: the earlier), respecting holds, blackouts, refused slots, constraints and the earliest start; the note of AC-2.1 is sent, since the exact times were not available.
- **AC-3.2** IF no slot on that date is free, THEN THE system SHALL fall back to AC-1.3.

### US4 · Readings that keep the party's last word (P1)

As a tenant, I want "yes, but not before 1pm" and "actually no, Thursday at 11" to be taken for what I mean, so that I am not asked to confirm a time I just ruled out.

**Acceptance criteria (EARS):**

- **AC-4.1** IF an `accept` states an exclusion that overlaps the current proposal, THEN THE system SHALL treat it as a mismatched acceptance, that is a counter with that reply's times and exclusions (004 AC-1.7); 003 AC-2.3 (confirmation) still applies when no exclusion overlaps the proposal.
- **AC-4.2** IF an interpretation is `contradictory` AND states at least one time, THEN THE system SHALL treat it as a counter with those times and exclusions (the later statement in the message wins), not as an unclear reply.
- **AC-4.3** THE interpretation prompt SHALL tell the model that availability that includes the proposed slot ("whenever suits you", "any time this week") is `accept`, and that a correction later in the same message wins over an earlier statement; the prompt version rises.
- **AC-4.4** THE regex fast path SHALL read a bare "tampoco" / "tampoco puedo" as `decline`.

## Edge cases

- An exclusion that covers every remaining hour of the search horizon is impossible in practice (constraints last 14 days for undated times); the existing search limit of 002 still bounds the search.
- Exclusions of the tenant and the handyman add up: a slot must avoid both.
- A preemption or blackout re-proposal also avoids the order's constraints (it uses the same fallback).
- A constraint never blocks another order.
- A party later names a time inside an excluded day ("actually Wednesday at 16 is fine"): honoured (AC-1.4).
- DST: constraint windows are built in Madrid time per day, so 25 October 2026 has the right offsets.
- "Yes, but not Thursday" to a Wednesday proposal: the exclusion does not overlap the proposal, so confirmation (003 AC-2.3) is asked as before, and Thursday is recorded as a constraint only if the reply is later refused.

## Scenarios

| Scenario | Covers | stdin (summary) | Expected |
|---|---|---|---|
| `009-decline-excluded-day` | AC-1.1, AC-1.3, AC-2.2 | Decline with exclusion Wednesday | v2 Thursday 09:00, no note |
| `009-weekend-only` | AC-1.2, AC-1.3, AC-2.2 | Counter, no times, exclusions Monday–Friday | v2 Saturday, no note |
| `009-afternoons-only` | AC-1.2, AC-1.3 | Decline with exclusion 07:00–14:00 (no date) | v2 Wed 14:00; after a decline of it, never before 14:00 on later days |
| `009-constraints-add-up` | AC-1.1, AC-1.3 | Tenant excludes Wednesday, handyman excludes Thursday | next slot Friday |
| `009-explicit-inside-constraint` | AC-1.4 | Tenant excludes Wednesday, then names Wednesday 16:00 | v3 Wed 16:00 |
| `009-nearest-same-day` | AC-3.1, AC-2.1 | "Tonight at 21:30" | v2 Wed 20:00–22:00 with the note |
| `009-nearest-none-free` | AC-3.2 | Stated date fully held | fallback, with the note |
| `009-accept-excludes-proposal` | AC-4.1 | "Yes, but not before 13:00" to 12:00 | counter: v2 Wed 14:00 (12:00–14:00 is refused and 07:00–13:00 excluded), no confirmation question |
| `009-accept-constraint-elsewhere` | AC-4.1 | "Yes, but not Thursday" to Wednesday | confirmation asked (003 AC-2.3 unchanged) |
| `009-contradictory-with-time` | AC-4.2 | contradictory with Thursday 11:00 | v2 Thu 11:00, no clarification |
| `009-tampoco` | AC-4.4 | "Tampoco" after a re-proposal | decline via regex |

Golden-set cases (eval only, real model): "Whenever suits you, I'm home all week" → `accept`; "Yes that works… actually no, something came up. Could we do Thursday at 11 instead?" → `counter` with Thursday 11:00; "Wednesday is impossible for me, any other weekday is fine" → `decline` or `counter` with the Wednesday exclusion.

## Success criteria

- The e2e scenarios `cal-decline-excluded-day`, `lang-el-finde`, `lang-por-las-tardes`, `lang-whenever`, `lang-change-mind`, `accept-with-constraint` and `counter-too-late` from 2026-11-03 produce a slot that respects what the party said, and no false note.
- `pnpm check` green; the golden-set accuracy on the existing 50 cases does not drop.

## Assumptions

- Undated time-of-day exclusions are a daily constraint for 14 days from the reference time; beyond that they lapse. Recurring constraints with no horizon stay out of scope (README limitation).
- A counter with only exclusions counts as a refusal of the current proposal, like any counter.

## Decisions

- **Exclusions are order constraints** (decided 2026-11-03 after the e2e runs). The model already extracts them; dropping them made the agent repeat what people had ruled out and claim false things.
- **Nearest slot on the stated day** (decided 2026-11-03 with the user). When the exact times do not fit, the closest slot that day is a better offer than the next free slot elsewhere.
- **An exclusion that rules out the proposal is not an acceptance** (decided 2026-11-03 with the user): it is a counter, so the party is not asked to confirm a time they excluded.

## Open questions

None.
