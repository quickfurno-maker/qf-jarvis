/**
 * Versioned role instruction identity (AS2, ADR-0143).
 *
 * ### Identity, bound by digest — not a mutable string in source
 *
 * A candidate has to be attributable to the instruction that produced it. If the instruction were one
 * editable template literal, then improving it silently re-attributes every past candidate to text
 * that no longer exists, and "which instruction produced this row" stops being answerable.
 *
 * So an instruction has a ref, a version and a **digest**, and the digest is what a config binds to.
 * Editing the words moves the digest, which is exactly the alarm you want.
 *
 * ### The prohibitions travel with it
 *
 * `forbids` is a closed list carried on the identity rather than buried in prose, so a reviewer can
 * see at a glance that this instruction told the model not to emit reasoning, not to invent
 * commercial truth and not to write the other participant's turns — without reading the instruction
 * itself, which may live elsewhere.
 */
import { z } from 'zod';

import { SHA256_HEX } from '../internal/digest.js';
import { RiyaSyntheticGenerationError } from './errors.js';
import { RIYA_SYNTHETIC_ROLES } from './model-config.js';
import type { RiyaSyntheticRole } from './model-config.js';

/**
 * What every role instruction must forbid.
 *
 * Not decoration. Each of these is a way a generated corpus quietly becomes unusable: reasoning
 * traces train the shape of reasoning rather than the answer; real personal data poisons the corpus
 * with something no privacy scan can un-learn; invented commercial truth becomes a confident
 * falsehood the moment a price changes; role crossover produces a conversation the customer never
 * actually had.
 */
export const RIYA_SYNTHETIC_INSTRUCTION_PROHIBITIONS = [
  'CHAIN_OF_THOUGHT',
  'REAL_PERSONAL_DATA',
  'SECRETS',
  'PROTECTED_EXAM_REFERENCE',
  'INVENTED_COMMERCIAL_TRUTH',
  'ROLE_CROSSOVER',
] as const;
export type RiyaSyntheticInstructionProhibition =
  (typeof RIYA_SYNTHETIC_INSTRUCTION_PROHIBITIONS)[number];

export interface RiyaSyntheticRoleInstructionV1 {
  readonly version: 1;
  readonly instructionRef: string;
  readonly instructionVersion: number;
  readonly role: RiyaSyntheticRole;
  readonly instructionSha256: string;
  readonly forbids: readonly RiyaSyntheticInstructionProhibition[];
}

export type RiyaSyntheticRoleInstructionInput = Omit<RiyaSyntheticRoleInstructionV1, 'version'> & {
  readonly version?: 1;
};

const REF = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9._:-]+$/);

const instructionSchema = z
  .object({
    version: z.literal(1).optional(),
    instructionRef: REF,
    instructionVersion: z.int().min(1).max(1_000_000),
    role: z.enum(RIYA_SYNTHETIC_ROLES),
    instructionSha256: z.string().regex(SHA256_HEX),
    forbids: z
      .array(z.enum(RIYA_SYNTHETIC_INSTRUCTION_PROHIBITIONS))
      .max(RIYA_SYNTHETIC_INSTRUCTION_PROHIBITIONS.length),
  })
  .strict();

/**
 * Validate and freeze a role instruction identity. Throws `invalid-role-instruction`.
 *
 * Every prohibition is REQUIRED, not merely allowed. An instruction that forbids only some of them is
 * an instruction somebody trimmed, and the trimmed one is always the inconvenient one.
 */
export function createRiyaSyntheticRoleInstruction(
  input: RiyaSyntheticRoleInstructionInput,
): RiyaSyntheticRoleInstructionV1 {
  const parsed = instructionSchema.safeParse(input);
  if (!parsed.success) {
    throw new RiyaSyntheticGenerationError('invalid-role-instruction');
  }
  const forbids = parsed.data.forbids;
  const complete = RIYA_SYNTHETIC_INSTRUCTION_PROHIBITIONS.every((one) => forbids.includes(one));
  if (!complete || new Set(forbids).size !== forbids.length) {
    throw new RiyaSyntheticGenerationError('invalid-role-instruction');
  }
  return Object.freeze({
    version: 1 as const,
    instructionRef: parsed.data.instructionRef,
    instructionVersion: parsed.data.instructionVersion,
    role: parsed.data.role,
    instructionSha256: parsed.data.instructionSha256,
    forbids: Object.freeze([...forbids].sort()),
  });
}
