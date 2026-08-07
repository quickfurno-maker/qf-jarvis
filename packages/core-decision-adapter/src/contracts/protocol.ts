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

/**
 * The default proposed protocol identity.
 *
 * ### v1 → v2 (RWC-P2D, ADR-0096)
 *
 * The strict command/response wire schema changed: a command now carries `proposalDigest`, and the
 * response schema REQUIRES it. Continuing to advertise `version: 1` with a different wire shape would
 * be the protocol lying about itself — a v1 responder would fail closed while still being told it was
 * talking v1, and a future reader could not tell which shape a recorded `qfj.core.decision/1` command
 * had.
 *
 * The NAME is unchanged: this is the same protocol, advanced. A second protocol name would fork the
 * contract and give Core two things to implement.
 *
 * QuickFurno Core-side adoption remains future work, exactly as it was for v1. This is still a
 * PROPOSED, provider-neutral protocol.
 */
export const DEFAULT_CORE_DECISION_PROTOCOL: CoreDecisionProtocol = Object.freeze({
  name: 'qfj.core.decision',
  version: 2,
  contractDigest: 'c0de0002',
});
