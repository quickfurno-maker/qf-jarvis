/**
 * Invalid fixtures — every failure that must fail.
 *
 * This file is the one that actually proves the boundary. A valid fixture shows
 * the contract can express a legitimate fact; an **invalid** fixture shows it
 * cannot express an illegitimate one. The second is the property the architecture
 * depends on.
 *
 * The ones that matter most, and what they would mean if they ever passed:
 *
 * | Fixture | If it parsed |
 * | --- | --- |
 * | `jarvisClaimsApprovalAuthority` | An agent could approve its own recommendation |
 * | `executionIntentIssuedByJarvis` | Jarvis could manufacture authority by manufacturing an artifact |
 * | `executionIntentTargetingProvider` | The Jarvis-to-provider edge would exist |
 * | `executionIntentMissingIdempotencyKey` | A retry could double-send, or double-dial |
 * | `executionIntentWithHiddenRetryPermission` | A second effect could be authorized by a flag rather than a decision |
 * | `indeterminateResultClaimedAsSuccess` | A founder could be told a call connected when nobody knows |
 * | `communicationWithPhoneNumberRecipient` | A recipient could be addressed directly, bypassing Core's consent |
 * | `communicationStateOutsideTheEighteen` | The lifecycle could quietly fork |
 * | `compositeWithoutContributors` | A Jarvis conclusion could wear a specialist's disguise |
 *
 * No real data appears here. Where a fixture needs to look like a secret or a
 * phone number in order to be rejected, it uses an obviously fake one — and the
 * point of the fixture is that it is **refused**.
 */

import { TARGET_INVALID_FIXTURES } from './target-invalid.js';

import type { ContractName } from './valid.js';
import {
  FIXTURE_IDS,
  FIXTURE_TIMES,
  validActionableRecommendation,
  validApprovalDecisionByHuman,
  validCommunicationDraft,
  validCompositeRecommendation,
  validExecutionIntent,
  validExecutionResultIndeterminate,
  validInformationalRecommendation,
  validRecommendationCreatedEvent,
} from './valid.js';

export interface InvalidFixture {
  readonly name: string;
  readonly contract: ContractName;
  readonly value: unknown;
  /** What must be refused. Documentation for a human reading a failure. */
  readonly because: string;
}

/** A narrowing guard, not a type assertion. This package uses no assertions. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Build a variant of a fixture. Takes a deep copy first, so the original is never
 * touched — a mutated fixture is a test that passes for the wrong reason.
 */
function variantOf(fixture: object, mutate: (draft: Record<string, unknown>) => void): unknown {
  const draft: unknown = structuredClone(fixture);
  if (!isRecord(draft)) {
    throw new Error('A fixture variant must be built from an object fixture');
  }

  mutate(draft);
  return draft;
}

/**
 * The record elements of an array field, **by reference** — mutating one of them
 * mutates the draft it came from.
 */
function recordsAt(draft: Record<string, unknown>, key: string): Record<string, unknown>[] {
  const value = draft[key];
  if (!Array.isArray(value)) {
    throw new Error(`Expected an array at "${key}"`);
  }
  return value.filter(isRecord);
}

/** Replace the parameters of the first proposed action. */
function setFirstActionParameters(
  draft: Record<string, unknown>,
  parameters: Record<string, unknown>,
): void {
  const firstAction = recordsAt(draft, 'proposedActions')[0];
  if (firstAction !== undefined) {
    firstAction['parameters'] = parameters;
  }
}

/** A cyclic object cannot be a literal, so it is built. */
export function createCyclicValue(): unknown {
  const cyclic: Record<string, unknown> = { label: 'loop' };
  cyclic['self'] = cyclic;

  return variantOf(validActionableRecommendation, (draft) => {
    setFirstActionParameters(draft, { nested: cyclic });
  });
}

/** Nesting beyond the depth limit. */
function createDeeplyNestedValue(): unknown {
  let nested: Record<string, unknown> = { bottom: true };
  for (let level = 0; level < 20; level += 1) {
    nested = { nested };
  }

  return variantOf(validActionableRecommendation, (draft) => {
    setFirstActionParameters(draft, nested);
  });
}

/**
 * The revised contracts' invalid fixtures live in target-invalid.ts, purely for size.
 * They are appended to this table, so every one of them runs under the same
 * `rejects: $name` test as the fixtures below.
 */
export const INVALID_FIXTURES: readonly InvalidFixture[] = [
  ...TARGET_INVALID_FIXTURES,
  // -------------------------------------------------------------------------
  // Canonical event envelope
  // -------------------------------------------------------------------------
  {
    name: 'event: unknown event type',
    contract: 'CanonicalEvent',
    because: 'An unregistered type is rejected, never handled generically.',
    value: variantOf(validRecommendationCreatedEvent, (draft) => {
      draft['eventType'] = 'qf.lead.created';
    }),
  },
  {
    // Version 3, not 2. Version 2 became the *registered* version in Stage 3.1.4, so a fixture
    // asserting "an unknown version is rejected" had to move to a version that is genuinely
    // unknown — otherwise it would have quietly started asserting that a valid event is invalid,
    // which is the same test passing for the opposite reason.
    name: 'event: unknown (future) event version does not fall back to an earlier one',
    contract: 'CanonicalEvent',
    because: 'An unknown version is rejected, never guessed at, and never downgraded.',
    value: variantOf(validRecommendationCreatedEvent, (draft) => {
      draft['eventVersion'] = 3;
    }),
  },
  {
    // The one that matters most in this stage. v1 is no longer registered — it carried the
    // arbitrary `detail` string and the open `signals` dictionary — and a v1 event must now fail
    // closed rather than be parsed by a schema that never checked it (ADR-0026 §5).
    name: 'event: the superseded version 1 is no longer ingestible',
    contract: 'CanonicalEvent',
    because:
      'Version 1 permitted arbitrary free text and an open dictionary. It is deregistered, and a ' +
      'deregistered version is refused rather than silently accepted by some other contract.',
    value: variantOf(validRecommendationCreatedEvent, (draft) => {
      draft['eventVersion'] = 1;
    }),
  },
  {
    name: 'event: emitted before it occurred',
    contract: 'CanonicalEvent',
    because: 'An event announced before it happened is a clock fault or a forgery.',
    value: variantOf(validRecommendationCreatedEvent, (draft) => {
      draft['emittedAt'] = '2026-07-11T08:59:59Z';
    }),
  },
  {
    name: 'event: self-causation',
    contract: 'CanonicalEvent',
    because: 'An event may not cause itself; the audit walk would never terminate.',
    value: variantOf(validRecommendationCreatedEvent, (draft) => {
      draft['causationEventId'] = FIXTURE_IDS.event;
    }),
  },
  {
    name: 'event: source is not QuickFurno Core',
    contract: 'CanonicalEvent',
    because: 'Only Core emits canonical events. A fact is a fact once Core records it.',
    value: variantOf(validRecommendationCreatedEvent, (draft) => {
      draft['source'] = 'qf-jarvis';
    }),
  },
  {
    name: 'event: non-UTC timestamp',
    contract: 'CanonicalEvent',
    because: 'A local offset means two systems must agree on a timezone database first.',
    value: variantOf(validRecommendationCreatedEvent, (draft) => {
      draft['occurredAt'] = '2026-07-11T09:00:00+05:30';
    }),
  },
  {
    name: 'event: impossible calendar date',
    contract: 'CanonicalEvent',
    because: '30 February is well-formed and does not exist.',
    value: variantOf(validRecommendationCreatedEvent, (draft) => {
      draft['occurredAt'] = '2026-02-30T09:00:00Z';
    }),
  },
  {
    name: 'event: malformed event id',
    contract: 'CanonicalEvent',
    because: 'The event id is the idempotency identity; a malformed one is not an identity.',
    value: variantOf(validRecommendationCreatedEvent, (draft) => {
      draft['eventId'] = 'not-a-uuid';
    }),
  },
  {
    name: 'event: unknown extra field on the envelope',
    contract: 'CanonicalEvent',
    because: 'Strict envelopes. An unrecognized field is a contract mismatch, not a bonus.',
    value: variantOf(validRecommendationCreatedEvent, (draft) => {
      draft['signature'] = 'ignore-me';
    }),
  },

  // -------------------------------------------------------------------------
  // Authority — the fixtures that matter most
  // -------------------------------------------------------------------------
  {
    name: 'approval: Jarvis claims approval authority as the issuer',
    contract: 'ApprovalDecisionV1',
    because: 'Only QuickFurno Core issues an approval decision. No agent self-approval, ever.',
    value: variantOf(validApprovalDecisionByHuman, (draft) => {
      draft['issuer'] = 'qf-jarvis';
    }),
  },
  {
    name: 'approval: an agent is named as the deciding actor',
    contract: 'ApprovalDecisionV1',
    because: 'The actor union has no agent variant. An agent cannot be an approval authority.',
    value: variantOf(validApprovalDecisionByHuman, (draft) => {
      draft['decidedBy'] = { actorType: 'agent', agentId: 'jarvis' };
    }),
  },
  {
    name: 'approval: a rejected decision nonetheless approves an action',
    contract: 'ApprovalDecisionV1',
    because: 'Rejected actions cannot be treated as executable.',
    value: variantOf(validApprovalDecisionByHuman, (draft) => {
      draft['outcome'] = 'rejected';
    }),
  },
  {
    name: 'approval: an approved decision approves nothing',
    contract: 'ApprovalDecisionV1',
    because: 'Authorization with nothing to execute is an ambiguity Core would have to guess at.',
    value: variantOf(validApprovalDecisionByHuman, (draft) => {
      draft['actionDecisions'] = [];
    }),
  },
  {
    name: 'approval: duplicate action ids',
    contract: 'ApprovalDecisionV1',
    because: 'Two verdicts for one action id means neither can be relied upon.',
    value: variantOf(validApprovalDecisionByHuman, (draft) => {
      draft['actionDecisions'] = [
        { actionId: FIXTURE_IDS.actionA, decision: 'approved' },
        { actionId: FIXTURE_IDS.actionA, decision: 'rejected' },
      ];
    }),
  },
  {
    name: 'approval: validity expires before the decision was made',
    contract: 'ApprovalDecisionV1',
    because: 'An authorization that expired before it was granted authorizes nothing.',
    value: variantOf(validApprovalDecisionByHuman, (draft) => {
      draft['validUntil'] = '2026-07-11T09:29:00Z';
    }),
  },

  // -------------------------------------------------------------------------
  // Execution intent
  // -------------------------------------------------------------------------
  {
    name: 'execution intent: issued by Jarvis',
    contract: 'ExecutionIntentV1',
    because: 'Jarvis cannot manufacture authority by manufacturing an artifact.',
    value: variantOf(validExecutionIntent, (draft) => {
      draft['issuer'] = 'qf-jarvis';
    }),
  },
  {
    name: 'execution intent: targeting a provider directly instead of n8n',
    contract: 'ExecutionIntentV1',
    because: 'The Jarvis-to-provider edge does not exist. Only n8n executes.',
    value: variantOf(validExecutionIntent, (draft) => {
      draft['executor'] = 'whatsapp-provider';
    }),
  },
  {
    name: 'execution intent: missing idempotency key',
    contract: 'ExecutionIntentV1',
    because: 'Without it, a retry can double-send or double-dial.',
    value: variantOf(validExecutionIntent, (draft) => {
      delete draft['idempotencyKey'];
    }),
  },
  {
    name: 'execution intent: delivery semantics other than at-most-once',
    contract: 'ExecutionIntentV1',
    because: 'One intent may produce at most one provider call initiation.',
    value: variantOf(validExecutionIntent, (draft) => {
      draft['deliverySemantics'] = 'at-least-once';
    }),
  },
  {
    name: 'execution intent: retry permission hidden inside parameters',
    contract: 'ExecutionIntentV1',
    because: 'A second external effect requires a second decision, not a flag.',
    value: variantOf(validExecutionIntent, (draft) => {
      draft['parameters'] = { templateId: 'client-followup-v2', autoRetry: true, maxAttempts: 3 };
    }),
  },
  {
    name: 'execution intent: a provider credential in parameters',
    contract: 'ExecutionIntentV1',
    because: 'Jarvis holds no credential, so a contract carrying one is a bug or a breach.',
    value: variantOf(validExecutionIntent, (draft) => {
      draft['parameters'] = { templateId: 'client-followup-v2', apiKey: 'FAKE-NOT-A-REAL-KEY' };
    }),
  },
  {
    name: 'execution intent: a recipient phone number in parameters',
    contract: 'ExecutionIntentV1',
    because: 'Core resolves the recipient from its own records, against consent it owns.',
    value: variantOf(validExecutionIntent, (draft) => {
      draft['parameters'] = { templateId: 'client-followup-v2', to: '+919876543210' };
    }),
  },
  {
    name: 'execution intent: expires before it was issued',
    contract: 'ExecutionIntentV1',
    because: 'An expired intent authorizes nothing, and this one was born expired.',
    value: variantOf(validExecutionIntent, (draft) => {
      draft['expiresAt'] = '2026-07-11T09:30:00Z';
    }),
  },
  {
    name: 'execution intent: carries an execution status',
    contract: 'ExecutionIntentV1',
    because: 'An intent describes what may happen. What did happen is an execution result.',
    value: variantOf(validExecutionIntent, (draft) => {
      draft['status'] = 'sent';
    }),
  },

  // -------------------------------------------------------------------------
  // Execution result
  // -------------------------------------------------------------------------
  {
    name: 'execution result: an ambiguous outcome claimed as success',
    contract: 'ExecutionResultV1',
    because:
      'An indeterminate provider response must never be recorded as success. Nobody knows whether the call connected.',
    value: variantOf(validExecutionResultIndeterminate, (draft) => {
      draft['outcome'] = 'succeeded';
    }),
  },
  {
    name: 'execution result: indeterminate but marked retryable',
    contract: 'ExecutionResultV1',
    because:
      'Ambiguity is reconciled before another attempt. The answer is to find out, not to dial and see.',
    value: variantOf(validExecutionResultIndeterminate, (draft) => {
      draft['failure'] = {
        failureCode: 'provider.no-terminal-status',
        failureCategory: 'ambiguous',
        retryClassification: 'retryable',
      };
    }),
  },
  {
    name: 'execution result: failed with no structured failure',
    contract: 'ExecutionResultV1',
    because: 'A failure that cannot be counted cannot be governed.',
    value: variantOf(validExecutionResultIndeterminate, (draft) => {
      draft['outcome'] = 'failed';
      delete draft['failure'];
    }),
  },
  {
    name: 'execution result: carries a raw call transcript',
    contract: 'ExecutionResultV1',
    because: 'Transcripts and recordings are not part of a generic execution result.',
    value: variantOf(validExecutionResultIndeterminate, (draft) => {
      draft['metadata'] = { transcript: 'Hello, is this a good time to talk?' };
    }),
  },
  {
    name: 'execution result: reported by Jarvis',
    contract: 'ExecutionResultV1',
    because: 'Jarvis executes nothing, so it observes nothing to report.',
    value: variantOf(validExecutionResultIndeterminate, (draft) => {
      draft['reportingSystem'] = 'qf-jarvis';
    }),
  },

  // -------------------------------------------------------------------------
  // Recommendation
  // -------------------------------------------------------------------------
  {
    name: 'recommendation: produced by a system other than Jarvis',
    contract: 'RecommendationV1',
    because: 'Only QF Jarvis produces recommendations.',
    value: variantOf(validActionableRecommendation, (draft) => {
      draft['producingSystem'] = 'quickfurno-core';
    }),
  },
  {
    name: 'recommendation: expires before it was created',
    contract: 'RecommendationV1',
    because: 'A recommendation born stale cannot be acted upon and should never exist.',
    value: variantOf(validActionableRecommendation, (draft) => {
      draft['expiresAt'] = '2026-07-11T08:00:00Z';
    }),
  },
  {
    name: 'recommendation: no evidence',
    contract: 'RecommendationV1',
    because: '"The model thought so" is not evidence. A recommendation without it is a defect.',
    value: variantOf(validActionableRecommendation, (draft) => {
      draft['evidence'] = [];
    }),
  },
  {
    name: 'recommendation: duplicate action ids',
    contract: 'RecommendationV1',
    because: 'An approval that approves one action and rejects another could not say which.',
    value: variantOf(validCompositeRecommendation, (draft) => {
      const second = recordsAt(draft, 'proposedActions')[1];
      if (second !== undefined) {
        second['actionId'] = FIXTURE_IDS.actionA;
      }
    }),
  },
  {
    name: 'recommendation: composite without contributor attribution',
    contract: 'RecommendationV1',
    because: 'A composite with no attributable contributors is a Jarvis conclusion in disguise.',
    value: variantOf(validCompositeRecommendation, (draft) => {
      delete draft['contributingAgents'];
    }),
  },
  {
    name: 'recommendation: composite with duplicate contributors',
    contract: 'RecommendationV1',
    because: 'Attribution that names the same agent twice is not attribution.',
    value: variantOf(validCompositeRecommendation, (draft) => {
      draft['contributingAgents'] = ['kabir', 'kabir'];
    }),
  },
  {
    name: 'recommendation: composite produced by a specialist rather than Jarvis',
    contract: 'RecommendationV1',
    because:
      'Only the coordinator assembles a composite. A specialist concludes within its domain.',
    value: variantOf(validCompositeRecommendation, (draft) => {
      draft['producingAgent'] = 'kabir';
    }),
  },
  {
    name: 'recommendation: money-related but delegated approval',
    contract: 'RecommendationV1',
    because: 'Money escalates. Never delegated by default.',
    value: variantOf(validCompositeRecommendation, (draft) => {
      draft['requiredApproval'] = 'delegated-approver';
    }),
  },
  {
    name: 'recommendation: actionable but requires no approval',
    contract: 'RecommendationV1',
    because: 'Never "none" for anything that can reach a client, a vendor, or an ad account.',
    value: variantOf(validActionableRecommendation, (draft) => {
      draft['requiredApproval'] = 'none';
    }),
  },
  {
    name: 'recommendation: informational but proposes an action',
    contract: 'RecommendationV1',
    because: 'An informational item executes nothing, so it may propose nothing.',
    value: variantOf(validInformationalRecommendation, (draft) => {
      draft['proposedActions'] = [
        {
          actionId: FIXTURE_IDS.actionA,
          actionType: 'communication.send-whatsapp',
          actionContractVersion: 1,
          summary: 'Send a message.',
          parameters: {},
        },
      ];
    }),
  },
  {
    name: 'recommendation: an action claims it was approved',
    contract: 'RecommendationV1',
    because: 'Authority comes from Core, never from a key in a payload.',
    value: variantOf(validActionableRecommendation, (draft) => {
      setFirstActionParameters(draft, { templateId: 'client-followup-v2', approved: true });
    }),
  },
  {
    name: 'recommendation: an action carries a recipient email address',
    contract: 'RecommendationV1',
    because: "Contact details are Core's, and Core resolves them at execution time.",
    value: variantOf(validActionableRecommendation, (draft) => {
      setFirstActionParameters(draft, { to: 'someone@example.invalid' });
    }),
  },
  {
    name: 'recommendation: evidence carries hidden chain-of-thought',
    contract: 'RecommendationV1',
    because: 'Chain-of-thought is never stored, never logged, never surfaced.',
    value: variantOf(validActionableRecommendation, (draft) => {
      const second = recordsAt(draft, 'evidence')[1];
      if (second !== undefined) {
        second['value'] = { chainOfThought: 'First I considered, then I concluded.' };
      }
    }),
  },
  {
    name: 'recommendation: confidence outside 0..1',
    contract: 'RecommendationV1',
    because: 'Confidence is a bounded quantity, and it never informs permission anyway.',
    value: variantOf(validActionableRecommendation, (draft) => {
      draft['confidence'] = 1.5;
    }),
  },
  {
    name: 'recommendation: unknown extra field',
    contract: 'RecommendationV1',
    because: 'Strict objects. An unrecognized field is a contract mismatch.',
    value: variantOf(validActionableRecommendation, (draft) => {
      draft['autoApprove'] = true;
    }),
  },
  {
    name: 'recommendation: oversized summary',
    contract: 'RecommendationV1',
    because: 'Every string is bounded; an unbounded one is a smuggling route.',
    value: variantOf(validActionableRecommendation, (draft) => {
      draft['summary'] = 'x'.repeat(5000);
    }),
  },
  {
    name: 'recommendation: excessive JSON nesting in action parameters',
    contract: 'RecommendationV1',
    because: 'Depth is bounded, or a parser can be made to do unbounded work.',
    value: createDeeplyNestedValue(),
  },
  {
    name: 'recommendation: cyclic object in action parameters',
    contract: 'RecommendationV1',
    because: 'A cycle cannot be serialized, and a naive validator hangs on it.',
    value: createCyclicValue(),
  },
  {
    name: 'recommendation: non-finite number in action parameters',
    contract: 'RecommendationV1',
    because: 'NaN and Infinity are not JSON; stringify turns them into null.',
    value: variantOf(validActionableRecommendation, (draft) => {
      setFirstActionParameters(draft, { ratio: Number.POSITIVE_INFINITY });
    }),
  },
  {
    name: 'recommendation: an unknown agent name',
    contract: 'RecommendationV1',
    because: 'Five agents exist. A sixth is a typo or an invention.',
    value: variantOf(validActionableRecommendation, (draft) => {
      draft['producingAgent'] = 'sofia';
    }),
  },

  // -------------------------------------------------------------------------
  // Recommendation lifecycle
  // -------------------------------------------------------------------------
  {
    name: 'lifecycle: approved without a Core decision reference',
    contract: 'RecommendationLifecycleRecordV1',
    because: 'Jarvis never sets approved itself. The state requires the decision that produced it.',
    value: {
      recommendationId: FIXTURE_IDS.recommendation,
      contractVersion: 1,
      state: 'approved',
      recordedAt: FIXTURE_TIMES.recordedAt,
      reasonCode: 'core.decision-recorded',
      correlationId: FIXTURE_IDS.correlation,
    },
  },
  {
    name: 'lifecycle: a state outside the approved fourteen',
    contract: 'RecommendationLifecycleRecordV1',
    because: 'The lifecycle is authoritative. A state nobody approved is a fork of it.',
    value: {
      recommendationId: FIXTURE_IDS.recommendation,
      contractVersion: 1,
      state: 'auto-approved',
      recordedAt: FIXTURE_TIMES.recordedAt,
      reasonCode: 'timeout.elapsed',
      correlationId: FIXTURE_IDS.correlation,
    },
  },
  {
    name: 'lifecycle: executed without an execution intent reference',
    contract: 'RecommendationLifecycleRecordV1',
    because: 'Only approved recommendations become intents, and an execution must name one.',
    value: {
      recommendationId: FIXTURE_IDS.recommendation,
      contractVersion: 1,
      state: 'executed',
      recordedAt: FIXTURE_TIMES.recordedAt,
      reasonCode: 'n8n.execution-attempted',
      correlationId: FIXTURE_IDS.correlation,
    },
  },

  // -------------------------------------------------------------------------
  // Communication
  // -------------------------------------------------------------------------
  {
    name: 'communication: a state outside the authoritative eighteen',
    contract: 'CommunicationStateRecordV1',
    because: 'Eighteen states, exactly. A nineteenth forks the lifecycle.',
    value: variantOf(validCommunicationDraft, (draft) => {
      draft['state'] = 'opted-out';
    }),
  },
  {
    name: 'communication: a phone number where an opaque reference is required',
    contract: 'CommunicationStateRecordV1',
    because:
      "The recipient is a Core reference. A request naming an attacker's number is refused, not dialled.",
    value: variantOf(validCommunicationDraft, (draft) => {
      draft['recipient'] = { entityType: 'client', entityId: '+919876543210' };
    }),
  },
  {
    name: 'communication: an email address as the recipient',
    contract: 'CommunicationStateRecordV1',
    because: 'The entity-id character set excludes "@", so contact details cannot appear.',
    value: variantOf(validCommunicationDraft, (draft) => {
      draft['recipient'] = { entityType: 'client', entityId: 'someone@example.invalid' };
    }),
  },
  {
    name: 'communication: contact details attached beside the reference',
    contract: 'CommunicationStateRecordV1',
    because:
      "Strict objects. A reference must stay a pointer, never become a copy of Core's record.",
    value: variantOf(validCommunicationDraft, (draft) => {
      draft['recipient'] = {
        entityType: 'client',
        entityId: 'CORE-CLIENT-00311',
        phoneNumber: '+919876543210',
      };
    }),
  },
  {
    name: 'communication: a consent boolean copied from Core',
    contract: 'CommunicationStateRecordV1',
    because:
      'A stale copy of a permission is the most dangerous field in a system that reaches real people. Core enforces.',
    value: variantOf(validCommunicationDraft, (draft) => {
      draft['hasConsent'] = true;
    }),
  },
  {
    name: 'communication: delivered without a Core-recorded execution result',
    contract: 'CommunicationStateRecordV1',
    because: 'No provider state becomes authoritative until Core records it.',
    value: variantOf(validCommunicationDraft, (draft) => {
      draft['state'] = 'delivered';
    }),
  },
  {
    name: 'communication: authorized without a Core decision',
    contract: 'CommunicationStateRecordV1',
    because: "Authorized is not Jarvis's to write. It comes from Core, with a decision behind it.",
    value: variantOf(validCommunicationDraft, (draft) => {
      draft['state'] = 'authorized';
    }),
  },
];
