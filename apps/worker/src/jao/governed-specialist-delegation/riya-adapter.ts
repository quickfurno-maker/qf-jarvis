/**
 * The JAO-2 Riya specialist adapter (ADR-0116).
 *
 * ### Riya's PURE BEHAVIOUR surface, and nothing else
 *
 * The only Riya import here is `decideRiyaTurn` and its two role constants. That function is
 * deterministic and structurally powerless by its own contract: it calls no model, holds no
 * credential, touches no transport, writes nothing, creates no proposal and mutates nothing. It
 * reads validated context and returns what SHOULD happen -- which is exactly what an advisory
 * delegation proof needs and the outer limit of what it may touch.
 *
 * Deliberately NOT imported, and asserted absent by a spec: `createRiyaProposal`, the live Riya
 * conversation service, the Jarvis inbound orchestrator, the model-reply adapter, communication
 * authorization, execution intent, n8n, WhatsApp and Meta. This is analysis, not sales.
 *
 * ### Riya's own guards stay superior
 *
 * A VENDOR party, a paused conversation, a human takeover or another AI actor owning the turn all
 * make Riya refuse, and this adapter preserves that refusal as the specialist's decision rather than
 * overriding, retrying or reinterpreting it. The supervisor asked; the specialist answered; a
 * refusal is an answer.
 *
 * ### `modelReplyEligible` is carried as DATA
 *
 * Riya may report that the merged model-reply boundary MAY be invoked for a turn. That is a fact
 * about Riya's decision, owned by whoever owns that boundary. JAO-2 makes zero model calls whatever
 * its value -- there is no gateway, no bridge and no provider anywhere in this slice -- and a spec
 * drives a `true` case end to end to prove it.
 *
 * Pure and synchronous: `decideRiyaTurn` is synchronous, so this adapter is too. No timer, no fake
 * async, no background work.
 */
import {
  RIYA_ACTOR,
  RIYA_SUPPORTED_PARTY,
  createNeedDiscovery,
  decideRiyaTurn,
  isClientSalesSignals,
} from '@qf-jarvis/riya-agent';
import type { RiyaTurnInput } from '@qf-jarvis/riya-agent';
import { RUNTIME_ACTORS, RUNTIME_PARTY_TYPES } from '@qf-jarvis/agent-runtime';
import type { RuntimeActor, RuntimePartyType } from '@qf-jarvis/agent-runtime';

import {
  jao2AdvisoryResultSchema,
  jao2RiyaSpecialistInputSchema,
  type Jao2AdvisoryResult,
  type Jao2RiyaSpecialistInput,
  type Jao2SpecialistDescriptor,
} from './contracts.js';
import { JAO2_RIYA_SPECIALIST } from './registry.js';

/** Riya's role constants, re-exported so a spec can prove the adapter did not redefine them. */
export const JAO2_RIYA_ACTOR = RIYA_ACTOR;
export const JAO2_RIYA_SUPPORTED_PARTY = RIYA_SUPPORTED_PARTY;

/**
 * Why the specialist could not answer.
 *
 * Two codes, and deliberately no `unavailable`: availability is the REGISTRY's decision and is made
 * before anything reaches this adapter, so an availability code here would be a second, weaker copy
 * of a gate that has already run.
 */
export class Jao2SpecialistError extends Error {
  readonly code: 'cancelled' | 'input-invalid';

  constructor(code: 'cancelled' | 'input-invalid') {
    super(`JAO-2 specialist ${code}`);
    this.name = 'Jao2SpecialistError';
    this.code = code;
  }
}

export interface Jao2SpecialistAdapter {
  readonly descriptor: Jao2SpecialistDescriptor;
  /** Synchronous, because the governed behaviour it delegates to is. Returns an unvalidated result. */
  invoke(input: Jao2RiyaSpecialistInput, signal?: AbortSignal): unknown;
}

function isRuntimePartyType(value: string): value is RuntimePartyType {
  return (RUNTIME_PARTY_TYPES as readonly string[]).includes(value);
}

function isRuntimeActor(value: string): value is RuntimeActor {
  return (RUNTIME_ACTORS as readonly string[]).includes(value);
}

/**
 * Build the Riya turn input from the parsed envelope.
 *
 * The party type and actor are narrowed against the CLOSED runtime vocabularies rather than cast: a
 * value outside them is refused here, so nothing invented by a caller reaches the specialist wearing
 * a runtime type it does not have. `VENDOR` is a real member and passes through on purpose -- Riya's
 * own role guard is what must refuse it, and a spec proves that is where the refusal happens.
 */
function toRiyaTurnInput(input: Jao2RiyaSpecialistInput): RiyaTurnInput {
  if (!isRuntimePartyType(input.partyType)) {
    throw new Jao2SpecialistError('input-invalid');
  }
  if (input.currentActor !== undefined && !isRuntimeActor(input.currentActor)) {
    throw new Jao2SpecialistError('input-invalid');
  }

  const needDiscovery =
    input.needDiscoveryCompleteness === undefined
      ? undefined
      : createNeedDiscovery({ completeness: input.needDiscoveryCompleteness });

  // Narrowed by Riya's OWN guard rather than cast. The envelope schema already mirrors the struct,
  // so this is a second, authoritative opinion from the package that owns the shape -- and if the two
  // ever drift, the delegation fails closed here instead of handing Riya something it did not expect.
  if (!isClientSalesSignals(input.signals)) {
    throw new Jao2SpecialistError('input-invalid');
  }

  return {
    partyType: input.partyType,
    ...(input.currentActor === undefined ? {} : { currentActor: input.currentActor }),
    signals: input.signals,
    ...(needDiscovery === undefined ? {} : { needDiscovery }),
    promptRef: input.promptRef,
    humanTakeover: input.humanTakeover,
    aiPaused: input.aiPaused,
  };
}

/**
 * The ONE adapter behind the registry.
 *
 * It validates, calls `decideRiyaTurn` at most once, and converts the decision into a strict
 * advisory result whose `advisoryOnly`, `businessEffect`, `proposalCreated` and `executionRequested`
 * are literals -- so the result cannot claim to have done anything, and a malformed conversion is
 * refused by the same parse rather than reaching a caller.
 */
export function createJao2RiyaSpecialistAdapter(
  descriptor: Jao2SpecialistDescriptor = JAO2_RIYA_SPECIALIST,
): Jao2SpecialistAdapter {
  return Object.freeze({
    descriptor,
    invoke(input: Jao2RiyaSpecialistInput, signal?: AbortSignal): unknown {
      if (signal?.aborted === true) {
        throw new Jao2SpecialistError('cancelled');
      }

      const parsed = jao2RiyaSpecialistInputSchema.safeParse(input);
      if (!parsed.success) {
        throw new Jao2SpecialistError('input-invalid');
      }

      const decision = decideRiyaTurn(toRiyaTurnInput(parsed.data));

      return jao2AdvisoryResultSchema.parse({
        specialistId: descriptor.specialistId,
        capabilityId: descriptor.capabilityId,
        behaviourVersion: String(decision.behaviourVersion),
        intent: decision.intent,
        disposition: decision.disposition,
        reason: decision.reason,
        // DATA. Preserved because it is part of Riya's answer, never read as authority here.
        modelReplyEligible: decision.modelReplyEligible,
        advisoryOnly: true,
        businessEffect: false,
        proposalCreated: false,
        executionRequested: false,
        decisionRefs: [
          `riya.behaviour:${String(decision.behaviourVersion)}`,
          `riya.actor:${decision.actor}`,
          `riya.disposition:${decision.disposition}`,
        ],
      }) satisfies Jao2AdvisoryResult;
    },
  });
}
