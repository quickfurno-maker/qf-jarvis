/**
 * The opaque references RWC-P6 carries across the Core boundary (ADR-0101).
 *
 * ### Why a dedicated grammar rather than a borrowed identifier type
 *
 * The repository has plenty of identifier schemas — `eventIdSchema`, `clientConfirmationIdSchema`,
 * `recommendationIdSchema`, `decisionIdSchema`, `linkedLeadIdSchema` — and every one of them would
 * technically hold a P6 evidence string. Reusing one is exactly the mistake the owner ruled out, and
 * the reason is not tidiness: an identifier type carries the MEANING of the domain that minted it. A
 * completion evidence typed as a `clientConfirmationId` would, six months later, be indistinguishable
 * from evidence of a reassignment confirmation — and the question "what did the client actually
 * agree to?" is precisely the one this evidence exists to answer.
 *
 * So P6 gets its own grammar. It is opaque: Jarvis never parses it, never derives meaning from it,
 * and never constructs one.
 *
 * ### What the grammar excludes, and why that is the point
 *
 * `[A-Za-z0-9._:-]`, 1–128 — the same shape continuity's own `completionEvidenceRef` accepts, which
 * is not a coincidence: a P6 evidence reference is the ONLY value that may ever be written there, so
 * a grammar this boundary accepted and that one refused would be a contract that fails at the last
 * step.
 *
 * No `@`, no `+`, no whitespace, no `/`. An email address, an E.164 number, a URL and a sentence are
 * all unrepresentable. That is what stops an evidence field from quietly becoming the place a contact
 * detail or a fragment of consent wording is smuggled across.
 */
import { z } from 'zod';

/** The bound shared by every opaque reference in this contract. */
export const MAX_CORE_RIYA_INTAKE_REF_CHARS = 128;

const OPAQUE_REF = z
  .string()
  .min(1)
  .max(MAX_CORE_RIYA_INTAKE_REF_CHARS)
  .regex(/^[A-Za-z0-9._:-]+$/u);

/**
 * Core's evidence that a governed step completed.
 *
 * Used for contact readiness, for each consent outcome, and for a successful submission. One grammar
 * rather than three: they differ in what they attest, not in what they look like, and three identical
 * schemas would be three things to keep in step.
 */
export const coreRiyaIntakeEvidenceRefSchema = OPAQUE_REF;

/**
 * Core's identifier for the intake state a later submission was built from.
 *
 * Binding evidence, **not a permission token**. It says which view of contact and consent Jarvis was
 * looking at; it does not authorize anything, and Core must re-evaluate at submission. A reference
 * that granted permission would be a stale permission the moment consent was withdrawn — the exact
 * failure `CommunicationAuthorizationV1` documents when it refuses to carry a consent snapshot.
 */
export const coreRiyaIntakeStateRefSchema = OPAQUE_REF;

/** The canonical runtime identifier grammar, for tenant, conversation and subject references. */
export const coreRiyaIntakeIdentifierSchema = OPAQUE_REF;

/**
 * A bounded machine reason. A token to count, never a sentence to read.
 *
 * Prose here would be the natural place for Core to explain a refusal in words — and those words
 * would describe a real person's circumstances, would end up in a Jarvis log, and would be exactly
 * the personal data this boundary exists to keep out.
 */
export const coreRiyaIntakeReasonCodeSchema = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/u);
