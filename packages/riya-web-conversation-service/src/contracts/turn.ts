/**
 * The service request: one trusted WEB conversation turn (RWC-P2C, ADR-0094).
 *
 * ### What a caller may say, and what it may not
 *
 * A caller supplies WHO the turn belongs to and WHAT was said. It does not supply what the turn IS.
 * `channel`, `partyType` and `direction` are fixed by the service to `WEB`, `CLIENT` and `INBOUND`;
 * so are the actor, the model, the prompt, the tools and the `runtimeId`. None of them appears in
 * this shape, and the schema is `.strict()`, so supplying one is a refusal rather than a value that
 * is quietly ignored.
 *
 * That is the whole point of a narrow service boundary. The caller here is a QuickFurno server
 * gateway relaying a browser, and a browser that could name its own `partyType` could have Riya
 * answer it as a vendor; one that could name its own `dataClass` could route HUMAN_ONLY content to
 * a hosted model.
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
