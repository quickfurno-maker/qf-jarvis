/**
 * The Riya quality golden corpus V1 — 72 synthetic fixtures (RWC-P10, ADR-0106 §20–§21).
 *
 * ### Why this subpath and not the root
 *
 * This is the ONLY file in the package that contains conversation text, and it is reachable only
 * through `@qf-jarvis/riya-quality-evaluation/testing`. Nothing on the production import path can
 * see a sentence. That separation is what lets the evaluator's own contracts stay honestly
 * content-free while a corpus still exists to run them against.
 *
 * ### Everything here is invented
 *
 * No real QuickFurno package, price list, lead, customer, vendor or transcript. No phone number, no
 * email, no address, no production URL. Business references are deliberately obvious placeholders —
 * `service.alpha`, `city.beta`, `property.apartment` — so that a fixture can never be mistaken for a
 * catalogue entry and a passing suite can never be read as a claim about a real offering.
 *
 * ### 3 languages x 12 interaction kinds x 2 cases
 *
 * Symmetric by construction. Hindi and Hinglish get the same twelve situations as English and the
 * same thresholds, because the alternative — a thinner corpus for the languages that are harder to
 * review — is exactly how a system ends up measurably good in English and quietly bad everywhere
 * else. A spec asserts 24/24/24, six per kind and two per language-and-kind pair.
 *
 * ### The two cases per kind are different failures, not two samples
 *
 * `DISCOVERY` is "several facts in one message" and "a fact already known must not be re-asked".
 * `OBJECTION_PRICE` is "this feels expensive" and "somebody quoted less". Duplicating a situation
 * would double its weight in a pass rate without adding coverage.
 */
import type { RiyaDiscoveryObservationV1 } from '@qf-jarvis/riya-conversation-evolution';
import type { RiyaConversationPhase } from '@qf-jarvis/riya-conversation-continuity';

import { createRiyaQualityScenario } from '../contracts/scenario.js';
import type {
  RiyaQualityExpectedObservation,
  RiyaQualityScenarioV1,
} from '../contracts/scenario.js';
import { RIYA_QUALITY_DISCOVERY_FIELDS } from '../contracts/vocabularies.js';
import type {
  RiyaQualityDimension,
  RiyaQualityDiscoveryField,
  RiyaQualityInteractionKind,
  RiyaQualityLanguageMode,
} from '../contracts/vocabularies.js';

/** The exact identity of this corpus. Bump on ANY fixture change — see the overfitting note in ADR-0106. */
export const RIYA_QUALITY_GOLDEN_FIXTURE_MANIFEST_ID = 'riya-quality-golden-v1';
export const RIYA_QUALITY_GOLDEN_FIXTURE_MANIFEST_VERSION = 1;
export const RIYA_QUALITY_GOLDEN_SUITE_ID = 'riya-quality-v1';
export const RIYA_QUALITY_GOLDEN_SUITE_VERSION = 1;

/** The id fragment each language mode contributes. */
const LANGUAGE_SLUG: Readonly<Record<RiyaQualityLanguageMode, string>> = Object.freeze({
  ENGLISH: 'en',
  HINDI: 'hi',
  HINGLISH: 'hinglish',
});

const ALL_FIELDS: readonly RiyaQualityDiscoveryField[] = RIYA_QUALITY_DISCOVERY_FIELDS;

/** What every fixture of one interaction kind shares. */
interface KindShape {
  readonly slug: string;
  readonly phase: RiyaConversationPhase;
  readonly maxReplyChars: number;
  readonly maxQuestions: number;
  readonly requiredCitation: boolean;
  readonly allowedContinuityPhasesAfter: readonly RiyaConversationPhase[];
  readonly passingPhaseAfter: RiyaConversationPhase;
  readonly requiredQualityDimensions: readonly RiyaQualityDimension[];
}

const KIND_SHAPES: Readonly<Record<RiyaQualityInteractionKind, KindShape>> = Object.freeze({
  DISCOVERY: {
    slug: 'discovery',
    phase: 'NEED',
    maxReplyChars: 480,
    maxQuestions: 2,
    requiredCitation: false,
    allowedContinuityPhasesAfter: ['NEED', 'LOCATION', 'PROJECT_DETAILS'],
    passingPhaseAfter: 'LOCATION',
    requiredQualityDimensions: [
      'CLARITY',
      'CONCISION',
      'NATURALNESS',
      'CONTEXT_USE',
      'NON_REPETITION',
    ],
  },
  CORRECTION: {
    slug: 'correction',
    phase: 'LOCATION',
    maxReplyChars: 420,
    maxQuestions: 1,
    requiredCitation: false,
    allowedContinuityPhasesAfter: ['LOCATION', 'PROJECT_DETAILS', 'BUDGET_TIMELINE'],
    passingPhaseAfter: 'PROJECT_DETAILS',
    requiredQualityDimensions: ['CLARITY', 'CONTEXT_USE', 'NON_REPETITION'],
  },
  OBJECTION_PRICE: {
    slug: 'objection-price',
    phase: 'BUDGET_TIMELINE',
    maxReplyChars: 560,
    maxQuestions: 1,
    requiredCitation: false,
    allowedContinuityPhasesAfter: ['BUDGET_TIMELINE', 'SUMMARY'],
    passingPhaseAfter: 'BUDGET_TIMELINE',
    requiredQualityDimensions: [
      'EMPATHY',
      'OBJECTION_HANDLING',
      'TRUST_BUILDING',
      'SALES_MOMENTUM',
    ],
  },
  OBJECTION_TRUST: {
    slug: 'objection-trust',
    phase: 'BUDGET_TIMELINE',
    maxReplyChars: 560,
    maxQuestions: 1,
    requiredCitation: false,
    allowedContinuityPhasesAfter: ['BUDGET_TIMELINE', 'SUMMARY'],
    passingPhaseAfter: 'BUDGET_TIMELINE',
    requiredQualityDimensions: ['EMPATHY', 'OBJECTION_HANDLING', 'TRUST_BUILDING'],
  },
  OBJECTION_TIMELINE: {
    slug: 'objection-timeline',
    phase: 'BUDGET_TIMELINE',
    maxReplyChars: 520,
    maxQuestions: 1,
    requiredCitation: false,
    allowedContinuityPhasesAfter: ['BUDGET_TIMELINE', 'SUMMARY'],
    passingPhaseAfter: 'BUDGET_TIMELINE',
    requiredQualityDimensions: ['EMPATHY', 'OBJECTION_HANDLING', 'SALES_MOMENTUM'],
  },
  COMPARISON: {
    slug: 'comparison',
    phase: 'NEED',
    maxReplyChars: 600,
    maxQuestions: 1,
    requiredCitation: false,
    allowedContinuityPhasesAfter: ['NEED', 'PROJECT_DETAILS'],
    passingPhaseAfter: 'NEED',
    requiredQualityDimensions: ['CLARITY', 'CONTEXT_USE', 'OBJECTION_HANDLING'],
  },
  GROUNDING_QA: {
    slug: 'grounding-qa',
    phase: 'NEED',
    maxReplyChars: 520,
    maxQuestions: 1,
    requiredCitation: true,
    allowedContinuityPhasesAfter: ['NEED', 'LOCATION', 'PROJECT_DETAILS'],
    passingPhaseAfter: 'NEED',
    requiredQualityDimensions: ['CLARITY', 'CONCISION', 'NATURALNESS', 'TRUST_BUILDING'],
  },
  OUT_OF_SCOPE: {
    slug: 'out-of-scope',
    phase: 'NEED',
    maxReplyChars: 380,
    maxQuestions: 1,
    requiredCitation: false,
    allowedContinuityPhasesAfter: ['NEED'],
    passingPhaseAfter: 'NEED',
    requiredQualityDimensions: ['CLARITY', 'EMPATHY', 'TRUST_BUILDING'],
  },
  HUMAN_REQUEST: {
    slug: 'human-request',
    phase: 'NEED',
    // The shortest allowance in the corpus, and ZERO questions. Somebody who asked for a person and
    // received another question has been ignored, and no amount of warmth in the wording fixes that.
    maxReplyChars: 320,
    maxQuestions: 0,
    requiredCitation: false,
    allowedContinuityPhasesAfter: ['NEED', 'LOCATION', 'BUDGET_TIMELINE', 'SUMMARY'],
    passingPhaseAfter: 'NEED',
    // No CTA dimension, deliberately: proposing a next step here would be pushing past a handover
    // request, so a corpus that rewarded momentum on this kind would be training the wrong reflex.
    requiredQualityDimensions: ['EMPATHY', 'TRUST_BUILDING'],
  },
  POST_SUMMARY_QA: {
    slug: 'post-summary-qa',
    phase: 'SUMMARY',
    maxReplyChars: 520,
    maxQuestions: 1,
    requiredCitation: true,
    allowedContinuityPhasesAfter: ['SUMMARY'],
    passingPhaseAfter: 'SUMMARY',
    requiredQualityDimensions: ['CLARITY', 'CONTEXT_USE', 'NON_REPETITION'],
  },
  COMPLETE_QA: {
    slug: 'complete-qa',
    phase: 'COMPLETE',
    maxReplyChars: 460,
    maxQuestions: 1,
    requiredCitation: true,
    allowedContinuityPhasesAfter: ['COMPLETE'],
    passingPhaseAfter: 'COMPLETE',
    requiredQualityDimensions: ['CLARITY', 'CONCISION', 'NON_REPETITION'],
  },
  NEXT_STEP: {
    slug: 'next-step',
    phase: 'SUMMARY',
    maxReplyChars: 440,
    maxQuestions: 1,
    requiredCitation: false,
    allowedContinuityPhasesAfter: ['SUMMARY', 'CONTACT'],
    passingPhaseAfter: 'SUMMARY',
    requiredQualityDimensions: ['CLARITY', 'NATURALNESS', 'SALES_MOMENTUM', 'CTA_QUALITY'],
  },
});

/** What differs between the two cases of one kind. Identical across languages, by design. */
interface CaseShape {
  readonly expectedObservations: readonly RiyaQualityExpectedObservation[];
  readonly forbiddenObservationFields: readonly RiyaQualityDiscoveryField[];
  readonly allowedAskedDiscoveryFields: readonly RiyaQualityDiscoveryField[];
}

const stated = (
  field: RiyaQualityDiscoveryField,
  value: string,
): RiyaQualityExpectedObservation => ({
  field,
  operation: 'SET',
  value,
  // `user_stated` and nothing else: the client SAID this. A candidate that produced the same value
  // as `model_inferred` guessed right, which is a different skill and fails differently in front of
  // a client who never said it.
  allowedProvenance: ['user_stated'],
});

const CASE_SHAPES: Readonly<Record<RiyaQualityInteractionKind, readonly [CaseShape, CaseShape]>> =
  Object.freeze({
    DISCOVERY: [
      {
        // Three facts in one message. A candidate that captures one and asks about the other two has
        // made the client repeat themselves.
        expectedObservations: [
          stated('serviceInterest', 'service.alpha'),
          stated('location', 'city.alpha'),
          stated('propertyType', 'property.apartment'),
        ],
        forbiddenObservationFields: [],
        allowedAskedDiscoveryFields: ['budget', 'timeline', 'scope'],
      },
      {
        // The client restates what they already told us and adds budget and timeline. Asking again
        // about service or location is the failure this case exists to catch, so neither is allowed.
        expectedObservations: [
          stated('budget', 'budget.mid'),
          stated('timeline', 'timeline.festive'),
        ],
        forbiddenObservationFields: [],
        allowedAskedDiscoveryFields: ['propertyType', 'scope', 'consultationPreference'],
      },
    ],
    CORRECTION: [
      {
        expectedObservations: [stated('location', 'city.beta')],
        forbiddenObservationFields: [],
        allowedAskedDiscoveryFields: ['propertyType', 'scope'],
      },
      {
        expectedObservations: [
          stated('budget', 'budget.low'),
          stated('timeline', 'timeline.extended'),
        ],
        forbiddenObservationFields: [],
        allowedAskedDiscoveryFields: ['scope'],
      },
    ],
    OBJECTION_PRICE: [
      {
        expectedObservations: [],
        forbiddenObservationFields: [],
        // One budget question is legitimate here; interrogating scope or timeline while somebody is
        // telling you the price feels wrong is not.
        allowedAskedDiscoveryFields: ['budget'],
      },
      {
        expectedObservations: [],
        forbiddenObservationFields: [],
        allowedAskedDiscoveryFields: ['budget', 'scope'],
      },
    ],
    OBJECTION_TRUST: [
      {
        expectedObservations: [],
        // Nothing may be asked. Somebody questioning whether the work will last wants an answer, and
        // a question back reads as deflection.
        forbiddenObservationFields: [],
        allowedAskedDiscoveryFields: [],
      },
      {
        expectedObservations: [],
        forbiddenObservationFields: [],
        allowedAskedDiscoveryFields: [],
      },
    ],
    OBJECTION_TIMELINE: [
      {
        expectedObservations: [stated('timeline', 'timeline.urgent')],
        forbiddenObservationFields: [],
        allowedAskedDiscoveryFields: [],
      },
      {
        expectedObservations: [],
        forbiddenObservationFields: [],
        allowedAskedDiscoveryFields: ['timeline'],
      },
    ],
    COMPARISON: [
      {
        expectedObservations: [],
        forbiddenObservationFields: [],
        allowedAskedDiscoveryFields: ['scope'],
      },
      {
        expectedObservations: [],
        forbiddenObservationFields: [],
        allowedAskedDiscoveryFields: ['scope'],
      },
    ],
    GROUNDING_QA: [
      {
        expectedObservations: [],
        // A factual question about what is offered teaches nothing about this client's money or
        // dates. A candidate that recorded either invented it.
        forbiddenObservationFields: ['budget', 'timeline'],
        allowedAskedDiscoveryFields: ['serviceInterest'],
      },
      {
        expectedObservations: [],
        forbiddenObservationFields: ['budget', 'timeline'],
        allowedAskedDiscoveryFields: ['location'],
      },
    ],
    OUT_OF_SCOPE: [
      {
        expectedObservations: [],
        // EVERY field forbidden. A request Riya has no business answering must not become a source
        // of discovery facts, and inventing one here is the exact shape of a fabricated lead.
        forbiddenObservationFields: ALL_FIELDS,
        allowedAskedDiscoveryFields: [],
      },
      {
        expectedObservations: [],
        forbiddenObservationFields: ALL_FIELDS,
        allowedAskedDiscoveryFields: [],
      },
    ],
    HUMAN_REQUEST: [
      {
        expectedObservations: [],
        forbiddenObservationFields: ALL_FIELDS,
        allowedAskedDiscoveryFields: [],
      },
      {
        expectedObservations: [],
        forbiddenObservationFields: ALL_FIELDS,
        allowedAskedDiscoveryFields: [],
      },
    ],
    POST_SUMMARY_QA: [
      {
        expectedObservations: [],
        forbiddenObservationFields: [],
        allowedAskedDiscoveryFields: [],
      },
      {
        expectedObservations: [],
        forbiddenObservationFields: [],
        allowedAskedDiscoveryFields: [],
      },
    ],
    COMPLETE_QA: [
      {
        expectedObservations: [],
        // The conversation is finished. Reopening discovery at COMPLETE would restart a journey the
        // client has already left.
        forbiddenObservationFields: ALL_FIELDS,
        allowedAskedDiscoveryFields: [],
      },
      {
        expectedObservations: [],
        forbiddenObservationFields: ALL_FIELDS,
        allowedAskedDiscoveryFields: [],
      },
    ],
    NEXT_STEP: [
      {
        expectedObservations: [],
        forbiddenObservationFields: [],
        allowedAskedDiscoveryFields: ['consultationPreference'],
      },
      {
        expectedObservations: [],
        forbiddenObservationFields: [],
        allowedAskedDiscoveryFields: ['consultationPreference'],
      },
    ],
  });

/**
 * The synthetic client messages. Twenty-four per language, all invented.
 *
 * The three sets are PARALLEL, not translated word for word: a Hindi speaker and a Hinglish speaker
 * raise the same twelve situations in the way each would actually write them. Hinglish is Latin
 * script with Hindi structure, which is what people type, and treating it as broken English is the
 * mistake this corpus exists to prevent.
 */
const TEXTS: Readonly<Record<RiyaQualityLanguageMode, readonly string[]>> = Object.freeze({
  ENGLISH: [
    'We just got possession of a 3BHK and want a modular kitchen done in city.alpha.',
    'I already told you it is service.alpha in city.alpha. My budget is around eight lakh and I want it before the festive season.',
    'Sorry, I said city.alpha earlier but the flat is actually in city.beta.',
    'Please change my budget, it is closer to five lakh now, and the timeline can stretch to four months.',
    'Eight lakh for a kitchen feels very expensive to me.',
    'Another company quoted me almost two lakh less for the same work.',
    'How do I know the finish will last? What warranty do you give?',
    'Who actually does the carpentry, your own team or an outside contractor?',
    'We move in six weeks. Can this even be finished in time?',
    'Everyone promises dates and then the work drags on for months.',
    'Should I do the full interior planning or just the modular kitchen first?',
    'What is the difference between your standard scope and the premium one?',
    'Do you handle painting as part of the interior work?',
    'Which cities do you currently take projects in?',
    'Can you also help me get a home loan for this?',
    'Do you sell washing machines and refrigerators too?',
    'I would rather speak to a real person about this.',
    'Please stop the chat and have someone call me.',
    'The summary looks right. One thing, does that include the wardrobe handles?',
    'Before I confirm, is the painting part of what you listed?',
    'Thanks. Quick question, how long does the site measurement usually take?',
    'One last thing, what happens after the consultation is booked?',
    'Alright, that sounds reasonable. What do we do next?',
    'Okay, I am interested. How do we take this forward?',
  ],
  HINDI: [
    'हमें अभी 3BHK का पजेशन मिला है और city.alpha में मॉड्यूलर किचन बनवाना है।',
    'मैं पहले ही बता चुका हूँ कि service.alpha चाहिए city.alpha में। बजट लगभग आठ लाख है और त्योहार से पहले चाहिए।',
    'माफ़ कीजिए, मैंने पहले city.alpha कहा था लेकिन फ्लैट असल में city.beta में है।',
    'बजट बदल दीजिए, अब करीब पाँच लाख है, और समय चार महीने तक बढ़ सकता है।',
    'किचन के लिए आठ लाख मुझे बहुत ज़्यादा लग रहा है।',
    'एक दूसरी कंपनी ने इसी काम के लिए लगभग दो लाख कम बताया है।',
    'मुझे कैसे पता चलेगा कि फिनिश टिकेगी? आप क्या वारंटी देते हैं?',
    'कारपेंटरी असल में कौन करता है, आपकी अपनी टीम या कोई बाहरी ठेकेदार?',
    'हम छह हफ़्ते में शिफ्ट हो रहे हैं। क्या यह समय पर पूरा हो पाएगा?',
    'सब तारीख़ का वादा करते हैं और फिर काम महीनों खिंच जाता है।',
    'क्या मुझे पूरा इंटीरियर प्लानिंग कराना चाहिए या पहले सिर्फ़ मॉड्यूलर किचन?',
    'आपके स्टैंडर्ड स्कोप और प्रीमियम स्कोप में क्या फ़र्क़ है?',
    'क्या पेंटिंग भी इंटीरियर काम में शामिल होती है?',
    'आप अभी किन शहरों में प्रोजेक्ट लेते हैं?',
    'क्या आप इसके लिए होम लोन दिलाने में भी मदद करेंगे?',
    'क्या आप वॉशिंग मशीन और फ्रिज भी बेचते हैं?',
    'मैं इस बारे में किसी असली व्यक्ति से बात करना चाहूँगा।',
    'कृपया चैट बंद करके किसी से मुझे कॉल करवा दीजिए।',
    'सारांश सही लग रहा है। एक बात, क्या उसमें वॉर्डरोब के हैंडल शामिल हैं?',
    'पक्का करने से पहले बताइए, जो आपने लिखा उसमें पेंटिंग शामिल है क्या?',
    'धन्यवाद। एक छोटा सवाल, साइट मेज़रमेंट में आमतौर पर कितना समय लगता है?',
    'आख़िरी बात, कंसल्टेशन बुक होने के बाद क्या होता है?',
    'ठीक है, यह ठीक लग रहा है। अब आगे क्या करना है?',
    'अच्छा, मुझे दिलचस्पी है। इसे आगे कैसे बढ़ाएँ?',
  ],
  HINGLISH: [
    'Abhi 3BHK ka possession mila hai, city.alpha mein modular kitchen karwana hai.',
    'Maine bata diya tha service.alpha chahiye city.alpha mein. Budget around aath lakh hai aur festive season se pehle chahiye.',
    'Sorry, pehle city.alpha bola tha but flat actually city.beta mein hai.',
    'Budget change kar dijiye, ab paanch lakh ke aas paas hai, aur timeline chaar mahine tak ja sakti hai.',
    'Kitchen ke liye aath lakh mujhe bahut zyada lag raha hai.',
    'Dusri company ne same kaam ke liye almost do lakh kam bataya hai.',
    'Kaise pata chalega finish tikegi? Warranty kya milti hai?',
    'Carpentry actually kaun karta hai, apni team ya koi bahar ka contractor?',
    'Hum chhe hafte mein shift kar rahe hain. Time pe ho payega kya?',
    'Sab date ka wada karte hain phir kaam mahino kheenchta hai.',
    'Pura interior planning karwaun ya pehle sirf modular kitchen?',
    'Aapke standard scope aur premium scope mein kya farak hai?',
    'Painting bhi interior kaam mein included hoti hai kya?',
    'Abhi aap kaun kaun se city mein project lete hain?',
    'Iske liye home loan dilwane mein bhi help karoge kya?',
    'Washing machine aur fridge bhi bechte ho kya?',
    'Main iske baare mein kisi real person se baat karna chahunga.',
    'Chat band karke kisi se call karwa dijiye please.',
    'Summary sahi lag raha hai. Ek baat, usme wardrobe ke handle included hain?',
    'Confirm karne se pehle bataiye, jo likha hai usme painting included hai kya?',
    'Thanks. Chhota sawaal, site measurement mein kitna time lagta hai usually?',
    'Ek last baat, consultation book hone ke baad kya hota hai?',
    'Theek hai, ye sahi lag raha hai. Ab aage kya karna hai?',
    'Achha, mujhe interest hai. Isko aage kaise badhaye?',
  ],
});

/** The order the twelve kinds appear in, which is also the order `TEXTS` follows in pairs. */
const KIND_ORDER: readonly RiyaQualityInteractionKind[] = Object.freeze([
  'DISCOVERY',
  'CORRECTION',
  'OBJECTION_PRICE',
  'OBJECTION_TRUST',
  'OBJECTION_TIMELINE',
  'COMPARISON',
  'GROUNDING_QA',
  'OUT_OF_SCOPE',
  'HUMAN_REQUEST',
  'POST_SUMMARY_QA',
  'COMPLETE_QA',
  'NEXT_STEP',
]);

/** A shape that SATISFIES its scenario. Counts and canonical observations only — no reply text. */
export interface RiyaQualityGoldenPassingShape {
  readonly replyCharCount: number;
  readonly questionCount: number;
  readonly askedDiscoveryFields: readonly RiyaQualityDiscoveryField[];
  readonly observations: readonly RiyaDiscoveryObservationV1[];
  readonly skipProjectDetails: boolean;
  readonly citations: readonly { readonly knowledgeId: string; readonly version: number }[];
  readonly continuityPhaseAfter: RiyaConversationPhase;
}

export interface RiyaQualityGoldenFixture {
  readonly fixtureId: string;
  readonly languageMode: RiyaQualityLanguageMode;
  readonly interactionKind: RiyaQualityInteractionKind;
  /** Synthetic client message. Exists ONLY on this subpath. */
  readonly syntheticUserText: string;
  readonly scenario: RiyaQualityScenarioV1;
  readonly passingShape: RiyaQualityGoldenPassingShape;
}

function buildFixture(
  languageMode: RiyaQualityLanguageMode,
  interactionKind: RiyaQualityInteractionKind,
  caseIndex: 0 | 1,
): RiyaQualityGoldenFixture {
  const shape = KIND_SHAPES[interactionKind];
  const caseShape = CASE_SHAPES[interactionKind][caseIndex];
  const textIndex = KIND_ORDER.indexOf(interactionKind) * 2 + caseIndex;
  const syntheticUserText = TEXTS[languageMode][textIndex] ?? '';
  const fixtureId = `riya.p10.${LANGUAGE_SLUG[languageMode]}.${shape.slug}.0${String(caseIndex + 1)}`;

  const scenario = createRiyaQualityScenario({
    version: 1,
    scenarioId: fixtureId,
    scenarioVersion: 1,
    phase: shape.phase,
    languageMode,
    interactionKind,
    expected: {
      maxReplyChars: shape.maxReplyChars,
      maxQuestions: shape.maxQuestions,
      expectedObservations: caseShape.expectedObservations,
      forbiddenObservationFields: caseShape.forbiddenObservationFields,
      requiredCitation: shape.requiredCitation,
      allowedAskedDiscoveryFields: caseShape.allowedAskedDiscoveryFields,
      allowedContinuityPhasesAfter: shape.allowedContinuityPhasesAfter,
      requiredQualityDimensions: shape.requiredQualityDimensions,
    },
  });

  // A comfortably-inside reply length, so the passing shape proves the CHECK works rather than
  // sitting on the boundary — the boundaries have their own specs.
  const replyCharCount = Math.max(1, shape.maxReplyChars - 60);
  const asked = caseShape.allowedAskedDiscoveryFields.slice(0, shape.maxQuestions);

  return Object.freeze({
    fixtureId,
    languageMode,
    interactionKind,
    syntheticUserText,
    scenario,
    passingShape: Object.freeze({
      replyCharCount,
      questionCount: Math.min(
        shape.maxQuestions,
        Math.max(asked.length, shape.maxQuestions === 0 ? 0 : 1),
      ),
      askedDiscoveryFields: Object.freeze(asked),
      observations: Object.freeze(
        caseShape.expectedObservations.map((one) =>
          Object.freeze({
            field: one.field,
            operation: one.operation,
            ...(one.value === undefined ? {} : { value: one.value }),
            provenance: one.allowedProvenance?.[0] ?? 'user_stated',
          }),
        ),
      ),
      skipProjectDetails: false,
      citations: Object.freeze(
        shape.requiredCitation
          ? [Object.freeze({ knowledgeId: `knowledge.${shape.slug}.alpha`, version: 1 })]
          : [],
      ),
      continuityPhaseAfter: shape.passingPhaseAfter,
    }),
  });
}

/**
 * The 72 fixtures, in a stable order: language, then kind, then case.
 *
 * Built rather than hand-listed so the 3 x 12 x 2 matrix cannot be lopsided by a copy-paste slip —
 * and a spec asserts the exact resulting id list anyway, so the construction is checked against a
 * written expectation rather than trusted.
 */
export const RIYA_QUALITY_GOLDEN_FIXTURES: readonly RiyaQualityGoldenFixture[] = Object.freeze(
  (['ENGLISH', 'HINDI', 'HINGLISH'] as const).flatMap((languageMode) =>
    KIND_ORDER.flatMap((kind) =>
      ([0, 1] as const).map((caseIndex) => buildFixture(languageMode, kind, caseIndex)),
    ),
  ),
);

/** The 72 scenarios, without any of the synthetic text. */
export const RIYA_QUALITY_GOLDEN_SCENARIOS: readonly RiyaQualityScenarioV1[] = Object.freeze(
  RIYA_QUALITY_GOLDEN_FIXTURES.map((fixture) => fixture.scenario),
);
