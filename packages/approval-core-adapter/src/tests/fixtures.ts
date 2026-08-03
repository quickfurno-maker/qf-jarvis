/**
 * Test plumbing: governed fixtures, a deterministic transport fake, and a proof holder.
 *
 * Not a test file, and NOT reachable from the package root — `tsconfig.build.json` excludes
 * `src/tests/**`, so nothing here reaches `dist/`. That exclusion matters more than usual: a
 * transport fake shipped in a production bundle is a transport, and the whole safety argument of
 * this package is that it cannot construct one.
 *
 * Every recommendation and request is built through the REAL merged runtimes. A hand-assembled
 * `ApprovalRequestV1` would prove only that this package agrees with a fixture; built through
 * `@qf-jarvis/recommendation-runtime` and `@qf-jarvis/approval-runtime`, the adapter is tested
 * against exactly what production would hand it.
 */
import { createRecommendationRuntime } from '@qf-jarvis/recommendation-runtime';
import type {
  RecommendationRuntimeIdentityPort,
  RecommendationRuntimeResult,
} from '@qf-jarvis/recommendation-runtime';
import { createApprovalRuntime } from '@qf-jarvis/approval-runtime';
import type { ApprovalDecisionV1, ApprovalRequestV1 } from '@qf-jarvis/contracts';

import type { ApprovalCoreAuthorizationProof, ApprovalCoreTransport } from '../contracts/api.js';

export const REC_CREATED_AT = '2026-08-02T09:00:00Z';
export const REC_EXPIRES_AT = '2026-08-04T09:00:00Z';
export const REQ_CREATED_AT = '2026-08-02T10:00:00Z';
export const REQ_EXPIRES_AT = '2026-08-03T10:00:00Z';
export const REQUESTED_AT = '2026-08-02T11:00:00Z';
export const DECIDED_AT = '2026-08-02T12:00:00Z';

export const POLICY = Object.freeze({ policyId: 'approval.policy', policyVersion: 3 });

/**
 * THE marker.
 *
 * One unmistakable string, carried only inside a proof holder. Every secrecy assertion in the suite
 * searches for exactly this: it cannot occur by coincidence, and if it appears in a serialized
 * command, a result, an error or a durable row, the holder leaked.
 */
export const PROOF_SECRET = 'QFJ-P08-PROOF-SECRET-c0ffee-DO-NOT-LEAK';

let uniqueCounter = 0;
function uniqueSuffix(): string {
  uniqueCounter += 1;
  return String(uniqueCounter).padStart(12, '0');
}

function sequentialRecommendationIdentity(tag: string): RecommendationRuntimeIdentityPort {
  let n = 0;
  return {
    nextRecommendationId: (): string => {
      n += 1;
      return `${tag}-0000-4000-8000-${String(n).padStart(12, '0')}`;
    },
    nextActionId: (): string => {
      n += 1;
      return `${tag}-1111-4000-8000-${String(n).padStart(12, '0')}`;
    },
  };
}

function actionDraft(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    actionType: 'schedule.follow-up',
    actionContractVersion: 1,
    summary: 'Schedule a follow-up with the vendor.',
    parameters: { channel: 'whatsapp', delayHours: 48 },
    ...over,
  };
}

/** A real governed recommendation. `tag` must be 8 lowercase hex characters. */
export function recommendationSource(
  tag: string,
  over: Record<string, unknown> = {},
): RecommendationRuntimeResult {
  return createRecommendationRuntime({
    identity: sequentialRecommendationIdentity(tag),
  }).create({
    recommendationType: 'vendor.follow-up',
    createdAt: REC_CREATED_AT,
    expiresAt: REC_EXPIRES_AT,
    producingAgent: 'anisha',
    producingAgentVersion: 'anisha.v1',
    subject: { entityType: 'vendor', entityId: 'vendor.42' },
    priority: 'medium',
    confidence: 0.8,
    risk: 'client-or-vendor-facing-communication',
    requiredApproval: 'authorized-team-human',
    summary: 'The vendor has not responded about the delayed sample.',
    rationale: 'Two follow-ups have gone unanswered for six days, past the agreed sample window.',
    evidence: [
      {
        evidenceType: 'derived-signal',
        signalCode: 'vendor.unresponsive',
        description: 'No vendor reply for six days.',
      },
    ],
    proposedActions: [actionDraft()],
    composite: false,
    correlationId: `${tag}-2222-4333-8444-555555555555`,
    ...over,
  });
}

/** Two actions, for the partial-approval proofs. */
export function twoActionSource(tag: string): RecommendationRuntimeResult {
  return recommendationSource(tag, {
    proposedActions: [
      actionDraft(),
      actionDraft({ actionType: 'notify.owner', summary: 'Tell the account owner.' }),
    ],
  });
}

/** A real approval request for one action of a real recommendation. */
export function approvalRequest(
  source: RecommendationRuntimeResult,
  over: {
    readonly actionIndex?: number;
    readonly createdAt?: string;
    readonly expiresAt?: string;
  } = {},
): ApprovalRequestV1 {
  const action = source.recommendation.proposedActions[over.actionIndex ?? 0];
  if (action === undefined) {
    throw new Error('fixture: no such action');
  }
  const id = `dddddddd-0000-4000-8000-${uniqueSuffix()}`;
  return createApprovalRuntime({
    identity: { nextApprovalRequestId: (): string => id },
  }).createRequest({
    source,
    proposedActionId: action.actionId,
    createdAt: over.createdAt ?? REQ_CREATED_AT,
    expiresAt: over.expiresAt ?? REQ_EXPIRES_AT,
    policy: POLICY,
  });
}

/** A named human operator, opaque to Jarvis exactly as the contract intends. */
export const OPERATOR = Object.freeze({
  actorType: 'human' as const,
  actor: Object.freeze({ entityType: 'operator' as const, entityId: 'human.approver.1' }),
});

/**
 * A well-formed Core decision over the given action verdicts.
 *
 * Cast rather than constructed: several specs deliberately hand it a shape Core could not have
 * issued -- a wrong `issuer`, an agent decider, a missing field -- precisely to prove the contract
 * refuses it.
 */
export function coreDecision(
  source: RecommendationRuntimeResult,
  actionDecisions: readonly {
    readonly actionId: string;
    readonly decision: 'approved' | 'rejected';
  }[],
  over: Record<string, unknown> = {},
): ApprovalDecisionV1 {
  const approved = actionDecisions.some((entry) => entry.decision === 'approved');
  return {
    decisionId: `eeeeeeee-0000-4000-8000-${uniqueSuffix()}`,
    recommendationId: source.recommendation.recommendationId,
    contractVersion: 1,
    issuer: 'quickfurno-core',
    decidedBy: {
      actorType: 'human',
      actor: { entityType: 'operator', entityId: 'human.approver.1' },
    },
    decidedAt: DECIDED_AT,
    outcome: approved ? 'approved' : 'rejected',
    actionDecisions: [...actionDecisions],
    reasonCode: 'core.decided',
    correlationId: source.recommendation.correlationId,
    ...over,
  } as unknown as ApprovalDecisionV1;
}

/**
 * A proof holder carrying the marker.
 *
 * The secret is a closure variable, not a property: there is no `holder.proof`, no getter, no
 * symbol-keyed field and nothing for `JSON.stringify`, `Object.keys` or a spread to find. The only
 * way to reach it is to be handed the holder and call `use`, which is exactly what a transport does
 * and nothing else does.
 */
export function proofHolder(secret: string = PROOF_SECRET): ApprovalCoreAuthorizationProof & {
  readonly uses: () => number;
} {
  let uses = 0;
  return Object.freeze({
    use: async <T>(operation: (proof: string) => Promise<T>): Promise<T> => {
      uses += 1;
      return operation(secret);
    },
    uses: (): number => uses,
  });
}

export interface TransportFake extends ApprovalCoreTransport {
  /** Every command this transport was handed, in order. */
  readonly commands: () => readonly string[];
  /** How many times a proof holder was actually opened. */
  readonly proofUses: () => number;
  readonly sends: () => number;
}

/**
 * A deterministic transport fake.
 *
 * `respond` decides what Core "returns" for a given command; throwing from it models an unreachable
 * Core. It opens the proof exactly the way a real transport would -- through `use` -- so the suite
 * can assert both that the proof IS reachable by a transport and that it is reachable by nothing
 * else.
 */
export function transportFake(
  respond: (command: string, proof: string) => Promise<string> | string,
): TransportFake {
  const commands: string[] = [];
  let proofUses = 0;
  let sends = 0;
  return Object.freeze({
    send: async (input: {
      readonly serializedCommand: string;
      readonly authorization: ApprovalCoreAuthorizationProof;
    }): Promise<string> => {
      sends += 1;
      commands.push(input.serializedCommand);
      return input.authorization.use(async (proof) => {
        proofUses += 1;
        return respond(input.serializedCommand, proof);
      });
    },
    commands: (): readonly string[] => [...commands],
    proofUses: (): number => proofUses,
    sends: (): number => sends,
  });
}

/** A transport that answers with the given decision, serialized as Core would. */
export function respondWith(decision: ApprovalDecisionV1): TransportFake {
  return transportFake(() => JSON.stringify(decision));
}
