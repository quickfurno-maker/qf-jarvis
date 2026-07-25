/**
 * The Core decision protocol identity (QFJ-M3, ADR-0056 §C).
 *
 * A PROPOSED, provider-neutral protocol — later QuickFurno Core-side adoption is required. Every
 * command and response binds an exact protocol name/version/contract-digest so a mismatch fails closed.
 */
import { z } from 'zod';

/** The exact protocol identity a command/response is bound to. */
export interface CoreDecisionProtocol {
  readonly name: string;
  readonly version: number;
  readonly contractDigest: string;
}

export const coreDecisionProtocolSchema = z
  .object({
    name: z
      .string()
      .min(1)
      .max(128)
      .regex(/^[A-Za-z0-9._:-]+$/),
    version: z.int().min(1).max(1_000_000),
    contractDigest: z.string().regex(/^[0-9a-f]{8,64}$/),
  })
  .strict();

/** The default proposed protocol identity for this foundation slice. */
export const DEFAULT_CORE_DECISION_PROTOCOL: CoreDecisionProtocol = Object.freeze({
  name: 'qfj.core.decision',
  version: 1,
  contractDigest: 'c0de0001',
});
