/**
 * The SYNTHETIC execution context one JF-5B certification turn runs inside.
 *
 * ### Why an operator has to build this at all
 *
 * A governed turn needs an authoritative conversation state, a Core decision boundary, and — for Riya
 * — a continuity row, a turn coordinator and a Core availability snapshot. A certification run has
 * none of those: there is no conversation, there is no QuickFurno Core, and this lane is forbidden
 * from integrating with either. So the operator supplies them, built through the SAME public
 * constructors production uses, from placeholders authored HERE.
 *
 * Every one of them is process memory. Nothing in this file opens a database, binds a socket, reads an
 * environment variable or persists a byte.
 *
 * ### Why no behaviour input port is wired
 *
 * `vendorJourneyBehaviourInput` and `aarohiAcquisitionBehaviourInput` carry facts QuickFurno Core owns
 * — a vendor's stage, a prospect's registration status, a package readiness band. This lane may not
 * invent one. Supplying fabricated certified artifacts so that a richer strategy would fire would mean
 * certifying a provider against a world the operator made up, and the receipt would then say nothing
 * about the deployment that actually exists.
 *
 * Absent is also what every deployment has today, which the runtime's own contract states: with no
 * port the turn takes the legacy eligible reply path, `assignAgent` still selects the agent from the
 * party type, and the per-scope binding still resolves that agent's OWN reviewed prompt. That is the
 * configuration JF-5B certifies, and it is measured as it is.
 *
 * ### Riya is different, and the difference is hers
 *
 * Anisha's and Aarohi's production prompts sit at `RESPONSE_GENERATION`, which is the task class the
 * ordinary inbound path resolves. Riya's three production variants do not: they are bound to her
 * dedicated task classes, and her reviewed bytes are only ever served through the RWC-P4B capability
 * behind the conversation service. Certifying her through the ordinary path would run her reviewed
 * system prompt against a schema she never runs under, and would then report that as "GROQ x RIYA".
 *
 * So Riya is certified through the real service, composed here with in-memory collaborators, and
 * reached through the SAME Mastra workflow the other two use.
 */
import { createInboundEnvelope, createRuntimePolicy } from '@qf-jarvis/agent-runtime';
import type { InboundEnvelope, RuntimeDataClass } from '@qf-jarvis/agent-runtime';
import type { CoreDecisionTransport } from '@qf-jarvis/core-decision-adapter';
import { parseCoreServiceAvailabilitySnapshotV1 } from '@qf-jarvis/core-service-availability-read';
import type {
  CoreServiceAvailabilityReadInput,
  CoreServiceAvailabilityReader,
} from '@qf-jarvis/core-service-availability-read';
import { createJarvisRuntime } from '@qf-jarvis/jarvis-runtime';
import type {
  AuthoritativeConversationStatePort,
  ConversationControlState,
  ConversationStateKey,
  JarvisRuntimeConfig,
  RiyaConversationEvolutionJarvisRuntime,
} from '@qf-jarvis/jarvis-runtime';
import {
  CERTIFIED_AGENTS,
  PROMPT_BY_AGENT,
} from '@qf-jarvis/jarvis-v1-provider-certification-live';
import type { CertifiedAgent } from '@qf-jarvis/jarvis-v1-provider-certification-live';
import type {
  ModelGatewayInvoker,
  ModelReplyPromptBinding,
  ModelReplyPromptBindings,
} from '@qf-jarvis/model-reply-adapter';
import { createPromptRegistry } from '@qf-jarvis/prompt-registry';
import type { PromptRegistry } from '@qf-jarvis/prompt-registry';
import { RIYA_PRODUCTION_PROMPTS } from '@qf-jarvis/riya-prompts';
import { createRiyaWebConversationService } from '@qf-jarvis/riya-web-conversation-service';
import type {
  RiyaContinuityCasOutcome,
  RiyaContinuityCreateResult,
  RiyaContinuityStoreKey,
  RiyaContinuityStorePort,
  RiyaConversationService,
  RiyaTurnBeginResult,
  RiyaTurnCoordinatorPort,
  RiyaTurnLease,
} from '@qf-jarvis/riya-web-conversation-service';

/** Obvious synthetic placeholders. No real tenant, conversation, vendor, prospect or client. */
export const JF5B_TENANT_ID = 'tenant.synthetic.jf5b';
export const JF5B_RUNTIME_ID = 'rt.jf5b.certification';
export const JF5B_POLICY_REVISION = 'policy.jf5b.rev.1';
export const JF5B_CAPABILITY_PROFILE_REF = 'cap.jf5b.structured.v1';

/** The party each certified agent is assigned from. `assignAgent` owns the mapping; this states it. */
export const PARTY_BY_AGENT: Readonly<Record<CertifiedAgent, 'CLIENT' | 'VENDOR' | 'PROSPECT'>> =
  Object.freeze({ RIYA: 'CLIENT', ANISHA: 'VENDOR', AAROHI: 'PROSPECT' });

/**
 * The evaluation reference each per-scope binding carries.
 *
 * A binding needs BOTH a reference and the digest it covers, or the adapter refuses it — correctly,
 * since an evaluation that does not say which bytes it assessed is the gap ADR-0073 closed. JF-5B is
 * the run that PRODUCES the measurement, so the reference names this run's suite rather than an
 * approval that does not exist: it is an identifier, and it approves nothing.
 */
const EVALUATION_REF_BY_AGENT: Readonly<Record<CertifiedAgent, string>> = Object.freeze({
  RIYA: 'evref-jf5b-riya',
  ANISHA: 'evref-jf5b-anis',
  AAROHI: 'evref-jf5b-aaro',
});

/** One per-scope prompt binding, naming that agent's own reviewed bytes and their exact digest. */
export function bindingFor(agent: CertifiedAgent): ModelReplyPromptBinding {
  const prompt = PROMPT_BY_AGENT[agent];
  return Object.freeze({
    promptFamily: prompt.promptId,
    promptVersion: prompt.promptVersion,
    evaluationRef: EVALUATION_REF_BY_AGENT[agent],
    // Read from the prompt package. A digest a caller could type is a digest that can disagree with
    // the bytes that actually ran.
    evaluationPromptDigest: prompt.contentDigest,
  });
}

/**
 * The per-scope bindings one certification runtime carries: exactly one, for exactly one agent.
 *
 * Written as three explicit cases rather than a computed key, because `ModelReplyPromptBindings` is a
 * closed four-scope record and a computed key would widen it to an index signature — which is how a
 * fourth scope could be configured by accident.
 */
export function bindingsFor(agent: CertifiedAgent): ModelReplyPromptBindings {
  const binding = bindingFor(agent);
  if (agent === 'RIYA') {
    return Object.freeze({ CLIENT: binding });
  }
  return agent === 'ANISHA'
    ? Object.freeze({ VENDOR: binding })
    : Object.freeze({ PROSPECT: binding });
}

/** The registry one certification runtime holds: exactly the prompts that agent can serve. */
export function registryFor(agent: CertifiedAgent): PromptRegistry {
  // Riya's reviewed body exists in three task-class variants and her capability picks between them,
  // so all three are registered. The other two agents have exactly one definition each.
  return agent === 'RIYA'
    ? createPromptRegistry([...RIYA_PRODUCTION_PROMPTS])
    : createPromptRegistry([PROMPT_BY_AGENT[agent]]);
}

// ---------------------------------------------------------------------------
// The synthetic collaborators. Process memory, certification only.
// ---------------------------------------------------------------------------

/** A clear synthetic control state for one certification turn. */
export function certificationControlState(
  over: Partial<ConversationControlState> = {},
): ConversationControlState {
  return Object.freeze({
    conversationId: 'conv.synthetic.jf5b',
    tenantId: JF5B_TENANT_ID,
    revision: 1,
    partyType: 'CLIENT',
    dataClass: 'HOSTED_ALLOWED',
    humanTakeover: false,
    aiPaused: false,
    cancelled: false,
    subjectStatus: 'clear',
    subjectRef: undefined,
    observedAt: '2026-09-11T00:00:00Z',
    ...over,
  });
}

/**
 * The ONE authoritative state source a certification turn reads.
 *
 * It refuses a key it does not serve, exactly as the shipped fakes do: a source that answered about
 * whatever it was asked would let a tenant-scoping regression pass unnoticed in the one run whose
 * whole job is to notice things.
 */
export function certificationAuthoritativeState(
  get: () => ConversationControlState,
): AuthoritativeConversationStatePort {
  return Object.freeze({
    read(key: ConversationStateKey): Promise<ConversationControlState> {
      const state = get();
      if (state.tenantId !== key.tenantId || state.conversationId !== key.conversationId) {
        throw new Error('jf5b-state-key-mismatch');
      }
      return Promise.resolve(state);
    },
  });
}

/**
 * The Core decision boundary, as a deterministic local responder.
 *
 * JF-5B certifies a PROVIDER against a reviewed prompt. Core is a different authority, this lane is
 * forbidden from integrating with QuickFurno, and a networked Core would put a business system in the
 * path of a measurement about a model. So the boundary is real — the adapter builds, signs and
 * validates a genuine command — and the responder is local.
 *
 * It ECHOES the identity it was sent, including `proposalDigest`, exactly as a conforming Core must.
 * A responder that recomputed the digest from its own view would agree with itself no matter what it
 * received, which would silently disable the RWC-P2D check for every certified case.
 */
export function certificationCoreTransport(decidedAt: string): CoreDecisionTransport {
  return Object.freeze({
    send(serializedCommand: string): Promise<string> {
      const command = JSON.parse(serializedCommand) as Record<string, unknown>;
      return Promise.resolve(
        JSON.stringify({
          protocol: command['protocol'],
          commandId: command['commandId'],
          idempotencyKey: command['idempotencyKey'],
          proposalId: command['proposalId'],
          proposalVersion: command['proposalVersion'],
          conversationId: command['conversationId'],
          boundRevision: command['expectedRevision'],
          proposalDigest: command['proposalDigest'],
          outcome: 'ACCEPTED',
          reason: 'core-decided',
          decidedAt,
        }),
      );
    },
  });
}

/** The synthetic Core availability snapshot, parsed through Core's own public parser. */
const JF5B_AVAILABILITY = parseCoreServiceAvailabilitySnapshotV1({
  version: 1,
  snapshotRef: 'core.snapshot.synthetic.jf5b.v1',
  taxonomyVersion: 1,
  cities: [
    { ref: 'city.alpha', displayName: 'City Alpha' },
    { ref: 'city.beta', displayName: 'City Beta' },
  ],
  services: [{ ref: 'service.alpha', displayName: 'Service Alpha' }],
  // Written out explicitly rather than implied by the two lists: stating the pairs is the rule the
  // reviewed prompt is written to obey, so an implicit snapshot would certify against a world where
  // that rule does not apply.
  availability: [{ serviceRef: 'service.alpha', cityRefs: ['city.alpha', 'city.beta'] }],
});

/** The availability reader. One snapshot, the same for every case, so only the turn varies. */
export function certificationAvailabilityReader(): CoreServiceAvailabilityReader {
  return Object.freeze({
    readCurrent(_input: CoreServiceAvailabilityReadInput): Promise<unknown> {
      return Promise.resolve(JF5B_AVAILABILITY);
    },
  });
}

/**
 * The continuity state, read OFF the store port rather than imported.
 *
 * The Riya continuity-contract package is PACKAGE-only — its own containment spec
 * pins that no application may import it, and that invariant is worth more than the convenience of
 * naming the type directly. The certification store never constructs a state: the conversation service
 * builds the initial one and hands it over, so holding what the port carries is all that is needed.
 */
type ContinuityState = Parameters<RiyaContinuityStorePort['createInitialIfAbsent']>[0]['state'];

/**
 * An in-memory continuity store, for THIS process and this run only.
 *
 * The production port has no default implementation, deliberately: an in-memory default would pass
 * every test and lose every conversation on restart. This is not that default — it is a certification
 * collaborator, constructed inside a one-shot executable, holding synthetic rows for turns that
 * describe nobody. It implements compare-and-set honestly rather than always answering `UPDATED`, so a
 * run cannot silently paper over a revision conflict it should have reconciled.
 */
export function certificationContinuityStore(): RiyaContinuityStorePort {
  const rows = new Map<string, ContinuityState>();
  const keyOf = (tenantId: string, conversationId: string): string =>
    [tenantId, conversationId].join('/');

  return Object.freeze({
    load(key: RiyaContinuityStoreKey): Promise<ContinuityState | undefined> {
      return Promise.resolve(rows.get(keyOf(key.tenantId, key.conversationId)));
    },
    createInitialIfAbsent(input: {
      readonly state: ContinuityState;
    }): Promise<RiyaContinuityCreateResult> {
      const id = keyOf(input.state.tenantId, input.state.conversationId);
      const existing = rows.get(id);
      if (existing !== undefined) {
        return Promise.resolve({ disposition: 'EXISTING' as const, state: existing });
      }
      rows.set(id, input.state);
      return Promise.resolve({ disposition: 'CREATED' as const, state: input.state });
    },
    compareAndSet(input: {
      readonly expectedRevision: number;
      readonly nextState: ContinuityState;
    }): Promise<RiyaContinuityCasOutcome> {
      const id = keyOf(input.nextState.tenantId, input.nextState.conversationId);
      const current = rows.get(id);
      if (current === undefined) {
        return Promise.resolve('NOT_FOUND' as const);
      }
      if (current.continuityRevision !== input.expectedRevision) {
        return Promise.resolve('REVISION_CONFLICT' as const);
      }
      rows.set(id, input.nextState);
      return Promise.resolve('UPDATED' as const);
    },
  });
}

/**
 * An in-memory turn coordinator, for THIS process and this run only.
 *
 * Same reasoning as the store, and the same refusal to be permissive: it remembers which logical
 * messages completed and answers `REPLAYED` for a repeat, so a corpus that accidentally reused a
 * message id would be caught rather than quietly certified twice. Each certification case carries its
 * own message id, so every one of them acquires.
 */
export function certificationTurnCoordinator(): RiyaTurnCoordinatorPort {
  const spent = new Set<string>();
  const inFlight = new Set<string>();

  return Object.freeze({
    begin(input: {
      readonly tenantId: string;
      readonly conversationId: string;
      readonly messageId: string;
    }): Promise<RiyaTurnBeginResult> {
      const message = [input.tenantId, input.messageId].join('/');
      const conversation = [input.tenantId, input.conversationId].join('/');
      if (spent.has(message)) {
        return Promise.resolve({ outcome: 'REPLAYED' as const });
      }
      if (inFlight.has(conversation)) {
        return Promise.resolve({ outcome: 'BUSY' as const });
      }
      inFlight.add(conversation);
      let finalized = false;
      const finalize = (markSpent: boolean): Promise<void> => {
        if (finalized) {
          // Every lease method is single-use; a second finalization would let one turn be reported
          // complete after it had already been recorded indeterminate.
          throw new Error('jf5b-lease-already-finalized');
        }
        finalized = true;
        inFlight.delete(conversation);
        if (markSpent) {
          spent.add(message);
        }
        return Promise.resolve();
      };
      const lease: RiyaTurnLease = Object.freeze({
        startProcessing: (): Promise<void> => Promise.resolve(),
        complete: (): Promise<void> => finalize(true),
        indeterminate: (): Promise<void> => finalize(true),
        releaseUnstarted: (): Promise<void> => finalize(false),
      });
      return Promise.resolve({ outcome: 'ACQUIRED' as const, lease });
    },
  });
}

// ---------------------------------------------------------------------------
// The runtimes.
// ---------------------------------------------------------------------------

export interface CertificationRuntimeInput {
  readonly agent: CertifiedAgent;
  readonly invoker: ModelGatewayInvoker;
  readonly state: () => ConversationControlState;
  readonly release: JarvisRuntimeConfig['release'];
  readonly clock: () => string;
}

/**
 * One composed runtime for one agent.
 *
 * Everything in it is the production composition: the real policy, the real per-scope binding, the
 * real registry, the real model reply adapter behind the injected invoker, and the real Core adapter
 * behind the local responder. What varies between the six certifications is the provider inside the
 * gateway the invoker wraps — which is the only thing that is supposed to vary.
 */
export function createCertificationRuntime(
  input: CertificationRuntimeInput,
): RiyaConversationEvolutionJarvisRuntime {
  const binding = bindingFor(input.agent);
  const config: JarvisRuntimeConfig = {
    authoritativeState: certificationAuthoritativeState(input.state),
    policy: createRuntimePolicy({ policyRevision: JF5B_POLICY_REVISION }),
    clock: input.clock,
    release: input.release,
    promptBindings: bindingsFor(input.agent),
    // Riya's reviewed bytes are served ONLY through her dedicated capability, so her binding is
    // supplied there as well. The scope binding above exists because a runtime must declare at least
    // one configured agent; nothing in a Riya certification resolves it.
    ...(input.agent === 'RIYA' ? { riyaConversationEvolutionPromptBinding: binding } : {}),
    promptRegistry: registryFor(input.agent),
    capabilityProfileRef: JF5B_CAPABILITY_PROFILE_REF,
    gatewayInvoker: input.invoker,
    coreTransport: certificationCoreTransport('2026-09-11T00:00:05Z'),
    // A model identity without an evaluation reference is refused. JF-5B always supplies one.
    requireEvaluationRef: true,
  };
  return createJarvisRuntime(config);
}

/** The Riya conversation service, composed over that runtime with the in-memory collaborators. */
export function createCertificationRiyaService(
  runtime: RiyaConversationEvolutionJarvisRuntime,
): RiyaConversationService {
  return createRiyaWebConversationService({
    runtime,
    continuityStore: certificationContinuityStore(),
    availabilityReader: certificationAvailabilityReader(),
    runtimeId: JF5B_RUNTIME_ID,
    turnCoordinator: certificationTurnCoordinator(),
    // One at a time. Concurrency is not what is being measured, and serial execution keeps the raw
    // bundle readable in the order the cases were written.
    maxConcurrentTextTurns: 1,
  });
}

/** The inbound envelope for one internal (Anisha or Aarohi) certification turn. */
export function certificationEnvelope(input: {
  readonly agent: CertifiedAgent;
  readonly conversationId: string;
  readonly messageId: string;
  readonly text: string;
  readonly dataClass: RuntimeDataClass;
  readonly receivedAt: string;
}): InboundEnvelope {
  return createInboundEnvelope({
    runtimeId: JF5B_RUNTIME_ID,
    conversationId: input.conversationId,
    messageId: input.messageId,
    tenantId: JF5B_TENANT_ID,
    channel: 'WEB',
    partyType: PARTY_BY_AGENT[input.agent],
    direction: 'INBOUND',
    receivedAt: input.receivedAt,
    providerMessageRef: `ref.jf5b.${input.messageId}`,
    dataClass: input.dataClass,
    normalizedText: input.text,
  });
}

/** The three agents, in the fixed order every JF-5B artifact uses. */
export const JF5B_AGENTS: readonly CertifiedAgent[] = CERTIFIED_AGENTS;
