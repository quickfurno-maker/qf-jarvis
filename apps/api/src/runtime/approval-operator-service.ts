/**
 * The authenticated operator approval boundary (QFJ-P08, ADR-0082).
 *
 * INTERNAL to `apps/api`. It is not re-exported from `src/index.ts`, and the application's root
 * runtime API stays at zero — this establishes the application boundary an operator surface will one
 * day be built on, and nothing more. There is no HTTP server, no framework, no route, no listener
 * and no authentication provider here, because none of those is approved yet.
 *
 * ### Authentication gates access. It is not authority.
 *
 * Two things that are easy to conflate, and must not be:
 *
 * - **Jarvis authenticates** to decide whether this caller may SEE the queue and SUBMIT an intent.
 *   That is an access gate over Jarvis's own surface.
 * - **QuickFurno Core authorizes.** Whether this person may approve THIS action, at THIS risk class,
 *   in the recommendation's CURRENT state, is Core's question, re-checked against Core's own truth
 *   (ADR-0002, ADR-0007). Core does that by independently validating the forwarded proof, not by
 *   believing an assertion Jarvis makes about who is calling.
 *
 * So there is no founder list, admin list, approver role, RBAC table or authority cache anywhere in
 * this file, and no local store in which one could live. A compromised Jarvis can lie to a human
 * about what happened; it cannot produce an authorization, because it never holds the authority to.
 *
 * ### Authenticate before touching anything
 *
 * Every method authenticates FIRST. An unauthenticated call performs zero queue reads, zero Core
 * sends and zero database contact — the durable approval queue is a record of what the business is
 * considering doing to real clients and vendors, and "reject after fetching" would still have
 * fetched it.
 *
 * ### There is no optimistic approval, and no pending state
 *
 * ADR-0007 rejects optimistic rendering explicitly, and this service is where that rejection has to
 * hold. Between the click and Core's answer, NOTHING durable changes. If Core refuses, the refusal is
 * the authoritative artifact and it is what gets stored. If Core cannot be reached, or answers with
 * something malformed, no decision is written at all and the ask simply remains unanswered and
 * active. `PENDING` is a thing a screen renders while a promise is outstanding; it is not a state
 * this service returns and not a row anything writes.
 */
import {
  approvalRequestIdSchema,
  humanActorSchema,
  isStrictlyBefore,
  utcTimestampSchema,
} from '@qf-jarvis/contracts';
import type {
  ApprovalCoreAdapter,
  ApprovalCoreAuthorizationProof,
  ApprovalCoreSubmissionResult,
  ApprovalOperatorAction,
  ApprovalOperatorActor,
} from '@qf-jarvis/approval-core-adapter';
import type {
  ApprovalQueueActiveEntry,
  ApprovalQueueRecordDecisionResult,
  ApprovalQueueRequestRecord,
  PostgresApprovalQueue,
} from '@qf-jarvis/postgres-approval-queue';

/** Core's own correlation observation, named through the queue rather than re-declared. */
type ApprovalCorrelation = ApprovalQueueRecordDecisionResult['correlation'];

/**
 * The durable queue, narrowed to what this service is allowed to do with it.
 *
 * `Pick` rather than a hand-written interface: re-declaring the queue's method shapes here would
 * create a second definition of a contract `@qf-jarvis/postgres-approval-queue` already owns, free
 * to drift. Narrowing is the point — `enqueueRequest` and `assertReady` are deliberately absent, so
 * an operator surface cannot create asks or run readiness as a side effect of someone clicking.
 */
export type ApprovalQueueReader = Pick<
  PostgresApprovalQueue,
  'readRequest' | 'readDecisionForRequest' | 'listActiveRequests' | 'recordDecision'
>;

/**
 * Who this caller is, once Jarvis has authenticated them.
 *
 * The actor is a governed `HumanActor` — a Core entity reference, opaque to Jarvis. The proof is a
 * holder whose contents no code in this application can read; it exists to be handed onward so CORE
 * can validate it. Jarvis carries the reference and forwards the proof; it never learns the person.
 */
export interface AuthenticatedApprovalOperator {
  readonly actor: ApprovalOperatorActor;
  readonly coreAuthorization: ApprovalCoreAuthorizationProof;
}

/**
 * The injected authentication boundary.
 *
 * An interface, and only an interface. No session store, no token format, no provider SDK and no
 * default implementation: `apps/api` has no approved authentication provider yet, and inventing one
 * here would be choosing it by accident. The credential is `unknown` because this service must not
 * know its shape — knowing it would be the first step toward validating it locally.
 */
export interface OperatorAuthenticationPort {
  authenticate(credential: unknown): Promise<AuthenticatedApprovalOperator>;
}

const OPERATOR_SERVICE_ERROR_CODE_VALUES = [
  /** The caller is not authenticated. Nothing was read, and nothing was sent. */
  'unauthenticated',
  /** The authentication boundary itself failed. Fail closed: an outage is not an admission. */
  'auth-unavailable',
  /** The supplied input is not valid. Nothing was read, and nothing was sent. */
  'invalid-input',
  /** No stored approval request exists for this identity. */
  'request-not-found',
  /** The ask had already expired at the stated instant. Nothing was sent to Core. */
  'request-expired',
  /** Core could not be reached. Nothing was decided, and the ask remains unanswered. */
  'core-unavailable',
  /** Core returned something that is not a well-formed decision. Nothing was written. */
  'core-invalid-response',
  /** Core's decision does not describe this ask, or contradicts the submitted intent. */
  'core-decision-mismatch',
  /** The durable store could not be reached. */
  'persistence-unavailable',
  /** Durable evidence contradicted itself. Trusting it would be worse than refusing. */
  'repository-invariant',
] as const;

export type ApprovalOperatorServiceErrorCode = (typeof OPERATOR_SERVICE_ERROR_CODE_VALUES)[number];

export const APPROVAL_OPERATOR_SERVICE_ERROR_CODES: readonly ApprovalOperatorServiceErrorCode[] =
  Object.freeze([...OPERATOR_SERVICE_ERROR_CODE_VALUES]);

/**
 * The fixed message per code.
 *
 * Content-free, and this surface is the one where that matters most: it handles a credential, an
 * authenticated operator's Core identity, an authorization proof, and a queue of asks describing
 * real clients and vendors. A message assembled from any of those would put all of them wherever the
 * error goes.
 */
const MESSAGES: Readonly<Record<ApprovalOperatorServiceErrorCode, string>> = Object.freeze({
  unauthenticated: 'The caller is not an authenticated approval operator.',
  'auth-unavailable': 'Operator authentication is unavailable.',
  'invalid-input': 'The operator request is invalid.',
  'request-not-found': 'No approval request exists for this identity.',
  'request-expired': 'The approval request had already expired.',
  'core-unavailable': 'The approval decision service could not be reached.',
  'core-invalid-response': 'The approval decision service returned an invalid response.',
  'core-decision-mismatch': 'The approval decision does not match the submitted request.',
  'persistence-unavailable': 'The approval queue database is unavailable.',
  'repository-invariant': 'A stored approval queue record is inconsistent.',
});

/** A bounded operator-service error. The code is the contract; the message is fixed per code. */
export class ApprovalOperatorServiceError extends Error {
  readonly code: ApprovalOperatorServiceErrorCode;

  constructor(code: ApprovalOperatorServiceErrorCode) {
    super(MESSAGES[code]);
    this.name = 'ApprovalOperatorServiceError';
    this.code = code;
  }
}

/** What an authenticated caller supplies to read the outstanding queue. */
export interface ApprovalOperatorListInput {
  readonly credential: unknown;
  readonly observedAt: string;
  readonly limit: number;
}

/**
 * What an authenticated caller supplies to act on ONE ask.
 *
 * Four fields, and the absences are the design. A caller cannot supply the actor (it comes from
 * authentication), the Core authorization proof (same), the recommendation, the action id, the
 * fingerprint, the risk, the requested authority, or a decision. Every one of those is read from the
 * durable record or derived — so a caller who can reach this method still cannot choose WHAT they
 * are approving, only whether to act on an ask that already exists.
 */
export interface ApprovalOperatorSubmitInput {
  readonly credential: unknown;
  readonly approvalRequestId: string;
  readonly action: ApprovalOperatorAction;
  readonly requestedAt: string;
}

/**
 * What happened.
 *
 * `DECIDED` means this submission produced Core's answer and it is now durable. `ALREADY_DECIDED`
 * means an authoritative answer already existed — from an earlier submission, or from another
 * process that won a race — and it was returned unchanged. There is no third outcome, and in
 * particular no `PENDING`: a submission either has Core's answer or it threw.
 */
export interface ApprovalOperatorSubmitResult {
  readonly outcome: 'DECIDED' | 'ALREADY_DECIDED';
  readonly correlation: ApprovalCorrelation;
}

export interface ApprovalOperatorService {
  listActive(input: ApprovalOperatorListInput): Promise<readonly ApprovalQueueActiveEntry[]>;
  submit(input: ApprovalOperatorSubmitInput): Promise<ApprovalOperatorSubmitResult>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function codeOf(error: unknown): string | undefined {
  const code: unknown = isRecord(error) ? error['code'] : undefined;
  return typeof code === 'string' ? code : undefined;
}

/** Map the queue's closed vocabulary into this service's, discarding everything else. */
function fromQueueError(error: unknown): ApprovalOperatorServiceError {
  switch (codeOf(error)) {
    case 'request-not-found':
      return new ApprovalOperatorServiceError('request-not-found');
    case 'invalid-input':
      return new ApprovalOperatorServiceError('invalid-input');
    case 'database-unavailable':
    case 'schema-incompatible':
      return new ApprovalOperatorServiceError('persistence-unavailable');
    default:
      // `binding-invalid`, `repository-invariant`, and the three conflict codes all mean the durable
      // evidence and this application disagree about what is representable. From an operator's seat
      // that is one thing -- the store cannot be trusted for this ask -- and it is never a reason to
      // proceed.
      return new ApprovalOperatorServiceError('repository-invariant');
  }
}

/** Map the Core adapter's closed vocabulary into this service's. */
function fromCoreError(error: unknown): ApprovalOperatorServiceError {
  switch (codeOf(error)) {
    case 'core-unavailable':
      return new ApprovalOperatorServiceError('core-unavailable');
    case 'core-invalid-response':
      return new ApprovalOperatorServiceError('core-invalid-response');
    case 'core-decision-mismatch':
      return new ApprovalOperatorServiceError('core-decision-mismatch');
    case 'invalid-input':
      return new ApprovalOperatorServiceError('invalid-input');
    default:
      // `binding-invalid` here means the PERSISTED request is not a faithful ask about the PERSISTED
      // source. The caller supplied neither, so this is the store contradicting itself.
      return new ApprovalOperatorServiceError('repository-invariant');
  }
}

/**
 * Build the internal operator service over three injected boundaries.
 *
 * Everything is injected and nothing is constructed: no pool, no connection string, no environment
 * read, no transport, no authentication provider. This module composes; it does not configure.
 */
export function createApprovalOperatorService(config: {
  readonly auth: OperatorAuthenticationPort;
  readonly queue: ApprovalQueueReader;
  readonly core: ApprovalCoreAdapter;
}): ApprovalOperatorService {
  const supplied: unknown = config;
  if (
    !isRecord(supplied) ||
    !isRecord(supplied['auth']) ||
    typeof supplied['auth']['authenticate'] !== 'function' ||
    !isRecord(supplied['queue']) ||
    typeof supplied['queue']['readRequest'] !== 'function' ||
    !isRecord(supplied['core']) ||
    typeof supplied['core']['submit'] !== 'function'
  ) {
    throw new ApprovalOperatorServiceError('invalid-input');
  }
  const { auth, queue, core } = config;

  /**
   * Authenticate, and fail closed on every path.
   *
   * A rejection from the port is `unauthenticated`; a port that throws something unrecognisable, or
   * resolves with a shape that is not an authenticated operator, is `auth-unavailable`. Neither is
   * ever treated as permission: an authentication outage that let calls through would be the single
   * worst failure mode this boundary has.
   *
   * ### The actor is parsed with the GOVERNED schema, not shape-checked here
   *
   * `humanActorSchema`, not `actorType === 'human'`. The difference is the whole point: an
   * authenticator that returned `{ actorType: 'human', actor: {} }` would satisfy a hand-written
   * check while carrying no Core entity reference at all — and `listActive` authenticates and then
   * reads the queue, so that caller would already have seen the outstanding asks before anything
   * downstream noticed. `submit` would eventually fail inside the Core adapter; the read would not,
   * and a read is the disclosure.
   *
   * Re-implementing the shape here would also make this the SECOND definition of a `HumanActor`,
   * free to drift from the one `@qf-jarvis/contracts` owns. The nested `entityReferenceSchema` is
   * strict and carries real controls — a lowercase machine-token entity type, an opaque identifier
   * whose character set structurally excludes an email address or an E.164 phone number, and no
   * extra keys — none of which an `actorType` check enforces.
   *
   * The PARSED actor is what travels onward, never the object the port handed back.
   */
  async function authenticate(credential: unknown): Promise<AuthenticatedApprovalOperator> {
    let operator: unknown;
    try {
      operator = await auth.authenticate(credential);
    } catch (error) {
      // The port's own vocabulary is its own; only the fact of refusal crosses. Nothing from the
      // thrown value -- message, stack, cause -- is read, because a failing authenticator commonly
      // reports the credential it rejected.
      throw new ApprovalOperatorServiceError(
        codeOf(error) === 'auth-unavailable' ? 'auth-unavailable' : 'unauthenticated',
      );
    }
    if (!isRecord(operator)) {
      throw new ApprovalOperatorServiceError('auth-unavailable');
    }
    const parsedActor = humanActorSchema.safeParse(operator['actor']);
    const proof: unknown = operator['coreAuthorization'];
    if (
      !parsedActor.success ||
      !isRecord(proof) ||
      typeof proof['use'] !== 'function'
      // The proof is checked for SHAPE only. Opening it here would defeat the holder: its contents
      // are for Core to validate, and this service must never be able to read them.
    ) {
      // Zod's issues are discarded: they would quote the malformed actor, which is an identity the
      // authenticator was handling.
      throw new ApprovalOperatorServiceError('auth-unavailable');
    }
    return Object.freeze({
      actor: parsedActor.data,
      coreAuthorization: proof as unknown as ApprovalCoreAuthorizationProof,
    });
  }

  async function listActive(
    input: ApprovalOperatorListInput,
  ): Promise<readonly ApprovalQueueActiveEntry[]> {
    // FIRST. Before the input is even validated, and long before the queue is touched.
    await authenticate(isRecord(input) ? input.credential : undefined);

    if (!isRecord(input)) {
      throw new ApprovalOperatorServiceError('invalid-input');
    }
    const observedAt = utcTimestampSchema.safeParse(input.observedAt);
    const limit: unknown = input.limit;
    if (
      !observedAt.success ||
      typeof limit !== 'number' ||
      !Number.isSafeInteger(limit) ||
      limit < 1 ||
      limit > 200
    ) {
      throw new ApprovalOperatorServiceError('invalid-input');
    }

    try {
      // The queue derives "active" at the instant the CALLER supplies; nothing here reads a clock.
      return Object.freeze([
        ...(await queue.listActiveRequests({ observedAt: observedAt.data, limit })),
      ]);
    } catch (error) {
      throw fromQueueError(error);
    }
  }

  /**
   * The already-answered short circuit.
   *
   * `readDecisionForRequest` reports `request-not-found` both for a missing REQUEST and for a request
   * with no decision link. Those are distinguished by ORDER: the caller below has already read the
   * request successfully, so a `request-not-found` here can only mean "not answered yet". The
   * ordering is load-bearing, not incidental.
   */
  async function existingDecision(
    approvalRequestId: string,
  ): Promise<ApprovalCorrelation | undefined> {
    try {
      return await queue.readDecisionForRequest(approvalRequestId);
    } catch (error) {
      if (codeOf(error) === 'request-not-found') {
        return undefined;
      }
      throw fromQueueError(error);
    }
  }

  async function submit(input: ApprovalOperatorSubmitInput): Promise<ApprovalOperatorSubmitResult> {
    // 1. FIRST, again. An unauthenticated submit reaches neither the queue nor Core.
    const operator = await authenticate(isRecord(input) ? input.credential : undefined);

    // 2. Shape. The action vocabulary is closed here as well as in the adapter, so an unknown verb
    //    never reaches a serializer.
    if (!isRecord(input)) {
      throw new ApprovalOperatorServiceError('invalid-input');
    }
    const approvalRequestId = approvalRequestIdSchema.safeParse(input.approvalRequestId);
    const requestedAt = utcTimestampSchema.safeParse(input.requestedAt);
    const action: unknown = input.action;
    if (
      !approvalRequestId.success ||
      !requestedAt.success ||
      (action !== 'APPROVE' && action !== 'REJECT' && action !== 'REQUEST_CHANGES')
    ) {
      throw new ApprovalOperatorServiceError('invalid-input');
    }

    // 3. The durable ask, and the durable source it was made about. The caller named an id;
    //    everything else describing WHAT is being approved comes from the store.
    let stored: ApprovalQueueRequestRecord;
    try {
      stored = await queue.readRequest(approvalRequestId.data);
    } catch (error) {
      throw fromQueueError(error);
    }

    // 4. Already answered? Return the stored artifact and send NOTHING. Core has spoken about this
    //    ask, and asking again could only produce a second answer to a question already settled.
    const already = await existingDecision(approvalRequestId.data);
    if (already !== undefined) {
      return Object.freeze({ outcome: 'ALREADY_DECIDED' as const, correlation: already });
    }

    // 5. Expired at the stated instant. Compared against the request's own `expiresAt` and the
    //    caller's instant -- no clock -- and refused BEFORE Core is contacted, because submitting a
    //    dead ask spends an operator's authorization proof on a question with no valid answer.
    //
    //    Through the contract's comparator, not `>=` on the strings: RFC 3339 admits fractional
    //    seconds, and `2026-08-02T10:00:00.5Z` sorts BEFORE `2026-08-02T10:00:00Z` lexicographically
    //    while being after it in time. A string comparison here would call a live ask expired.
    if (!isStrictlyBefore(requestedAt.data, stored.request.expiresAt)) {
      throw new ApprovalOperatorServiceError('request-expired');
    }

    // 6. Submit the human's intent. The actor and the proof come from AUTHENTICATION, never from the
    //    caller's payload; the source and request come from the STORE, never from the caller either.
    let submitted: ApprovalCoreSubmissionResult;
    try {
      submitted = await core.submit({
        source: stored.source,
        request: stored.request,
        operator: operator.actor,
        action,
        requestedAt: requestedAt.data,
        authorization: operator.coreAuthorization,
      });
    } catch (error) {
      // Core unavailable, malformed, or contradicting the intent: NOTHING is written. The ask
      // remains unanswered and, if unexpired, still active. This is the branch ADR-0007's rejection
      // of optimistic state lives in.
      throw fromCoreError(error);
    }

    // 7. Record Core's authoritative artifact. `CREATED` and `REPLAYED` are both success: the queue
    //    treats an exact reissue as one durable effect.
    try {
      const recorded = await queue.recordDecision({
        approvalRequestId: stored.request.approvalRequestId,
        decision: submitted.decision,
      });
      return Object.freeze({ outcome: 'DECIDED' as const, correlation: recorded.correlation });
    } catch (error) {
      if (codeOf(error) === 'request-already-decided') {
        // Another process recorded a DIFFERENT authoritative decision for this ask while this
        // submission was in flight. The stored artifact wins -- it is not overwritten, not merged
        // and not preferred against. Whichever Core decision became durable is the one that
        // happened, and this caller is told what that is.
        const winner = await existingDecision(stored.request.approvalRequestId);
        if (winner === undefined) {
          throw new ApprovalOperatorServiceError('repository-invariant');
        }
        return Object.freeze({ outcome: 'ALREADY_DECIDED' as const, correlation: winner });
      }
      throw fromQueueError(error);
    }
  }

  return Object.freeze({ listActive, submit });
}
