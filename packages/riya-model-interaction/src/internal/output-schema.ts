/**
 * The strict Riya one-call structured output (RWC-P4B, ADR-0099 §10–§12).
 *
 * One answer, two parts: the ordinary reply the M4 adapter already gates, and the bounded discovery
 * observations this turn produced. Both are `.strict()` at every level, so an unknown key is a
 * refusal rather than a value quietly ignored.
 *
 * ### The model's provenance vocabulary is NARROWER than RWC-P4A's
 *
 * P4A accepts five origins because many future producers may exist. A MODEL producer may emit only
 * `user_stated` and `model_inferred`:
 *
 * - `server_runtime` belongs to governed runtime seeding, not to something a model decided;
 * - `user_selected` requires an actual structured UI selection event — prose is not a chip tap;
 * - `user_confirmed` belongs to RWC-P6's structured summary confirmation, and a model that could
 *   mint it would be upgrading its own interpretation into confirmation authority.
 *
 * A `CLEAR` must additionally be `user_stated`, because P4A already locks that an inference may not
 * withdraw a fact.
 *
 * ### The question plan is a CLAIM, not a decision
 *
 * It exists only so the one-call answer can be checked against what the P4A reducer independently
 * decides. The reducer remains the phase and provenance authority; the agreement check is in
 * `profile.ts`.
 */
import { DISCOVERY_FIELDS_FROZEN } from '@qf-jarvis/riya-agent';
import type { DiscoveryField } from '@qf-jarvis/riya-agent';
import { RIYA_CONVERSATION_PHASES } from '@qf-jarvis/riya-conversation-continuity';
import { RIYA_DISCOVERY_OBSERVATION_OPERATIONS } from '@qf-jarvis/riya-conversation-evolution';
import { z } from 'zod';

/** The only origins a MODEL may claim. See the module note. */
export const RIYA_MODEL_PROVENANCES = ['user_stated', 'model_inferred'] as const;

/**
 * A Riya-specific reply-body bound, smaller than the generic 8192.
 *
 * The whole structured answer now carries observations and a question plan beside the reply, and it
 * must still fit the M4 output budget comfortably. Shrinking the Riya reply is the right side to
 * give: widening the generic budget for every agent because one envelope grew would be paying
 * globally for a local choice, and Riya should be conversationally concise anyway.
 */
export const MAX_RIYA_REPLY_BODY_CHARS = 2500;

const IDENTIFIER = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9._:-]+$/u);

const FIELD = z.enum(DISCOVERY_FIELDS_FROZEN as readonly [DiscoveryField, ...DiscoveryField[]]);

/**
 * The nested reply. `REPLY` ONLY, with a required body and the tighter Riya bound.
 *
 * ### Why this is narrower than the generic four kinds
 *
 * The generic `StructuredReply` supports `ESCALATE_TO_HUMAN`, `REQUEST_CLARIFICATION` and
 * `NO_ACTION`, and `model-reply-adapter` keeps all four. This schema supports one, for two reasons
 * that both point the same way.
 *
 * The first is mechanical. M4 builds a `ModelReplyDraft` only for `kind === 'REPLY'`; for the other
 * three, `draft` is `undefined`, and M2 then refuses the candidate as draft-invalid. Advertising them
 * here would offer the model three answers the authoritative Riya path structurally cannot carry —
 * every one of them a guaranteed refusal after a paid inference.
 *
 * The second is authority. Escalating to a human, declining to act and asking for clarification as a
 * DISPOSITION are policy decisions, and they belong to Riya's behaviour boundary and M2 — not to the
 * text generator. P4B's model drafts a reply and reports what it observed; it does not select the
 * action. (A clarifying QUESTION is of course still expressible: it is a `REPLY` whose body asks
 * one, which is exactly what the question plan is for.)
 *
 * It is projected out and RE-PROVED against the real `structuredReplySchema` by the M4 adapter, so
 * this schema can only ever be narrower than the generic contract, never wider.
 */
const riyaReplySchema = z
  .object({
    kind: z.literal('REPLY'),
    // Required, not optional-with-a-refinement: a `REPLY` with no body is not a reply.
    replyBody: z.string().min(1).max(MAX_RIYA_REPLY_BODY_CHARS),
    reasonCode: z
      .string()
      .min(1)
      .max(64)
      .regex(/^[A-Za-z0-9._:-]+$/u)
      .optional(),
    citations: z
      .array(z.object({ knowledgeId: IDENTIFIER, version: z.int().min(1).max(1_000_000) }).strict())
      .max(64),
  })
  .strict();

const observationSchema = z
  .object({
    field: FIELD,
    operation: z.enum(RIYA_DISCOVERY_OBSERVATION_OPERATIONS),
    value: z.string().min(1).max(2048).optional(),
    provenance: z.enum(RIYA_MODEL_PROVENANCES),
  })
  .strict()
  .superRefine((observation, ctx) => {
    if (observation.operation === 'SET' && observation.value === undefined) {
      ctx.addIssue({ code: 'custom', message: 'SET requires a value.' });
    }
    if (observation.operation === 'CLEAR' && observation.value !== undefined) {
      ctx.addIssue({ code: 'custom', message: 'CLEAR forbids a value.' });
    }
    if (observation.operation === 'CLEAR' && observation.provenance !== 'user_stated') {
      // An inference may not withdraw a fact. RWC-P4A refuses this too; refusing it HERE means the
      // whole model answer is rejected rather than one observation being quietly dropped.
      ctx.addIssue({ code: 'custom', message: 'CLEAR requires an explicit user statement.' });
    }
  });

const questionPlanSchema = z
  .object({
    // RWC-P4A's ceiling. `CONTACT`, `CONSENT` and `COMPLETE` are RWC-P6's and a model may not name
    // them as a next step at all.
    phase: z.enum(
      RIYA_CONVERSATION_PHASES.filter(
        (phase) => phase !== 'CONTACT' && phase !== 'CONSENT' && phase !== 'COMPLETE',
      ) as unknown as [string, ...string[]],
    ),
    questionFields: z.array(FIELD).max(2),
  })
  .strict();

const evolutionSchema = z
  .object({
    version: z.literal(1),
    observations: z.array(observationSchema).max(DISCOVERY_FIELDS_FROZEN.length),
    skipProjectDetails: z.boolean(),
    questionPlan: questionPlanSchema,
  })
  .strict();

/**
 * The MODEL-PRODUCER rule, as one predicate.
 *
 * The schema above enforces it on the way in. `parseRiyaModelProfileDetail` enforces the same rule
 * on a detail arriving from anywhere else, and both call THIS — a second copy of the rule in
 * `profile.ts` or in `jarvis-runtime` would be a second answer to "may a model claim that?", and the
 * two would drift the first time one of them was corrected.
 *
 * Deliberately NOT a narrowing of RWC-P4A. The reducer accepts five origins because many producers
 * may exist; this is the subset one particular producer — a model — is allowed to claim.
 */
export function isModelProducibleObservation(observation: {
  readonly operation: string;
  readonly provenance: string;
}): boolean {
  if (!(RIYA_MODEL_PROVENANCES as readonly string[]).includes(observation.provenance)) {
    return false;
  }
  // An inference may not withdraw a fact.
  return !(observation.operation === 'CLEAR' && observation.provenance !== 'user_stated');
}

/** The whole Riya one-call answer. */
export const riyaStructuredOutputSchema = z
  .object({
    reply: riyaReplySchema,
    evolution: evolutionSchema,
  })
  .strict();

export type RiyaStructuredOutput = z.infer<typeof riyaStructuredOutputSchema>;

/**
 * The POST-SUMMARY grounded answer (RWC-P7, ADR-0103 §16).
 *
 * A reply, and structurally nothing else. `.strict()` with a single key, so this schema cannot
 * express an observation, an evolution, a question plan, a provenance, a phase, a contact or consent
 * claim, a completion reference or a business action — and a model that tried to send one is refused
 * rather than trimmed.
 *
 * That absence is the whole design of the post-summary text turn. Past `SUMMARY` the conversation is
 * governed by RWC-P6's structured actions, which make ZERO model calls; a client typing "yes" into a
 * chat box must be able to receive an answer without any possibility of that answer moving a phase,
 * confirming a summary or submitting an intake. The narrowest way to guarantee that is a schema with
 * nowhere to put it.
 */
export const riyaGroundedReplyOutputSchema = z.object({ reply: riyaReplySchema }).strict();

export type RiyaGroundedReplyOutput = z.infer<typeof riyaGroundedReplyOutputSchema>;
