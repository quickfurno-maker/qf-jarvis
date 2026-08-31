/**
 * The PURPOSE-SPECIFIC trusted communication evidence reader (QFJ-P09 D4, ADR-0140).
 *
 * Given a gap-free projection POSITION, resolve the MINIMAL evidence needed for the first six durable
 * Model-2 communication states — and nothing else. It reads the append-only position map
 * (`qf_jarvis.projection_event_position`) and joins to `qf_jarvis.event` through the raw storage
 * identity, using that identity ONLY for the join and never returning it, exactly as
 * {@link ./projection-subject-reader.readSubjectReferenceAtPosition} does for the opaque subject.
 *
 * ### What this is NOT
 *
 * It is not a generic event-store lookup, not a read-by-`eventId`, not a read-any-payload capability,
 * not a projection, not a lifecycle authority, and not a signature verifier. There is deliberately no
 * `readPayloadAtPosition`: a generic payload reader shared across projections would hand every future
 * handler the whole event log, which is the opposite of what D4 exists to do. This module earns access
 * for ONE purpose and returns ONE minimised semantic union.
 *
 * ### Where the trust actually comes from
 *
 * D2a (ADR-0138, merged as PR #179) is the prerequisite. It established, at the REPOSITORY/APPLICATION
 * level, that a canonical event row cannot be created by another production import or runtime SQL
 * writer without failing tested containment: one SQL INSERT implementation, one low-level
 * `storeValidatedEvent` caller, one governed-writer importer, one mint call site, and `verify ->
 * prepare -> persist` as the accepted-event path.
 *
 * That is what lets this reader call its output "trusted". It is emphatically NOT a claim that:
 *
 * - the database cryptographically proves any row was signed;
 * - `eventId` authenticates origin (it is a name any caller can type — here it is a POINTER TO
 *   provenance obtained from an already-positioned, D2a-governed row, never provenance itself);
 * - re-parsing a payload authenticates origin (it proves shape, never where the bytes came from);
 * - the `source` column authenticates origin (it is a stored literal; the check below is a
 *   CONSISTENCY check, not the authentication anchor);
 * - any of this constrains a privileged out-of-repository database actor. It does not.
 *
 * ### Offline by construction
 *
 * The two event families this reader admits are D2 TARGET families. **No adopted or live emission for
 * either was established at the accepted S3 pin, and D4 makes no current-live emission claim** — D4
 * did not re-pin or inspect Core, so it is in no position to assert what Core does right now.
 * `authorization-recorded` readiness awaits C3A; `result-recorded` awaits C3B's contract-fit proof. D4
 * is built and tested offline against published contracts and synthetic accepted rows.
 * `qf.execution.intent-issued` and `qf.execution.result-recorded` remain unadopted.
 *
 * ### Least privilege by module boundary
 *
 * Root-unexported, absent from the package export map, and — for this slice — importable by NO
 * production file. A restricted-import rule in `eslint.config.mjs` forbids it repository-wide, and a
 * source scan asserts the production importer count is exactly ZERO. D5 must deliberately move that
 * invariant from 0 to 1 in its own reviewed PR when it builds the actual state projection handler.
 * Nothing here pre-authorizes that.
 */
import {
  eventIdSchema,
  safeParseCanonicalPayload,
  type CommunicationAuthorizationV1,
  type CommunicationResultV1,
} from '@qf-jarvis/contracts';

import type { DatabaseClient } from '../persistence/pool.js';
import { ProjectionInputError, ProjectionStoredDataError } from './projection-errors.js';

/**
 * The module-private brand.
 *
 * It is declared, never exported, and has no runtime value, so no code outside this module can name
 * it — which means the evidence types below cannot be produced by writing an object literal. The
 * claim that buys is precise: **arbitrary code cannot STRUCTURALLY construct the evidence type
 * without an assertion or cast.** It is not a claim that TypeScript proves the row came from Core.
 * That comes from D2a plus this read path, not from a type.
 */
declare const TRUSTED_COMMUNICATION_EVIDENCE: unique symbol;

/** Carried by every evidence value; unforgeable by structural typing alone. */
interface TrustedEvidenceBrand {
  readonly [TRUSTED_COMMUNICATION_EVIDENCE]: true;
}

/** The two Core-owned event families D2 selected as targets. Nothing else is admitted. */
const AUTHORIZATION_RECORDED_EVENT_TYPE = 'qf.communication.authorization-recorded';
const RESULT_RECORDED_EVENT_TYPE = 'qf.communication.result-recorded';
/**
 * The canonical EVENT WIRE version D4 supports — a different axis from the artifact contract version.
 *
 *   canonical event / payload registry version : **@2**  (this constant)
 *   nested communication ARTIFACT contract     : **V1**  (`CommunicationAuthorizationV1` etc.)
 *
 * Conflating them is easy and wrong. D2 (ADR-0137) selected the two **families**; it said nothing
 * about their envelope version. At this baseline the authoritative registry carries both families at
 * **@2**, privacy-hardened; the `@1` schemas survive for regression and history only, are absent from
 * the payload registry, and are therefore **NOT INGESTIBLE**. A `@1` row cannot reach the store through
 * the verify -> prepare -> persist path D4 relies on, so admitting one would have meant trusting a row
 * that very trust path refuses.
 *
 * Deliberately an explicit constant, not "whatever the registry's highest version happens to be". A
 * future `@3` carries fields nobody here has reviewed, so it must fail closed until a D4 change
 * reviews them.
 */
const SUPPORTED_EVENT_VERSION = 2;

/** The one canonical emitter of a canonical event. A consistency check, not an authentication anchor. */
const CANONICAL_CORE_SOURCE = 'quickfurno-core';

/**
 * The ONLY channel the first live runtime supports (ADR-0137 Q11).
 *
 * Core may lawfully authorize a channel Jarvis cannot execute. An authorization for `sms`, `email` or
 * `voice` is a perfectly valid Core fact — it is simply not evidence this runtime may act on, so D4
 * declines it rather than quietly admitting a state the runtime would then be unable to honour.
 */
const SUPPORTED_AUTHORIZED_CHANNEL = 'whatsapp';

/**
 * The FOUR result lifecycle states D4 admits.
 *
 * Excluded on purpose, each for its own reason (ADR-0137): `completed` has NO distinct Core
 * representation, so admitting it would mean inventing a completion fact; `answered`, `no-answer` and
 * `busy` are voice outcomes Core does not model; `execution-submitted` has no proved durable Core
 * submission artifact; `cancelled` and `expired` are rejected for the MVP; `follow-up-requested` and
 * `human-handoff-required` are Tier-B; and a result-borne `rejected` is excluded because a rejection
 * must come from an authorization REFUSAL, not from a result artifact.
 */
const ADMITTED_RESULT_STATES = Object.freeze([
  'provider-accepted',
  'delivered',
  'read',
  'failed',
] as const);

export type AdmittedCommunicationResultState = (typeof ADMITTED_RESULT_STATES)[number];

/**
 * Minimised evidence of a Core communication AUTHORIZATION decision.
 *
 * The full canonical `CommunicationAuthorizationV1` is parsed before anything is read out of it; this
 * type is what survives field minimisation. `explanation`, `policy` and `approvalDecisionId` are
 * deliberately absent — free text, policy internals, and a human approval id are none of a state
 * projection's business. **Returning less is not parsing less.**
 */
export interface TrustedCommunicationAuthorizationEvidence extends TrustedEvidenceBrand {
  readonly kind: 'communication-authorization';
  readonly position: bigint;
  /** A POINTER to provenance, obtained from the positioned row. Never provenance itself. */
  readonly sourceEventId: string;
  readonly communicationId: string;
  readonly communicationRequestId: string;
  readonly outcome: CommunicationAuthorizationV1['outcome'];
  readonly authorizedChannel?: CommunicationAuthorizationV1['authorizedChannel'];
  readonly reasonCode: string;
  readonly decidedAt: string;
  readonly correlationId: string;
}

/** Minimised failure evidence: a machine code and a retry class. No category, no description. */
export interface TrustedCommunicationFailureEvidence {
  readonly failureCode: string;
  readonly retryClassification: NonNullable<
    CommunicationResultV1['failure']
  >['retryClassification'];
}

/**
 * Minimised evidence of a Core-recorded communication RESULT.
 *
 * The full canonical `CommunicationResultV1` is parsed first — including its mandatory
 * `executionIntentId` and `executionResultId` — and those ids are then stripped, along with
 * `explanation`, `providerEvidence`, `providerOccurredAt`, `failure.failureCategory` and
 * `failure.description`. D4 strips only AFTER a lawful parse; it never relaxes the source contract.
 */
export interface TrustedCommunicationResultEvidence extends TrustedEvidenceBrand {
  readonly kind: 'communication-result';
  readonly position: bigint;
  /** A POINTER to provenance, obtained from the positioned row. Never provenance itself. */
  readonly sourceEventId: string;
  readonly communicationId: string;
  readonly communicationResultId: string;
  readonly lifecycleState: AdmittedCommunicationResultState;
  readonly outcome: CommunicationResultV1['outcome'];
  readonly recordedAt: string;
  readonly reasonCode: string;
  readonly failure?: TrustedCommunicationFailureEvidence;
  readonly correlationId: string;
}

export type TrustedCommunicationEvidence =
  TrustedCommunicationAuthorizationEvidence | TrustedCommunicationResultEvidence;

interface RawEvidenceRow {
  readonly position: unknown;
  readonly event_id: unknown;
  readonly event_type: unknown;
  readonly event_version: unknown;
  readonly source: unknown;
  readonly payload: unknown;
}

/**
 * ONE parameterized, fully-qualified, position-keyed query.
 *
 * The `CASE` is the payload-minimisation boundary: the database returns a payload ONLY for the two
 * target families **at the exact supported version**, so neither an unrelated positioned event nor a
 * target at an unreviewed version sends its payload across this boundary at all. Gating on the family
 * alone would have let a future `@3` payload — precisely the one carrying fields nobody here has
 * reviewed — into the process before the version check rejected it. Everything else selected is envelope metadata this reader actually needs. Deliberately NOT
 * selected: `sequence` (used only for the join), `subject_type`, `subject_id`, `occurred_at`,
 * `emitted_at`, `causation_event_id`, `signature`, `signature_key_id`, `signature_signed_at`,
 * `semantic_event_digest`, `body_digest`.
 */
const SELECT_COMMUNICATION_EVIDENCE_BY_POSITION_SQL = `
SELECT
  m.position,
  e.event_id,
  e.event_type,
  e.event_version,
  e.source,
  CASE
    WHEN e.event_type IN ($2, $3) AND e.event_version = $4 THEN e.payload
    ELSE NULL
  END AS payload
FROM qf_jarvis.projection_event_position AS m
JOIN qf_jarvis.event AS e ON e.sequence = m.event_storage_sequence
WHERE m.position = $1
`;

/** A canonical positive decimal, as the position map stores it. No sign, no padding, no exponent. */
const CANONICAL_POSITION_PATTERN = /^[1-9][0-9]*$/;

/** The event-type grammar and version range from migration 0001, mirrored by the existing readers. */
const EVENT_TYPE_PATTERN = /^[a-z0-9]+([-.][a-z0-9]+)*$/;
const MAX_EVENT_TYPE_LENGTH = 64;
const MIN_EVENT_VERSION = 1;
const MAX_EVENT_VERSION = 1000;

/**
 * Re-parse the stored payload against the **authoritative registered contract** for this exact
 * `type@version`, then hand back the one nested artifact.
 *
 * This goes through `safeParseCanonicalPayload` rather than reaching for the nested artifact schema
 * directly, and the difference is not cosmetic. The registered `@2` payload is
 * `contractPayloadV2({ authorization: ... })`, which applies a privacy-hardened prohibited-content
 * guard across the WHOLE payload. Parsing only `communicationAuthorizationV1Schema` would skip that
 * guard, so a payload the registry rejects — a coordinate pair inside an otherwise-bounded
 * `explanation`, say — would sail straight through. **D4 minimises what it RETURNS; it must never
 * parse a weaker contract than the one the event was accepted under.**
 *
 * The wrapper key is then read out of an already-validated payload, so that step is extraction rather
 * than a second, weaker validation pass.
 */
function parseRegisteredPayload(
  eventType: string,
  eventVersion: number,
  payload: unknown,
  key: string,
): unknown {
  const parsed = safeParseCanonicalPayload(eventType, eventVersion, payload);
  if (!parsed.success) {
    throw new ProjectionStoredDataError(
      'A stored communication event payload does not satisfy its registered canonical contract.',
    );
  }

  const data = parsed.data;
  if (typeof data !== 'object' || data === null || !(key in data)) {
    throw new ProjectionStoredDataError(
      'A stored communication event payload does not have the exact canonical wrapper.',
    );
  }
  return (data as Record<string, unknown>)[key];
}

function isAdmittedResultState(state: string): state is AdmittedCommunicationResultState {
  return (ADMITTED_RESULT_STATES as readonly string[]).includes(state);
}

/**
 * Resolve the minimal trusted communication evidence at `position`.
 *
 * Returns `null` when a positioned event exists but is not admitted by D4's purpose — an unrelated
 * event type, or a target result whose lifecycle state is outside the first durable six. `null` means
 * "not applicable to this capability"; it never means "something was wrong but we carried on", and it
 * is never a substitute state.
 *
 * FAILS CLOSED on: a non-positive-bigint input; a missing position (at projection time the runner has
 * already resolved this position, so absence is corruption, not benign); a stored position that is
 * malformed or does not equal the requested one; a target event type at an unsupported version (a
 * silent skip there would produce a quietly incomplete projection of a fact we rely on); a target
 * event whose source is not the canonical Core literal; a malformed payload wrapper; and any artifact
 * that fails its canonical schema.
 *
 * Database and connection failures are deliberately NOT caught or reclassified: they are
 * infrastructure failures and must stay that way for the projection runner's existing error handling.
 */
export async function readTrustedCommunicationEvidenceAtPosition(
  client: DatabaseClient,
  position: bigint,
): Promise<TrustedCommunicationEvidence | null> {
  if (typeof position !== 'bigint' || position <= 0n) {
    throw new ProjectionInputError('projection position must be a positive integer position.');
  }

  const result = await client.query<RawEvidenceRow>(SELECT_COMMUNICATION_EVIDENCE_BY_POSITION_SQL, [
    position.toString(),
    AUTHORIZATION_RECORDED_EVENT_TYPE,
    RESULT_RECORDED_EVENT_TYPE,
    SUPPORTED_EVENT_VERSION,
  ]);
  const raw = result.rows[0];
  if (raw === undefined) {
    throw new ProjectionStoredDataError('No event maps to the requested projection position.');
  }

  // The stored position must be a STRING, canonical, AND the one that was asked for.
  //
  // Requiring the string is not pedantry: coercing a number or bigint through `String()` would turn a
  // corrupted column type into a value that then passes the grammar check, and the existing projection
  // readers deliberately refuse that coercion. A reader that silently returned evidence for a
  // different position would corrupt ordering without ever erroring.
  if (typeof raw.position !== 'string' || !CANONICAL_POSITION_PATTERN.test(raw.position)) {
    throw new ProjectionStoredDataError(
      'A stored projection position is not a canonical position.',
    );
  }
  if (BigInt(raw.position) !== position) {
    throw new ProjectionStoredDataError(
      'A stored projection position does not match the requested position.',
    );
  }

  // Validate the stored METADATA against the event log's own contract BEFORE classifying it. Without
  // this, a corrupted type such as `'!!!'` would be quietly treated as a benign "unrelated event" and
  // return null — hiding corruption behind a normal-looking answer.
  if (
    typeof raw.event_type !== 'string' ||
    raw.event_type.length < 1 ||
    raw.event_type.length > MAX_EVENT_TYPE_LENGTH ||
    !EVENT_TYPE_PATTERN.test(raw.event_type)
  ) {
    throw new ProjectionStoredDataError('A stored event type is not a valid machine token.');
  }
  if (
    typeof raw.event_version !== 'number' ||
    !Number.isSafeInteger(raw.event_version) ||
    raw.event_version < MIN_EVENT_VERSION ||
    raw.event_version > MAX_EVENT_VERSION
  ) {
    throw new ProjectionStoredDataError('A stored event version is not a valid contract version.');
  }
  const isAuthorization = raw.event_type === AUTHORIZATION_RECORDED_EVENT_TYPE;
  const isResult = raw.event_type === RESULT_RECORDED_EVENT_TYPE;
  if (!isAuthorization && !isResult) {
    // An unrelated canonical event. Not this capability's business, and its payload was never
    // selected. Benign.
    return null;
  }

  // A KNOWN target family at an UNSUPPORTED version is not "irrelevant". Returning null here would
  // silently drop a fact the projection depends on, so it fails closed instead.
  if (raw.event_version !== SUPPORTED_EVENT_VERSION) {
    throw new ProjectionStoredDataError(
      'A stored communication event is at an unsupported contract version.',
    );
  }

  if (raw.source !== CANONICAL_CORE_SOURCE) {
    throw new ProjectionStoredDataError(
      'A stored communication event does not carry the canonical Core source.',
    );
  }

  const eventId = eventIdSchema.safeParse(raw.event_id);
  if (!eventId.success) {
    throw new ProjectionStoredDataError('A stored event id is not a canonical event id.');
  }

  if (isAuthorization) {
    const authorization = parseRegisteredPayload(
      raw.event_type,
      raw.event_version,
      raw.payload,
      'authorization',
    ) as CommunicationAuthorizationV1;
    return authorizationEvidence(position, eventId.data, authorization);
  }

  const communicationResult = parseRegisteredPayload(
    raw.event_type,
    raw.event_version,
    raw.payload,
    'result',
  ) as CommunicationResultV1;
  return resultEvidence(position, eventId.data, communicationResult);
}

/**
 * Minimise a lawfully parsed authorization.
 *
 * An `authorized` outcome for a channel this runtime cannot execute returns `null`: it is a valid Core
 * fact, but not evidence the first WhatsApp-only runtime may act on. A REJECTION is admitted whatever
 * channel was proposed — a refusal is a refusal, and channel support has no bearing on it.
 */
function authorizationEvidence(
  position: bigint,
  sourceEventId: string,
  authorization: CommunicationAuthorizationV1,
): TrustedCommunicationAuthorizationEvidence | null {
  if (
    authorization.outcome === 'authorized' &&
    authorization.authorizedChannel !== SUPPORTED_AUTHORIZED_CHANNEL
  ) {
    return null;
  }

  return Object.freeze({
    kind: 'communication-authorization',
    position,
    sourceEventId,
    communicationId: authorization.communicationId,
    communicationRequestId: authorization.communicationRequestId,
    outcome: authorization.outcome,
    ...(authorization.authorizedChannel === undefined
      ? {}
      : { authorizedChannel: authorization.authorizedChannel }),
    reasonCode: authorization.reasonCode,
    decidedAt: authorization.decidedAt,
    correlationId: authorization.correlationId,
  }) as TrustedCommunicationAuthorizationEvidence;
}

/** Minimise a lawfully parsed result, or decline a lifecycle state outside the first durable six. */
function resultEvidence(
  position: bigint,
  sourceEventId: string,
  communicationResult: CommunicationResultV1,
): TrustedCommunicationResultEvidence | null {
  const { lifecycleState } = communicationResult;
  if (!isAdmittedResultState(lifecycleState)) {
    // Lawfully parsed, deliberately not admitted. No evidence is invented, and no replacement state
    // is derived — the caller gets nothing rather than something plausible.
    return null;
  }

  const failure =
    communicationResult.failure === undefined
      ? undefined
      : Object.freeze({
          failureCode: communicationResult.failure.failureCode,
          retryClassification: communicationResult.failure.retryClassification,
        });

  return Object.freeze({
    kind: 'communication-result',
    position,
    sourceEventId,
    communicationId: communicationResult.communicationId,
    communicationResultId: communicationResult.communicationResultId,
    lifecycleState,
    outcome: communicationResult.outcome,
    recordedAt: communicationResult.recordedAt,
    reasonCode: communicationResult.reasonCode,
    ...(failure === undefined ? {} : { failure }),
    correlationId: communicationResult.correlationId,
  }) as TrustedCommunicationResultEvidence;
}
