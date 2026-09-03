/**
 * Provider-neutral JSON Schemas for each role's output (AS3A, ADR-0143 §6, §7).
 *
 * ### These make output more reliable. They are not authority.
 *
 * A provider that supports native structured output will usually return the right shape, and that is
 * worth having: a malformed payload costs a repair attempt or a candidate. But "usually" is the whole
 * problem with treating it as a guarantee. The bytes still come back UNTRUSTED and still go through
 * AS2's `parseRiyaSyntheticModelOutput`, its strict zod schema, its canonical constructors and then
 * AS1's validator. A provider schema is a hint to the model; the parse is the gate.
 *
 * ### Required, never optional — and why that is compatible
 *
 * Strict provider schemas require every declared property to be present. AS2's zod schemas mark a few
 * fields optional (`wantsHuman`, `endsConversation`, `expectedPhaseAfter`, `failedQualityDimensions`).
 * Those two facts are reconciled in the only direction that keeps the parse honest: the provider
 * schema REQUIRES them, with non-nullable types. A present, valid value satisfies `.optional()`, so
 * nothing downstream changes — and the alternative shapes both fail. Declaring them nullable would
 * return `null`, which AS2's `.optional()` rejects (it accepts absent, not null); and omitting them
 * from the schema entirely would cost the corpus its handoff and conversation-ending signals, which
 * §20's pilot metrics are measured on.
 *
 * The consequence worth stating plainly: this module NEVER rewrites a payload to make it fit. There
 * is no null-stripping, no coercion, no defaulting. If a model returns something AS2 rejects, that is
 * a rejection.
 *
 * ### The enum members come from the canonical vocabularies
 *
 * Spread from the dataset and continuity packages at module load, never retyped. A hand-copied enum
 * list is a second definition that drifts, and the day it does, a model is asked for a value the
 * parser will refuse.
 */
import {
  RIYA_DATASET_ASSISTANT_DECISIONS,
  RIYA_DATASET_DISCOVERY_FIELDS,
  RIYA_DATASET_QUALITY_DIMENSIONS,
  RIYA_DATASET_RESPONSE_OBJECTIVES,
} from '@qf-jarvis/riya-intelligence-dataset';
import { RIYA_CONVERSATION_PHASES } from '@qf-jarvis/riya-conversation-continuity';
import type { RiyaSyntheticRole } from '@qf-jarvis/riya-ai-synthetic-generation';

import { RiyaSyntheticPilotError } from '../contracts/pilot-errors.js';

/** A JSON Schema fragment. Deliberately loose — providers accept a JSON Schema subset, not a type. */
export type RiyaSyntheticJsonSchema = Readonly<Record<string, unknown>>;

const TURN_TEXT: RiyaSyntheticJsonSchema = Object.freeze({
  type: 'string',
  minLength: 1,
  maxLength: 4000,
});

const CUSTOMER_TURN_SCHEMA: RiyaSyntheticJsonSchema = Object.freeze({
  type: 'object',
  additionalProperties: false,
  required: ['userText', 'revealedFields', 'behaviorEvents', 'wantsHuman', 'endsConversation'],
  properties: {
    userText: TURN_TEXT,
    revealedFields: {
      type: 'array',
      maxItems: RIYA_DATASET_DISCOVERY_FIELDS.length,
      items: { type: 'string', enum: [...RIYA_DATASET_DISCOVERY_FIELDS] },
    },
    behaviorEvents: {
      type: 'array',
      maxItems: 8,
      items: { type: 'string', minLength: 1, maxLength: 64 },
    },
    wantsHuman: { type: 'boolean' },
    endsConversation: { type: 'boolean' },
  },
});

const TEACHER_TURN_SCHEMA: RiyaSyntheticJsonSchema = Object.freeze({
  type: 'object',
  additionalProperties: false,
  required: ['assistantText', 'annotation'],
  properties: {
    assistantText: TURN_TEXT,
    annotation: {
      type: 'object',
      additionalProperties: false,
      required: [
        'decision',
        'responseObjective',
        'askedDiscoveryFields',
        'supportedFactRefs',
        'expectedPhaseAfter',
      ],
      properties: {
        decision: { type: 'string', enum: [...RIYA_DATASET_ASSISTANT_DECISIONS] },
        responseObjective: { type: 'string', enum: [...RIYA_DATASET_RESPONSE_OBJECTIVES] },
        askedDiscoveryFields: {
          type: 'array',
          maxItems: RIYA_DATASET_DISCOVERY_FIELDS.length,
          items: { type: 'string', enum: [...RIYA_DATASET_DISCOVERY_FIELDS] },
        },
        // Refs the teacher CITES. The pattern matches AS2's, so a model cannot smuggle prose here.
        supportedFactRefs: {
          type: 'array',
          maxItems: 32,
          items: { type: 'string', minLength: 1, maxLength: 128, pattern: '^[A-Za-z0-9._:-]+$' },
        },
        expectedPhaseAfter: { type: 'string', enum: [...RIYA_CONVERSATION_PHASES] },
      },
    },
  },
});

const VERIFIER_SCHEMA: RiyaSyntheticJsonSchema = Object.freeze({
  type: 'object',
  additionalProperties: false,
  required: ['decision', 'failedChecks'],
  properties: {
    decision: { type: 'string', enum: ['VERIFIED', 'REJECTED'] },
    failedChecks: {
      type: 'array',
      maxItems: 16,
      items: { type: 'string', minLength: 1, maxLength: 64 },
    },
  },
});

const CRITIC_SCHEMA: RiyaSyntheticJsonSchema = Object.freeze({
  type: 'object',
  additionalProperties: false,
  required: ['decision', 'satisfiedQualityDimensions', 'failedQualityDimensions'],
  properties: {
    decision: { type: 'string', enum: ['ACCEPTED', 'REJECTED'] },
    satisfiedQualityDimensions: {
      type: 'array',
      maxItems: RIYA_DATASET_QUALITY_DIMENSIONS.length,
      items: { type: 'string', enum: [...RIYA_DATASET_QUALITY_DIMENSIONS] },
    },
    failedQualityDimensions: {
      type: 'array',
      maxItems: RIYA_DATASET_QUALITY_DIMENSIONS.length,
      items: { type: 'string', enum: [...RIYA_DATASET_QUALITY_DIMENSIONS] },
    },
  },
});

/**
 * The registry, keyed by the EXACT `outputSchemaRef` AS2 puts on the request.
 *
 * AS2 builds that ref as `${role}.v${config.outputSchemaVersion}`. Keying on the full ref rather than
 * on the role alone is what makes a version bump fail loudly: raise `outputSchemaVersion` to 2 in a
 * config and this lookup throws before a request is sent, instead of quietly serving v1 shapes under
 * a v2 label into a corpus that claims otherwise.
 */
const SCHEMAS: ReadonlyMap<string, RiyaSyntheticJsonSchema> = new Map([
  ['CUSTOMER_SIMULATOR.v1', CUSTOMER_TURN_SCHEMA],
  ['RIYA_TEACHER.v1', TEACHER_TURN_SCHEMA],
  ['ANNOTATION_VERIFIER.v1', VERIFIER_SCHEMA],
  ['CRITIC.v1', CRITIC_SCHEMA],
]);

/** Every schema ref this package can serve. A run whose configs ask for another one fails preflight. */
export const RIYA_SYNTHETIC_SUPPORTED_OUTPUT_SCHEMA_REFS: readonly string[] = Object.freeze([
  ...SCHEMAS.keys(),
]);

/** The schema ref a role at a given config version resolves to. Mirrors AS2's construction exactly. */
export function riyaSyntheticOutputSchemaRef(role: RiyaSyntheticRole, version: number): string {
  return `${role}.v${String(version)}`;
}

/** Look one up, or throw `preflight-rejected`. Never falls back to a nearby version. */
export function riyaSyntheticOutputSchemaFor(outputSchemaRef: string): RiyaSyntheticJsonSchema {
  const schema = SCHEMAS.get(outputSchemaRef);
  if (schema === undefined) {
    throw new RiyaSyntheticPilotError('preflight-rejected');
  }
  return schema;
}
