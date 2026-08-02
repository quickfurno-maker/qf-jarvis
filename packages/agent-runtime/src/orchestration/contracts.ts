/**
 * The immutable M2 orchestration contracts (QFJ-M2, ADR-0055 §D, §E, §H).
 *
 * The revision-bound conversation context, exact knowledge citations, the provider-neutral reply
 * plan, the validated model reply draft, the authority-first proposal (always
 * `PENDING_CORE_VALIDATION`, no execute/send method), the immutable Core decision, and the
 * orchestration result. Every reference is EXACT — no wildcard/`latest` — and no raw provider object,
 * chain-of-thought, secret, or arbitrary metadata may enter.
 */
import { z } from 'zod';

import { AgentRuntimeError } from '../contracts/errors.js';
import { assertActorPartyCompatible } from '../contracts/scope.js';
import { PROPOSAL_AUTHORITY_STATUS } from '../contracts/vocabularies.js';
import type {
  ProposalAuthorityStatus,
  RuntimeActor,
  RuntimeDataClass,
  RuntimeExecutionClass,
  RuntimePartyType,
} from '../contracts/vocabularies.js';
import { CORE_DECISION_OUTCOMES, ORCHESTRATION_PROPOSAL_KINDS } from './vocabularies.js';
import type {
  CoreDecisionOutcome,
  OrchestrationProposalKind,
  OrchestrationReason,
} from './vocabularies.js';

const IDENTIFIER = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9._:-]+$/);
/**
 * A VERSION of an authored artefact: a knowledge citation, a model reply citation, a proposal.
 *
 * One-based and bounded, because there is no such thing as version 0 of a document that exists, and
 * a version in the millions is a bug rather than a catalogue. Deliberately NOT used for conversation
 * revision — see `REVISION` below.
 */
const VERSION = z.int().min(1).max(1_000_000);

/**
 * A CONVERSATION REVISION. A different domain that happened to share `VERSION`'s shape.
 *
 * A conversation revision is not an authored version. It is a monotonic compare-and-set counter over
 * one conversation's safe state, and its domain is fixed by the durable schema that owns it:
 * migration 0008 requires every new state row to start at **0** and permits values through
 * `Number.MAX_SAFE_INTEGER`.
 *
 * Validating it through `VERSION` was a semantic-domain conflation, and it had two real consequences
 * (QFJ-P08-B3 final review). A freshly provisioned conversation — revision 0, which the durable
 * trigger REQUIRES — was refused as `invalid-context` and could never be served. And any conversation
 * whose revision passed 1,000,000 would have become permanently unservable, silently, long after
 * deployment.
 *
 * Nothing caught it because the in-memory fake starts at revision 1: a value the durable schema
 * cannot produce. That is the precise reason a fake is not evidence about a database.
 *
 * `VERSION` is left exactly as it was. Widening it would have let version 0 into knowledge
 * citations, reply citations and `proposalVersion`, which is a real loosening of three unrelated
 * contracts to fix a fourth. This schema is private and reaches only the two revision-bearing
 * conversation fields.
 */
const REVISION = z.int().min(0).max(Number.MAX_SAFE_INTEGER);
const DIGEST = z.string().regex(/^[0-9a-f]{8,64}$/);

// ---------------------------------------------------------------------------
// Exact knowledge citation.
// ---------------------------------------------------------------------------
export interface KnowledgeCitation {
  readonly knowledgeId: string;
  readonly version: number;
  readonly source: string;
  readonly digest: string;
}
export const knowledgeCitationSchema = z
  .object({
    knowledgeId: IDENTIFIER,
    version: VERSION,
    source: z.string().min(1).max(256),
    digest: DIGEST,
  })
  .strict();

// ---------------------------------------------------------------------------
// Revision-bound conversation context.
// ---------------------------------------------------------------------------
export interface OrchestrationContext {
  readonly conversationId: string;
  readonly tenantId: string;
  readonly partyType: RuntimePartyType;
  readonly humanTakeover: boolean;
  readonly aiPaused: boolean;
  readonly cancelled: boolean;
  readonly dataClass: RuntimeDataClass;
  readonly revision: number;
  readonly subjectRef: string | undefined;
}

export interface OrchestrationContextInput {
  readonly conversationId: string;
  readonly tenantId: string;
  readonly partyType: RuntimePartyType;
  readonly dataClass: RuntimeDataClass;
  readonly revision: number;
  readonly humanTakeover?: boolean;
  readonly aiPaused?: boolean;
  readonly cancelled?: boolean;
  readonly subjectRef?: string | undefined;
}

const contextSchema = z
  .object({
    conversationId: IDENTIFIER,
    tenantId: IDENTIFIER,
    partyType: z.enum(['CLIENT', 'VENDOR', 'UNKNOWN']),
    dataClass: z.enum(['HOSTED_ALLOWED', 'LOCAL_ONLY', 'HUMAN_ONLY']),
    // A conversation revision, not an authored version: 0 is legitimate and required by the durable
    // schema for a freshly provisioned conversation.
    revision: REVISION,
    humanTakeover: z.boolean().default(false),
    aiPaused: z.boolean().default(false),
    cancelled: z.boolean().default(false),
    subjectRef: IDENTIFIER.optional(),
  })
  .strict();

/** Validate and freeze a revision-bound context. Throws `AgentRuntimeError('invalid-context')`. */
export function createOrchestrationContext(input: OrchestrationContextInput): OrchestrationContext {
  const parsed = contextSchema.safeParse(input);
  if (!parsed.success) {
    throw new AgentRuntimeError('invalid-context');
  }
  const c = parsed.data;
  return Object.freeze({
    conversationId: c.conversationId,
    tenantId: c.tenantId,
    partyType: c.partyType,
    humanTakeover: c.humanTakeover,
    aiPaused: c.aiPaused,
    cancelled: c.cancelled,
    dataClass: c.dataClass,
    revision: c.revision,
    subjectRef: c.subjectRef,
  });
}

// ---------------------------------------------------------------------------
// Exact model release identity.
// ---------------------------------------------------------------------------
export interface ModelReleaseRef {
  readonly releaseId: string;
  readonly providerId: string;
  readonly modelId: string;
  readonly modelVersion: string;
  readonly configDigest: string;
  readonly executionClass: RuntimeExecutionClass;
}

// ---------------------------------------------------------------------------
// Provider-neutral reply plan (passed to the injected model port).
// ---------------------------------------------------------------------------
export interface ReplyPlan {
  readonly runId: string;
  readonly conversationId: string;
  readonly assignedActor: RuntimeActor;
  readonly partyType: RuntimePartyType;
  readonly dataClass: RuntimeDataClass;
  readonly taskClass: string;
  readonly requiresStructuredOutput: true;
  readonly release: ModelReleaseRef;
  readonly promptFamily: string;
  readonly promptVersion: number;
  readonly capabilityProfileRef: string;
  readonly evaluationRef: string | undefined;
  readonly policyRevision: string;
  readonly citations: readonly KnowledgeCitation[];
  /** The minimized normalized inbound text — passed ONLY to the model port, never to observability. */
  readonly normalizedText: string | undefined;
}

// ---------------------------------------------------------------------------
// Validated model reply draft (returned by the injected model port).
// ---------------------------------------------------------------------------
export interface ModelReplyDraft {
  readonly structured: true;
  readonly replyBody: string;
  readonly citations: readonly { readonly knowledgeId: string; readonly version: number }[];
  readonly usageTraceId: string;
}
/** Strict schema: any raw body / header / chain-of-thought key makes the draft invalid. */
export const modelReplyDraftSchema = z
  .object({
    structured: z.literal(true),
    replyBody: z.string().min(1).max(8192),
    citations: z.array(z.object({ knowledgeId: IDENTIFIER, version: VERSION }).strict()).max(64),
    usageTraceId: IDENTIFIER,
  })
  .strict();

// ---------------------------------------------------------------------------
// Authority-first orchestration proposal.
// ---------------------------------------------------------------------------
export interface OrchestrationProposal {
  readonly proposalId: string;
  readonly proposalVersion: number;
  readonly conversationId: string;
  readonly expectedRevision: number;
  readonly assignedActor: RuntimeActor;
  readonly partyType: RuntimePartyType;
  readonly kind: OrchestrationProposalKind;
  readonly structuredIntent: Readonly<Record<string, string | number | boolean>>;
  readonly replyBody: string | undefined;
  readonly citations: readonly KnowledgeCitation[];
  readonly authorityStatus: ProposalAuthorityStatus;
}

export interface OrchestrationProposalInput {
  readonly proposalId: string;
  readonly proposalVersion: number;
  readonly conversationId: string;
  readonly expectedRevision: number;
  readonly assignedActor: RuntimeActor;
  readonly partyType: RuntimePartyType;
  readonly kind: OrchestrationProposalKind;
  readonly structuredIntent: Readonly<Record<string, string | number | boolean>>;
  readonly citations: readonly KnowledgeCitation[];
  readonly replyBody?: string | undefined;
}

const intentSchema = z.record(
  z
    .string()
    .min(1)
    .max(64)
    .regex(/^[A-Za-z0-9._:-]+$/),
  z.union([z.string().max(1024), z.number(), z.boolean()]),
);

const proposalSchema = z
  .object({
    proposalId: IDENTIFIER,
    // The proposal's OWN version stays a one-based authored version.
    proposalVersion: VERSION,
    conversationId: IDENTIFIER,
    // The conversation revision this proposal binds to. It must accept exactly what the context
    // accepts, or a revision-0 conversation would pass the gate and then fail to produce a proposal.
    expectedRevision: REVISION,
    kind: z.enum(ORCHESTRATION_PROPOSAL_KINDS),
    structuredIntent: intentSchema,
    citations: z.array(knowledgeCitationSchema).max(64),
    replyBody: z.string().min(1).max(8192).optional(),
  })
  .strict();

/**
 * Build a frozen `PENDING_CORE_VALIDATION` proposal. Enforces actor↔party scope (Riya client-only /
 * Anisha vendor-only). It carries no `send`/`execute`/`authorize`/`callN8n` method. Throws
 * `AgentRuntimeError('invalid-proposal' | 'scope-violation')`.
 */
export function createOrchestrationProposal(
  input: OrchestrationProposalInput,
): OrchestrationProposal {
  const parsed = proposalSchema.safeParse({
    proposalId: input.proposalId,
    proposalVersion: input.proposalVersion,
    conversationId: input.conversationId,
    expectedRevision: input.expectedRevision,
    kind: input.kind,
    structuredIntent: input.structuredIntent,
    citations: input.citations,
    ...(input.replyBody === undefined ? {} : { replyBody: input.replyBody }),
  });
  if (!parsed.success) {
    throw new AgentRuntimeError('invalid-proposal');
  }
  assertActorPartyCompatible(input.assignedActor, input.partyType);
  return Object.freeze({
    proposalId: input.proposalId,
    proposalVersion: input.proposalVersion,
    conversationId: input.conversationId,
    expectedRevision: input.expectedRevision,
    assignedActor: input.assignedActor,
    partyType: input.partyType,
    kind: input.kind,
    structuredIntent: Object.freeze({ ...input.structuredIntent }),
    replyBody: input.replyBody,
    citations: Object.freeze(input.citations.map((c) => Object.freeze({ ...c }))),
    authorityStatus: PROPOSAL_AUTHORITY_STATUS,
  });
}

// ---------------------------------------------------------------------------
// Immutable Core decision + orchestration result.
// ---------------------------------------------------------------------------
export interface CoreDecision {
  readonly outcome: CoreDecisionOutcome;
  readonly conversationId: string;
  readonly proposalId: string;
  readonly boundRevision: number;
}

/** Build a frozen Core decision. `outcome` comes ONLY from the injected port (never fabricated). */
export function coreDecision(
  outcome: CoreDecisionOutcome,
  conversationId: string,
  proposalId: string,
  boundRevision: number,
): CoreDecision {
  if (!CORE_DECISION_OUTCOMES.includes(outcome)) {
    throw new AgentRuntimeError('invalid-proposal');
  }
  return Object.freeze({ outcome, conversationId, proposalId, boundRevision });
}

/** The immutable orchestration result: a proposal (+ Core decision), or a fail-closed reason. */
export type OrchestrationResult =
  | {
      readonly ok: true;
      readonly assignedActor: RuntimeActor;
      readonly proposal: OrchestrationProposal;
      readonly decision: CoreDecision;
    }
  | { readonly ok: false; readonly reason: OrchestrationReason };
