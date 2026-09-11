/**
 * The production customer runtime composition (JF-4, ADR-0149).
 *
 * ### The one obvious place the customer path is assembled
 *
 * Before JF-4 there was no production module that wired the private ingress to the conversation
 * service — the ingress factory existed, the service factory existed, and only tests joined them. A
 * deployment therefore had no single artifact that said "this is the customer runtime", and the
 * question "does a customer turn go through Mastra?" had no answer that could be checked.
 *
 * This is that artifact. It returns the channel-neutral runner and an ingress-compatible facade, and
 * BOTH go through the Mastra workflow. There is no direct-service fallback in it, because a fallback
 * is what a composition quietly takes when the orchestration boundary is inconvenient.
 *
 * ### What it refuses to default
 *
 * Nothing. A conversation service must be supplied, and it must actually be one — a config missing it,
 * or carrying an object without the two entry points, fails at construction rather than at the first
 * customer turn. There is no default fake service, no default gateway, no in-memory continuity and no
 * permissive RAG anywhere in this file: every one of those would be a deployment that works in a test
 * and loses conversations in production.
 *
 * ### What it deliberately does not do
 *
 * It binds no socket, starts no server, reads no environment and holds no credential. JF-6 owns
 * process binding, readiness and operator controls. This returns objects.
 */
import type {
  RiyaConversationResultV1,
  RiyaConversationService,
  RiyaConversationTurnV1,
  RiyaWebConversationResultV2,
} from '@qf-jarvis/riya-web-conversation-service';

import type { RiyaCustomerOrchestrationObservability } from './contracts.js';
import { runCustomerTurnWorkflow } from './mastra-customer-turn-runner.js';

/** The WEB turn shape the ingress hands over. Structural: the schema belongs to the service. */
interface WebTurnLike {
  readonly webTurnRef: string;
}

/**
 * The channel-neutral customer runner.
 *
 * `handleTurn` exists so the existing private ingress composes unchanged — it is typed against a
 * service with that method, and the wire contract does not move. `handleConversationTurn` is the
 * channel-neutral surface WEB and WHATSAPP share.
 */
export interface RiyaCustomerTurnRunner {
  /** WEB, for the existing ingress. Delegates to the service's own `handleTurn`. */
  handleTurn(turn: WebTurnLike): Promise<RiyaWebConversationResultV2>;
  /** Channel-neutral (RWC-P8). One Riya, two surfaces. */
  handleConversationTurn(turn: RiyaConversationTurnV1): Promise<RiyaConversationResultV1>;
}

export interface RiyaCustomerRuntimeConfig {
  /**
   * The composed channel-neutral Riya conversation service. REQUIRED, and never defaulted.
   *
   * It arrives already holding the runtime, the continuity store and the turn coordinator. This
   * composition does not build it, does not inspect it and does not reach past it.
   */
  readonly conversationService: RiyaConversationService;
  /** Optional content-free orchestration observability. */
  readonly observability?: RiyaCustomerOrchestrationObservability;
}

export interface RiyaCustomerRuntimeComposition {
  /** The customer turn runner. Every turn through it goes through the Mastra workflow. */
  readonly customerTurnRunner: RiyaCustomerTurnRunner;
  /**
   * The object to hand `createPrivateRiyaWebIngressHandler` as its `service`.
   *
   * The same runner. Named separately because that is what the ingress calls it, and because a reader
   * checking "does the ingress go through Mastra?" should find the answer here rather than by
   * following a type.
   */
  readonly ingressService: RiyaCustomerTurnRunner;
}

/** Raised when the composition cannot be trusted. Content-free. */
export class RiyaCustomerRuntimeCompositionError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = 'RiyaCustomerRuntimeCompositionError';
    Object.freeze(this);
  }
}

/**
 * Compose the production customer runtime.
 *
 * Fails closed on a missing or unusable conversation service. It cannot verify that the service is the
 * REAL one — that is the trusted composition boundary's job, as it has been since ADR-0147 — but it
 * can refuse one that is structurally incapable of serving a turn, and it does.
 */
export function createRiyaCustomerRuntimeComposition(
  config: RiyaCustomerRuntimeConfig,
): RiyaCustomerRuntimeComposition {
  // Read through `unknown`, exactly as the private ingress already does with its own service option.
  // A caller one package away can pass anything through a cast, and the declared type is not a check.
  const supplied = config as unknown as { conversationService?: unknown } | undefined;
  const service: unknown = supplied?.conversationService;
  if (
    service === null ||
    service === undefined ||
    typeof service !== 'object' ||
    typeof (service as { handleTurn?: unknown }).handleTurn !== 'function' ||
    typeof (service as { handleChannelTurn?: unknown }).handleChannelTurn !== 'function'
  ) {
    throw new RiyaCustomerRuntimeCompositionError(
      'A Riya customer runtime requires a composed channel-neutral conversation service.',
    );
  }
  const conversationService = service as RiyaConversationService;
  const options = config.observability === undefined ? {} : { observability: config.observability };

  const customerTurnRunner: RiyaCustomerTurnRunner = Object.freeze({
    handleTurn(turn: WebTurnLike): Promise<RiyaWebConversationResultV2> {
      // The service's own WEB entry point runs INSIDE the workflow. Mapping `webTurnRef` to
      // `channelTurnRef` and fixing the channel stay where RWC-P8 put them; reimplementing that here
      // would be a second, drifting definition of what a WEB turn is.
      return runCustomerTurnWorkflow(
        () => conversationService.handleTurn(turn as never),
        'WEB',
        options,
      );
    },
    handleConversationTurn(turn: RiyaConversationTurnV1): Promise<RiyaConversationResultV1> {
      return runCustomerTurnWorkflow(
        () => conversationService.handleChannelTurn(turn),
        turn.channel,
        options,
      );
    },
  });

  return Object.freeze({
    customerTurnRunner,
    ingressService: customerTurnRunner,
  });
}
