/**
 * The internal three-agent runtime composition (JF-4B/C/D, ADR-0150).
 *
 * ### What this adds, and what it deliberately does not
 *
 * JF-4A composed the Riya CUSTOMER path: private ingress → Mastra workflow → conversation service.
 * Anisha and Aarohi have no customer-facing wire and must not acquire one here — Riya's private web
 * contract is client-only by design, and widening it so a caller could choose its own party type would
 * reopen the one thing it exists to forbid.
 *
 * So this is an INTERNAL composition. It takes the already-built Riya customer runtime and the
 * already-built authoritative Jarvis runtime, and returns one object through which all three agents are
 * reachable. It binds no socket, starts no server, publishes no route and holds no credential.
 *
 * ### The same Mastra workflow, reused rather than copied
 *
 * The vendor and prospect turns run through `runCustomerTurnWorkflow` — the exact generic one-step
 * closure workflow JF-4A built. It was already generic: `<T>` over a supplied call, carrying an opaque
 * run marker and never the turn. So there is one Mastra architecture in this application, not three, and
 * the single-call / no-retry / no-memory guarantees are inherited rather than re-proved per agent.
 *
 * Riya's own entry point is untouched: `riyaCustomerRuntime` is the JF-4A composition, passed straight
 * through. This file adds nothing to the customer path.
 *
 * ### Routing stays where it is
 *
 * Nothing here decides which agent serves a turn. `assignAgent` does, inside the runtime, from the
 * party type the trusted caller stated — and this composition cannot influence it. A vendor turn and a
 * prospect turn are the same call into the same runtime; what differs is the party type on the envelope,
 * which is the caller's statement of fact.
 *
 * That is why there is no `handleVendorTurn` / `handleProspectTurn` pair below. Two methods would be two
 * places that believe something about a party, and the second one would eventually disagree.
 */
import type { JarvisRuntime } from '@qf-jarvis/jarvis-runtime';

import type { RiyaCustomerOrchestrationObservability } from './contracts.js';
import { runCustomerTurnWorkflow } from './mastra-customer-turn-runner.js';
import type { RiyaCustomerTurnRunner } from './create-riya-customer-runtime.js';

/**
 * The internal canonical shape an agent turn arrives in.
 *
 * Structural, and deliberately not a new wire schema: the authoritative envelope contract belongs to
 * `@qf-jarvis/agent-runtime`, and the runtime re-validates whatever it is handed. What this type says is
 * only that the caller is trusted and internal — there is no signature, no transport and no route here,
 * and JF-7 owns the external handshake.
 */
export interface InternalAgentTurn {
  readonly conversationId: string;
  readonly tenantId: string;
}

/** The agent-facing surface. One method, because one runtime decides which agent answers. */
export interface InternalAgentTurnRunner {
  /**
   * Run one non-customer agent turn through the Mastra workflow into the authoritative runtime.
   *
   * The envelope's party type decides whether Anisha or Aarohi is consulted, via `assignAgent`. This
   * method neither reads it nor cares: it is the orchestration boundary, not a router.
   */
  handleAgentTurn(turn: InternalAgentTurn): Promise<unknown>;
}

export interface ThreeAgentRuntimeConfig {
  /** The JF-4A Riya customer composition, passed through untouched. */
  readonly riyaCustomerRuntime: RiyaCustomerTurnRunner;
  /**
   * The composed authoritative Jarvis runtime. REQUIRED and never defaulted.
   *
   * It arrives already holding whichever behaviour input ports the deployment configured. An absent
   * vendor port means a VENDOR turn takes the legacy path; an absent Aarohi port means a PROSPECT turn
   * does. This composition supplies neither, because the authoritative source of both is a future
   * QuickFurno/Core adapter and a default here would be a fabricated business fact.
   */
  readonly jarvisRuntime: JarvisRuntime;
  readonly observability?: RiyaCustomerOrchestrationObservability;
}

export interface ThreeAgentRuntimeComposition {
  /** Riya, exactly as JF-4A composed her. Not re-wrapped. */
  readonly riyaCustomerRuntime: RiyaCustomerTurnRunner;
  /** Anisha and Aarohi, through the same Mastra workflow into the same runtime. */
  readonly internalAgentTurnRunner: InternalAgentTurnRunner;
}

/** Raised when the composition cannot be trusted. Content-free. */
export class ThreeAgentRuntimeCompositionError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = 'ThreeAgentRuntimeCompositionError';
    Object.freeze(this);
  }
}

/**
 * Compose the internal three-agent runtime.
 *
 * Fails closed on a missing Riya composition or a missing runtime. It cannot verify either is the REAL
 * one — that is the trusted composition boundary's job, as it has been since ADR-0147 — but it refuses
 * one that is structurally incapable of serving a turn.
 */
export function createThreeAgentJarvisRuntimeComposition(
  config: ThreeAgentRuntimeConfig,
): ThreeAgentRuntimeComposition {
  const supplied = config as unknown as
    { riyaCustomerRuntime?: unknown; jarvisRuntime?: unknown } | undefined;
  const riya = supplied?.riyaCustomerRuntime;
  const runtime = supplied?.jarvisRuntime;

  if (
    riya === null ||
    riya === undefined ||
    typeof riya !== 'object' ||
    typeof (riya as { handleConversationTurn?: unknown }).handleConversationTurn !== 'function'
  ) {
    throw new ThreeAgentRuntimeCompositionError(
      'A three-agent runtime requires the composed Riya customer runtime.',
    );
  }
  if (
    runtime === null ||
    runtime === undefined ||
    typeof runtime !== 'object' ||
    typeof (runtime as { processInbound?: unknown }).processInbound !== 'function'
  ) {
    throw new ThreeAgentRuntimeCompositionError(
      'A three-agent runtime requires the composed authoritative Jarvis runtime.',
    );
  }

  const jarvisRuntime = runtime as JarvisRuntime;
  const options = config.observability === undefined ? {} : { observability: config.observability };

  const internalAgentTurnRunner: InternalAgentTurnRunner = Object.freeze({
    handleAgentTurn(turn: InternalAgentTurn): Promise<unknown> {
      // The SAME generic workflow Riya's turns use. `WEB` is the orchestration channel label for the
      // observability event only -- it names where the shell ran, and the runtime reads the channel it
      // actually cares about off the envelope it validates.
      return runCustomerTurnWorkflow(
        () => jarvisRuntime.processInbound(turn as never),
        'WEB',
        options,
      );
    },
  });

  return Object.freeze({
    riyaCustomerRuntime: config.riyaCustomerRuntime,
    internalAgentTurnRunner,
  });
}
