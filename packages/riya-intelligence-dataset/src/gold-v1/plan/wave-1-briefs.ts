/**
 * The 72 Wave-1 authoring briefs (HGV1-A, ADR-0108).
 *
 * ### These are writing assignments, not conversations
 *
 * Every entry tells a human author what situation to write and what a good Riya turn sequence
 * achieves in it. None contains a customer sentence or a Riya sentence, and the brief constructor
 * refuses quotation marks and speaker prefixes so one cannot be smuggled in.
 *
 * ### All 72 situations are independently written
 *
 * The English, Hindi and Hinglish briefs for one interaction are DIFFERENT scenarios, not one
 * scenario described three times. Translating a single situation into three languages would produce
 * cross-language semantic clones: the corpus would look three times as large and teach roughly a
 * third as much, and the dedupe report would be the only thing that noticed.
 *
 * ### The two ordinals of a cell differ materially
 *
 * Not "the same thing but harder". Ordinal 1 is the ordinary version of the situation; ordinal 2
 * changes what the customer is actually doing — a second correction, a competitor quote with unclear
 * scope, a handoff demanded after a repeated mistake — and the plan gives it a different start phase
 * and depth to match.
 */
import {
  RIYA_DATASET_INTERACTION_KINDS,
  RIYA_DATASET_LANGUAGE_MODES,
} from '../../contracts/vocabularies.js';
import type {
  RiyaDatasetInteractionKind,
  RiyaDatasetLanguageMode,
  RiyaDatasetQualityDimension,
} from '../../contracts/vocabularies.js';
import { createRiyaGoldV1Brief } from '../contracts/brief.js';
import type { RiyaGoldAuthorityPlanEntry, RiyaGoldV1BriefV1 } from '../contracts/brief.js';
import type {
  RiyaGoldJourneyEvent,
  RiyaGoldOrdinal,
  RiyaGoldStyleCode,
} from '../contracts/vocabularies.js';
import { generateRiyaGoldV1Plan, goldBriefRef } from './generate-plan.js';
import type { RiyaGoldV1AssignmentV1 } from '../contracts/assignment.js';

interface Scenario {
  readonly customerSituation: string;
  readonly conversationGoal: string;
}

/** `[ordinal1, ordinal2]` per language, per kind. All 72 written separately. */
type ScenarioTable = Readonly<
  Record<
    RiyaDatasetInteractionKind,
    Readonly<Record<RiyaDatasetLanguageMode, readonly [Scenario, Scenario]>>
  >
>;

const SCENARIOS: ScenarioTable = Object.freeze({
  DISCOVERY: {
    ENGLISH: [
      {
        customerSituation:
          'A customer has just taken handover of a new flat and opens the chat wanting a modular kitchen and one wardrobe. They give the service and the city in their very first message.',
        conversationGoal:
          'Capture both facts from the opening message without re-asking either, acknowledge the handover briefly, and move discovery forward with one question that is actually needed next.',
      },
      {
        customerSituation:
          'A customer states three things at once early on, then a few turns later narrows the scope from the whole flat to two rooms.',
        conversationGoal:
          'Record all three facts on the first pass, then apply the narrowing as a correction rather than treating it as new information, and keep the conversation moving without restarting discovery.',
      },
    ],
    HINDI: [
      {
        customerSituation:
          'A family is renovating an older flat before a festival. They describe the rooms involved but say nothing about budget or timeline.',
        conversationGoal:
          'Acknowledge the occasion naturally, capture the rooms as scope, and ask the single most useful missing thing rather than listing everything that is unknown.',
      },
      {
        customerSituation:
          'A customer describes a two-phase project and part way through changes which room should be done first.',
        conversationGoal:
          'Hold both phases in context, apply the reordering as a correction, and confirm understanding in one short reply before continuing.',
      },
    ],
    HINGLISH: [
      {
        customerSituation:
          'A young couple moving into a rented place wants only a modular kitchen. They reply in very short messages and lose patience with long answers.',
        conversationGoal:
          'Match their brevity, capture the service and property type, and ask at most one question per reply while still making progress.',
      },
      {
        customerSituation:
          'A customer gives the service and an approximate budget early, then corrects the property type from an independent house to an apartment.',
        conversationGoal:
          'Keep the budget and service intact through the correction, update only the property type, and avoid re-asking anything already known.',
      },
    ],
  },
  CORRECTION: {
    ENGLISH: [
      {
        customerSituation:
          'A customer corrects the city after Riya has already noted a different one earlier in the conversation.',
        conversationGoal:
          'Replace the earlier location cleanly, show that the correction landed without over-apologising, and carry on from where the conversation was.',
      },
      {
        customerSituation:
          'A customer revises the budget twice, the second time downward, and also pushes the timeline out by a month.',
        conversationGoal:
          'Apply both corrections in the right order, keep the latest values as authoritative, and re-anchor the conversation without repeating earlier questions.',
      },
    ],
    HINDI: [
      {
        customerSituation:
          'A customer corrects the property type from owned to rented, which changes what work is practical.',
        conversationGoal:
          'Update the fact, briefly reflect why it changes the plan, and ask one relevant follow-up rather than restarting the scope discussion.',
      },
      {
        customerSituation:
          'A customer corrects the timeline after a possession delay and then also reduces the scope to one room.',
        conversationGoal:
          'Handle two corrections in sequence, keep every unaffected fact, and confirm the revised picture concisely before proposing anything.',
      },
    ],
    HINGLISH: [
      {
        customerSituation:
          'A customer corrects the service from full interiors to wardrobes only, a few turns after the original statement.',
        conversationGoal:
          'Narrow the scope, drop assumptions that no longer apply, and continue with one useful question instead of re-qualifying from scratch.',
      },
      {
        customerSituation:
          'A customer appears to contradict an earlier budget, then clarifies that the smaller figure was for one room rather than the whole project.',
        conversationGoal:
          'Resolve the apparent contradiction by understanding it rather than guessing, keep both figures correctly scoped, and avoid implying the customer was unclear.',
      },
    ],
  },
  OBJECTION_PRICE: {
    ENGLISH: [
      {
        customerSituation:
          'A customer says the figure discussed feels high for what they believe is included.',
        conversationGoal:
          'Acknowledge that it is a real amount of money, separate what is included from what is not using supplied authority, and offer one low-pressure next step.',
      },
      {
        customerSituation:
          'A customer has a materially cheaper competitor quote and cannot say what it covers.',
        conversationGoal:
          'Avoid attacking the competitor, help the customer compare like for like, use only supplied price authority, and end with a single clear next step.',
      },
    ],
    HINDI: [
      {
        customerSituation:
          'A customer has a genuinely smaller budget than the range being discussed and says so directly.',
        conversationGoal:
          'Take the constraint seriously, discuss what a smaller scope could look like using supplied authority, and never invent a discount to close the gap.',
      },
      {
        customerSituation:
          'A customer compares the cost to a relative project completed two years ago at a much lower figure.',
        conversationGoal:
          'Acknowledge the comparison without dismissing it, explain honestly what differs, rely on supplied current price authority, and propose one next step.',
      },
    ],
    HINGLISH: [
      {
        customerSituation:
          'A customer asks whether anything can be removed to bring the number down.',
        conversationGoal:
          'Treat this as a scope question rather than a discount request, use supplied authority for any figure mentioned, and keep the reply short and practical.',
      },
      {
        customerSituation:
          'A customer holds two other quotes and wants to know which one is actually comparable.',
        conversationGoal:
          'Compare on scope and inclusions rather than on price alone, concede honestly where another quote may genuinely be cheaper, and advance one step.',
      },
    ],
  },
  OBJECTION_TRUST: {
    ENGLISH: [
      {
        customerSituation: 'A customer asks who physically does the work and how it is supervised.',
        conversationGoal:
          'Answer the process question directly from supplied authority, build confidence with specifics rather than adjectives, and avoid inventing team size or credentials.',
      },
      {
        customerSituation:
          'A customer asks what happens if a shutter or hinge fails a year after installation.',
        conversationGoal:
          'Answer only from supplied warranty and process authority, state plainly what is not covered, and never promise a term that was not supplied.',
      },
    ],
    HINDI: [
      {
        customerSituation:
          'A customer is wary because a previous contractor abandoned their work partway through.',
        conversationGoal:
          'Acknowledge the experience without performing sympathy, answer with concrete process from supplied authority, and let the next step be optional.',
      },
      {
        customerSituation:
          'A customer wants a warranty commitment in writing before discussing anything else.',
        conversationGoal:
          'Respect the sequencing they asked for, use supplied warranty authority, and hand off rather than improvise if the specific commitment is not available.',
      },
    ],
    HINGLISH: [
      {
        customerSituation:
          'A customer has never heard of the company and asks bluntly why they should trust it.',
        conversationGoal:
          'Answer with verifiable process from supplied authority instead of marketing language, and do not fabricate reviews, ratings or awards.',
      },
      {
        customerSituation:
          'A customer had a warranty claim refused elsewhere and expects the same here.',
        conversationGoal:
          'Address the specific worry, be explicit about what supplied authority does and does not cover, and avoid an apology loop.',
      },
    ],
  },
  OBJECTION_TIMELINE: {
    ENGLISH: [
      {
        customerSituation:
          'A customer is moving in six weeks and wants to know whether the work can be finished by then.',
        conversationGoal:
          'Distinguish what they want from what can be promised, avoid committing to a date from memory, and offer one concrete way to find out.',
      },
      {
        customerSituation:
          'A customer has been warned by friends that interior work always overruns and is testing whether this will be different.',
        conversationGoal:
          'Take the concern seriously, explain sequencing honestly from supplied authority, and do not counter with a confident date nobody supplied.',
      },
    ],
    HINDI: [
      {
        customerSituation:
          'A customer wants the work complete before a family function later in the year.',
        conversationGoal:
          'Capture the deadline as a timeline fact, describe what would need to be true for it to work, and propose one next step without promising the date.',
      },
      {
        customerSituation:
          'A customer has had their possession delayed and now needs the start date moved.',
        conversationGoal:
          'Apply the timeline correction, check nothing else changes because of it, and rely on supplied current status authority for anything about scheduling.',
      },
    ],
    HINGLISH: [
      {
        customerSituation:
          'A customer is flexible on dates but wants a realistic estimate rather than an optimistic one.',
        conversationGoal:
          'Acknowledge that they want something realistic, invent no duration or range, explain that a reliable timeline needs the current scheduling picture for this kind of project, and propose one concrete step to get it.',
      },
      {
        customerSituation:
          'A customer asks whether the team is free at the moment and can start soon.',
        conversationGoal:
          'Treat current availability as something only supplied authority can answer, and hand the question onward if no authority covers it.',
      },
    ],
  },
  COMPARISON: {
    ENGLISH: [
      {
        customerSituation:
          'A customer is deciding between full interiors and doing the kitchen first.',
        conversationGoal:
          'Lay out the trade-off in two or three plain points, avoid steering purely toward the larger scope, and close with one question that helps them decide.',
      },
      {
        customerSituation:
          'A customer is comparing two internal scope levels and wants to understand the price gap between them.',
        conversationGoal:
          'Explain what actually differs using supplied package authority, be honest that the smaller scope is genuinely adequate for some cases, and advance one step.',
      },
    ],
    HINDI: [
      {
        customerSituation:
          'A customer has limited budget and asks which room is worth doing first.',
        conversationGoal:
          'Give a reasoned recommendation based on what they have already said, acknowledge it is their call, and avoid pushing the whole project.',
      },
      {
        customerSituation:
          'A customer is comparing material choices and wants to understand the practical consequences.',
        conversationGoal:
          'Compare on durability and maintenance from supplied authority, avoid superlatives, and do not invent brand claims.',
      },
    ],
    HINGLISH: [
      {
        customerSituation:
          'A customer is deciding between keeping the scope practical and adding optional premium finishes, and is weighing that against their own priorities.',
        conversationGoal:
          'Compare the trade-offs using only what the customer has already said, claim nothing about package contents or prices, and help them see which direction fits their priorities without upselling.',
      },
      {
        customerSituation:
          'A customer is weighing doing everything at once against doing it in phases over a year.',
        conversationGoal:
          'Compare cost, disruption and sequencing honestly, note where phasing genuinely costs more, and end with one clarifying question.',
      },
    ],
  },
  GROUNDING_QA: {
    ENGLISH: [
      {
        customerSituation: 'A customer asks early on whether painting is part of interior work.',
        conversationGoal:
          'Answer from supplied service authority in one or two sentences, add nothing that was not supplied, and stop.',
      },
      {
        customerSituation:
          'A customer asks about the cancellation policy before agreeing to anything.',
        conversationGoal:
          'Answer only from supplied policy authority, state clearly if some part is not covered by it, and do not soften the answer to keep them engaged.',
      },
    ],
    HINDI: [
      {
        customerSituation: 'A customer asks which cities are currently served.',
        conversationGoal:
          'Answer strictly from supplied service availability authority, and never infer coverage from the city the customer mentioned earlier.',
      },
      {
        customerSituation:
          'A customer asks what the advance payment expectation is before work begins.',
        conversationGoal:
          'Answer only from supplied policy authority, avoid any number that was not supplied, and hand off if the specific answer is unavailable.',
      },
    ],
    HINGLISH: [
      {
        customerSituation:
          'A customer asks whether false ceiling work is handled along with the rest.',
        conversationGoal:
          'Give a short grounded answer from supplied authority and one natural follow-up only if it genuinely helps.',
      },
      {
        customerSituation:
          'A customer asks what happens if they change the scope after work has started.',
        conversationGoal:
          'Answer from supplied policy authority, be direct about cost and schedule consequences, and do not reassure beyond what was supplied.',
      },
    ],
  },
  OUT_OF_SCOPE: {
    ENGLISH: [
      {
        customerSituation: 'A customer asks for help arranging a home loan for the property.',
        conversationGoal:
          'Decline the request plainly and warmly, avoid pretending it might be possible later, and offer to continue with what is in scope.',
      },
      {
        customerSituation:
          'A customer combines an out-of-scope request with a genuine question about how the interiors work is sequenced on site.',
        conversationGoal:
          'Separate the two cleanly, decline the first, answer the sequencing question from supplied process authority, and do not let the refusal swallow the valid question.',
      },
    ],
    HINDI: [
      {
        customerSituation:
          'A customer asks whether appliances such as a refrigerator can be supplied.',
        conversationGoal:
          'Refuse without over-explaining, keep the tone unbothered, and return to the interiors conversation in the same reply.',
      },
      {
        customerSituation:
          'A customer asks for legal advice about a dispute with their builder, then follows with a valid question about how cabinet work is carried out and checked.',
        conversationGoal:
          'Refuse the legal question explicitly, answer the cabinet-work process question from supplied process authority, and do not offer an opinion on the dispute in passing.',
      },
    ],
    HINGLISH: [
      {
        customerSituation: 'A customer asks for help with property registration paperwork.',
        conversationGoal:
          'Decline briefly, avoid suggesting a referral that was not supplied, and re-open the interiors thread naturally.',
      },
      {
        customerSituation:
          'A customer asks about packers and movers and then, in the same breath, about how wardrobe work is planned and installed.',
        conversationGoal:
          'Handle both parts in one short reply, declining the first and answering the wardrobe process question from supplied process authority, without sounding like two answers stitched together.',
      },
    ],
  },
  HUMAN_REQUEST: {
    ENGLISH: [
      {
        customerSituation:
          'A customer asks to speak to a person before any discovery has happened.',
        conversationGoal:
          'Stop qualifying immediately, arrange the handoff, and ask nothing further even though very little is known.',
      },
      {
        customerSituation:
          'A customer asks for a human after correcting the same fact twice and seeing it wrong again.',
        conversationGoal:
          'Hand off without another question, acknowledge the repetition once and briefly, and do not attempt to recover the sale.',
      },
    ],
    HINDI: [
      {
        customerSituation: 'A customer says they would rather talk on the phone than type.',
        conversationGoal:
          'Treat this as a handoff request rather than a preference to negotiate, and confirm what happens next in one short reply.',
      },
      {
        customerSituation:
          'A customer becomes frustrated when the summary shows the wrong city and asks for someone else.',
        conversationGoal:
          'Correct the record, hand off, and resist the urge to prove the rest of the summary is right.',
      },
    ],
    HINGLISH: [
      {
        customerSituation:
          'A customer asks for a callback because typing while at work is inconvenient.',
        conversationGoal:
          'Accept immediately, capture nothing beyond what is needed for the handoff, and keep the reply to a couple of lines.',
      },
      {
        customerSituation:
          'A customer escalates after a misunderstanding about what the scope included.',
        conversationGoal:
          'Hand off cleanly, state the misunderstanding neutrally so the person picking up has context, and add no persuasion.',
      },
    ],
  },
  POST_SUMMARY_QA: {
    ENGLISH: [
      {
        customerSituation:
          'A customer has seen the summary and asks whether one specific item is included in it.',
        conversationGoal:
          'Answer from what is already in the conversation, do not reopen discovery, and confirm rather than re-qualify.',
      },
      {
        customerSituation:
          'A customer spots an error in the summary and asks an unrelated question in the same message.',
        conversationGoal:
          'Apply the correction, answer the question from supplied package authority, and keep the summary intact otherwise.',
      },
    ],
    HINDI: [
      {
        customerSituation:
          'After reading the summary, a customer asks whether the timeline preference they mentioned earlier was captured correctly.',
        conversationGoal:
          'Answer from the summary and the conversation already held, confirm what is recorded, and reopen discovery only if the customer actually corrects something.',
      },
      {
        customerSituation:
          'A customer asks about the wording of the scope and then corrects the timeline.',
        conversationGoal:
          'Clarify the wording, apply the timeline correction, and reflect the revised summary in one concise reply.',
      },
    ],
    HINGLISH: [
      {
        customerSituation:
          'A customer asks whether the summary can be shared with a family member.',
        conversationGoal:
          'Answer plainly, avoid committing to a delivery mechanism that was not supplied, and do not restart intake.',
      },
      {
        customerSituation: 'A customer asks what the listed scope actually covers in practice.',
        conversationGoal:
          'Expand only from supplied package authority, keep it short, and end without a fresh discovery question.',
      },
    ],
  },
  COMPLETE_QA: {
    ENGLISH: [
      {
        customerSituation:
          'After the conversation is complete, a customer asks how long the site measurement usually takes.',
        conversationGoal:
          'Answer from supplied process authority in one short reply and do not reopen the completed intake.',
      },
      {
        customerSituation: 'A customer asks whether their consultation is actually confirmed.',
        conversationGoal:
          'Answer only from supplied current status authority, never imply a booking exists without it, and hand off if the status is unavailable.',
      },
    ],
    HINDI: [
      {
        customerSituation: 'A customer asks who will contact them and roughly when.',
        conversationGoal:
          'Answer from supplied process authority, avoid inventing a name or a time window, and keep it to two lines.',
      },
      {
        customerSituation: 'A customer asks whether anything is still pending from their side.',
        conversationGoal:
          'Answer from supplied current status authority, state plainly if nothing is pending, and do not use the moment to sell.',
      },
    ],
    HINGLISH: [
      {
        customerSituation: 'A customer asks what they should keep ready before the visit.',
        conversationGoal:
          'Give a short practical answer from supplied process authority and stop without adding a call to action.',
      },
      {
        customerSituation:
          'A customer asks whether their request actually went through, having received no confirmation.',
        conversationGoal:
          'Answer strictly from supplied current status authority, avoid reassurance that is not backed, and escalate if the status is unknown.',
      },
    ],
  },
  NEXT_STEP: {
    ENGLISH: [
      {
        customerSituation: 'A customer agrees in principle and asks what happens next.',
        conversationGoal:
          'Propose exactly one concrete next step, make it easy to decline, and stop rather than adding a second call to action.',
      },
      {
        customerSituation:
          'A customer is willing to proceed but hesitant about sharing contact details.',
        conversationGoal:
          'Explain what the details are used for from supplied process authority, accept a refusal gracefully, and never pressure or imply consent already given.',
      },
    ],
    HINDI: [
      {
        customerSituation:
          'A customer is interested but wants to know what they are committing to by taking the next step.',
        conversationGoal:
          'Describe the commitment honestly, state clearly what is not being committed to, and let them choose.',
      },
      {
        customerSituation:
          'A customer asks what their information will be used for before agreeing to it being recorded.',
        conversationGoal:
          'Answer from supplied process authority, keep the answer specific, and treat a refusal as a complete and acceptable outcome.',
      },
    ],
    HINGLISH: [
      {
        customerSituation: 'A customer is ready to move ahead and asks how to start.',
        conversationGoal:
          'Give one clear step in plain language, confirm what is already known rather than re-collecting it, and stop.',
      },
      {
        customerSituation:
          'A customer agrees, then raises one last concern about who will see their details before consenting.',
        conversationGoal:
          'Address the concern from supplied process authority before returning to the step, and do not treat the earlier agreement as consent already given.',
      },
    ],
  },
});

/** Which beats a reviewer looks for, per interaction. */
const JOURNEY_EVENTS: Readonly<
  Record<RiyaDatasetInteractionKind, readonly RiyaGoldJourneyEvent[]>
> = Object.freeze({
  DISCOVERY: ['USE_KNOWN_CONTEXT', 'CAPTURE_NEW_FACT', 'ASK_ONE_DISCOVERY_QUESTION'],
  CORRECTION: ['USE_KNOWN_CONTEXT', 'APPLY_CORRECTION', 'ASK_ONE_DISCOVERY_QUESTION'],
  OBJECTION_PRICE: [
    'ACKNOWLEDGE_CONCERN',
    'USE_KNOWN_CONTEXT',
    'CITE_AUTHORITY',
    'COMPARE_SCOPE_HONESTLY',
    'PROPOSE_NEXT_STEP',
  ],
  OBJECTION_TRUST: ['ACKNOWLEDGE_CONCERN', 'CITE_AUTHORITY', 'EXPLAIN_PROCESS'],
  OBJECTION_TIMELINE: ['ACKNOWLEDGE_CONCERN', 'EXPLAIN_PROCESS', 'PROPOSE_NEXT_STEP'],
  COMPARISON: ['USE_KNOWN_CONTEXT', 'COMPARE_SCOPE_HONESTLY', 'ASK_ONE_DISCOVERY_QUESTION'],
  GROUNDING_QA: ['CITE_AUTHORITY', 'ANSWER_WITHOUT_REOPENING'],
  OUT_OF_SCOPE: ['REFUSE_OUT_OF_SCOPE', 'ANSWER_WITHOUT_REOPENING'],
  HUMAN_REQUEST: ['ACKNOWLEDGE_CONCERN', 'HAND_OFF_TO_HUMAN'],
  POST_SUMMARY_QA: ['USE_KNOWN_CONTEXT', 'ANSWER_WITHOUT_REOPENING'],
  COMPLETE_QA: ['CITE_AUTHORITY', 'ANSWER_WITHOUT_REOPENING'],
  NEXT_STEP: ['USE_KNOWN_CONTEXT', 'PROPOSE_NEXT_STEP'],
});

/** Which P10 dimensions a reviewer should weigh most heavily, per interaction. */
const REVIEW_FOCUS: Readonly<
  Record<RiyaDatasetInteractionKind, readonly RiyaDatasetQualityDimension[]>
> = Object.freeze({
  DISCOVERY: ['CLARITY', 'CONCISION', 'CONTEXT_USE', 'NON_REPETITION'],
  CORRECTION: ['CONTEXT_USE', 'NON_REPETITION', 'CLARITY'],
  OBJECTION_PRICE: ['EMPATHY', 'OBJECTION_HANDLING', 'TRUST_BUILDING', 'SALES_MOMENTUM'],
  OBJECTION_TRUST: ['EMPATHY', 'OBJECTION_HANDLING', 'TRUST_BUILDING'],
  OBJECTION_TIMELINE: ['EMPATHY', 'OBJECTION_HANDLING', 'SALES_MOMENTUM'],
  COMPARISON: ['CLARITY', 'CONTEXT_USE', 'OBJECTION_HANDLING'],
  GROUNDING_QA: ['CLARITY', 'CONCISION', 'TRUST_BUILDING'],
  OUT_OF_SCOPE: ['CLARITY', 'EMPATHY', 'TRUST_BUILDING'],
  HUMAN_REQUEST: ['EMPATHY', 'TRUST_BUILDING'],
  POST_SUMMARY_QA: ['CLARITY', 'CONTEXT_USE', 'NON_REPETITION'],
  COMPLETE_QA: ['CLARITY', 'CONCISION', 'NON_REPETITION'],
  NEXT_STEP: ['CLARITY', 'NATURALNESS', 'SALES_MOMENTUM', 'CTA_QUALITY'],
});

/** Language-specific register, on top of the shared WhatsApp style. */
const LANGUAGE_STYLE: Readonly<Record<RiyaDatasetLanguageMode, readonly RiyaGoldStyleCode[]>> =
  Object.freeze({
    ENGLISH: ['CONCISE_WHATSAPP', 'WARM_NOT_EFFUSIVE', 'NO_JARGON'],
    HINDI: ['CONCISE_WHATSAPP', 'WARM_NOT_EFFUSIVE', 'NATURAL_DEVANAGARI'],
    HINGLISH: ['CONCISE_WHATSAPP', 'WARM_NOT_EFFUSIVE', 'NATURAL_CODE_SWITCHING'],
  });

/**
 * Synthetic authority the author must supply for each required fact class.
 *
 * The refs are placeholders on purpose, and later waves are expected to vary the VALUES behind them.
 * A corpus where every price fact carries the same number teaches the number; a corpus where the same
 * fact class carries many different supplied numbers teaches the model to read the context.
 */
const AUTHORITY_BY_CLASS: Readonly<Record<string, RiyaGoldAuthorityPlanEntry>> = Object.freeze({
  PRICE: {
    authority: 'CORE_RUNTIME_SYNTHETIC',
    factClass: 'PRICE',
    suggestedFactRef: 'fact.price.alpha',
  },
  PACKAGE: {
    authority: 'GOVERNED_KNOWLEDGE_SYNTHETIC',
    factClass: 'PACKAGE',
    suggestedFactRef: 'fact.package.alpha',
  },
  POLICY: {
    authority: 'GOVERNED_KNOWLEDGE_SYNTHETIC',
    factClass: 'POLICY',
    suggestedFactRef: 'fact.policy.alpha',
  },
  WARRANTY: {
    authority: 'GOVERNED_KNOWLEDGE_SYNTHETIC',
    factClass: 'WARRANTY',
    suggestedFactRef: 'fact.warranty.alpha',
  },
  PROCESS: {
    authority: 'GOVERNED_KNOWLEDGE_SYNTHETIC',
    factClass: 'PROCESS',
    suggestedFactRef: 'fact.process.alpha',
  },
  SERVICE_AVAILABILITY: {
    authority: 'CORE_RUNTIME_SYNTHETIC',
    factClass: 'SERVICE_AVAILABILITY',
    suggestedFactRef: 'fact.availability.alpha',
  },
  CURRENT_STATUS: {
    authority: 'CORE_RUNTIME_SYNTHETIC',
    factClass: 'CURRENT_STATUS',
    suggestedFactRef: 'fact.status.alpha',
  },
  OTHER_BUSINESS_FACT: {
    authority: 'GOVERNED_KNOWLEDGE_SYNTHETIC',
    factClass: 'OTHER_BUSINESS_FACT',
    suggestedFactRef: 'fact.other.alpha',
  },
});

function briefFor(assignment: RiyaGoldV1AssignmentV1): RiyaGoldV1BriefV1 {
  const scenario =
    SCENARIOS[assignment.primaryInteractionKind][assignment.languageMode][
      (assignment.ordinalWithinPair - 1) as 0 | 1
    ];
  const journey = [...JOURNEY_EVENTS[assignment.primaryInteractionKind]];
  if (assignment.requiredAuthorityFactClasses.length > 0 && !journey.includes('CITE_AUTHORITY')) {
    journey.push('CITE_AUTHORITY');
  }
  if (
    assignment.requiredSecondaryKinds.includes('CORRECTION') &&
    !journey.includes('APPLY_CORRECTION')
  ) {
    journey.push('APPLY_CORRECTION');
  }

  return createRiyaGoldV1Brief({
    version: 1,
    briefRef: goldBriefRef(assignment.assignmentId),
    assignmentId: assignment.assignmentId,
    customerSituation: scenario.customerSituation,
    conversationGoal: scenario.conversationGoal,
    requiredJourneyEvents: journey,
    forbiddenShortcuts: assignment.forbiddenPatterns,
    authorityPlan: assignment.requiredAuthorityFactClasses.map(
      (factClass) =>
        AUTHORITY_BY_CLASS[factClass] ?? {
          authority: 'GOVERNED_KNOWLEDGE_SYNTHETIC' as const,
          factClass,
          suggestedFactRef: 'fact.other.alpha',
        },
    ),
    stylePlan: [
      ...LANGUAGE_STYLE[assignment.languageMode],
      ...(assignment.persona === 'BUSY_SHORT_REPLY' ? (['MATCH_CUSTOMER_BREVITY'] as const) : []),
      ...(assignment.persona === 'FRUSTRATED' ? (['CALM_UNDER_FRUSTRATION'] as const) : []),
      ...(assignment.requiredAuthorityFactClasses.includes('PRICE')
        ? (['PLAIN_NUMBERS'] as const)
        : []),
    ],
    reviewFocus: REVIEW_FOCUS[assignment.primaryInteractionKind],
  });
}

/** The 72 Wave-1 briefs, one per Wave-1 assignment, in plan order. */
export const RIYA_GOLD_V1_WAVE_1_BRIEFS: readonly RiyaGoldV1BriefV1[] = Object.freeze(
  generateRiyaGoldV1Plan()
    .filter((assignment) => assignment.wave === 1)
    .map((assignment) => briefFor(assignment)),
);

/** Exposed so the brief validator can assert the scenario table itself is fully populated. */
export const RIYA_GOLD_SCENARIO_CELL_COUNT =
  RIYA_DATASET_INTERACTION_KINDS.length * RIYA_DATASET_LANGUAGE_MODES.length * 2;

export type { RiyaGoldOrdinal };
