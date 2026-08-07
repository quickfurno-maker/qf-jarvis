/**
 * The private Riya web ingress handler (ADR-0097).
 *
 * ### The topology this implements
 *
 * Browser → QuickFurno SERVER → **this ingress** → `RiyaWebConversationService` → `JarvisRuntime` →
 * the existing Core-decision boundary → authorized reply materialization → back to the QuickFurno
 * server. **The browser never calls Jarvis directly.**
 *
 * ### It builds a listener. It does not start one.
 *
 * This module returns an `http.RequestListener` and stops there. Nothing here calls `listen`, creates
 * a server, reads any environment variable, or knows a port or host. Importing it opens no socket
 * and binds nothing — a later, separately reviewed deployment slice decides whether this is ever
 * bound, and to which private interface. A module that activated itself on import would make "is it
 * live?" a question about the import graph rather than a decision somebody made.
 *
 * ### Order of checks, and why
 *
 * 1. path, then method — a wrong path is a 404 whatever the verb;
 * 2. media type and content encoding — refused before a byte of body is read;
 * 3. the raw body, bounded, aborting at the limit;
 * 4. fatal UTF-8 decode, then JSON, then the STRICT schema;
 * 5. **authentication** — Ed25519 over the raw body digest and the routing identity;
 * 6. the replay claim, so a captured request cannot be spent twice inside its window;
 * 7. the server-side classification policy — the first thing that sees the person's words;
 * 8. exactly ONE `service.handleTurn`;
 * 9. a minimal response that carries text only when Core authorized it.
 *
 * Steps 4 and 5 are in that order because the signing input names `requestId` and `issuedAt`, which
 * live in the body; there is nothing to verify against until the body has a shape. The policy is
 * still reached only by an authenticated request, which is the property that matters.
 */
import type { IncomingMessage, RequestListener, ServerResponse } from 'node:http';

import type {
  RiyaWebConversationResultV2,
  RiyaWebConversationService,
  RiyaWebConversationTurnV1,
} from '@qf-jarvis/riya-web-conversation-service';

import {
  CANONICAL_INSTANT_PATTERN,
  PRIVATE_RIYA_WEB_INGRESS_AUDIENCE,
  PRIVATE_RIYA_WEB_INGRESS_CALLER,
  PRIVATE_RIYA_WEB_INGRESS_METHOD,
  PRIVATE_RIYA_WEB_INGRESS_PATH,
  PRIVATE_RIYA_WEB_INGRESS_PROTOCOL,
  privateRiyaWebIngressRequestSchema,
} from './contracts.js';
import type {
  PrivateRiyaWebIngressRequestV1,
  PrivateRiyaWebIngressResponseV1,
} from './contracts.js';
import { isRuntimeDataClass } from './data-class-policy.js';
import type { RiyaWebIngressDataClassPolicy } from './data-class-policy.js';
import { PrivateRiyaWebIngressError, statusForIngressError } from './errors.js';
import type { PrivateRiyaWebIngressErrorCode } from './errors.js';
import { createReplayGuard } from './replay-guard.js';
import type { ReplayGuard, ReplayGuardConfig } from './replay-guard.js';
import {
  KEY_ID_HEADER,
  SIGNATURE_HEADER,
  createVerificationKeyRing,
  rawBodyDigest,
  verifyIngressSignature,
} from './signature.js';
import type { PrivateRiyaWebIngressVerificationKey } from './signature.js';

/** The raw-body bound, in bytes. Applied BEFORE parsing and enforced while reading. */
export const MAX_REQUEST_BODY_BYTES = 16 * 1024;

/** What a deployment injects. Every collaborator is required; none has a default. */
export interface PrivateRiyaWebIngressConfig {
  /** The ALREADY-COMPOSED RWC-P2C/P2D service. This ingress composes nothing. */
  readonly service: RiyaWebConversationService;
  /** The REQUIRED synchronous server-side classification policy. No default exists. */
  readonly dataClassPolicy: RiyaWebIngressDataClassPolicy;
  /** The injected canonical-instant clock. Freshness and replay expiry both read it. */
  readonly clock: () => string;
  /** 1–4 Ed25519 PUBLIC verification keys. Jarvis never holds signing material. */
  readonly verificationKeys: readonly PrivateRiyaWebIngressVerificationKey[];
  readonly replay?: ReplayGuardConfig;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Headers every response carries. No CORS header, no `Set-Cookie`, no session of any kind. */
function writeResponse(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  // A private server-to-server answer that may carry Core-authorized client text. Nothing about it
  // is cacheable, and `nosniff` stops a misconfigured intermediary rendering it as anything else.
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Content-Length', String(Buffer.byteLength(payload, 'utf8')));
  res.end(payload);
}

function writeError(res: ServerResponse, code: PrivateRiyaWebIngressErrorCode): void {
  writeResponse(res, statusForIngressError(code), {
    protocol: PRIVATE_RIYA_WEB_INGRESS_PROTOCOL,
    version: 1,
    error: code,
  });
}

/** Read the raw body, aborting past the bound. Resolves the exact bytes the caller signed. */
async function readBoundedBody(req: IncomingMessage): Promise<Buffer> {
  const declared = req.headers['content-length'];
  if (typeof declared === 'string') {
    const length = Number(declared);
    if (!Number.isInteger(length) || length < 0 || length > MAX_REQUEST_BODY_BYTES) {
      throw new PrivateRiyaWebIngressError('payload-too-large');
    }
  }
  return await new Promise<Buffer>((resolve, reject) => {
    const chunks: Buffer[] = [];
    let total = 0;
    let settled = false;
    const finish = (fn: () => void): void => {
      if (!settled) {
        settled = true;
        fn();
      }
    };
    req.on('data', (chunk: Buffer) => {
      total += chunk.length;
      // Counted as bytes ARRIVE, not from the declared length: a chunked request declares nothing,
      // and a lying `Content-Length` is exactly what this second check exists for.
      if (total > MAX_REQUEST_BODY_BYTES) {
        finish(() => {
          req.destroy();
          reject(new PrivateRiyaWebIngressError('payload-too-large'));
        });
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      finish(() => {
        resolve(Buffer.concat(chunks));
      });
    });
    req.on('error', () => {
      // The socket error is discarded: it can name a peer address.
      finish(() => {
        reject(new PrivateRiyaWebIngressError('invalid-request'));
      });
    });
  });
}

/** Refuse anything that is not plain, unencoded JSON. No decompression happens anywhere. */
function assertAcceptableMedia(req: IncomingMessage): void {
  const contentType = req.headers['content-type'];
  if (typeof contentType !== 'string') {
    throw new PrivateRiyaWebIngressError('unsupported-media');
  }
  const normalized = contentType.toLowerCase().replace(/\s+/gu, '');
  if (normalized !== 'application/json' && normalized !== 'application/json;charset=utf-8') {
    throw new PrivateRiyaWebIngressError('unsupported-media');
  }
  const encoding = req.headers['content-encoding'];
  // An ARRAY here means the header was sent twice, which is refused outright rather than resolved.
  const encodingValue = Array.isArray(encoding) ? '<duplicated>' : encoding;
  if (encodingValue !== undefined && encodingValue.toLowerCase().trim() !== 'identity') {
    // No decompression: a compressed body would make the signed byte count a property of a codec,
    // and decompressing untrusted input before authenticating it is its own hazard.
    throw new PrivateRiyaWebIngressError('unsupported-media');
  }
}

/** Fatal UTF-8 decode, then JSON, then the strict schema. Never quotes what it rejected. */
function parseRequest(rawBody: Buffer): PrivateRiyaWebIngressRequestV1 {
  let text: string;
  try {
    // `fatal` matters: the default decoder silently replaces invalid sequences, which would mean the
    // bytes that were signed and the text that was parsed are not the same thing.
    text = new TextDecoder('utf-8', { fatal: true }).decode(rawBody);
  } catch {
    throw new PrivateRiyaWebIngressError('invalid-request');
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new PrivateRiyaWebIngressError('invalid-request');
  }
  if (!isRecord(parsed)) {
    throw new PrivateRiyaWebIngressError('invalid-request');
  }
  const result = privateRiyaWebIngressRequestSchema.safeParse(parsed);
  if (!result.success) {
    // The zod issue is discarded: its path names the failing field and its message can quote the
    // value -- and the value here is a person's own words about their home.
    throw new PrivateRiyaWebIngressError('invalid-request');
  }
  return result.data as PrivateRiyaWebIngressRequestV1;
}

/**
 * Build the private ingress handler. Fails closed at CONSTRUCTION on any invalid collaborator.
 *
 * There is no partial ingress: a handler that existed but could not classify, verify or delegate
 * would answer requests it must not answer.
 */
export function createPrivateRiyaWebIngressHandler(
  config: PrivateRiyaWebIngressConfig,
): RequestListener {
  const supplied: unknown = config;
  if (!isRecord(supplied)) {
    throw new PrivateRiyaWebIngressError('internal-invariant');
  }
  const suppliedService = supplied['service'] as { handleTurn?: unknown } | undefined;
  const suppliedPolicy = supplied['dataClassPolicy'] as { classify?: unknown } | undefined;
  const suppliedClock: unknown = supplied['clock'];
  if (
    typeof suppliedService?.handleTurn !== 'function' ||
    typeof suppliedPolicy?.classify !== 'function' ||
    typeof suppliedClock !== 'function'
  ) {
    throw new PrivateRiyaWebIngressError('internal-invariant');
  }
  const service = suppliedService as unknown as RiyaWebConversationService;
  const policy = suppliedPolicy as unknown as RiyaWebIngressDataClassPolicy;
  const clock = suppliedClock as () => string;
  // Both throw on invalid configuration, and both are built HERE so a deployment defect surfaces
  // when the handler is created rather than on the first real request from a gateway.
  const keyRing = createVerificationKeyRing(
    supplied['verificationKeys'] as readonly PrivateRiyaWebIngressVerificationKey[],
  );
  const replayGuard: ReplayGuard = createReplayGuard(
    (supplied['replay'] as ReplayGuardConfig | undefined) ?? {},
  );

  /** One authenticated turn, from validated request to minimal response. */
  const serve = async (
    request: PrivateRiyaWebIngressRequestV1,
  ): Promise<PrivateRiyaWebIngressResponseV1> => {
    // 7. Classification. The FIRST thing to see the person's words, and only now that the request is
    //    authenticated. A policy that threw, or answered outside the closed vocabulary, is a
    //    deployment defect and must not become a guessed class.
    let dataClass: unknown;
    try {
      dataClass = policy.classify({
        tenantId: request.tenantId,
        conversationId: request.conversationId,
        messageId: request.messageId,
        ...(request.subjectRef === undefined ? {} : { subjectRef: request.subjectRef }),
        ...(request.normalizedText === undefined ? {} : { normalizedText: request.normalizedText }),
      });
    } catch {
      throw new PrivateRiyaWebIngressError('policy-refused');
    }
    if (!isRuntimeDataClass(dataClass)) {
      throw new PrivateRiyaWebIngressError('policy-refused');
    }

    // 8. EXACTLY ONE delegation. The turn is assembled from SIGNED fields plus the SERVER-DERIVED
    //    class -- never from anything a browser could have chosen.
    const turn: RiyaWebConversationTurnV1 = {
      version: 1,
      tenantId: request.tenantId,
      conversationId: request.conversationId,
      messageId: request.messageId,
      receivedAt: request.receivedAt,
      webTurnRef: request.webTurnRef,
      dataClass,
      ...(request.subjectRef === undefined ? {} : { subjectRef: request.subjectRef }),
      ...(request.normalizedText === undefined ? {} : { normalizedText: request.normalizedText }),
    };

    let result: RiyaWebConversationResultV2;
    try {
      // No retry and no fallback path. A retry inside a boundary that has already reached a model is
      // how one thing a person said becomes two proposals.
      result = await service.handleTurn(turn);
    } catch {
      // The service's own bounded error is not surfaced: it is a different vocabulary, and wrapping
      // it would make this wire surface open-ended.
      throw new PrivateRiyaWebIngressError('service-unavailable');
    }

    // 9. The response. Defensive, because this is the last point at which text can be withheld.
    if (
      result.tenantId !== request.tenantId ||
      result.conversationId !== request.conversationId ||
      result.messageId !== request.messageId
    ) {
      throw new PrivateRiyaWebIngressError('internal-invariant');
    }
    const authorized = result.authorizedReply;
    if (authorized !== undefined && result.disposition !== 'PROCESSED') {
      // A materialization attached to a non-served disposition is self-contradicting evidence.
      // Fail closed rather than choose which half to believe.
      throw new PrivateRiyaWebIngressError('internal-invariant');
    }
    return {
      protocol: PRIVATE_RIYA_WEB_INGRESS_PROTOCOL,
      version: 1,
      requestId: request.requestId,
      tenantId: result.tenantId,
      conversationId: result.conversationId,
      messageId: result.messageId,
      disposition: result.disposition,
      reason: result.reason ?? null,
      // The ONLY gate on client-facing text. `disposition === 'PROCESSED'` is deliberately NOT it:
      // a turn is processed whether or not Core authorized anything to say.
      authorizedReply:
        authorized === undefined
          ? null
          : {
              version: 1,
              proposalId: authorized.proposalId,
              boundRevision: authorized.boundRevision,
              proposalKind: authorized.proposalKind,
              // Byte for byte. No trim, rewrite, template, markdown or citation insertion.
              replyBody: authorized.replyBody,
            },
    };
  };

  return (req: IncomingMessage, res: ServerResponse): void => {
    void (async (): Promise<void> => {
      try {
        // 1. The one route. A query string is refused because it is UNSIGNED input, and the signature
        //    binds the path exactly.
        if (req.url !== PRIVATE_RIYA_WEB_INGRESS_PATH) {
          writeResponse(res, 404, {
            protocol: PRIVATE_RIYA_WEB_INGRESS_PROTOCOL,
            version: 1,
            error: 'not-found',
          });
          return;
        }
        if (req.method !== PRIVATE_RIYA_WEB_INGRESS_METHOD) {
          // No OPTIONS branch: there is no preflight because there is no browser caller.
          res.setHeader('Allow', PRIVATE_RIYA_WEB_INGRESS_METHOD);
          writeResponse(res, 405, {
            protocol: PRIVATE_RIYA_WEB_INGRESS_PROTOCOL,
            version: 1,
            error: 'method-not-allowed',
          });
          return;
        }

        assertAcceptableMedia(req);
        const rawBody = await readBoundedBody(req);
        const request = parseRequest(rawBody);

        // ONE clock sample for the whole request, validated before anything reads it.
        //
        // Freshness and the replay claim must reason about the SAME instant. Two reads could
        // straddle the boundary of the window they jointly define -- a signature judged fresh
        // against one instant and a claim expired against another -- and the guard would be
        // deciding about a moment the authentication never saw. An unusable clock fails closed
        // here, before the policy or the service could run: substituting a time would be inventing
        // the one input every window in this file is measured against.
        //
        // The snapshot must be CANONICAL, not merely parseable. `Date.parse` accepts `2026-08-07`
        // and `2026-08-07T09:00:00+00:00`, and every other instant crossing this boundary -- the
        // signed `issuedAt`, the signed `receivedAt` -- is held to the strict UTC grammar. A clock
        // held to a looser standard than the requests it judges would be the one input nobody
        // checked. It is refused rather than normalized: converting an offset to `Z` would decide
        // what a misconfigured deployment meant.
        const now = clock();
        if (typeof now !== 'string' || !CANONICAL_INSTANT_PATTERN.test(now)) {
          throw new PrivateRiyaWebIngressError('internal-invariant');
        }
        const nowMs = Date.parse(now);
        if (!Number.isFinite(nowMs)) {
          throw new PrivateRiyaWebIngressError('internal-invariant');
        }
        // Canonical in SHAPE is still not necessarily a real calendar time. `Date.parse` accepts
        // `2026-02-31T09:00:00Z` and silently ROLLS IT OVER to March 3 -- so a misconfigured clock
        // would not fail, it would quietly report a different instant, and every window measured
        // against it would be measured against a lie. Round-tripping the parsed value back through
        // `toISOString` is what turns "well-formed" into "real".
        if (new Date(nowMs).toISOString().slice(0, 19) !== now.slice(0, 19)) {
          throw new PrivateRiyaWebIngressError('internal-invariant');
        }

        // 5. Authentication. Binds the routing identity AND the exact body bytes.
        verifyIngressSignature({
          keyRing,
          keyIdHeader: req.headers[KEY_ID_HEADER],
          signatureHeader: req.headers[SIGNATURE_HEADER],
          method: PRIVATE_RIYA_WEB_INGRESS_METHOD,
          path: PRIVATE_RIYA_WEB_INGRESS_PATH,
          caller: request.caller,
          audience: request.audience,
          requestId: request.requestId,
          issuedAt: request.issuedAt,
          rawBody,
          now,
        });

        // Restated after verification. The schema already pins both to literals; asserting again
        // costs nothing and means an accidental schema relaxation cannot silently widen the caller.
        // Widened to `string` deliberately: the schema already pins both to literals, so the
        // compiler is right that these comparisons cannot fail today. That is exactly why they are
        // here -- if the schema is ever relaxed, this restated check is what stops the caller
        // silently widening with it. The cast keeps the runtime check the compiler would erase.
        if (
          (request.caller as string) !== PRIVATE_RIYA_WEB_INGRESS_CALLER ||
          (request.audience as string) !== PRIVATE_RIYA_WEB_INGRESS_AUDIENCE
        ) {
          throw new PrivateRiyaWebIngressError('authentication-failed');
        }

        // 6. The replay claim -- AFTER verification, so an unauthenticated caller cannot burn
        //    identifiers a real gateway intends to use, and BEFORE the policy or the service, so a
        //    refused claim costs neither a classification nor an agent turn.
        // The SAME instant authentication just judged freshness against.
        const claim = replayGuard.claim({
          caller: request.caller,
          requestId: request.requestId,
          bodyDigest: rawBodyDigest(rawBody),
          nowMs,
        });
        if (claim === 'capacity-exhausted') {
          // Fail CLOSED. The guard is full of live claims and will not evict one to make room --
          // and this is reported as its own code, never as a replay or a conflict.
          throw new PrivateRiyaWebIngressError('replay-guard-unavailable');
        }
        if (claim !== 'claimed') {
          throw new PrivateRiyaWebIngressError(claim);
        }

        writeResponse(res, 200, await serve(request));
      } catch (error: unknown) {
        if (error instanceof PrivateRiyaWebIngressError) {
          writeError(res, error.code);
          return;
        }
        // Anything unclassified becomes one bounded code. No stack, no message, no cause: an
        // unexpected error is exactly the kind that carries a body, a key or a connection string.
        writeError(res, 'internal-invariant');
      }
    })();
  };
}
