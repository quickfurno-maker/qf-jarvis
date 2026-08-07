/**
 * The private ingress wire contracts (ADR-0097).
 *
 * ### The browser is not the caller
 *
 * The topology is Browser → QuickFurno server → **this** ingress → the RWC-P2C/P2D service. A browser
 * never reaches Jarvis. So this request shape is what a trusted QuickFurno SERVER may send, and every
 * field in it is something a server-side gateway is entitled to assert about a turn it relayed.
 *
 * ### There is no `dataClass` field, and that is the point
 *
 * ADR-0094 recorded the rule this slice has to implement: `RuntimeDataClass` must be derived or
 * assigned under governed server-side policy, and a browser attempt to choose it must never be
 * forwarded. A visitor who could label their own content `HOSTED_ALLOWED` could route HUMAN_ONLY
 * material to a hosted model — the single failure the class exists to prevent.
 *
 * An OPTIONAL `dataClass` that the ingress ignored would not be enough. Somebody would send it,
 * nothing would complain, and the next reader would reasonably assume it mattered. So the field does
 * not exist and the schema is `.strict()`: supplying it is a refusal somebody can see, not a value
 * quietly dropped.
 *
 * The same applies to every authority and business field. `channel`, `partyType`, `direction`, the
 * actor, the model, the prompt, the tools, the `runtimeId`, consent, suppression, `canSubmit`, a
 * lead, a vendor, a city, a package, a price, an approval flag or a delivery status have no field
 * here at all. Jarvis recommends; QuickFurno Core authorizes.
 */
import { z } from 'zod';

/** The wire protocol name. Distinct from `qfj.core.decision` — a different boundary entirely. */
export const PRIVATE_RIYA_WEB_INGRESS_PROTOCOL = 'qfj.riya.web.ingress' as const;

/** The only caller this version recognises: the QuickFurno server-side gateway. */
export const PRIVATE_RIYA_WEB_INGRESS_CALLER = 'quickfurno-core' as const;

/** The audience a signature must name. A signature for another audience is not for this ingress. */
export const PRIVATE_RIYA_WEB_INGRESS_AUDIENCE = 'qf-jarvis-private-riya-web' as const;

/** The one route. Fixed, signed, and never pattern-matched. */
export const PRIVATE_RIYA_WEB_INGRESS_METHOD = 'POST' as const;
export const PRIVATE_RIYA_WEB_INGRESS_PATH = '/internal/v1/riya/web-turn' as const;

/**
 * The canonical runtime identifier grammar, restated.
 *
 * `[A-Za-z0-9._:-]`, 1–128 — the same shape the runtime envelope and the RWC-P2C turn use. The
 * excluded characters do work: no `@`, no `+`, no whitespace, so an email address or an E.164 number
 * cannot become an identifier.
 */
const IDENTIFIER = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9._:-]+$/u);

/** A canonical UTC instant, matching what the runtime envelope accepts. */
const CANONICAL_INSTANT = z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/u);

/** One inbound WEB turn as a trusted QuickFurno server sends it. */
export interface PrivateRiyaWebIngressRequestV1 {
  readonly protocol: typeof PRIVATE_RIYA_WEB_INGRESS_PROTOCOL;
  readonly version: 1;
  readonly caller: typeof PRIVATE_RIYA_WEB_INGRESS_CALLER;
  readonly audience: typeof PRIVATE_RIYA_WEB_INGRESS_AUDIENCE;
  /** Unique per request. Signed, and the replay guard's key. Never reused for a different body. */
  readonly requestId: string;
  /** When the CALLER signed this request. Freshness is checked against it. */
  readonly issuedAt: string;
  readonly tenantId: string;
  readonly conversationId: string;
  readonly messageId: string;
  /**
   * When the TURN was received from the browser. Deliberately distinct from `issuedAt`: a gateway
   * may batch, queue or retry-with-a-new-signature, and collapsing the two would let transport
   * timing rewrite conversation timing.
   */
  readonly receivedAt: string;
  /** Opaque reference to the web turn. Never a URL, cookie or session token. */
  readonly webTurnRef: string;
  readonly subjectRef?: string;
  readonly normalizedText?: string;
}

/**
 * The strict request schema.
 *
 * `.strict()` is load-bearing rather than tidy: it is what turns "the gateway forwarded the browser's
 * `dataClass`" from a silently dropped field into a refusal somebody can see.
 */
export const privateRiyaWebIngressRequestSchema = z
  .object({
    protocol: z.literal(PRIVATE_RIYA_WEB_INGRESS_PROTOCOL),
    version: z.literal(1),
    caller: z.literal(PRIVATE_RIYA_WEB_INGRESS_CALLER),
    audience: z.literal(PRIVATE_RIYA_WEB_INGRESS_AUDIENCE),
    requestId: IDENTIFIER,
    issuedAt: CANONICAL_INSTANT,
    tenantId: IDENTIFIER,
    conversationId: IDENTIFIER,
    messageId: IDENTIFIER,
    receivedAt: CANONICAL_INSTANT,
    webTurnRef: z.string().min(1).max(256),
    subjectRef: IDENTIFIER.optional(),
    // The same 4096 bound the runtime envelope and the P2C turn already enforce, restated so an
    // oversized message is refused at the outermost boundary rather than deep inside a service.
    normalizedText: z.string().max(4096).optional(),
  })
  .strict();

/**
 * The Core-authorized reply, as it appears on the wire.
 *
 * Structurally the P2D `JarvisCoreAuthorizedReplyV1`, restated here because this is a WIRE contract:
 * a shape a QuickFurno server parses must not silently change because an internal type moved.
 */
export interface PrivateRiyaWebIngressAuthorizedReplyV1 {
  readonly version: 1;
  readonly proposalId: string;
  readonly boundRevision: number;
  readonly proposalKind: 'REPLY' | 'FOLLOW_UP';
  readonly replyBody: string;
}

/**
 * The private success response. MINIMAL by construction.
 *
 * What is deliberately absent is the substance of this contract. No `continuity` — the working state
 * of a conversation is Jarvis's, and putting it on a wire would make it something a QuickFurno server
 * could read, cache or come to depend on. No `discovery`, `fieldProvenance`, `summaryConfirmed` or
 * `completionEvidenceRef` for the same reason. No `runId`, `provenance`, `modelDrafted`,
 * `coreConsulted`, `proposalDigest`, `idempotencyKey`, model, provider, prompt, database detail or
 * stack: operational internals are not a client's business, and each one is a thing somebody would
 * eventually branch on.
 *
 * `authorizedReply` is `null` unless QuickFurno Core actually authorized that exact proposal. A
 * `disposition` of `PROCESSED` is NOT permission to show text.
 */
export interface PrivateRiyaWebIngressResponseV1 {
  readonly protocol: typeof PRIVATE_RIYA_WEB_INGRESS_PROTOCOL;
  readonly version: 1;
  readonly requestId: string;
  readonly tenantId: string;
  readonly conversationId: string;
  readonly messageId: string;
  readonly disposition: 'PROCESSED' | 'REFUSED' | 'NOT_READY';
  /** The service's own closed reason token, or `null`. Never a message, model output or exception. */
  readonly reason: string | null;
  readonly authorizedReply: PrivateRiyaWebIngressAuthorizedReplyV1 | null;
}

/** The private failure response. A code, and nothing that could carry content. */
export interface PrivateRiyaWebIngressErrorResponseV1 {
  readonly protocol: typeof PRIVATE_RIYA_WEB_INGRESS_PROTOCOL;
  readonly version: 1;
  readonly error: string;
}
