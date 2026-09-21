/**
 * A validated Jarvis reply proposal that still requires QuickFurno authorization.
 *
 * This is deliberately separate from JarvisCoreAuthorizedReplyV1. It is exposed only when the
 * runtime completed with MODEL_DRAFTED and no Core transport was wired. The body passed every Jarvis
 * model/reply/state/privacy gate, but it is NOT authorized, sent or queued.
 */
import type { JarvisRuntimeResult } from './runtime-result.js';

export type ProposedTextCarryingProposalKind = 'REPLY' | 'FOLLOW_UP';

export interface JarvisProposedReplyV1 {
  readonly version: 1;
  readonly proposalId: string;
  readonly boundRevision: number;
  readonly proposalKind: ProposedTextCarryingProposalKind;
  readonly authorityStatus: 'PENDING_CORE_VALIDATION';
  readonly replyBody: string;
}

export interface JarvisProposedReplyResult {
  readonly runtimeResult: JarvisRuntimeResult;
  readonly proposedReply: JarvisProposedReplyV1 | undefined;
}
