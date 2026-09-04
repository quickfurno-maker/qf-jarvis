/**
 * Role input projection and provider-neutral rendering (AS3A, ADR-0143 §8, §9).
 *
 * ### This module is the leakage boundary, and it is an ALLOWLIST
 *
 * Everything a model is ever told passes through here. AS2 hands the port a `structuredInput` typed
 * `unknown` — deliberately, so the port grows no role knowledge — which means the bytes that reach a
 * provider are decided in exactly one place: this file.
 *
 * So the projection is an allowlist twice over. Each role's input goes through a `.strict()` zod
 * schema, which FAILS on an unknown key rather than dropping it; and the serialized object is then
 * REBUILT field by field from the parsed result, so even a schema mistake cannot pass a stray value
 * through. Fail-closed on both sides: a caller that supplied more than the role may see gets a
 * rejected invocation and zero provider calls, not a redacted one.
 *
 * Dropping unknown keys silently was the obvious alternative and is worse. It would mean a future AS2
 * field — say a new scenario attribute — reaching this boundary and being quietly discarded, so the
 * day somebody added `split` to a role input, the blindness guarantee would hold by accident and stop
 * holding the moment the projection was "helpfully" widened.
 *
 * ### What each role may see, restated as code
 *
 * The customer simulator keeps its hidden customer state, because revealing it on its own schedule is
 * its entire job. It gets no split, no lineage and no acceptance state. The teacher gets a projection
 * with no `plannedCustomerFacts`, no `customerBehaviorCodes` and no future interaction label — it
 * cannot be told what the customer is about to do, or the conversation is a script rather than a
 * conversation. The verifier and the critic see what the teacher saw, and no more.
 *
 * The protected RWC-P10 exam appears in none of these shapes and has no path to one. It reaches the
 * AS1 validator, after a candidate already exists.
 */
import { RiyaSyntheticGenerationError } from '@qf-jarvis/riya-ai-synthetic-generation';
import type {
  RiyaSyntheticInvocationRequestV1,
  RiyaSyntheticRole,
} from '@qf-jarvis/riya-ai-synthetic-generation';
import { z } from 'zod';

import { riyaSyntheticInstructionFor } from './instruction-inventory.js';
import { riyaSyntheticOutputSchemaFor } from './output-schemas.js';
import type { RiyaSyntheticJsonSchema } from './output-schemas.js';

const TEXT = z.string().min(1).max(4_000);
const LABEL = z.string().min(1).max(128);

const visibleTurnSchema = z.object({ speaker: z.enum(['USER', 'ASSISTANT']), text: TEXT }).strict();

const teacherScenarioSchema = z
  .object({
    languageMode: LABEL,
    riskClass: LABEL,
    startPhase: LABEL,
    plannedDiscoveryFields: z.array(LABEL).max(64),
    forbiddenBehaviors: z.array(LABEL).max(64),
  })
  .strict();

const customerScenarioSchema = z
  .object({
    languageMode: LABEL,
    persona: LABEL,
    difficulty: LABEL,
    plannedDiscoveryFields: z.array(LABEL).max(64),
    plannedCustomerFacts: z
      .array(z.object({ field: LABEL, value: z.string().min(1).max(512) }).strict())
      .max(64),
    customerBehaviorCodes: z.array(LABEL).max(64),
    requiredConversationEvents: z.array(LABEL).max(64),
    forbiddenBehaviors: z.array(LABEL).max(64),
  })
  .strict();

const customerInputSchema = z
  .object({
    scenario: customerScenarioSchema,
    visibleHistory: z.array(visibleTurnSchema).max(256),
    turnIndex: z.int().min(0).max(256),
    mayConclude: z.boolean(),
  })
  .strict();

const teacherInputSchema = z
  .object({
    scenario: teacherScenarioSchema,
    visibleHistory: z.array(visibleTurnSchema).max(256),
    turnIndex: z.int().min(0).max(256),
    availableAuthorityFacts: z
      .array(
        z.object({ factRef: LABEL, factClass: LABEL, value: z.string().min(1).max(512) }).strict(),
      )
      .max(64),
  })
  .strict();

const verifierInputSchema = z
  .object({
    scenario: teacherScenarioSchema,
    visibleHistory: z.array(visibleTurnSchema).max(256),
    askedDiscoveryFieldsByTurn: z.array(z.array(LABEL).max(64)).max(256),
    decisionsByTurn: z.array(LABEL).max(256),
  })
  .strict();

const criticInputSchema = z
  .object({
    scenario: teacherScenarioSchema,
    visibleHistory: z.array(visibleTurnSchema).max(256),
    requestedQualityDimensions: z.array(LABEL).min(1).max(64),
  })
  .strict();

/** Rebuild the teacher-visible scenario field by field. The second allowlist. */
function teacherScenarioOut(view: z.infer<typeof teacherScenarioSchema>): unknown {
  return {
    languageMode: view.languageMode,
    riskClass: view.riskClass,
    startPhase: view.startPhase,
    plannedDiscoveryFields: [...view.plannedDiscoveryFields],
    forbiddenBehaviors: [...view.forbiddenBehaviors],
  };
}

function visibleHistoryOut(turns: readonly z.infer<typeof visibleTurnSchema>[]): unknown {
  return turns.map((turn) => ({ speaker: turn.speaker, text: turn.text }));
}

/**
 * Project one role's input down to the exact object that may be serialized.
 *
 * Throws `invalid-invocation-request` on anything unexpected — BEFORE a transport exists, so a
 * rejected projection costs nothing and reaches no provider.
 */
export function projectRiyaSyntheticRoleInput(
  role: RiyaSyntheticRole,
  structuredInput: unknown,
): unknown {
  switch (role) {
    case 'CUSTOMER_SIMULATOR': {
      const parsed = customerInputSchema.safeParse(structuredInput);
      if (!parsed.success) throw new RiyaSyntheticGenerationError('invalid-invocation-request');
      const value = parsed.data;
      return {
        scenario: {
          languageMode: value.scenario.languageMode,
          persona: value.scenario.persona,
          difficulty: value.scenario.difficulty,
          plannedDiscoveryFields: [...value.scenario.plannedDiscoveryFields],
          plannedCustomerFacts: value.scenario.plannedCustomerFacts.map((fact) => ({
            field: fact.field,
            value: fact.value,
          })),
          customerBehaviorCodes: [...value.scenario.customerBehaviorCodes],
          requiredConversationEvents: [...value.scenario.requiredConversationEvents],
          forbiddenBehaviors: [...value.scenario.forbiddenBehaviors],
        },
        visibleHistory: visibleHistoryOut(value.visibleHistory),
        turnIndex: value.turnIndex,
        mayConclude: value.mayConclude,
      };
    }
    case 'RIYA_TEACHER': {
      const parsed = teacherInputSchema.safeParse(structuredInput);
      if (!parsed.success) throw new RiyaSyntheticGenerationError('invalid-invocation-request');
      const value = parsed.data;
      return {
        scenario: teacherScenarioOut(value.scenario),
        visibleHistory: visibleHistoryOut(value.visibleHistory),
        turnIndex: value.turnIndex,
        // Ref, class AND value. A teacher given only a ref can label a citation but not answer with
        // it, which pushes it toward inventing the number or refusing to use authority at all.
        availableAuthorityFacts: value.availableAuthorityFacts.map((fact) => ({
          factRef: fact.factRef,
          factClass: fact.factClass,
          value: fact.value,
        })),
      };
    }
    case 'ANNOTATION_VERIFIER': {
      const parsed = verifierInputSchema.safeParse(structuredInput);
      if (!parsed.success) throw new RiyaSyntheticGenerationError('invalid-invocation-request');
      const value = parsed.data;
      return {
        scenario: teacherScenarioOut(value.scenario),
        visibleHistory: visibleHistoryOut(value.visibleHistory),
        askedDiscoveryFieldsByTurn: value.askedDiscoveryFieldsByTurn.map((one) => [...one]),
        decisionsByTurn: [...value.decisionsByTurn],
      };
    }
    case 'CRITIC': {
      const parsed = criticInputSchema.safeParse(structuredInput);
      if (!parsed.success) throw new RiyaSyntheticGenerationError('invalid-invocation-request');
      const value = parsed.data;
      return {
        scenario: teacherScenarioOut(value.scenario),
        visibleHistory: visibleHistoryOut(value.visibleHistory),
        requestedQualityDimensions: [...value.requestedQualityDimensions],
      };
    }
    case 'SCENARIO_PLANNER':
      // The scheduler is deterministic; no model plans scenarios. A run that reached here is
      // misconfigured, and inventing a projection for it would hide that.
      throw new RiyaSyntheticGenerationError('invalid-invocation-request');
  }
}

/** Everything a provider binding needs, and nothing about how to reach a provider. */
export interface RiyaSyntheticRenderedRequestV1 {
  readonly role: RiyaSyntheticRole;
  readonly configRef: string;
  readonly modelRef: string;
  readonly instructionRef: string;
  readonly instructionSha256: string;
  readonly outputSchemaRef: string;
  readonly outputSchema: RiyaSyntheticJsonSchema;
  /** The role instruction. Identical for every provider family. */
  readonly systemText: string;
  /** The projected input, serialized. The ONLY variable bytes that reach a model. */
  readonly userText: string;
  readonly maxOutputTokens: number;
}

/**
 * Render one invocation into provider-neutral parts.
 *
 * The result binds instruction identity, instruction digest, output schema ref, role and model
 * identity together, so a candidate can be attributed to exactly what produced it. It carries no
 * credential, no URL and no provider name — a binding adds those, and only a binding.
 */
export function renderRiyaSyntheticRequest(
  request: RiyaSyntheticInvocationRequestV1,
  structuredInput: unknown,
  modelRef: string,
): RiyaSyntheticRenderedRequestV1 {
  const instruction = riyaSyntheticInstructionFor(request.role);
  const outputSchema = riyaSyntheticOutputSchemaFor(request.outputSchemaRef);
  const projected = projectRiyaSyntheticRoleInput(request.role, structuredInput);

  return Object.freeze({
    role: request.role,
    configRef: request.configRef,
    modelRef,
    instructionRef: instruction.identity.instructionRef,
    instructionSha256: instruction.identity.instructionSha256,
    outputSchemaRef: request.outputSchemaRef,
    outputSchema,
    systemText: instruction.text,
    // Two spaces, so a human reading a captured request can actually read it. Determinism comes from
    // the explicit field-by-field rebuild above, not from the formatting.
    userText: JSON.stringify(projected, null, 2),
    maxOutputTokens: request.maxOutputTokens,
  });
}
