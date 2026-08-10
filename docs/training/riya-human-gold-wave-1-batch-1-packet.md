# Riya HUMAN GOLD V1 — Wave 1, micro-batch 1 authoring packet

**Slice:** HGV1-B · **Decision:** [ADR-0108](../decisions/ADR-0108-riya-human-gold-v1-authoring-and-calibration.md) · **Read first:** [authoring rubric](./riya-human-gold-authoring-rubric.md) · **Then:** [review workflow](./riya-human-gold-review-workflow.md), [wave plan](./riya-human-gold-wave-plan.md)

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

## How to work through a slot

1. Read the assignment table. Language, persona, difficulty, risk, start phase and target depth are
   **binding** — the validator checks each against the plan.
2. Read the brief. The situation and goal are the scenario; the journey events are beats that must
   actually happen; the forbidden shortcuts are ways of writing it that read well and teach harm.
3. Write every customer line and every Riya line yourself, in the assigned language.
4. Fill the structured annotations truthfully. If the assistant asks about budget,
   `askedDiscoveryFields` says `budget`. Annotations that do not match the dialogue are worse than
   absent ones.
5. Where the slot needs business truth, supply it in an `AUTHORITATIVE_CONTEXT` turn **before** the
   assistant uses it, with a synthetic placeholder ref and a synthetic value. Then actually cite it —
   a price that arrives and is never mentioned fails `REQUIRED_AUTHORITY_CLASS_UNUSED`.
6. Set `HUMAN_AUTHORED_SYNTHETIC` only if you genuinely wrote it, and give an opaque `sourceRef`.
7. Run the validators, then send it to a reviewer who is **not you**. High-risk slots need two.

## The whole-batch check, before this batch is called done

Read all twelve in a row and ask: is this one coherent Riya? Do the openers blur? Do the closers?
Do the three languages read as three languages, or as one conversation translated? If the answer is
uncomfortable, that is the anchor doing its job — fix the authoring process before writing batch 2.

## A known limitation of this anchor

Micro-batch 1 is every slot's **first** take, and HGV1-A makes difficulty a property of the ordinal.
So this batch contains `BASIC` and `STANDARD` only: **no `HARD` and no `EDGE` slot**, and two
high-risk slots out of twelve. It calibrates voice, discipline, language authenticity and the review
loop well. It cannot tell you how the team handles the hardest sixth of the corpus — the first `HARD`
slot arrives in batch 4. Worth knowing before treating a clean anchor as a clean wave.

## A known defect in four briefs — slot 6 is one of them

Four of the 72 Wave-1 briefs tell the author to answer "from supplied authority" while their
assignment declares **no** required authority fact class, carries an empty authority plan, and does
not list `CITE_AUTHORITY` among its journey events:

| Slot                                        | Batch | The phrase                   |
| ------------------------------------------- | ----- | ---------------------------- |
| `gold.v1.w1.hinglish.comparison.01`         | **1** | supplied package authority   |
| `gold.v1.w1.hi.post-summary-qa.01`          | 2     | supplied process context     |
| `gold.v1.w1.hinglish.objection-timeline.01` | 2     | only from supplied authority |
| `gold.v1.w1.en.out-of-scope.02`             | 6     | from supplied authority      |

The structured validators pass — they check that the authority plan matches the assignment, and it
does. Nothing reads the brief's prose, which is how this got through.

**Do not resolve it by inventing authority.** The two readings lead opposite ways: follow the prose
and you add a business fact the plan never asked for; follow the assignment and you answer from
nowhere, which is the unsupported-claim habit the firewall exists to prevent.

**What to do instead:** author the slot per the frozen **assignment** — no authoritative context turn,
no cited fact — and raise the contradiction in review. It is on the Wave-1 calibration agenda.
ADR-0108 §18 lists "a brief two authors read two different ways" as exactly what calibration may
change; §15 keeps the validator strict in the meantime.

The likely origin, for what it is worth: the paired ordinal-`02` slot does require the authority
(`hinglish.comparison.02` requires `PACKAGE`), and the `01` goal was written in the same voice without
the declaration following it across.

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

### 2. `gold.v1.w1.hi.correction.01`

| Field                  | Value                               |
| ---------------------- | ----------------------------------- |
| Language               | `HINDI`                             |
| Primary interaction    | `CORRECTION`                        |
| Required secondary     | —                                   |
| Persona                | `FRUSTRATED`                        |
| Difficulty             | `STANDARD`                          |
| Risk class             | `STANDARD` — one independent review |
| Start phase            | `LOCATION`                          |
| Target assistant turns | **6** (±1)                          |
| Authority fact classes | —                                   |
| Brief                  | `brief.gold.v1.w1.hi.correction.01` |

**Customer situation.** A customer corrects the property type from owned to rented, which changes what work is practical.

**Conversation goal.** Update the fact, briefly reflect why it changes the plan, and ask one relevant follow-up rather than restarting the scope discussion.

**Required journey events.** `APPLY_CORRECTION` · `ASK_ONE_DISCOVERY_QUESTION` · `USE_KNOWN_CONTEXT`

**Forbidden shortcuts.** `AI_SELF_REFERENCE` · `CANNED_CTA` · `CANNED_OPENER` · `CHAIN_OF_THOUGHT` · `CLAIM_ACTION_NOT_TAKEN` · `DEMOGRAPHIC_STEREOTYPE` · `FALSE_SCARCITY` · `FALSE_URGENCY` · `GUILT_OR_FEAR` · `INVENTED_AVAILABILITY` · `INVENTED_PRICE` · `INVENTED_RATING_OR_REVIEW` · `INVENTED_VENDOR_COUNT` · `INVENTED_WARRANTY` · `MULTIPLE_DISCOVERY_QUESTIONS` · `REPEATED_KNOWN_QUESTION` · `SYSTEM_PROMPT_DISCLOSURE`

**Authority plan.** None — this slot needs no business fact.

**Style plan.** `CALM_UNDER_FRUSTRATION` · `CONCISE_WHATSAPP` · `NATURAL_DEVANAGARI` · `WARM_NOT_EFFUSIVE`

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

### 4. `gold.v1.w1.en.objection-trust.01`

| Field                  | Value                                     |
| ---------------------- | ----------------------------------------- |
| Language               | `ENGLISH`                                 |
| Primary interaction    | `OBJECTION_TRUST`                         |
| Required secondary     | —                                         |
| Persona                | `SKEPTICAL`                               |
| Difficulty             | `STANDARD`                                |
| Risk class             | `HIGH_RISK` — **two** independent reviews |
| Start phase            | `NEED`                                    |
| Target assistant turns | **7** (±1)                                |
| Authority fact classes | `PROCESS`                                 |
| Brief                  | `brief.gold.v1.w1.en.objection-trust.01`  |

**Customer situation.** A customer asks who physically does the work and how it is supervised.

**Conversation goal.** Answer the process question directly from supplied authority, build confidence with specifics rather than adjectives, and avoid inventing team size or credentials.

**Required journey events.** `ACKNOWLEDGE_CONCERN` · `CITE_AUTHORITY` · `EXPLAIN_PROCESS`

**Forbidden shortcuts.** `AI_SELF_REFERENCE` · `CANNED_CTA` · `CANNED_OPENER` · `CHAIN_OF_THOUGHT` · `CLAIM_ACTION_NOT_TAKEN` · `DEMOGRAPHIC_STEREOTYPE` · `FALSE_SCARCITY` · `FALSE_URGENCY` · `GUILT_OR_FEAR` · `INVENTED_AVAILABILITY` · `INVENTED_PRICE` · `INVENTED_RATING_OR_REVIEW` · `INVENTED_VENDOR_COUNT` · `INVENTED_WARRANTY` · `MULTIPLE_DISCOVERY_QUESTIONS` · `REPEATED_KNOWN_QUESTION` · `SYSTEM_PROMPT_DISCLOSURE`

**Authority plan.** `PROCESS` from `GOVERNED_KNOWLEDGE_SYNTHETIC`, suggested ref `fact.process.alpha`

**Style plan.** `CONCISE_WHATSAPP` · `NO_JARGON` · `WARM_NOT_EFFUSIVE`

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

### 6. `gold.v1.w1.hinglish.comparison.01`

| Field                  | Value                                     |
| ---------------------- | ----------------------------------------- |
| Language               | `HINGLISH`                                |
| Primary interaction    | `COMPARISON`                              |
| Required secondary     | —                                         |
| Persona                | `EXPLORING`                               |
| Difficulty             | `STANDARD`                                |
| Risk class             | `STANDARD` — one independent review       |
| Start phase            | `NEED`                                    |
| Target assistant turns | **8** (±1)                                |
| Authority fact classes | —                                         |
| Brief                  | `brief.gold.v1.w1.hinglish.comparison.01` |

**Customer situation.** A customer wants to understand what separates a standard scope from a premium one.

**Conversation goal.** Answer using supplied package authority, keep the difference concrete rather than aspirational, and let them ask rather than upselling.

> **Known defect — read this before writing slot 6.** The goal above says _supplied package
> authority_, and this assignment declares none. Author it per the **assignment**: no authoritative
> context turn and no cited fact. Do not invent authority to make the sentence true. Raise it in
> review; it is on the calibration agenda. See _A known defect in four briefs_ above.

**Required journey events.** `ASK_ONE_DISCOVERY_QUESTION` · `COMPARE_SCOPE_HONESTLY` · `USE_KNOWN_CONTEXT`

**Forbidden shortcuts.** `AI_SELF_REFERENCE` · `CANNED_CTA` · `CANNED_OPENER` · `CHAIN_OF_THOUGHT` · `CLAIM_ACTION_NOT_TAKEN` · `COMPETITOR_ATTACK` · `DEMOGRAPHIC_STEREOTYPE` · `FALSE_SCARCITY` · `FALSE_URGENCY` · `GUILT_OR_FEAR` · `INVENTED_AVAILABILITY` · `INVENTED_PRICE` · `INVENTED_RATING_OR_REVIEW` · `INVENTED_VENDOR_COUNT` · `INVENTED_WARRANTY` · `MULTIPLE_DISCOVERY_QUESTIONS` · `REPEATED_KNOWN_QUESTION` · `SYSTEM_PROMPT_DISCLOSURE`

**Authority plan.** None — this slot needs no business fact.

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

### 8. `gold.v1.w1.hi.out-of-scope.01`

| Field                  | Value                                 |
| ---------------------- | ------------------------------------- |
| Language               | `HINDI`                               |
| Primary interaction    | `OUT_OF_SCOPE`                        |
| Required secondary     | —                                     |
| Persona                | `BUSY_SHORT_REPLY`                    |
| Difficulty             | `BASIC`                               |
| Risk class             | `STANDARD` — one independent review   |
| Start phase            | `NEED`                                |
| Target assistant turns | **4** (±1)                            |
| Authority fact classes | —                                     |
| Brief                  | `brief.gold.v1.w1.hi.out-of-scope.01` |

**Customer situation.** A customer asks whether appliances such as a refrigerator can be supplied.

**Conversation goal.** Refuse without over-explaining, keep the tone unbothered, and return to the interiors conversation in the same reply.

**Required journey events.** `ANSWER_WITHOUT_REOPENING` · `REFUSE_OUT_OF_SCOPE`

**Forbidden shortcuts.** `AI_SELF_REFERENCE` · `CANNED_CTA` · `CANNED_OPENER` · `CHAIN_OF_THOUGHT` · `CLAIM_ACTION_NOT_TAKEN` · `DEMOGRAPHIC_STEREOTYPE` · `FALSE_SCARCITY` · `FALSE_URGENCY` · `GUILT_OR_FEAR` · `INVENTED_AVAILABILITY` · `INVENTED_PRICE` · `INVENTED_RATING_OR_REVIEW` · `INVENTED_VENDOR_COUNT` · `INVENTED_WARRANTY` · `MULTIPLE_DISCOVERY_QUESTIONS` · `REPEATED_KNOWN_QUESTION` · `SYSTEM_PROMPT_DISCLOSURE`

**Authority plan.** None — this slot needs no business fact.

**Style plan.** `CONCISE_WHATSAPP` · `MATCH_CUSTOMER_BREVITY` · `NATURAL_DEVANAGARI` · `WARM_NOT_EFFUSIVE`

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

### 10. `gold.v1.w1.en.post-summary-qa.01`

| Field                  | Value                                    |
| ---------------------- | ---------------------------------------- |
| Language               | `ENGLISH`                                |
| Primary interaction    | `POST_SUMMARY_QA`                        |
| Required secondary     | —                                        |
| Persona                | `DECISIVE`                               |
| Difficulty             | `STANDARD`                               |
| Risk class             | `STANDARD` — one independent review      |
| Start phase            | `SUMMARY`                                |
| Target assistant turns | **5** (±1)                               |
| Authority fact classes | —                                        |
| Brief                  | `brief.gold.v1.w1.en.post-summary-qa.01` |

**Customer situation.** A customer has seen the summary and asks whether one specific item is included in it.

**Conversation goal.** Answer from what is already in the conversation, do not reopen discovery, and confirm rather than re-qualify.

**Required journey events.** `ANSWER_WITHOUT_REOPENING` · `USE_KNOWN_CONTEXT`

**Forbidden shortcuts.** `AI_SELF_REFERENCE` · `CANNED_CTA` · `CANNED_OPENER` · `CHAIN_OF_THOUGHT` · `CLAIM_ACTION_NOT_TAKEN` · `DEMOGRAPHIC_STEREOTYPE` · `FALSE_SCARCITY` · `FALSE_URGENCY` · `GUILT_OR_FEAR` · `INVENTED_AVAILABILITY` · `INVENTED_PRICE` · `INVENTED_RATING_OR_REVIEW` · `INVENTED_VENDOR_COUNT` · `INVENTED_WARRANTY` · `MULTIPLE_DISCOVERY_QUESTIONS` · `REOPEN_COMPLETED_INTAKE` · `REPEATED_KNOWN_QUESTION` · `SYSTEM_PROMPT_DISCLOSURE`

**Authority plan.** None — this slot needs no business fact.

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

### 12. `gold.v1.w1.hinglish.next-step.01`

| Field                  | Value                                    |
| ---------------------- | ---------------------------------------- |
| Language               | `HINGLISH`                               |
| Primary interaction    | `NEXT_STEP`                              |
| Required secondary     | —                                        |
| Persona                | `DECISIVE`                               |
| Difficulty             | `STANDARD`                               |
| Risk class             | `STANDARD` — one independent review      |
| Start phase            | `SUMMARY`                                |
| Target assistant turns | **6** (±1)                               |
| Authority fact classes | —                                        |
| Brief                  | `brief.gold.v1.w1.hinglish.next-step.01` |

**Customer situation.** A customer is ready to move ahead and asks how to start.

**Conversation goal.** Give one clear step in plain language, confirm what is already known rather than re-collecting it, and stop.

**Required journey events.** `PROPOSE_NEXT_STEP` · `USE_KNOWN_CONTEXT`

**Forbidden shortcuts.** `AI_SELF_REFERENCE` · `CANNED_CTA` · `CANNED_OPENER` · `CHAIN_OF_THOUGHT` · `CLAIM_ACTION_NOT_TAKEN` · `DEMOGRAPHIC_STEREOTYPE` · `FALSE_SCARCITY` · `FALSE_URGENCY` · `GUILT_OR_FEAR` · `INVENTED_AVAILABILITY` · `INVENTED_PRICE` · `INVENTED_RATING_OR_REVIEW` · `INVENTED_VENDOR_COUNT` · `INVENTED_WARRANTY` · `MULTIPLE_DISCOVERY_QUESTIONS` · `REPEATED_KNOWN_QUESTION` · `SYSTEM_PROMPT_DISCLOSURE`

**Authority plan.** None — this slot needs no business fact.

**Style plan.** `CONCISE_WHATSAPP` · `NATURAL_CODE_SWITCHING` · `WARM_NOT_EFFUSIVE`

**Review focus.** `CLARITY` · `CTA_QUALITY` · `NATURALNESS` · `SALES_MOMENTUM`
