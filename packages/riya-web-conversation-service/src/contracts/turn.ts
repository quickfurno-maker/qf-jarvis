/**
 * The service request: one trusted WEB conversation turn (RWC-P2C, ADR-0094).
 *
 * ### What a TRUSTED PRIVATE caller may supply
 *
 * - the tenant, conversation and message identity;
 * - the current message content;
 * - a **server-derived** `RuntimeDataClass`.
 *
 * ### What no caller may supply
 *
 * `channel`, `partyType` and `direction` are fixed by the service to `WEB`, `CLIENT` and `INBOUND`;
 * so are the actor, the model, the prompt, the tools and the `runtimeId`. Authority and business
 * state — consent, `canSubmit`, a lead, a vendor, a city or a price — have no field at all. None of
 * them appears in this shape, and the schema is `.strict()`, so supplying one is a refusal rather
 * than a value that is quietly ignored.
 *
 * That is the whole point of a narrow service boundary. The caller here is a QuickFurno server
 * gateway relaying a browser, and a browser that could name its own `partyType` could have Riya
 * answer it as a vendor.
 *
 * ### `dataClass` is NOT browser input
 *
 * It appears above because the authoritative runtime requires classified data — routing a turn
 * safely is not possible without knowing whether its content may leave a hosted boundary. It is
 * accepted here from a **trusted private caller**, and that is a different thing from being
 * caller-*chosen*.
 *
 * **This service does not, and cannot, prove where a `dataClass` came from.** It has no ingress, no
 * authentication and no notion of a browser; proving provenance is the job of the future private
 * ingress adapter, which is precisely why that adapter is a separate, later slice.
 *
 * The rule that adapter must hold: **derive or assign `RuntimeDataClass` under governed server-side
 * policy, and reject or ignore any browser attempt to choose it.** A browser-supplied classification
 * must never be forwarded through — a visitor that could label their own content `HOSTED_ALLOWED`
 * could route HUMAN_ONLY material to a hosted model, which is the one failure the class exists to
 * prevent. Direct browser access to this service remains forbidden (ADR-0092, ADR-0094).
 *
 * ### `webTurnRef` is opaque
 *
 * It maps to the runtime's existing `providerMessageRef`. The mature runtime field is NOT renamed
 * for the web (ADR-0092 §3 already established that the field is opaque and provider-neutral), and
 * a web turn reference is neither a URL nor a cookie nor a session token.
 */
import { RUNTIME_DATA_CLASSES } from '@qf-jarvis/agent-runtime';
import type { RuntimeDataClass } from '@qf-jarvis/agent-runtime';
import { z } from 'zod';

/**
 * The canonical runtime identifier grammar, restated.
 *
 * `[A-Za-z0-9._:-]`, 1–128 — the same shape the runtime envelope uses. Restated rather than
 * imported because that schema is private to the runtime kernel. The excluded characters do work:
 * no `@`, no `+`, no whitespace, so an email address or an E.164 number cannot become an identifier.
 */
const IDENTIFIER = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9._:-]+$/u);

/** A canonical UTC instant, matching what the runtime envelope accepts. */
const CANONICAL_INSTANT = z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/u);

/** One inbound WEB turn, as a trusted private caller supplies it. */
export interface RiyaWebConversationTurnV1 {
  readonly version: 1;
  readonly tenantId: string;
  readonly conversationId: string;
  readonly messageId: string;
  readonly receivedAt: string;
  /** Opaque reference to the web turn. Never a URL, cookie or session token. */
  readonly webTurnRef: string;
  /**
   * SERVER-DERIVED classification, supplied by the trusted private caller. Never browser input.
   *
   * A future ingress adapter must derive or assign this under governed server-side policy and must
   * not forward a browser-supplied value. This service cannot check that; the adapter must.
   */
  readonly dataClass: RuntimeDataClass;
  readonly subjectRef?: string;
  readonly normalizedText?: string;
}

/**
 * The strict turn schema.
 *
 * `.strict()` is load-bearing rather than tidy: it is what turns "the browser tried to set
 * `partyType`" from a silently dropped field into a refusal somebody can see.
 */
export const webConversationTurnSchema = z
  .object({
    version: z.literal(1),
    tenantId: IDENTIFIER,
    conversationId: IDENTIFIER,
    messageId: IDENTIFIER,
    receivedAt: CANONICAL_INSTANT,
    webTurnRef: z.string().min(1).max(256),
    dataClass: z.enum(RUNTIME_DATA_CLASSES),
    subjectRef: IDENTIFIER.optional(),
    // The same 4096 bound the runtime envelope already enforces. Restated so an oversized message
    // is refused at the service boundary rather than deep inside the runtime.
    normalizedText: z.string().max(4096).optional(),
  })
  .strict();
