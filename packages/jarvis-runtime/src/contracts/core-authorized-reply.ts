/**
 * The Core-authorized reply materialization (RWC-P2D, ADR-0096).
 *
 * ### Why this is a SEPARATE contract rather than two more fields on `JarvisRuntimeResult`
 *
 * `JarvisRuntimeResult` is deliberately content-free, and callers are entitled to treat it as safe
 * operational output — the kind of object a logger, a metric or a trace span may be handed whole.
 * Adding client-facing text to it would silently convert every existing whole-result log into a
 * retainer of model output, at no call site anybody edited. So the text lives in its own explicitly
 * named type, reachable only through an explicitly named method, and a caller that wants content has
 * to say so.
 *
 * ### `CORE_ACCEPTED` is authorization, NOT delivery
 *
 * An `authorizedReply` means exactly one thing: QuickFurno Core authorized this exact proposal under
 * the existing M2/M3 contract, and the final M3 outcome — after the post-response authoritative-state
 * gate — was `ACCEPTED`. It does NOT mean the text was rendered, returned over HTTP, sent to a
 * provider, accepted by WhatsApp, delivered, read, executed or persisted. Nothing in this repository
 * does any of those yet. That is why no name here is `RESPONDED`, `SENT`, `DELIVERED`, `PUBLISHED`
 * or `DISPATCHED`: it is approved content available to a trusted private caller, and the ingress that
 * would actually hand it to somebody is a later, separate slice.
 *
 * ### It is materialization, not generation
 *
 * The body is the validated proposal body, byte for byte. Nothing here rewrites, trims, paraphrases,
 * templates, converts to markdown, expands a URL, inserts a citation or enriches with business data.
 * A second transformation stage would mean Core authorized one string and a client received another.
 */
import type { JarvisRuntimeResult } from './runtime-result.js';

/**
 * The proposal kinds that carry client-facing text.
 *
 * This is not a stylistic choice. M3's `buildCoreCommand` forwards `proposedReplyBody` **only** for
 * `REPLY` and `FOLLOW_UP`; for every other kind the body is dropped and Core never sees it. So a
 * proposal object that happened to retain text under, say, `ESCALATION` was never authorized as a
 * reply — Core decided about a command that had no body in it. Materializing that text would present
 * an unreviewed string as Core-approved.
 */
export const CORE_TEXT_CARRYING_PROPOSAL_KINDS = ['REPLY', 'FOLLOW_UP'] as const;

/** A proposal kind whose text Core actually received as the proposed reply body. */
export type CoreTextCarryingProposalKind = (typeof CORE_TEXT_CARRYING_PROPOSAL_KINDS)[number];

/**
 * The exact validated body Core authorized, with the identity it was authorized under.
 *
 * `proposalId` and `boundRevision` are carried so a caller can prove the body belongs to the run it
 * is holding rather than trusting adjacency. A materialization whose identity disagrees with its own
 * runtime result is evidence of a defect, not a reply.
 */
export interface JarvisCoreAuthorizedReplyV1 {
  readonly version: 1;
  readonly proposalId: string;
  readonly boundRevision: number;
  readonly proposalKind: CoreTextCarryingProposalKind;
  /** The validated proposal body, unmodified. 1–8192 characters, as M2 already bounds it. */
  readonly replyBody: string;
}

/**
 * One completed run, reported twice: the ordinary content-free result, plus the optional body.
 *
 * `runtimeResult` is byte-for-byte the object ordinary `processInbound` would have returned for the
 * same run — the same single orchestration, not a second one. `authorizedReply` is `undefined` for
 * every outcome except a Core-accepted text-carrying proposal that actually has a body.
 */
export interface JarvisCoreAuthorizedReplyResult {
  readonly runtimeResult: JarvisRuntimeResult;
  readonly authorizedReply: JarvisCoreAuthorizedReplyV1 | undefined;
}
