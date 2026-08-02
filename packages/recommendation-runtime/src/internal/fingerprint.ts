/**
 * The action content fingerprint (QFJ-P05.05, ADR-0079).
 *
 * `ApprovalRequestV1` requires an `actionFingerprint`, and `@qf-jarvis/contracts` deliberately
 * declares its SHAPE without computing it — a contracts package that hashed things would be a
 * contracts package with behaviour. This is the producer.
 *
 * ### What it binds, and what it deliberately does not
 *
 * The digest covers the action's CONTENT and nothing else:
 *
 *     { actionType, actionContractVersion, summary, parameters }
 *
 * `actionId` is EXCLUDED. That is the load-bearing decision of this module, and it is not an
 * oversight: `ApprovalRequestV1` already carries `proposedActionId` as a separate field, so identity
 * is bound there. Including it in the digest too would make the fingerprint useless for the one
 * question it exists to answer — "is the thing being approved still the thing that was proposed?" —
 * because every regenerated recommendation would produce a different digest for an identical action,
 * and no two proposals could ever be compared.
 *
 * The consequences are exact, and both are tested:
 *
 * - same content, different `actionId` → the SAME fingerprint;
 * - same `actionId`, changed content → a DIFFERENT fingerprint.
 *
 * The second is what a human approving an action is actually relying on. Between a recommendation
 * being written and an approval being granted, the digest is what makes a silent parameter edit
 * detectable.
 *
 * Nothing contextual is included: no `recommendationId`, no subject, no timestamp, no correlation
 * id, no approval state. Those describe the SITUATION, not the action, and folding them in would
 * again make identical actions hash differently.
 *
 * ### It is not a signature
 *
 * A SHA-256 over public content is a content binding and nothing more. It is unkeyed, so anyone can
 * compute it; it proves neither origin nor authorization. Authority comes from Core, recorded in an
 * approval decision (ADR-0002). Treating this value as proof of anything but "the bytes are the same
 * bytes" would be a category error.
 */
import { createHash } from 'node:crypto';

import { actionFingerprintSchema, proposedActionSchema } from '@qf-jarvis/contracts';
import type { ActionFingerprint, ProposedAction } from '@qf-jarvis/contracts';

import { RecommendationRuntimeError } from '../contracts/errors.js';
import { canonicalJson } from './canonical-json.js';

/**
 * The domain separator, prefixed to the canonical JSON before hashing.
 *
 * Without one, a digest of an action's content is also a digest of any other structure that happens
 * to canonicalize to the same string — a cross-protocol collision that costs nothing to prevent and
 * cannot be retrofitted once fingerprints exist in stored approval records.
 *
 * It carries an explicit `.v1`. Changing the canonicalization, the covered field set, or this
 * string produces different digests for unchanged actions, so it is a governed contract change and
 * needs a new version, not an edit.
 */
export const ACTION_CONTENT_DOMAIN_SEPARATOR = 'qf-jarvis.proposed-action-content.v1\n';

/**
 * The exact content covered by the digest. Four fields, in the canonicalizer's hands.
 *
 * Key order here is irrelevant — `canonicalJson` sorts — but the SET is the contract.
 */
function actionContentOf(action: ProposedAction): Record<string, unknown> {
  return {
    actionType: action.actionType,
    actionContractVersion: action.actionContractVersion,
    summary: action.summary,
    parameters: action.parameters,
  };
}

/** The exact preimage, for the golden vector and for anyone reproducing a digest by hand. */
export function actionContentPreimage(action: ProposedAction): string {
  return `${ACTION_CONTENT_DOMAIN_SEPARATOR}${canonicalJson(actionContentOf(action))}`;
}

/**
 * Compute the canonical SHA-256 content fingerprint of one proposed action.
 *
 * The action is re-validated through `proposedActionSchema` first. The static type is not evidence:
 * this is a public entry point, and an untyped caller or a deserialized value arrives as a plain
 * object TypeScript never inspected. Hashing an unvalidated action would produce a well-formed
 * digest of malformed content — which is worse than refusing, because it looks correct.
 *
 * The input is never mutated.
 */
export function fingerprintProposedAction(action: ProposedAction): ActionFingerprint {
  const parsed = proposedActionSchema.safeParse(action);
  if (!parsed.success) {
    // The Zod issue tree is discarded: `parameters` is governed precisely because it may contain
    // something that must never be echoed, and an error that quoted the rejected value would have
    // logged it.
    throw new RecommendationRuntimeError('invalid-input');
  }

  let digest: string;
  try {
    digest = createHash('sha256').update(actionContentPreimage(parsed.data), 'utf8').digest('hex');
  } catch {
    throw new RecommendationRuntimeError('fingerprint-failure');
  }

  // Lowercase 64-hex, checked against the contract rather than assumed from the algorithm.
  const fingerprint = actionFingerprintSchema.safeParse(digest);
  if (!fingerprint.success) {
    throw new RecommendationRuntimeError('fingerprint-failure');
  }
  return fingerprint.data;
}
