/**
 * The fixed constants of the PROPOSED B4 execution-dispatch protocol (QFJ-P09.02, ADR-0090).
 *
 * "Proposed" is not a hedge. QuickFurno Core does not sign execution dispatches this way yet and
 * the execution side does not verify them yet; this package exists so the boundary can be reviewed
 * and adversarially tested BEFORE either end is built. Nothing here is an endpoint, a URL, a header
 * name or a credential format, because inventing those would be inventing an adopted protocol.
 */

/**
 * Domain separation, and the single most important constant in this package.
 *
 * A signature is only meaningful for the boundary it was produced for. Core → Jarvis event
 * ingestion (B1) signs under `qf-jarvis-event-v1`; this is Core → n8n execution dispatch (B4) and
 * signs under its own prefix. The two use the same algorithm, so WITHOUT this a captured event
 * signature would verify as an execution dispatch — a system that observes could be replayed into
 * one that acts.
 *
 * This value must never equal the event-ingestion prefix, and a test asserts exactly that.
 */
export const EXECUTION_DISPATCH_DOMAIN_SEPARATOR = 'qf-execution-dispatch-v1';

/**
 * The purpose an execution-dispatch verification key is trusted FOR.
 *
 * Key material is not fungible across trust boundaries. A key trusted to sign events Jarvis merely
 * records must not also authorise dispatches n8n would act on, so the registry records a purpose
 * and refuses anything else. Stating it as a value rather than a convention means the refusal is
 * testable.
 */
export const EXECUTION_DISPATCH_KEY_PURPOSE = 'quickfurno-core-to-n8n-execution-dispatch';

/** The one and only accepted signature algorithm. Asymmetric, and not negotiable. */
export const SUPPORTED_ALGORITHM = 'ed25519';

/**
 * Maximum raw body accepted, in bytes (64 KiB).
 *
 * Checked FIRST, before configuration, before the envelope is touched, before hashing. A contract-
 * bounded `ExecutionIntentV1` is far smaller; the bound caps work an attacker can impose, and is
 * tighter than the event bound because an execution intent is a small, fixed-shape document rather
 * than an arbitrary domain event.
 */
export const MAX_RAW_BODY_BYTES = 65_536;

/** The envelope's `bodyDigest` is `sha256:<hex>`. This is the prefix. */
export const BODY_DIGEST_PREFIX = 'sha256:';

/** A SHA-256 digest is 32 bytes — 64 lowercase hexadecimal characters. */
export const BODY_DIGEST_HEX_LENGTH = 64;

/**
 * Default signature freshness window: ±2 minutes around the injected `now`.
 *
 * Tighter than event ingestion's five minutes, deliberately. A stale EVENT is a record that arrives
 * late; a stale DISPATCH is an instruction that may still cause an effect, so the window an attacker
 * has to replay a captured envelope should be as small as clock discipline allows.
 *
 * This window is about the SIGNATURE only. It never extends `intent.expiresAt` — see `temporal.ts`.
 */
export const DEFAULT_SIGNATURE_FRESHNESS_WINDOW_MS = 120_000;

/** Smallest configurable freshness window: 1 second. A zero window rejects everything. */
export const MIN_SIGNATURE_FRESHNESS_WINDOW_MS = 1_000;

/** Largest configurable freshness window: 15 minutes. Beyond this, freshness stops meaning much. */
export const MAX_SIGNATURE_FRESHNESS_WINDOW_MS = 900_000;
