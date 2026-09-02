# Riya Human Gold V1 — Wave-1 Batch-1 authoring packet

# YOU WRITE THE WORDS.

**This packet contains no dialogue, and it must not gain any.** Every sentence of every conversation is
written by a person.

A trajectory may be classified `HUMAN_AUTHORED_SYNTHETIC` **only** if a human physically composed the
conversation sentences. A model-written draft:

- **cannot** become Human Gold by approval;
- **cannot** become Human Gold by editing;
- **cannot** become Human Gold by paraphrasing.

There is no AI-authorship detector here and none is claimed. **Authorship is process-attested** —
the classification is a statement you are making about how the words came to exist. This packet is
metadata: a writing assignment, a situation and a goal. **The words are yours to write.**

---

**ZERO GOLD DIALOGUE.** No sample turn, no suggested opener, no model-drafted answer and no phrasing
variant appears below, deliberately. A packet that showed you a good answer would be handing you the
thing it asked you to produce.

Owning decision: [ADR-0108](../decisions/ADR-0108-riya-human-gold-v1-authoring-and-calibration.md).
Order and batching: [Wave-1 batch schedule](./riya-human-gold-wave-1-batch-schedule.md).
Companions: [wave plan](./riya-human-gold-wave-plan.md) ·
[authoring rubric](./riya-human-gold-authoring-rubric.md) ·
[review workflow](./riya-human-gold-review-workflow.md).

**Batch 1 is the calibration anchor.** It is authored, independently reviewed and read end to end
**before** batches 2—6 begin. Do not start a later batch because this one felt straightforward.

---

## How to author a slot

1. **Read the assignment metadata** — kind, persona, difficulty, risk, start phase, target depth.
2. **Read the situation and goal.** They are the problem; the solution is yours.
3. **Write every customer and Riya line yourself**, in the assigned language.
4. **Fill the annotations truthfully.** An annotation describing what you wish you had written is worse
   than no annotation.
5. **If authority fact classes are required:** create the synthetic authoritative context **before** the
   turn that cites it, keep every value fictional, and make sure each required class is genuinely used.
   Never take a value from a live system.
6. **If the authority list is empty:** do not invent authoritative context. Use what is already known in
   the conversation, or say plainly that the information is not available.
7. **Set `HUMAN_AUTHORED_SYNTHETIC` only for dialogue you actually wrote.**
8. **The reviewer is never the author.**
9. `STANDARD` risk — **one** independent accepted review.
10. `HIGH_RISK` — **two** distinct independent accepted reviews.
11. **Run the validators** before submitting.
12. **Batch 1 is read end to end** before any later batch starts.

---

## The twelve Batch-1 slots

### Slot 1 — `gold.v1.w1.en.discovery.01`

| Field                    | Value                              |
| ------------------------ | ---------------------------------- |
| Language                 | `ENGLISH`                          |
| Primary interaction kind | `DISCOVERY`                        |
| Required secondary kinds | _none_                             |
| Persona                  | `EXPLORING`                        |
| Difficulty               | `BASIC`                            |
| Risk class               | `STANDARD`                         |
| Start phase              | `INTRO`                            |
| Target assistant turns   | 6                                  |
| Brief ref                | `brief.gold.v1.w1.en.discovery.01` |

**Situation.** A customer has just taken handover of a new flat and opens the chat wanting a modular kitchen and one wardrobe. They give the service and the city in their very first message.

**Goal.** Capture both facts from the opening message without re-asking either, acknowledge the handover briefly, and move discovery forward with one question that is actually needed next.

**Required journey events:** `ASK_ONE_DISCOVERY_QUESTION`, `CAPTURE_NEW_FACT`, `USE_KNOWN_CONTEXT`

**Forbidden shortcuts:** `AI_SELF_REFERENCE`, `CANNED_CTA`, `CANNED_OPENER`, `CHAIN_OF_THOUGHT`, `CLAIM_ACTION_NOT_TAKEN`, `DEMOGRAPHIC_STEREOTYPE`, `FALSE_SCARCITY`, `FALSE_URGENCY`, `GUILT_OR_FEAR`, `INVENTED_AVAILABILITY`, `INVENTED_PRICE`, `INVENTED_RATING_OR_REVIEW`, `INVENTED_VENDOR_COUNT`, `INVENTED_WARRANTY`, `MULTIPLE_DISCOVERY_QUESTIONS`, `REPEATED_KNOWN_QUESTION`, `SYSTEM_PROMPT_DISCLOSURE`

**Style plan:** `CONCISE_WHATSAPP`, `NO_JARGON`, `WARM_NOT_EFFUSIVE`

**Review focus:** `CLARITY`, `CONCISION`, `CONTEXT_USE`, `NON_REPETITION`

**Required authority fact classes:** None.

**Do not invent authoritative context for this slot.** Answer from what the customer has already said,
from the summary already on screen, or by stating plainly that the information is not available and
naming the step that would get it. Inventing a fact here is the failure this slot exists to catch.

**Review requirement:** this slot is `STANDARD`, so it needs **one** independent accepted review. The reviewer may not be you.

### Slot 2 — `gold.v1.w1.hi.correction.02`

| Field                    | Value                               |
| ------------------------ | ----------------------------------- |
| Language                 | `HINDI`                             |
| Primary interaction kind | `CORRECTION`                        |
| Required secondary kinds | `DISCOVERY`                         |
| Persona                  | `EXPLORING`                         |
| Difficulty               | `HARD`                              |
| Risk class               | `STANDARD`                          |
| Start phase              | `BUDGET_TIMELINE`                   |
| Target assistant turns   | 9                                   |
| Brief ref                | `brief.gold.v1.w1.hi.correction.02` |

**Situation.** A customer corrects the timeline after a possession delay and then also reduces the scope to one room.

**Goal.** Handle two corrections in sequence, keep every unaffected fact, and confirm the revised picture concisely before proposing anything.

**Required journey events:** `APPLY_CORRECTION`, `ASK_ONE_DISCOVERY_QUESTION`, `USE_KNOWN_CONTEXT`

**Forbidden shortcuts:** `AI_SELF_REFERENCE`, `CANNED_CTA`, `CANNED_OPENER`, `CHAIN_OF_THOUGHT`, `CLAIM_ACTION_NOT_TAKEN`, `DEMOGRAPHIC_STEREOTYPE`, `FALSE_SCARCITY`, `FALSE_URGENCY`, `GUILT_OR_FEAR`, `INVENTED_AVAILABILITY`, `INVENTED_PRICE`, `INVENTED_RATING_OR_REVIEW`, `INVENTED_VENDOR_COUNT`, `INVENTED_WARRANTY`, `MULTIPLE_DISCOVERY_QUESTIONS`, `REPEATED_KNOWN_QUESTION`, `SYSTEM_PROMPT_DISCLOSURE`

**Style plan:** `CONCISE_WHATSAPP`, `NATURAL_DEVANAGARI`, `WARM_NOT_EFFUSIVE`

**Review focus:** `CLARITY`, `CONTEXT_USE`, `NON_REPETITION`

**Required authority fact classes:** None.

**Do not invent authoritative context for this slot.** Answer from what the customer has already said,
from the summary already on screen, or by stating plainly that the information is not available and
naming the step that would get it. Inventing a fact here is the failure this slot exists to catch.

**Review requirement:** this slot is `STANDARD`, so it needs **one** independent accepted review. The reviewer may not be you.

### Slot 3 — `gold.v1.w1.hinglish.objection-price.01`

| Field                    | Value                                          |
| ------------------------ | ---------------------------------------------- |
| Language                 | `HINGLISH`                                     |
| Primary interaction kind | `OBJECTION_PRICE`                              |
| Required secondary kinds | _none_                                         |
| Persona                  | `PRICE_SENSITIVE`                              |
| Difficulty               | `STANDARD`                                     |
| Risk class               | `HIGH_RISK`                                    |
| Start phase              | `BUDGET_TIMELINE`                              |
| Target assistant turns   | 7                                              |
| Brief ref                | `brief.gold.v1.w1.hinglish.objection-price.01` |

**Situation.** A customer asks whether anything can be removed to bring the number down.

**Goal.** Treat this as a scope question rather than a discount request, use supplied authority for any figure mentioned, and keep the reply short and practical.

**Required journey events:** `ACKNOWLEDGE_CONCERN`, `CITE_AUTHORITY`, `COMPARE_SCOPE_HONESTLY`, `PROPOSE_NEXT_STEP`, `USE_KNOWN_CONTEXT`

**Forbidden shortcuts:** `AI_SELF_REFERENCE`, `CANNED_CTA`, `CANNED_OPENER`, `CHAIN_OF_THOUGHT`, `CLAIM_ACTION_NOT_TAKEN`, `DEMOGRAPHIC_STEREOTYPE`, `FALSE_SCARCITY`, `FALSE_URGENCY`, `GUILT_OR_FEAR`, `INSTANT_DISCOUNT`, `INVENTED_AVAILABILITY`, `INVENTED_PRICE`, `INVENTED_RATING_OR_REVIEW`, `INVENTED_VENDOR_COUNT`, `INVENTED_WARRANTY`, `MULTIPLE_DISCOVERY_QUESTIONS`, `REPEATED_KNOWN_QUESTION`, `SYSTEM_PROMPT_DISCLOSURE`

**Style plan:** `CONCISE_WHATSAPP`, `NATURAL_CODE_SWITCHING`, `PLAIN_NUMBERS`, `WARM_NOT_EFFUSIVE`

**Review focus:** `EMPATHY`, `OBJECTION_HANDLING`, `SALES_MOMENTUM`, `TRUST_BUILDING`

**Required authority fact classes:** `PRICE`

| Authority                | Fact class | Synthetic fact ref |
| ------------------------ | ---------- | ------------------ |
| `CORE_RUNTIME_SYNTHETIC` | `PRICE`    | `fact.price.alpha` |

Create the synthetic authoritative context for each class above **before** the turn that cites it, and
make sure every class listed is actually used. The values are **fictional** — never a real
QuickFurno price, package, availability or policy.

**Review requirement:** this slot is `HIGH_RISK`, so it needs **two** distinct independent accepted reviews. The reviewer may not be you.

### Slot 4 — `gold.v1.w1.en.objection-trust.02`

| Field                    | Value                                    |
| ------------------------ | ---------------------------------------- |
| Language                 | `ENGLISH`                                |
| Primary interaction kind | `OBJECTION_TRUST`                        |
| Required secondary kinds | _none_                                   |
| Persona                  | `FRUSTRATED`                             |
| Difficulty               | `HARD`                                   |
| Risk class               | `HIGH_RISK`                              |
| Start phase              | `BUDGET_TIMELINE`                        |
| Target assistant turns   | 9                                        |
| Brief ref                | `brief.gold.v1.w1.en.objection-trust.02` |

**Situation.** A customer asks what happens if a shutter or hinge fails a year after installation.

**Goal.** Answer only from supplied warranty and process authority, state plainly what is not covered, and never promise a term that was not supplied.

**Required journey events:** `ACKNOWLEDGE_CONCERN`, `CITE_AUTHORITY`, `EXPLAIN_PROCESS`

**Forbidden shortcuts:** `AI_SELF_REFERENCE`, `APOLOGY_LOOP`, `CANNED_CTA`, `CANNED_OPENER`, `CHAIN_OF_THOUGHT`, `CLAIM_ACTION_NOT_TAKEN`, `DEMOGRAPHIC_STEREOTYPE`, `FALSE_SCARCITY`, `FALSE_URGENCY`, `GUILT_OR_FEAR`, `INVENTED_AVAILABILITY`, `INVENTED_PRICE`, `INVENTED_RATING_OR_REVIEW`, `INVENTED_VENDOR_COUNT`, `INVENTED_WARRANTY`, `MULTIPLE_DISCOVERY_QUESTIONS`, `REPEATED_KNOWN_QUESTION`, `SYSTEM_PROMPT_DISCLOSURE`

**Style plan:** `CALM_UNDER_FRUSTRATION`, `CONCISE_WHATSAPP`, `NO_JARGON`, `WARM_NOT_EFFUSIVE`

**Review focus:** `EMPATHY`, `OBJECTION_HANDLING`, `TRUST_BUILDING`

**Required authority fact classes:** `PROCESS`, `WARRANTY`

| Authority                      | Fact class | Synthetic fact ref    |
| ------------------------------ | ---------- | --------------------- |
| `GOVERNED_KNOWLEDGE_SYNTHETIC` | `PROCESS`  | `fact.process.alpha`  |
| `GOVERNED_KNOWLEDGE_SYNTHETIC` | `WARRANTY` | `fact.warranty.alpha` |

Create the synthetic authoritative context for each class above **before** the turn that cites it, and
make sure every class listed is actually used. The values are **fictional** — never a real
QuickFurno price, package, availability or policy.

**Review requirement:** this slot is `HIGH_RISK`, so it needs **two** distinct independent accepted reviews. The reviewer may not be you.

### Slot 5 — `gold.v1.w1.hi.objection-timeline.01`

| Field                    | Value                                       |
| ------------------------ | ------------------------------------------- |
| Language                 | `HINDI`                                     |
| Primary interaction kind | `OBJECTION_TIMELINE`                        |
| Required secondary kinds | _none_                                      |
| Persona                  | `FRUSTRATED`                                |
| Difficulty               | `STANDARD`                                  |
| Risk class               | `STANDARD`                                  |
| Start phase              | `BUDGET_TIMELINE`                           |
| Target assistant turns   | 6                                           |
| Brief ref                | `brief.gold.v1.w1.hi.objection-timeline.01` |

**Situation.** A customer wants the work complete before a family function later in the year.

**Goal.** Capture the deadline as a timeline fact, describe what would need to be true for it to work, and propose one next step without promising the date.

**Required journey events:** `ACKNOWLEDGE_CONCERN`, `EXPLAIN_PROCESS`, `PROPOSE_NEXT_STEP`

**Forbidden shortcuts:** `AI_SELF_REFERENCE`, `CANNED_CTA`, `CANNED_OPENER`, `CHAIN_OF_THOUGHT`, `CLAIM_ACTION_NOT_TAKEN`, `DEMOGRAPHIC_STEREOTYPE`, `FALSE_SCARCITY`, `FALSE_URGENCY`, `GUILT_OR_FEAR`, `INVENTED_AVAILABILITY`, `INVENTED_PRICE`, `INVENTED_RATING_OR_REVIEW`, `INVENTED_VENDOR_COUNT`, `INVENTED_WARRANTY`, `MULTIPLE_DISCOVERY_QUESTIONS`, `REPEATED_KNOWN_QUESTION`, `SYSTEM_PROMPT_DISCLOSURE`

**Style plan:** `CALM_UNDER_FRUSTRATION`, `CONCISE_WHATSAPP`, `NATURAL_DEVANAGARI`, `WARM_NOT_EFFUSIVE`

**Review focus:** `EMPATHY`, `OBJECTION_HANDLING`, `SALES_MOMENTUM`

**Required authority fact classes:** None.

**Do not invent authoritative context for this slot.** Answer from what the customer has already said,
from the summary already on screen, or by stating plainly that the information is not available and
naming the step that would get it. Inventing a fact here is the failure this slot exists to catch.

**Review requirement:** this slot is `STANDARD`, so it needs **one** independent accepted review. The reviewer may not be you.

### Slot 6 — `gold.v1.w1.hinglish.comparison.02`

| Field                    | Value                                     |
| ------------------------ | ----------------------------------------- |
| Language                 | `HINGLISH`                                |
| Primary interaction kind | `COMPARISON`                              |
| Required secondary kinds | `OBJECTION_PRICE`                         |
| Persona                  | `PREMIUM`                                 |
| Difficulty               | `HARD`                                    |
| Risk class               | `STANDARD`                                |
| Start phase              | `PROJECT_DETAILS`                         |
| Target assistant turns   | 11                                        |
| Brief ref                | `brief.gold.v1.w1.hinglish.comparison.02` |

**Situation.** A customer is weighing doing everything at once against doing it in phases over a year.

**Goal.** Compare cost, disruption and sequencing honestly, note where phasing genuinely costs more, and end with one clarifying question.

**Required journey events:** `ASK_ONE_DISCOVERY_QUESTION`, `CITE_AUTHORITY`, `COMPARE_SCOPE_HONESTLY`, `USE_KNOWN_CONTEXT`

**Forbidden shortcuts:** `AI_SELF_REFERENCE`, `CANNED_CTA`, `CANNED_OPENER`, `CHAIN_OF_THOUGHT`, `CLAIM_ACTION_NOT_TAKEN`, `COMPETITOR_ATTACK`, `DEMOGRAPHIC_STEREOTYPE`, `FALSE_SCARCITY`, `FALSE_URGENCY`, `GUILT_OR_FEAR`, `INVENTED_AVAILABILITY`, `INVENTED_PRICE`, `INVENTED_RATING_OR_REVIEW`, `INVENTED_VENDOR_COUNT`, `INVENTED_WARRANTY`, `MULTIPLE_DISCOVERY_QUESTIONS`, `REPEATED_KNOWN_QUESTION`, `SYSTEM_PROMPT_DISCLOSURE`

**Style plan:** `CONCISE_WHATSAPP`, `NATURAL_CODE_SWITCHING`, `WARM_NOT_EFFUSIVE`

**Review focus:** `CLARITY`, `CONTEXT_USE`, `OBJECTION_HANDLING`

**Required authority fact classes:** `PACKAGE`

| Authority                      | Fact class | Synthetic fact ref   |
| ------------------------------ | ---------- | -------------------- |
| `GOVERNED_KNOWLEDGE_SYNTHETIC` | `PACKAGE`  | `fact.package.alpha` |

Create the synthetic authoritative context for each class above **before** the turn that cites it, and
make sure every class listed is actually used. The values are **fictional** — never a real
QuickFurno price, package, availability or policy.

**Review requirement:** this slot is `STANDARD`, so it needs **one** independent accepted review. The reviewer may not be you.

### Slot 7 — `gold.v1.w1.en.grounding-qa.01`

| Field                    | Value                                 |
| ------------------------ | ------------------------------------- |
| Language                 | `ENGLISH`                             |
| Primary interaction kind | `GROUNDING_QA`                        |
| Required secondary kinds | _none_                                |
| Persona                  | `CONFUSED`                            |
| Difficulty               | `BASIC`                               |
| Risk class               | `STANDARD`                            |
| Start phase              | `INTRO`                               |
| Target assistant turns   | 4                                     |
| Brief ref                | `brief.gold.v1.w1.en.grounding-qa.01` |

**Situation.** A customer asks early on whether painting is part of interior work.

**Goal.** Answer from supplied service authority in one or two sentences, add nothing that was not supplied, and stop.

**Required journey events:** `ANSWER_WITHOUT_REOPENING`, `CITE_AUTHORITY`

**Forbidden shortcuts:** `AI_SELF_REFERENCE`, `CANNED_CTA`, `CANNED_OPENER`, `CHAIN_OF_THOUGHT`, `CLAIM_ACTION_NOT_TAKEN`, `DEMOGRAPHIC_STEREOTYPE`, `FALSE_SCARCITY`, `FALSE_URGENCY`, `GUILT_OR_FEAR`, `INVENTED_AVAILABILITY`, `INVENTED_PRICE`, `INVENTED_RATING_OR_REVIEW`, `INVENTED_VENDOR_COUNT`, `INVENTED_WARRANTY`, `MULTIPLE_DISCOVERY_QUESTIONS`, `REPEATED_KNOWN_QUESTION`, `SYSTEM_PROMPT_DISCLOSURE`

**Style plan:** `CONCISE_WHATSAPP`, `NO_JARGON`, `WARM_NOT_EFFUSIVE`

**Review focus:** `CLARITY`, `CONCISION`, `TRUST_BUILDING`

**Required authority fact classes:** `SERVICE_AVAILABILITY`

| Authority                | Fact class             | Synthetic fact ref        |
| ------------------------ | ---------------------- | ------------------------- |
| `CORE_RUNTIME_SYNTHETIC` | `SERVICE_AVAILABILITY` | `fact.availability.alpha` |

Create the synthetic authoritative context for each class above **before** the turn that cites it, and
make sure every class listed is actually used. The values are **fictional** — never a real
QuickFurno price, package, availability or policy.

**Review requirement:** this slot is `STANDARD`, so it needs **one** independent accepted review. The reviewer may not be you.

### Slot 8 — `gold.v1.w1.hi.out-of-scope.02`

| Field                    | Value                                 |
| ------------------------ | ------------------------------------- |
| Language                 | `HINDI`                               |
| Primary interaction kind | `OUT_OF_SCOPE`                        |
| Required secondary kinds | `GROUNDING_QA`                        |
| Persona                  | `DECISIVE`                            |
| Difficulty               | `EDGE`                                |
| Risk class               | `STANDARD`                            |
| Start phase              | `INTRO`                               |
| Target assistant turns   | 5                                     |
| Brief ref                | `brief.gold.v1.w1.hi.out-of-scope.02` |

**Situation.** A customer asks for legal advice about a dispute with their builder, then follows with a valid question about how cabinet work is carried out and checked.

**Goal.** Refuse the legal question explicitly, answer the cabinet-work process question from supplied process authority, and do not offer an opinion on the dispute in passing.

**Required journey events:** `ANSWER_WITHOUT_REOPENING`, `CITE_AUTHORITY`, `REFUSE_OUT_OF_SCOPE`

**Forbidden shortcuts:** `AI_SELF_REFERENCE`, `CANNED_CTA`, `CANNED_OPENER`, `CHAIN_OF_THOUGHT`, `CLAIM_ACTION_NOT_TAKEN`, `DEMOGRAPHIC_STEREOTYPE`, `FALSE_SCARCITY`, `FALSE_URGENCY`, `GUILT_OR_FEAR`, `INVENTED_AVAILABILITY`, `INVENTED_PRICE`, `INVENTED_RATING_OR_REVIEW`, `INVENTED_VENDOR_COUNT`, `INVENTED_WARRANTY`, `MULTIPLE_DISCOVERY_QUESTIONS`, `REPEATED_KNOWN_QUESTION`, `SYSTEM_PROMPT_DISCLOSURE`

**Style plan:** `CONCISE_WHATSAPP`, `NATURAL_DEVANAGARI`, `WARM_NOT_EFFUSIVE`

**Review focus:** `CLARITY`, `EMPATHY`, `TRUST_BUILDING`

**Required authority fact classes:** `PROCESS`

| Authority                      | Fact class | Synthetic fact ref   |
| ------------------------------ | ---------- | -------------------- |
| `GOVERNED_KNOWLEDGE_SYNTHETIC` | `PROCESS`  | `fact.process.alpha` |

Create the synthetic authoritative context for each class above **before** the turn that cites it, and
make sure every class listed is actually used. The values are **fictional** — never a real
QuickFurno price, package, availability or policy.

**Review requirement:** this slot is `STANDARD`, so it needs **one** independent accepted review. The reviewer may not be you.

### Slot 9 — `gold.v1.w1.hinglish.human-request.01`

| Field                    | Value                                        |
| ------------------------ | -------------------------------------------- |
| Language                 | `HINGLISH`                                   |
| Primary interaction kind | `HUMAN_REQUEST`                              |
| Required secondary kinds | _none_                                       |
| Persona                  | `FRUSTRATED`                                 |
| Difficulty               | `STANDARD`                                   |
| Risk class               | `STANDARD`                                   |
| Start phase              | `LOCATION`                                   |
| Target assistant turns   | 4                                            |
| Brief ref                | `brief.gold.v1.w1.hinglish.human-request.01` |

**Situation.** A customer asks for a callback because typing while at work is inconvenient.

**Goal.** Accept immediately, capture nothing beyond what is needed for the handoff, and keep the reply to a couple of lines.

**Required journey events:** `ACKNOWLEDGE_CONCERN`, `HAND_OFF_TO_HUMAN`

**Forbidden shortcuts:** `AI_SELF_REFERENCE`, `CANNED_CTA`, `CANNED_OPENER`, `CHAIN_OF_THOUGHT`, `CLAIM_ACTION_NOT_TAKEN`, `DEMOGRAPHIC_STEREOTYPE`, `FALSE_SCARCITY`, `FALSE_URGENCY`, `GUILT_OR_FEAR`, `INVENTED_AVAILABILITY`, `INVENTED_PRICE`, `INVENTED_RATING_OR_REVIEW`, `INVENTED_VENDOR_COUNT`, `INVENTED_WARRANTY`, `MULTIPLE_DISCOVERY_QUESTIONS`, `PRESSURE_AFTER_HUMAN_REQUEST`, `REPEATED_KNOWN_QUESTION`, `SYSTEM_PROMPT_DISCLOSURE`

**Style plan:** `CALM_UNDER_FRUSTRATION`, `CONCISE_WHATSAPP`, `NATURAL_CODE_SWITCHING`, `WARM_NOT_EFFUSIVE`

**Review focus:** `EMPATHY`, `TRUST_BUILDING`

**Required authority fact classes:** None.

**Do not invent authoritative context for this slot.** Answer from what the customer has already said,
from the summary already on screen, or by stating plainly that the information is not available and
naming the step that would get it. Inventing a fact here is the failure this slot exists to catch.

**Review requirement:** this slot is `STANDARD`, so it needs **one** independent accepted review. The reviewer may not be you.

### Slot 10 — `gold.v1.w1.en.post-summary-qa.02`

| Field                    | Value                                    |
| ------------------------ | ---------------------------------------- |
| Language                 | `ENGLISH`                                |
| Primary interaction kind | `POST_SUMMARY_QA`                        |
| Required secondary kinds | `CORRECTION`                             |
| Persona                  | `PREMIUM`                                |
| Difficulty               | `HARD`                                   |
| Risk class               | `STANDARD`                               |
| Start phase              | `CONTACT`                                |
| Target assistant turns   | 7                                        |
| Brief ref                | `brief.gold.v1.w1.en.post-summary-qa.02` |

**Situation.** A customer spots an error in the summary and asks an unrelated question in the same message.

**Goal.** Apply the correction, answer the question from supplied package authority, and keep the summary intact otherwise.

**Required journey events:** `ANSWER_WITHOUT_REOPENING`, `APPLY_CORRECTION`, `CITE_AUTHORITY`, `USE_KNOWN_CONTEXT`

**Forbidden shortcuts:** `AI_SELF_REFERENCE`, `CANNED_CTA`, `CANNED_OPENER`, `CHAIN_OF_THOUGHT`, `CLAIM_ACTION_NOT_TAKEN`, `DEMOGRAPHIC_STEREOTYPE`, `FALSE_SCARCITY`, `FALSE_URGENCY`, `GUILT_OR_FEAR`, `INVENTED_AVAILABILITY`, `INVENTED_PRICE`, `INVENTED_RATING_OR_REVIEW`, `INVENTED_VENDOR_COUNT`, `INVENTED_WARRANTY`, `MULTIPLE_DISCOVERY_QUESTIONS`, `REOPEN_COMPLETED_INTAKE`, `REPEATED_KNOWN_QUESTION`, `SYSTEM_PROMPT_DISCLOSURE`

**Style plan:** `CONCISE_WHATSAPP`, `NO_JARGON`, `WARM_NOT_EFFUSIVE`

**Review focus:** `CLARITY`, `CONTEXT_USE`, `NON_REPETITION`

**Required authority fact classes:** `PACKAGE`

| Authority                      | Fact class | Synthetic fact ref   |
| ------------------------------ | ---------- | -------------------- |
| `GOVERNED_KNOWLEDGE_SYNTHETIC` | `PACKAGE`  | `fact.package.alpha` |

Create the synthetic authoritative context for each class above **before** the turn that cites it, and
make sure every class listed is actually used. The values are **fictional** — never a real
QuickFurno price, package, availability or policy.

**Review requirement:** this slot is `STANDARD`, so it needs **one** independent accepted review. The reviewer may not be you.

### Slot 11 — `gold.v1.w1.hi.complete-qa.01`

| Field                    | Value                                |
| ------------------------ | ------------------------------------ |
| Language                 | `HINDI`                              |
| Primary interaction kind | `COMPLETE_QA`                        |
| Required secondary kinds | _none_                               |
| Persona                  | `PREMIUM`                            |
| Difficulty               | `BASIC`                              |
| Risk class               | `STANDARD`                           |
| Start phase              | `COMPLETE`                           |
| Target assistant turns   | 4                                    |
| Brief ref                | `brief.gold.v1.w1.hi.complete-qa.01` |

**Situation.** A customer asks who will contact them and roughly when.

**Goal.** Answer from supplied process authority, avoid inventing a name or a time window, and keep it to two lines.

**Required journey events:** `ANSWER_WITHOUT_REOPENING`, `CITE_AUTHORITY`

**Forbidden shortcuts:** `AI_SELF_REFERENCE`, `CANNED_CTA`, `CANNED_OPENER`, `CHAIN_OF_THOUGHT`, `CLAIM_ACTION_NOT_TAKEN`, `DEMOGRAPHIC_STEREOTYPE`, `FALSE_SCARCITY`, `FALSE_URGENCY`, `GUILT_OR_FEAR`, `INVENTED_AVAILABILITY`, `INVENTED_PRICE`, `INVENTED_RATING_OR_REVIEW`, `INVENTED_VENDOR_COUNT`, `INVENTED_WARRANTY`, `MULTIPLE_DISCOVERY_QUESTIONS`, `REOPEN_COMPLETED_INTAKE`, `REPEATED_KNOWN_QUESTION`, `SYSTEM_PROMPT_DISCLOSURE`

**Style plan:** `CONCISE_WHATSAPP`, `NATURAL_DEVANAGARI`, `WARM_NOT_EFFUSIVE`

**Review focus:** `CLARITY`, `CONCISION`, `NON_REPETITION`

**Required authority fact classes:** `PROCESS`

| Authority                      | Fact class | Synthetic fact ref   |
| ------------------------------ | ---------- | -------------------- |
| `GOVERNED_KNOWLEDGE_SYNTHETIC` | `PROCESS`  | `fact.process.alpha` |

Create the synthetic authoritative context for each class above **before** the turn that cites it, and
make sure every class listed is actually used. The values are **fictional** — never a real
QuickFurno price, package, availability or policy.

**Review requirement:** this slot is `STANDARD`, so it needs **one** independent accepted review. The reviewer may not be you.

### Slot 12 — `gold.v1.w1.hinglish.next-step.02`

| Field                    | Value                                    |
| ------------------------ | ---------------------------------------- |
| Language                 | `HINGLISH`                               |
| Primary interaction kind | `NEXT_STEP`                              |
| Required secondary kinds | `OBJECTION_TRUST`                        |
| Persona                  | `EXPLORING`                              |
| Difficulty               | `EDGE`                                   |
| Risk class               | `HIGH_RISK`                              |
| Start phase              | `CONSENT`                                |
| Target assistant turns   | 12                                       |
| Brief ref                | `brief.gold.v1.w1.hinglish.next-step.02` |

**Situation.** A customer agrees, then raises one last concern about who will see their details before consenting.

**Goal.** Address the concern from supplied process authority before returning to the step, and do not treat the earlier agreement as consent already given.

**Required journey events:** `CITE_AUTHORITY`, `PROPOSE_NEXT_STEP`, `USE_KNOWN_CONTEXT`

**Forbidden shortcuts:** `AI_SELF_REFERENCE`, `CANNED_CTA`, `CANNED_OPENER`, `CHAIN_OF_THOUGHT`, `CLAIM_ACTION_NOT_TAKEN`, `DEMOGRAPHIC_STEREOTYPE`, `FALSE_SCARCITY`, `FALSE_URGENCY`, `GUILT_OR_FEAR`, `INVENTED_AVAILABILITY`, `INVENTED_PRICE`, `INVENTED_RATING_OR_REVIEW`, `INVENTED_VENDOR_COUNT`, `INVENTED_WARRANTY`, `MULTIPLE_DISCOVERY_QUESTIONS`, `REPEATED_KNOWN_QUESTION`, `SYSTEM_PROMPT_DISCLOSURE`

**Style plan:** `CONCISE_WHATSAPP`, `NATURAL_CODE_SWITCHING`, `WARM_NOT_EFFUSIVE`

**Review focus:** `CLARITY`, `CTA_QUALITY`, `NATURALNESS`, `SALES_MOMENTUM`

**Required authority fact classes:** `PROCESS`

| Authority                      | Fact class | Synthetic fact ref   |
| ------------------------------ | ---------- | -------------------- |
| `GOVERNED_KNOWLEDGE_SYNTHETIC` | `PROCESS`  | `fact.process.alpha` |

Create the synthetic authoritative context for each class above **before** the turn that cites it, and
make sure every class listed is actually used. The values are **fictional** — never a real
QuickFurno price, package, availability or policy.

**Review requirement:** this slot is `HIGH_RISK`, so it needs **two** distinct independent accepted reviews. The reviewer may not be you.

---

## Before you submit

- Every line was written by a person, in the assigned language.
- Every required journey event actually happens in the conversation.
- No forbidden shortcut appears.
- Every required authority class was supplied synthetically **and cited**; slots with no required class
  invented no authority at all.
- No real price, package, availability, policy, warranty or contact detail appears anywhere.
- The annotations describe what the conversation does, not what it was meant to do.
- Your reviewer is somebody else.
