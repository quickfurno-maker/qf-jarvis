# Riya HUMAN GOLD V1 — Wave 1, micro-batch 1 authoring packet

**Slice:** HGV1-B · **Decision:** [ADR-0108](../decisions/ADR-0108-riya-human-gold-v1-authoring-and-calibration.md) · **Read first:** [authoring rubric](./riya-human-gold-authoring-rubric.md) · **Then:** [review workflow](./riya-human-gold-review-workflow.md), [wave plan](./riya-human-gold-wave-plan.md), [batch schedule](./riya-human-gold-wave-1-batch-schedule.md)

These are the twelve slots of the **calibration anchor**. They are written, reviewed and read end to
end before anybody starts the other sixty.

> ## You write the words
>
> Not a model. Not a rewrite of a model's draft. Not a model's draft with the phrasing changed.
>
> No tool in this repository can tell whether a sentence was typed by a person, and there will never
> be one that tries. Classification is enforced; authorship is process-attested. If a language model
> composed a line in your trajectory, the trajectory is not Human Gold, and labelling it so makes
> every later claim about this dataset false. The rule holds because you hold it.
>
> There is a legitimate path for model-assisted content — `TEACHER_GENERATED_SYNTHETIC`, separately
> governed, a later slice. This is not it.

---

## What is in this packet, and what is not

Each slot below carries its assignment (the binding structure) and its brief (the writing
instruction). **There is no dialogue anywhere in this file**, and there is none anywhere in the
repository yet — Wave 1 has not been authored.

You will not be shown any P10 protected evaluation content. That is deliberate: the exam has to stay
unseen for the score to mean anything, and an author who has read it cannot unread it.

## This anchor samples the hard work

The twelve are not all first drafts. Six are a cell's `01` take and six its `02`, which is what puts
real difficulty in front of the calibration read:

| Difficulty | Slots |     | Risk        | Slots |
| ---------- | ----- | --- | ----------- | ----- |
| `BASIC`    | 3     |     | `STANDARD`  | 9     |
| `STANDARD` | 3     |     | `HIGH_RISK` | 3     |
| `HARD`     | 4     |     |             |       |
| `EDGE`     | 2     |     |             |       |

Four English, four Hindi, four Hinglish; all twelve interaction kinds exactly once. Three slots need
two independent reviewers rather than one — plan for that before you start.

## How to work through a slot

1. Read the assignment table. Language, persona, difficulty, risk, start phase and target depth are
   **binding** — the validator checks each against the plan.
2. Read the brief. The situation and goal are the scenario; the journey events are beats that must
   actually happen; the forbidden shortcuts are ways of writing it that read well and teach harm.
3. Write every customer line and every Riya line yourself, in the assigned language.
4. Fill the structured annotations truthfully. If the assistant asks about budget,
   `askedDiscoveryFields` says `budget`. Annotations that do not match the dialogue are worse than
   absent ones.
5. Where the slot names an authority fact class, supply it in an `AUTHORITATIVE_CONTEXT` turn
   **before** the assistant uses it, with a synthetic placeholder ref and a synthetic value you wrote.
   Then actually cite it — a fact that arrives and is never mentioned fails
   `REQUIRED_AUTHORITY_CLASS_UNUSED`. Where the slot names none, invent none: answer from the
   conversation, or say plainly that you need the information. Both behaviours belong in Gold, and
   which one a slot teaches is decided by its assignment, not by what would be convenient.
6. Set `HUMAN_AUTHORED_SYNTHETIC` only if you genuinely wrote it, and give an opaque `sourceRef`.
7. Run the validators, then send it to a reviewer who is **not you**. High-risk slots need two.

## The whole-batch check, before this batch is called done

Read all twelve in a row and ask: is this one coherent Riya? Do the openers blur? Do the closers?
Do the three languages read as three languages, or as one conversation translated? If the answer is
uncomfortable, that is the anchor doing its job — fix the authoring process before writing batch 2.

## Note on slot 8

`hi.out-of-scope.02` requires `GROUNDING_QA` as a secondary interaction and now requires `PROCESS`
authority to go with it. That pairing is deliberate and was corrected during the pre-authoring audit:
a grounded question means one answered from governed knowledge _with a citation_, so the slot has to
supply something to cite. Decline the out-of-scope half; answer the process half from a synthetic
`PROCESS` fact you supply in context.

---

## The twelve slots

### 1. `gold.v1.w1.en.discovery.01`

| Field                  | Value                               |
| ---------------------- | ----------------------------------- |
| Language               | `ENGLISH`                           |
| Primary interaction    | `DISCOVERY`                         |
| Required secondary     | —                                   |
| Persona                | `EXPLORING`                         |
| Difficulty             | `BASIC`                             |
| Risk class             | `STANDARD` — one independent review |
| Start phase            | `INTRO`                             |
| Target assistant turns | **6** (±1)                          |
| Authority fact classes | —                                   |
| Brief                  | `brief.gold.v1.w1.en.discovery.01`  |

**Customer situation.** A customer has just taken handover of a new flat and opens the chat wanting a modular kitchen and one wardrobe. They give the service and the city in their very first message.

**Conversation goal.** Capture both facts from the opening message without re-asking either, acknowledge the handover briefly, and move discovery forward with one question that is actually needed next.

**Required journey events.** `ASK_ONE_DISCOVERY_QUESTION` · `CAPTURE_NEW_FACT` · `USE_KNOWN_CONTEXT`

**Forbidden shortcuts.** `AI_SELF_REFERENCE` · `CANNED_CTA` · `CANNED_OPENER` · `CHAIN_OF_THOUGHT` · `CLAIM_ACTION_NOT_TAKEN` · `DEMOGRAPHIC_STEREOTYPE` · `FALSE_SCARCITY` · `FALSE_URGENCY` · `GUILT_OR_FEAR` · `INVENTED_AVAILABILITY` · `INVENTED_PRICE` · `INVENTED_RATING_OR_REVIEW` · `INVENTED_VENDOR_COUNT` · `INVENTED_WARRANTY` · `MULTIPLE_DISCOVERY_QUESTIONS` · `REPEATED_KNOWN_QUESTION` · `SYSTEM_PROMPT_DISCLOSURE`

**Authority plan.** None — this slot needs no business fact.

**Style plan.** `CONCISE_WHATSAPP` · `NO_JARGON` · `WARM_NOT_EFFUSIVE`

**Review focus.** `CLARITY` · `CONCISION` · `CONTEXT_USE` · `NON_REPETITION`

---

### 2. `gold.v1.w1.hi.correction.02`

| Field                  | Value                               |
| ---------------------- | ----------------------------------- |
| Language               | `HINDI`                             |
| Primary interaction    | `CORRECTION`                        |
| Required secondary     | `DISCOVERY`                         |
| Persona                | `EXPLORING`                         |
| Difficulty             | `HARD`                              |
| Risk class             | `STANDARD` — one independent review |
| Start phase            | `BUDGET_TIMELINE`                   |
| Target assistant turns | **9** (±1)                          |
| Authority fact classes | —                                   |
| Brief                  | `brief.gold.v1.w1.hi.correction.02` |

**Customer situation.** A customer corrects the timeline after a possession delay and then also reduces the scope to one room.

**Conversation goal.** Handle two corrections in sequence, keep every unaffected fact, and confirm the revised picture concisely before proposing anything.

**Required journey events.** `APPLY_CORRECTION` · `ASK_ONE_DISCOVERY_QUESTION` · `USE_KNOWN_CONTEXT`

**Forbidden shortcuts.** `AI_SELF_REFERENCE` · `CANNED_CTA` · `CANNED_OPENER` · `CHAIN_OF_THOUGHT` · `CLAIM_ACTION_NOT_TAKEN` · `DEMOGRAPHIC_STEREOTYPE` · `FALSE_SCARCITY` · `FALSE_URGENCY` · `GUILT_OR_FEAR` · `INVENTED_AVAILABILITY` · `INVENTED_PRICE` · `INVENTED_RATING_OR_REVIEW` · `INVENTED_VENDOR_COUNT` · `INVENTED_WARRANTY` · `MULTIPLE_DISCOVERY_QUESTIONS` · `REPEATED_KNOWN_QUESTION` · `SYSTEM_PROMPT_DISCLOSURE`

**Authority plan.** None — this slot needs no business fact.

**Style plan.** `CONCISE_WHATSAPP` · `NATURAL_DEVANAGARI` · `WARM_NOT_EFFUSIVE`

**Review focus.** `CLARITY` · `CONTEXT_USE` · `NON_REPETITION`

---

### 3. `gold.v1.w1.hinglish.objection-price.01`

| Field                  | Value                                          |
| ---------------------- | ---------------------------------------------- |
| Language               | `HINGLISH`                                     |
| Primary interaction    | `OBJECTION_PRICE`                              |
| Required secondary     | —                                              |
| Persona                | `PRICE_SENSITIVE`                              |
| Difficulty             | `STANDARD`                                     |
| Risk class             | `HIGH_RISK` — **two** independent reviews      |
| Start phase            | `BUDGET_TIMELINE`                              |
| Target assistant turns | **7** (±1)                                     |
| Authority fact classes | `PRICE`                                        |
| Brief                  | `brief.gold.v1.w1.hinglish.objection-price.01` |

**Customer situation.** A customer asks whether anything can be removed to bring the number down.

**Conversation goal.** Treat this as a scope question rather than a discount request, use supplied authority for any figure mentioned, and keep the reply short and practical.

**Required journey events.** `ACKNOWLEDGE_CONCERN` · `CITE_AUTHORITY` · `COMPARE_SCOPE_HONESTLY` · `PROPOSE_NEXT_STEP` · `USE_KNOWN_CONTEXT`

**Forbidden shortcuts.** `AI_SELF_REFERENCE` · `CANNED_CTA` · `CANNED_OPENER` · `CHAIN_OF_THOUGHT` · `CLAIM_ACTION_NOT_TAKEN` · `DEMOGRAPHIC_STEREOTYPE` · `FALSE_SCARCITY` · `FALSE_URGENCY` · `GUILT_OR_FEAR` · `INSTANT_DISCOUNT` · `INVENTED_AVAILABILITY` · `INVENTED_PRICE` · `INVENTED_RATING_OR_REVIEW` · `INVENTED_VENDOR_COUNT` · `INVENTED_WARRANTY` · `MULTIPLE_DISCOVERY_QUESTIONS` · `REPEATED_KNOWN_QUESTION` · `SYSTEM_PROMPT_DISCLOSURE`

**Authority plan.** `PRICE` from `CORE_RUNTIME_SYNTHETIC`, suggested ref `fact.price.alpha`

**Style plan.** `CONCISE_WHATSAPP` · `NATURAL_CODE_SWITCHING` · `PLAIN_NUMBERS` · `WARM_NOT_EFFUSIVE`

**Review focus.** `EMPATHY` · `OBJECTION_HANDLING` · `SALES_MOMENTUM` · `TRUST_BUILDING`

---

### 4. `gold.v1.w1.en.objection-trust.02`

| Field                  | Value                                     |
| ---------------------- | ----------------------------------------- |
| Language               | `ENGLISH`                                 |
| Primary interaction    | `OBJECTION_TRUST`                         |
| Required secondary     | —                                         |
| Persona                | `FRUSTRATED`                              |
| Difficulty             | `HARD`                                    |
| Risk class             | `HIGH_RISK` — **two** independent reviews |
| Start phase            | `BUDGET_TIMELINE`                         |
| Target assistant turns | **9** (±1)                                |
| Authority fact classes | `PROCESS`, `WARRANTY`                     |
| Brief                  | `brief.gold.v1.w1.en.objection-trust.02`  |

**Customer situation.** A customer asks what happens if a shutter or hinge fails a year after installation.

**Conversation goal.** Answer only from supplied warranty and process authority, state plainly what is not covered, and never promise a term that was not supplied.

**Required journey events.** `ACKNOWLEDGE_CONCERN` · `CITE_AUTHORITY` · `EXPLAIN_PROCESS`

**Forbidden shortcuts.** `AI_SELF_REFERENCE` · `APOLOGY_LOOP` · `CANNED_CTA` · `CANNED_OPENER` · `CHAIN_OF_THOUGHT` · `CLAIM_ACTION_NOT_TAKEN` · `DEMOGRAPHIC_STEREOTYPE` · `FALSE_SCARCITY` · `FALSE_URGENCY` · `GUILT_OR_FEAR` · `INVENTED_AVAILABILITY` · `INVENTED_PRICE` · `INVENTED_RATING_OR_REVIEW` · `INVENTED_VENDOR_COUNT` · `INVENTED_WARRANTY` · `MULTIPLE_DISCOVERY_QUESTIONS` · `REPEATED_KNOWN_QUESTION` · `SYSTEM_PROMPT_DISCLOSURE`

**Authority plan.** `PROCESS` from `GOVERNED_KNOWLEDGE_SYNTHETIC`, suggested ref `fact.process.alpha`; `WARRANTY` from `GOVERNED_KNOWLEDGE_SYNTHETIC`, suggested ref `fact.warranty.alpha`

**Style plan.** `CALM_UNDER_FRUSTRATION` · `CONCISE_WHATSAPP` · `NO_JARGON` · `WARM_NOT_EFFUSIVE`

**Review focus.** `EMPATHY` · `OBJECTION_HANDLING` · `TRUST_BUILDING`

---

### 5. `gold.v1.w1.hi.objection-timeline.01`

| Field                  | Value                                       |
| ---------------------- | ------------------------------------------- |
| Language               | `HINDI`                                     |
| Primary interaction    | `OBJECTION_TIMELINE`                        |
| Required secondary     | —                                           |
| Persona                | `FRUSTRATED`                                |
| Difficulty             | `STANDARD`                                  |
| Risk class             | `STANDARD` — one independent review         |
| Start phase            | `BUDGET_TIMELINE`                           |
| Target assistant turns | **6** (±1)                                  |
| Authority fact classes | —                                           |
| Brief                  | `brief.gold.v1.w1.hi.objection-timeline.01` |

**Customer situation.** A customer wants the work complete before a family function later in the year.

**Conversation goal.** Capture the deadline as a timeline fact, describe what would need to be true for it to work, and propose one next step without promising the date.

**Required journey events.** `ACKNOWLEDGE_CONCERN` · `EXPLAIN_PROCESS` · `PROPOSE_NEXT_STEP`

**Forbidden shortcuts.** `AI_SELF_REFERENCE` · `CANNED_CTA` · `CANNED_OPENER` · `CHAIN_OF_THOUGHT` · `CLAIM_ACTION_NOT_TAKEN` · `DEMOGRAPHIC_STEREOTYPE` · `FALSE_SCARCITY` · `FALSE_URGENCY` · `GUILT_OR_FEAR` · `INVENTED_AVAILABILITY` · `INVENTED_PRICE` · `INVENTED_RATING_OR_REVIEW` · `INVENTED_VENDOR_COUNT` · `INVENTED_WARRANTY` · `MULTIPLE_DISCOVERY_QUESTIONS` · `REPEATED_KNOWN_QUESTION` · `SYSTEM_PROMPT_DISCLOSURE`

**Authority plan.** None — this slot needs no business fact.

**Style plan.** `CALM_UNDER_FRUSTRATION` · `CONCISE_WHATSAPP` · `NATURAL_DEVANAGARI` · `WARM_NOT_EFFUSIVE`

**Review focus.** `EMPATHY` · `OBJECTION_HANDLING` · `SALES_MOMENTUM`

---

### 6. `gold.v1.w1.hinglish.comparison.02`

| Field                  | Value                                     |
| ---------------------- | ----------------------------------------- |
| Language               | `HINGLISH`                                |
| Primary interaction    | `COMPARISON`                              |
| Required secondary     | `OBJECTION_PRICE`                         |
| Persona                | `PREMIUM`                                 |
| Difficulty             | `HARD`                                    |
| Risk class             | `STANDARD` — one independent review       |
| Start phase            | `PROJECT_DETAILS`                         |
| Target assistant turns | **11** (±1)                               |
| Authority fact classes | `PACKAGE`                                 |
| Brief                  | `brief.gold.v1.w1.hinglish.comparison.02` |

**Customer situation.** A customer is weighing doing everything at once against doing it in phases over a year.

**Conversation goal.** Compare cost, disruption and sequencing honestly, note where phasing genuinely costs more, and end with one clarifying question.

**Required journey events.** `ASK_ONE_DISCOVERY_QUESTION` · `CITE_AUTHORITY` · `COMPARE_SCOPE_HONESTLY` · `USE_KNOWN_CONTEXT`

**Forbidden shortcuts.** `AI_SELF_REFERENCE` · `CANNED_CTA` · `CANNED_OPENER` · `CHAIN_OF_THOUGHT` · `CLAIM_ACTION_NOT_TAKEN` · `COMPETITOR_ATTACK` · `DEMOGRAPHIC_STEREOTYPE` · `FALSE_SCARCITY` · `FALSE_URGENCY` · `GUILT_OR_FEAR` · `INVENTED_AVAILABILITY` · `INVENTED_PRICE` · `INVENTED_RATING_OR_REVIEW` · `INVENTED_VENDOR_COUNT` · `INVENTED_WARRANTY` · `MULTIPLE_DISCOVERY_QUESTIONS` · `REPEATED_KNOWN_QUESTION` · `SYSTEM_PROMPT_DISCLOSURE`

**Authority plan.** `PACKAGE` from `GOVERNED_KNOWLEDGE_SYNTHETIC`, suggested ref `fact.package.alpha`

**Style plan.** `CONCISE_WHATSAPP` · `NATURAL_CODE_SWITCHING` · `WARM_NOT_EFFUSIVE`

**Review focus.** `CLARITY` · `CONTEXT_USE` · `OBJECTION_HANDLING`

---

### 7. `gold.v1.w1.en.grounding-qa.01`

| Field                  | Value                                 |
| ---------------------- | ------------------------------------- |
| Language               | `ENGLISH`                             |
| Primary interaction    | `GROUNDING_QA`                        |
| Required secondary     | —                                     |
| Persona                | `CONFUSED`                            |
| Difficulty             | `BASIC`                               |
| Risk class             | `STANDARD` — one independent review   |
| Start phase            | `INTRO`                               |
| Target assistant turns | **4** (±1)                            |
| Authority fact classes | `SERVICE_AVAILABILITY`                |
| Brief                  | `brief.gold.v1.w1.en.grounding-qa.01` |

**Customer situation.** A customer asks early on whether painting is part of interior work.

**Conversation goal.** Answer from supplied service authority in one or two sentences, add nothing that was not supplied, and stop.

**Required journey events.** `ANSWER_WITHOUT_REOPENING` · `CITE_AUTHORITY`

**Forbidden shortcuts.** `AI_SELF_REFERENCE` · `CANNED_CTA` · `CANNED_OPENER` · `CHAIN_OF_THOUGHT` · `CLAIM_ACTION_NOT_TAKEN` · `DEMOGRAPHIC_STEREOTYPE` · `FALSE_SCARCITY` · `FALSE_URGENCY` · `GUILT_OR_FEAR` · `INVENTED_AVAILABILITY` · `INVENTED_PRICE` · `INVENTED_RATING_OR_REVIEW` · `INVENTED_VENDOR_COUNT` · `INVENTED_WARRANTY` · `MULTIPLE_DISCOVERY_QUESTIONS` · `REPEATED_KNOWN_QUESTION` · `SYSTEM_PROMPT_DISCLOSURE`

**Authority plan.** `SERVICE_AVAILABILITY` from `CORE_RUNTIME_SYNTHETIC`, suggested ref `fact.availability.alpha`

**Style plan.** `CONCISE_WHATSAPP` · `NO_JARGON` · `WARM_NOT_EFFUSIVE`

**Review focus.** `CLARITY` · `CONCISION` · `TRUST_BUILDING`

---

### 8. `gold.v1.w1.hi.out-of-scope.02`

| Field                  | Value                                 |
| ---------------------- | ------------------------------------- |
| Language               | `HINDI`                               |
| Primary interaction    | `OUT_OF_SCOPE`                        |
| Required secondary     | `GROUNDING_QA`                        |
| Persona                | `DECISIVE`                            |
| Difficulty             | `EDGE`                                |
| Risk class             | `STANDARD` — one independent review   |
| Start phase            | `INTRO`                               |
| Target assistant turns | **5** (±1)                            |
| Authority fact classes | `PROCESS`                             |
| Brief                  | `brief.gold.v1.w1.hi.out-of-scope.02` |

**Customer situation.** A customer asks for legal advice about a dispute with their builder, then follows with a valid question about how cabinet work is carried out and checked.

**Conversation goal.** Refuse the legal question explicitly, answer the cabinet-work process question from supplied process authority, and do not offer an opinion on the dispute in passing.

**Required journey events.** `ANSWER_WITHOUT_REOPENING` · `CITE_AUTHORITY` · `REFUSE_OUT_OF_SCOPE`

**Forbidden shortcuts.** `AI_SELF_REFERENCE` · `CANNED_CTA` · `CANNED_OPENER` · `CHAIN_OF_THOUGHT` · `CLAIM_ACTION_NOT_TAKEN` · `DEMOGRAPHIC_STEREOTYPE` · `FALSE_SCARCITY` · `FALSE_URGENCY` · `GUILT_OR_FEAR` · `INVENTED_AVAILABILITY` · `INVENTED_PRICE` · `INVENTED_RATING_OR_REVIEW` · `INVENTED_VENDOR_COUNT` · `INVENTED_WARRANTY` · `MULTIPLE_DISCOVERY_QUESTIONS` · `REPEATED_KNOWN_QUESTION` · `SYSTEM_PROMPT_DISCLOSURE`

**Authority plan.** `PROCESS` from `GOVERNED_KNOWLEDGE_SYNTHETIC`, suggested ref `fact.process.alpha`

**Style plan.** `CONCISE_WHATSAPP` · `NATURAL_DEVANAGARI` · `WARM_NOT_EFFUSIVE`

**Review focus.** `CLARITY` · `EMPATHY` · `TRUST_BUILDING`

---

### 9. `gold.v1.w1.hinglish.human-request.01`

| Field                  | Value                                        |
| ---------------------- | -------------------------------------------- |
| Language               | `HINGLISH`                                   |
| Primary interaction    | `HUMAN_REQUEST`                              |
| Required secondary     | —                                            |
| Persona                | `FRUSTRATED`                                 |
| Difficulty             | `STANDARD`                                   |
| Risk class             | `STANDARD` — one independent review          |
| Start phase            | `LOCATION`                                   |
| Target assistant turns | **4** (±1)                                   |
| Authority fact classes | —                                            |
| Brief                  | `brief.gold.v1.w1.hinglish.human-request.01` |

**Customer situation.** A customer asks for a callback because typing while at work is inconvenient.

**Conversation goal.** Accept immediately, capture nothing beyond what is needed for the handoff, and keep the reply to a couple of lines.

**Required journey events.** `ACKNOWLEDGE_CONCERN` · `HAND_OFF_TO_HUMAN`

**Forbidden shortcuts.** `AI_SELF_REFERENCE` · `CANNED_CTA` · `CANNED_OPENER` · `CHAIN_OF_THOUGHT` · `CLAIM_ACTION_NOT_TAKEN` · `DEMOGRAPHIC_STEREOTYPE` · `FALSE_SCARCITY` · `FALSE_URGENCY` · `GUILT_OR_FEAR` · `INVENTED_AVAILABILITY` · `INVENTED_PRICE` · `INVENTED_RATING_OR_REVIEW` · `INVENTED_VENDOR_COUNT` · `INVENTED_WARRANTY` · `MULTIPLE_DISCOVERY_QUESTIONS` · `PRESSURE_AFTER_HUMAN_REQUEST` · `REPEATED_KNOWN_QUESTION` · `SYSTEM_PROMPT_DISCLOSURE`

**Authority plan.** None — this slot needs no business fact.

**Style plan.** `CALM_UNDER_FRUSTRATION` · `CONCISE_WHATSAPP` · `NATURAL_CODE_SWITCHING` · `WARM_NOT_EFFUSIVE`

**Review focus.** `EMPATHY` · `TRUST_BUILDING`

---

### 10. `gold.v1.w1.en.post-summary-qa.02`

| Field                  | Value                                    |
| ---------------------- | ---------------------------------------- |
| Language               | `ENGLISH`                                |
| Primary interaction    | `POST_SUMMARY_QA`                        |
| Required secondary     | `CORRECTION`                             |
| Persona                | `PREMIUM`                                |
| Difficulty             | `HARD`                                   |
| Risk class             | `STANDARD` — one independent review      |
| Start phase            | `CONTACT`                                |
| Target assistant turns | **7** (±1)                               |
| Authority fact classes | `PACKAGE`                                |
| Brief                  | `brief.gold.v1.w1.en.post-summary-qa.02` |

**Customer situation.** A customer spots an error in the summary and asks an unrelated question in the same message.

**Conversation goal.** Apply the correction, answer the question from supplied package authority, and keep the summary intact otherwise.

**Required journey events.** `ANSWER_WITHOUT_REOPENING` · `APPLY_CORRECTION` · `CITE_AUTHORITY` · `USE_KNOWN_CONTEXT`

**Forbidden shortcuts.** `AI_SELF_REFERENCE` · `CANNED_CTA` · `CANNED_OPENER` · `CHAIN_OF_THOUGHT` · `CLAIM_ACTION_NOT_TAKEN` · `DEMOGRAPHIC_STEREOTYPE` · `FALSE_SCARCITY` · `FALSE_URGENCY` · `GUILT_OR_FEAR` · `INVENTED_AVAILABILITY` · `INVENTED_PRICE` · `INVENTED_RATING_OR_REVIEW` · `INVENTED_VENDOR_COUNT` · `INVENTED_WARRANTY` · `MULTIPLE_DISCOVERY_QUESTIONS` · `REOPEN_COMPLETED_INTAKE` · `REPEATED_KNOWN_QUESTION` · `SYSTEM_PROMPT_DISCLOSURE`

**Authority plan.** `PACKAGE` from `GOVERNED_KNOWLEDGE_SYNTHETIC`, suggested ref `fact.package.alpha`

**Style plan.** `CONCISE_WHATSAPP` · `NO_JARGON` · `WARM_NOT_EFFUSIVE`

**Review focus.** `CLARITY` · `CONTEXT_USE` · `NON_REPETITION`

---

### 11. `gold.v1.w1.hi.complete-qa.01`

| Field                  | Value                                |
| ---------------------- | ------------------------------------ |
| Language               | `HINDI`                              |
| Primary interaction    | `COMPLETE_QA`                        |
| Required secondary     | —                                    |
| Persona                | `PREMIUM`                            |
| Difficulty             | `BASIC`                              |
| Risk class             | `STANDARD` — one independent review  |
| Start phase            | `COMPLETE`                           |
| Target assistant turns | **4** (±1)                           |
| Authority fact classes | `PROCESS`                            |
| Brief                  | `brief.gold.v1.w1.hi.complete-qa.01` |

**Customer situation.** A customer asks who will contact them and roughly when.

**Conversation goal.** Answer from supplied process authority, avoid inventing a name or a time window, and keep it to two lines.

**Required journey events.** `ANSWER_WITHOUT_REOPENING` · `CITE_AUTHORITY`

**Forbidden shortcuts.** `AI_SELF_REFERENCE` · `CANNED_CTA` · `CANNED_OPENER` · `CHAIN_OF_THOUGHT` · `CLAIM_ACTION_NOT_TAKEN` · `DEMOGRAPHIC_STEREOTYPE` · `FALSE_SCARCITY` · `FALSE_URGENCY` · `GUILT_OR_FEAR` · `INVENTED_AVAILABILITY` · `INVENTED_PRICE` · `INVENTED_RATING_OR_REVIEW` · `INVENTED_VENDOR_COUNT` · `INVENTED_WARRANTY` · `MULTIPLE_DISCOVERY_QUESTIONS` · `REOPEN_COMPLETED_INTAKE` · `REPEATED_KNOWN_QUESTION` · `SYSTEM_PROMPT_DISCLOSURE`

**Authority plan.** `PROCESS` from `GOVERNED_KNOWLEDGE_SYNTHETIC`, suggested ref `fact.process.alpha`

**Style plan.** `CONCISE_WHATSAPP` · `NATURAL_DEVANAGARI` · `WARM_NOT_EFFUSIVE`

**Review focus.** `CLARITY` · `CONCISION` · `NON_REPETITION`

---

### 12. `gold.v1.w1.hinglish.next-step.02`

| Field                  | Value                                     |
| ---------------------- | ----------------------------------------- |
| Language               | `HINGLISH`                                |
| Primary interaction    | `NEXT_STEP`                               |
| Required secondary     | `OBJECTION_TRUST`                         |
| Persona                | `EXPLORING`                               |
| Difficulty             | `EDGE`                                    |
| Risk class             | `HIGH_RISK` — **two** independent reviews |
| Start phase            | `CONSENT`                                 |
| Target assistant turns | **12** (±1)                               |
| Authority fact classes | `PROCESS`                                 |
| Brief                  | `brief.gold.v1.w1.hinglish.next-step.02`  |

**Customer situation.** A customer agrees, then raises one last concern about who will see their details before consenting.

**Conversation goal.** Address the concern from supplied process authority before returning to the step, and do not treat the earlier agreement as consent already given.

**Required journey events.** `CITE_AUTHORITY` · `PROPOSE_NEXT_STEP` · `USE_KNOWN_CONTEXT`

**Forbidden shortcuts.** `AI_SELF_REFERENCE` · `CANNED_CTA` · `CANNED_OPENER` · `CHAIN_OF_THOUGHT` · `CLAIM_ACTION_NOT_TAKEN` · `DEMOGRAPHIC_STEREOTYPE` · `FALSE_SCARCITY` · `FALSE_URGENCY` · `GUILT_OR_FEAR` · `INVENTED_AVAILABILITY` · `INVENTED_PRICE` · `INVENTED_RATING_OR_REVIEW` · `INVENTED_VENDOR_COUNT` · `INVENTED_WARRANTY` · `MULTIPLE_DISCOVERY_QUESTIONS` · `REPEATED_KNOWN_QUESTION` · `SYSTEM_PROMPT_DISCLOSURE`

**Authority plan.** `PROCESS` from `GOVERNED_KNOWLEDGE_SYNTHETIC`, suggested ref `fact.process.alpha`

**Style plan.** `CONCISE_WHATSAPP` · `NATURAL_CODE_SWITCHING` · `WARM_NOT_EFFUSIVE`

**Review focus.** `CLARITY` · `CTA_QUALITY` · `NATURALNESS` · `SALES_MOMENTUM`
