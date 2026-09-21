/**
 * Internal proposal-only materialization.
 *
 * The method is intentionally unavailable when Core was consulted. A deployment that wires a Core
 * decision transport must use the Core-authorized materialization instead; it may not fall back to an
 * unapproved draft when Core rejects or is unavailable.
 */
import type { OrchestrationProposal } from '@qf-jarvis/agent-runtime';

import type { JarvisProposedReplyV1 } from '../contracts/proposed-reply.js';
import type { JarvisRuntimeOutcome } from '../contracts/reasons.js';

export function materializeProposedReply(
  outcome: JarvisRuntimeOutcome,
  coreConsulted: boolean,
  proposal: OrchestrationProposal,
  boundRevision: number,
): JarvisProposedReplyV1 | undefined {
  if (outcome !== 'MODEL_DRAFTED' || coreConsulted) return undefined;
  if (proposal.expectedRevision !== boundRevision) return undefined;
  const proposalKind = proposal.kind;
  if (proposalKind !== 'REPLY' && proposalKind !== 'FOLLOW_UP') return undefined;
  const replyBody = proposal.replyBody;
  if (replyBody === undefined || replyBody.length === 0) return undefined;

  return Object.freeze({
    version: 1 as const,
    proposalId: proposal.proposalId,
    boundRevision,
    proposalKind,
    authorityStatus: 'PENDING_CORE_VALIDATION' as const,
    replyBody,
  });
}
