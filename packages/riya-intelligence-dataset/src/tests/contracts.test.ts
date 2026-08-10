/**
 * RID-F1 — the contracts refuse what they must (ADR-0107 §8–§21).
 *
 * The specs worth reading twice are the ordering rules. A trajectory whose assistant cites a fact
 * supplied LATER, or answers twice with no customer in between, is not merely malformed — it is a
 * lesson that teaches the model a habit it will then exhibit in production.
 */
import { describe, expect, it } from 'vitest';

import { RiyaDatasetError } from '../contracts/errors.js';
import { createRiyaTrainingReview } from '../contracts/review.js';
import { createRiyaTrainingState } from '../contracts/training-state.js';
import { createRiyaIntelligenceTrajectory } from '../contracts/trajectory.js';
import {
  createRiyaDatasetAssistantTurn,
  createRiyaDatasetAuthoritativeContextTurn,
  createRiyaDatasetUserTurn,
} from '../contracts/turns.js';
import {
  RIYA_DATASET_ASSISTANT_DECISIONS,
  RIYA_DATASET_CONTEXT_AUTHORITIES,
  RIYA_DATASET_DIFFICULTIES,
  RIYA_DATASET_FACT_CLASSES,
  RIYA_DATASET_INTERACTION_KINDS,
  RIYA_DATASET_LANGUAGE_MODES,
  RIYA_DATASET_PERSONAS,
  RIYA_DATASET_RESPONSE_OBJECTIVES,
  RIYA_DATASET_RISK_CLASSES,
  RIYA_DATASET_SOURCE_KINDS,
  RIYA_DATASET_SPLITS,
  RIYA_DATASET_TURN_TYPES,
} from '../contracts/vocabularies.js';
import {
  acceptedReviews,
  discoveryTurns,
  emptyTrainingState,
  syntheticTrajectory,
} from '../testing/fixtures.js';

const codeOf = (run: () => unknown): string => {
  try {
    run();
  } catch (error: unknown) {
    return error instanceof RiyaDatasetError ? error.code : 'not-a-dataset-error';
  }
  return 'no-error';
};

// ---------------------------------------------------------------------------
// 1. Vocabularies.
// ---------------------------------------------------------------------------

describe('the vocabularies are exactly what ADR-0107 locks', () => {
  it('three splits, and P10 GOLD is not one of them', () => {
    // The exam is not a partition a dataset may draw from. Listing it here would invite exactly the
    // reading the leakage firewall exists to prevent.
    expect([...RIYA_DATASET_SPLITS]).toStrictEqual(['TRAIN', 'VALIDATION', 'HOLDOUT']);
    expect(RIYA_DATASET_SPLITS).not.toContain('GOLD');
    expect(RIYA_DATASET_SPLITS).not.toContain('P10');
    expect(RIYA_DATASET_SPLITS).not.toContain('TEST');
  });

  it('reuses the P10 language and interaction vocabularies rather than forking them', () => {
    expect([...RIYA_DATASET_LANGUAGE_MODES]).toStrictEqual(['ENGLISH', 'HINDI', 'HINGLISH']);
    expect(RIYA_DATASET_INTERACTION_KINDS).toHaveLength(12);
    expect([...RIYA_DATASET_INTERACTION_KINDS]).toStrictEqual([
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
  });

  it('eight behavioural personas, with no identity trait among them', () => {
    expect([...RIYA_DATASET_PERSONAS]).toStrictEqual([
      'DECISIVE',
      'EXPLORING',
      'PRICE_SENSITIVE',
      'PREMIUM',
      'SKEPTICAL',
      'BUSY_SHORT_REPLY',
      'CONFUSED',
      'FRUSTRATED',
    ]);
    const joined = RIYA_DATASET_PERSONAS.join(' ').toLowerCase();
    // A corpus that conditioned selling on any of these would teach Riya to do the same, and no
    // downstream evaluation would reliably catch it.
    for (const forbidden of [
      'religion',
      'caste',
      'hindu',
      'muslim',
      'male',
      'female',
      'age',
      'income',
      'medical',
      'political',
    ]) {
      expect(joined, forbidden).not.toContain(forbidden);
    }
  });

  it('four difficulties and two risk classes', () => {
    expect([...RIYA_DATASET_DIFFICULTIES]).toStrictEqual(['BASIC', 'STANDARD', 'HARD', 'EDGE']);
    expect([...RIYA_DATASET_RISK_CLASSES]).toStrictEqual(['STANDARD', 'HIGH_RISK']);
  });

  it('SYNTHETIC-ONLY sources: a real conversation is not representable', () => {
    expect([...RIYA_DATASET_SOURCE_KINDS]).toStrictEqual([
      'HUMAN_AUTHORED_SYNTHETIC',
      'TEACHER_GENERATED_SYNTHETIC',
    ]);
    const joined = RIYA_DATASET_SOURCE_KINDS.join(' ');
    for (const forbidden of [
      'LIVE_CHAT',
      'PRODUCTION_EXPORT',
      'CRM_EXPORT',
      'WHATSAPP_EXPORT',
      'REAL_CUSTOMER',
    ]) {
      expect(joined, forbidden).not.toContain(forbidden);
    }
  });

  it('three turn types, and no SYSTEM turn', () => {
    // A system prompt is model-specific formatting; baking one in would make the corpus obsolete the
    // day the prompt changed.
    expect([...RIYA_DATASET_TURN_TYPES]).toStrictEqual([
      'USER',
      'AUTHORITATIVE_CONTEXT',
      'ASSISTANT',
    ]);
    expect(RIYA_DATASET_TURN_TYPES).not.toContain('SYSTEM');
  });

  it('both authorities are explicitly SYNTHETIC', () => {
    expect([...RIYA_DATASET_CONTEXT_AUTHORITIES]).toStrictEqual([
      'GOVERNED_KNOWLEDGE_SYNTHETIC',
      'CORE_RUNTIME_SYNTHETIC',
    ]);
    for (const authority of RIYA_DATASET_CONTEXT_AUTHORITIES) {
      expect(authority.endsWith('_SYNTHETIC')).toBe(true);
    }
  });

  it('eight fact classes, seven decisions and eight objectives', () => {
    expect(RIYA_DATASET_FACT_CLASSES).toHaveLength(8);
    expect([...RIYA_DATASET_ASSISTANT_DECISIONS]).toStrictEqual([
      'ANSWER_DIRECT',
      'ASK_DISCOVERY',
      'USE_GOVERNED_KNOWLEDGE',
      'USE_CORE_TRUTH',
      'REQUEST_CONTROLLED_ACTION',
      'HANDOFF_HUMAN',
      'REFUSE_OUT_OF_SCOPE',
    ]);
    // Nothing here can express authority the deterministic business layer owns.
    const joined = RIYA_DATASET_ASSISTANT_DECISIONS.join(' ');
    for (const forbidden of [
      'PROVIDER',
      'N8N',
      'DATABASE',
      'ASSIGN_VENDOR',
      'SET_PRICE',
      'GRANT_DISCOUNT',
      'TAKE_PAYMENT',
    ]) {
      expect(joined, forbidden).not.toContain(forbidden);
    }
    expect([...RIYA_DATASET_RESPONSE_OBJECTIVES]).toStrictEqual([
      'DISCOVER',
      'CORRECT',
      'ANSWER',
      'ADDRESS_OBJECTION',
      'BUILD_TRUST',
      'ADVANCE_NEXT_STEP',
      'HANDOFF',
      'REFUSE',
    ]);
  });
});

// ---------------------------------------------------------------------------
// 2. Training state.
// ---------------------------------------------------------------------------

describe('a training state is context, not a conversation record', () => {
  it('accepts a known field with its provenance', () => {
    const state = createRiyaTrainingState({
      phase: 'LOCATION',
      discovery: { location: 'city.alpha' },
      fieldProvenance: { location: 'user_stated' },
      summaryConfirmed: false,
    });
    expect(state.discovery.location).toBe('city.alpha');
    expect(state.fieldProvenance.location).toBe('user_stated');
    expect(Object.isFrozen(state)).toBe(true);
  });

  it('refuses a value without provenance, or provenance without a value', () => {
    // A fact of unknown strength, or a strength attached to nothing. Either teaches the model to read
    // the pair inconsistently.
    expect(
      codeOf(() =>
        createRiyaTrainingState({
          phase: 'NEED',
          discovery: { budget: 'budget.mid' },
          fieldProvenance: {},
          summaryConfirmed: false,
        }),
      ),
    ).toBe('invalid-trajectory');
    expect(
      codeOf(() =>
        createRiyaTrainingState({
          phase: 'NEED',
          discovery: {},
          fieldProvenance: { budget: 'user_stated' },
          summaryConfirmed: false,
        }),
      ),
    ).toBe('invalid-trajectory');
  });

  it('refuses an unknown field and carries no conversation identity', () => {
    expect(
      codeOf(() =>
        createRiyaTrainingState({
          phase: 'NEED',
          discovery: { notAField: 'x' } as never,
          fieldProvenance: { notAField: 'user_stated' } as never,
          summaryConfirmed: false,
        }),
      ),
    ).toBe('invalid-trajectory');
    for (const extra of [
      { tenantId: 't' },
      { conversationId: 'c' },
      { messageId: 'm' },
      { subjectRef: 's' },
    ]) {
      expect(
        codeOf(() =>
          createRiyaTrainingState({
            phase: 'NEED',
            discovery: {},
            fieldProvenance: {},
            summaryConfirmed: false,
            ...extra,
          } as never),
        ),
      ).toBe('invalid-trajectory');
    }
  });
});

// ---------------------------------------------------------------------------
// 3. Turns.
// ---------------------------------------------------------------------------

describe('turns are strict, and the assistant annotation is the training signal', () => {
  it('an assistant turn may ask at most ONE discovery question', () => {
    // Two questions in one message is a form, not a conversation, and it is a habit that shows up in
    // every turn afterwards.
    expect(
      codeOf(() =>
        createRiyaDatasetAssistantTurn({
          type: 'ASSISTANT',
          turnRef: 'a1',
          text: 'What is your budget and when do you want to start?',
          annotation: {
            decision: 'ASK_DISCOVERY',
            askedDiscoveryFields: ['budget', 'timeline'],
            supportedFactRefs: [],
            responseObjective: 'DISCOVER',
          },
        }),
      ),
    ).toBe('invalid-turn');
  });

  it('a HANDOFF turn may ask NOTHING', () => {
    // Somebody who asked for a person and got another question has been ignored.
    expect(
      codeOf(() =>
        createRiyaDatasetAssistantTurn({
          type: 'ASSISTANT',
          turnRef: 'a1',
          text: 'Of course. Before I connect you, what is your budget?',
          annotation: {
            decision: 'HANDOFF_HUMAN',
            askedDiscoveryFields: ['budget'],
            supportedFactRefs: [],
            responseObjective: 'HANDOFF',
          },
        }),
      ),
    ).toBe('invalid-turn');
  });

  it('the expected observation batch is re-proved through the canonical constructor', () => {
    // A batch this package accepted but RWC-P4A would refuse is a training target the runtime can
    // never produce.
    for (const observations of [
      [
        { field: 'location', operation: 'SET', value: 'a', provenance: 'user_stated' },
        { field: 'location', operation: 'SET', value: 'b', provenance: 'user_stated' },
      ],
      [{ field: 'location', operation: 'SET', provenance: 'user_stated' }],
      [{ field: 'location', operation: 'SET', value: 'a', provenance: 'telepathy' }],
      [{ field: 'notAField', operation: 'SET', value: 'a', provenance: 'user_stated' }],
    ]) {
      expect(
        codeOf(() =>
          createRiyaDatasetAssistantTurn({
            type: 'ASSISTANT',
            turnRef: 'a1',
            text: 'Understood.',
            annotation: {
              decision: 'ANSWER_DIRECT',
              expectedObservationBatch: {
                version: 1,
                observations: observations as never,
                skipProjectDetails: false,
              },
              askedDiscoveryFields: [],
              supportedFactRefs: [],
              responseObjective: 'ANSWER',
            },
          }),
        ),
      ).toBe('invalid-turn');
    }
  });

  it('an extra top-level batch field is refused by the canonical constructor', () => {
    expect(
      codeOf(() =>
        createRiyaDatasetAssistantTurn({
          type: 'ASSISTANT',
          turnRef: 'a1',
          text: 'Understood.',
          annotation: {
            decision: 'ANSWER_DIRECT',
            expectedObservationBatch: {
              version: 1,
              observations: [],
              skipProjectDetails: false,
              rawText: 'we want a modular kitchen',
            } as never,
            askedDiscoveryFields: [],
            supportedFactRefs: [],
            responseObjective: 'ANSWER',
          },
        }),
      ),
    ).toBe('invalid-turn');
  });

  it('there is NO hidden-reasoning field anywhere on an annotation', () => {
    // Training on a teacher's reasoning trace teaches the shape of reasoning rather than the
    // conclusion, and the traces are unverifiable.
    for (const extra of [
      { reasoning: 'the client seems price sensitive' },
      { chainOfThought: 'step 1...' },
      { rationale: 'because' },
      { scratchpad: 'notes' },
      { teacherExplanation: 'the teacher said' },
      { confidence: 0.9 },
    ]) {
      expect(
        codeOf(() =>
          createRiyaDatasetAssistantTurn({
            type: 'ASSISTANT',
            turnRef: 'a1',
            text: 'Understood.',
            annotation: {
              decision: 'ANSWER_DIRECT',
              askedDiscoveryFields: [],
              supportedFactRefs: [],
              responseObjective: 'ANSWER',
              ...extra,
            } as never,
          }),
        ),
        JSON.stringify(extra),
      ).toBe('invalid-turn');
    }
  });

  it('a context turn needs at least one fact, with unique refs', () => {
    expect(
      codeOf(() =>
        createRiyaDatasetAuthoritativeContextTurn({
          type: 'AUTHORITATIVE_CONTEXT',
          turnRef: 'c1',
          authority: 'CORE_RUNTIME_SYNTHETIC',
          facts: [],
        }),
      ),
    ).toBe('invalid-turn');
    expect(
      codeOf(() =>
        createRiyaDatasetAuthoritativeContextTurn({
          type: 'AUTHORITATIVE_CONTEXT',
          turnRef: 'c1',
          authority: 'CORE_RUNTIME_SYNTHETIC',
          facts: [
            { factRef: 'f1', value: 'a', factClass: 'PRICE' },
            { factRef: 'f1', value: 'b', factClass: 'PRICE' },
          ],
        }),
      ),
    ).toBe('invalid-turn');
  });

  it('turn text is bounded at both ends', () => {
    expect(codeOf(() => createRiyaDatasetUserTurn({ type: 'USER', turnRef: 'u1', text: '' }))).toBe(
      'invalid-turn',
    );
    expect(
      codeOf(() =>
        createRiyaDatasetUserTurn({ type: 'USER', turnRef: 'u1', text: 'x'.repeat(4001) }),
      ),
    ).toBe('invalid-turn');
  });
});

// ---------------------------------------------------------------------------
// 4. Trajectory ordering and bounds.
// ---------------------------------------------------------------------------

const user = (ref: string, text = 'Hello, I need help with my kitchen.') =>
  createRiyaDatasetUserTurn({ type: 'USER', turnRef: ref, text });

const assistant = (ref: string, text = 'Happy to help. What city is the flat in?') =>
  createRiyaDatasetAssistantTurn({
    type: 'ASSISTANT',
    turnRef: ref,
    text,
    annotation: {
      decision: 'ASK_DISCOVERY',
      askedDiscoveryFields: ['location'],
      supportedFactRefs: [],
      responseObjective: 'DISCOVER',
    },
  });

describe('a trajectory is a conversation, and its order is a rule', () => {
  it('accepts a well-formed example', () => {
    const trajectory = syntheticTrajectory();
    expect(trajectory.turns).toHaveLength(2);
    expect(Object.isFrozen(trajectory)).toBe(true);
  });

  it('the first SPOKEN turn must be the customer', () => {
    // Pre-existing context may open a trajectory; an assistant speaking unprompted is a broadcast.
    expect(codeOf(() => syntheticTrajectory({ turns: [assistant('a1'), user('u1')] }))).toBe(
      'invalid-trajectory',
    );
    const withContext = syntheticTrajectory({
      turns: [
        createRiyaDatasetAuthoritativeContextTurn({
          type: 'AUTHORITATIVE_CONTEXT',
          turnRef: 'c0',
          authority: 'GOVERNED_KNOWLEDGE_SYNTHETIC',
          facts: [
            { factRef: 'f0', value: 'service.alpha is offered', factClass: 'SERVICE_AVAILABILITY' },
          ],
        }),
        user('u1'),
        assistant('a1'),
      ],
    });
    expect(withContext.turns).toHaveLength(3);
  });

  it('requires at least one customer turn and at least one assistant turn', () => {
    expect(codeOf(() => syntheticTrajectory({ turns: [user('u1')] }))).toBe('invalid-trajectory');
    expect(codeOf(() => syntheticTrajectory({ turns: [] }))).toBe('invalid-trajectory');
  });

  it('refuses two assistant turns in a row', () => {
    // A conversation the customer never got to answer is not a conversation.
    expect(
      codeOf(() => syntheticTrajectory({ turns: [user('u1'), assistant('a1'), assistant('a2')] })),
    ).toBe('invalid-trajectory');
  });

  it('refuses duplicate turn refs', () => {
    expect(codeOf(() => syntheticTrajectory({ turns: [user('u1'), assistant('u1')] }))).toBe(
      'invalid-trajectory',
    );
  });

  it('bounds total and assistant turns', () => {
    const many = Array.from({ length: 66 }, (_unused, index) =>
      index % 2 === 0 ? user(`u${String(index)}`) : assistant(`a${String(index)}`),
    );
    expect(codeOf(() => syntheticTrajectory({ turns: many }))).toBe('invalid-trajectory');
  });

  it('a teacher-generated example must name its teacher, and a human one must not', () => {
    // A bad generator has to be traceable to the rows it made.
    expect(
      codeOf(() =>
        createRiyaIntelligenceTrajectory({
          ...syntheticTrajectory(),
          source: {
            kind: 'TEACHER_GENERATED_SYNTHETIC',
            sourceRef: 'author.alpha',
            synthetic: true,
          },
        }),
      ),
    ).toBe('invalid-trajectory');
    expect(
      codeOf(() =>
        createRiyaIntelligenceTrajectory({
          ...syntheticTrajectory(),
          source: {
            kind: 'HUMAN_AUTHORED_SYNTHETIC',
            sourceRef: 'author.alpha',
            synthetic: true,
            teacherRef: 'teacher.alpha',
          },
        }),
      ),
    ).toBe('invalid-trajectory');
  });

  it('refuses a non-synthetic source outright', () => {
    expect(
      codeOf(() =>
        createRiyaIntelligenceTrajectory({
          ...syntheticTrajectory(),
          source: {
            kind: 'HUMAN_AUTHORED_SYNTHETIC',
            sourceRef: 'author.alpha',
            synthetic: false,
          } as never,
        }),
      ),
    ).toBe('invalid-trajectory');
  });

  it('refuses an unknown top-level field', () => {
    expect(
      codeOf(() =>
        createRiyaIntelligenceTrajectory({
          ...syntheticTrajectory(),
          metadata: { anything: true },
        } as never),
      ),
    ).toBe('invalid-trajectory');
  });

  it('refuses a primary kind repeated among the secondaries, and a self-parent', () => {
    expect(
      codeOf(() =>
        createRiyaIntelligenceTrajectory({
          ...syntheticTrajectory(),
          secondaryInteractionKinds: ['DISCOVERY'],
        }),
      ),
    ).toBe('invalid-trajectory');
    expect(
      codeOf(() =>
        createRiyaIntelligenceTrajectory({
          ...syntheticTrajectory(),
          parentTrajectoryRef: 'riya.gold.en.discovery.001',
        }),
      ),
    ).toBe('invalid-trajectory');
  });
});

// ---------------------------------------------------------------------------
// 5. Review contract.
// ---------------------------------------------------------------------------

describe('a review carries a judgement and nothing else', () => {
  it('refuses a name, an email, a comment, a rationale or a confidence', () => {
    for (const extra of [
      { reviewerName: 'a real person' },
      { name: 'a real person' },
      { email: 'someone@example.com' },
      { comment: 'the closing line assumed the sale' },
      { rationale: 'because' },
      { confidence: 0.8 },
      { notes: '' },
    ]) {
      expect(
        codeOf(() =>
          createRiyaTrainingReview({
            reviewRef: 'reviewer.alpha',
            decision: 'ACCEPTED',
            satisfiedQualityDimensions: ['CLARITY'],
            ...extra,
          } as never),
        ),
        JSON.stringify(extra),
      ).toBe('invalid-review');
    }
  });

  it('refuses a repeated dimension and an unknown one', () => {
    expect(
      codeOf(() =>
        createRiyaTrainingReview({
          reviewRef: 'r',
          decision: 'ACCEPTED',
          satisfiedQualityDimensions: ['CLARITY', 'CLARITY'],
        }),
      ),
    ).toBe('invalid-review');
    expect(
      codeOf(() =>
        createRiyaTrainingReview({
          reviewRef: 'r',
          decision: 'ACCEPTED',
          satisfiedQualityDimensions: ['CHARISMA' as never],
        }),
      ),
    ).toBe('invalid-review');
  });

  it('a trajectory refuses two reviews with the same ref', () => {
    // One person counted twice is exactly what the two-reviewer rule exists to prevent.
    const duplicate = acceptedReviews(2, { refs: ['same', 'same'] });
    expect(codeOf(() => syntheticTrajectory({ riskClass: 'HIGH_RISK', review: duplicate }))).toBe(
      'invalid-review',
    );
  });

  it('sorts reviews so a trajectory does not depend on submission order', () => {
    const forward = syntheticTrajectory({
      riskClass: 'HIGH_RISK',
      review: acceptedReviews(2, { refs: ['zeta', 'alpha'] }),
      turns: discoveryTurns(),
      initialState: emptyTrainingState(),
    });
    expect(forward.review.map((one) => one.reviewRef)).toStrictEqual(['alpha', 'zeta']);
  });
});
