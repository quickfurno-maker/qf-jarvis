/**
 * Erasure: the request, and the record.
 *
 * A client or vendor exercised a deletion or anonymisation right, and that must
 * propagate out of QuickFurno Core and into everything Jarvis derived from it — read
 * models, identity references, recommendation evidence, and **agent memory**
 * (docs/architecture/data-ownership.md).
 *
 * ### Two contracts, because a request is not a completion
 *
 * `ErasureRequestV1` says *this was asked for*. `ErasureRecordV1` says *this was done* —
 * and, crucially, **what was and was not reached**.
 *
 * Collapsing them into one record with a `done: true` flag is the obvious shortcut and
 * it is a bad one. Erasure is a distributed operation across systems that can each fail
 * independently, and the interval between "asked" and "completed everywhere" is real,
 * sometimes long, and legally material. A shape that cannot represent *in progress*
 * forces a caller to choose between claiming completion it has not achieved and
 * recording nothing at all. Both are worse than the truth.
 *
 * ### `scopesCompleted` is the field that makes this auditable
 *
 * An erasure record names which derived stores were actually reached. "We deleted the
 * client" is a claim; "we deleted the client from read models, evidence, and Riya's
 * memory, and here is the list" is an answer to a regulator.
 *
 * A record that claims `completed` while naming no scopes is refused: an erasure that
 * erased nothing, in nowhere, is not a completed erasure.
 *
 * ### What audit records do *not* do
 *
 * Approval decisions and audit trails are **immutable**, and they are handled under
 * legal-retention rules rather than deletion rules (data-ownership.md). Erasing the
 * record that a decision was made would destroy the accountability the decision exists
 * to provide. What is erased is the *personal data*; what remains is the *fact that a
 * governed action occurred*. `audit-trail` is deliberately absent from the erasable
 * scopes below.
 */

import { z } from 'zod';

import { correlationIdSchema, erasureRequestIdSchema } from '../common/identifiers.js';
import { actorReferenceSchema } from '../common/actor.js';
import { boundedText, reasonCodeSchema, TEXT_LIMITS } from '../common/text.js';
import { entityReferenceSchema } from '../common/entity-reference.js';
import { erasureTypeSchema } from '../common/classification.js';
import { policyReferenceSchema } from '../common/policy.js';
import { quickfurnoCoreSchema } from '../common/systems.js';
import { utcTimestampSchema } from '../common/timestamp.js';

export const ERASURE_REQUEST_CONTRACT_VERSION = 1;
export const ERASURE_RECORD_CONTRACT_VERSION = 1;

/**
 * The derived stores an erasure must reach.
 *
 * Note the absence of `audit-trail`. See the file header: the personal data goes, the
 * fact that a governed action occurred stays.
 */
export const ERASABLE_SCOPES = [
  'derived-read-models',
  'identity-references',
  'recommendation-evidence',
  'agent-memory',
  'dataset-examples',
] as const;

export const erasableScopeSchema = z.enum(ERASABLE_SCOPES);
export type ErasableScope = z.infer<typeof erasableScopeSchema>;

// ---------------------------------------------------------------------------
// The request
// ---------------------------------------------------------------------------

export const erasureRequestV1Schema = z.strictObject({
  erasureRequestId: erasureRequestIdSchema,
  contractVersion: z.literal(ERASURE_REQUEST_CONTRACT_VERSION),

  /** Only Core originates an erasure. It owns the identity being erased. */
  issuer: quickfurnoCoreSchema,

  /** Whose data. An opaque Core reference — erasing a person does not require naming them here. */
  subject: entityReferenceSchema,

  erasureType: erasureTypeSchema,

  /** Who asked. A human exercising a right, or a named retention policy falling due. */
  requestedBy: actorReferenceSchema,
  requestedAt: utcTimestampSchema,

  /** Which derived stores this must reach. Non-empty: an erasure that reaches nowhere is not one. */
  scopes: z.array(erasableScopeSchema).min(1),

  reasonCode: reasonCodeSchema,
  explanation: boundedText(TEXT_LIMITS.explanation).optional(),

  policy: policyReferenceSchema,

  correlationId: correlationIdSchema,
});

export type ErasureRequestV1 = z.infer<typeof erasureRequestV1Schema>;

// ---------------------------------------------------------------------------
// The record
// ---------------------------------------------------------------------------

/**
 * How far the erasure actually got.
 *
 * `partial` exists so that an honest system can say "we reached three of five stores and
 * the fourth is failing". A shape without it forces a lie in exactly the situation where
 * the truth matters most.
 */
export const ERASURE_OUTCOMES = ['completed', 'partial', 'failed'] as const;

export const erasureOutcomeSchema = z.enum(ERASURE_OUTCOMES);
export type ErasureOutcome = z.infer<typeof erasureOutcomeSchema>;

const erasureRecordShapeSchema = z.strictObject({
  erasureRequestId: erasureRequestIdSchema,
  contractVersion: z.literal(ERASURE_RECORD_CONTRACT_VERSION),

  /** Core records the completion. As with everything else, recording is what makes it true. */
  issuer: quickfurnoCoreSchema,

  subject: entityReferenceSchema,
  erasureType: erasureTypeSchema,

  outcome: erasureOutcomeSchema,

  /** Where it actually got to. This is the field a regulator reads. */
  scopesCompleted: z.array(erasableScopeSchema),
  /** Where it did not. Mandatory when the outcome is not `completed`. */
  scopesOutstanding: z.array(erasableScopeSchema),

  recordedAt: utcTimestampSchema,

  reasonCode: reasonCodeSchema,
  explanation: boundedText(TEXT_LIMITS.explanation).optional(),

  correlationId: correlationIdSchema,
});

export const erasureRecordV1Schema = erasureRecordShapeSchema.superRefine((value, ctx) => {
  // An erasure that erased nothing, nowhere, is not a completed erasure.
  if (value.outcome === 'completed' && value.scopesCompleted.length === 0) {
    ctx.addIssue({
      code: 'custom',
      path: ['scopesCompleted'],
      message: 'A completed erasure must name at least one scope it actually reached',
    });
  }

  // "Completed" with work left over is the single most dangerous record this contract
  // could carry: it closes the obligation while the data is still there.
  if (value.outcome === 'completed' && value.scopesOutstanding.length > 0) {
    ctx.addIssue({
      code: 'custom',
      path: ['scopesOutstanding'],
      message:
        'A completed erasure must have no outstanding scopes. If data remains anywhere, the outcome is "partial" — closing the obligation early is how data survives a deletion',
    });
  }

  // A partial or failed erasure that names nothing outstanding is claiming, by omission,
  // to have finished.
  if (value.outcome !== 'completed' && value.scopesOutstanding.length === 0) {
    ctx.addIssue({
      code: 'custom',
      path: ['scopesOutstanding'],
      message: `A "${value.outcome}" erasure must name the scopes it did not reach`,
    });
  }

  if (value.outcome === 'failed' && value.scopesCompleted.length > 0) {
    ctx.addIssue({
      code: 'custom',
      path: ['outcome'],
      message:
        'An erasure that reached some scopes is "partial", not "failed". The distinction is what tells an operator whether anything worked',
    });
  }

  // A scope cannot be both done and not done.
  const completed = new Set<string>(value.scopesCompleted);
  const overlap = value.scopesOutstanding.filter((scope) => completed.has(scope));
  if (overlap.length > 0) {
    ctx.addIssue({
      code: 'custom',
      path: ['scopesOutstanding'],
      message: 'A scope cannot be both completed and outstanding',
    });
  }
});

export type ErasureRecordV1 = z.infer<typeof erasureRecordV1Schema>;
