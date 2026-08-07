/**
 * QFJ-M3 / RWC-P2D — `proposalDigest` binds the exact semantic proposal (ADR-0096, ADR-0056).
 *
 * `proposalId` and `idempotencyKey` bind proposal IDENTITY and deliberately exclude everything a
 * model produced. That is correct for deduplication and wrong as evidence about content: it let a
 * stale `ACCEPTED` for one proposal validate against a command carrying different content.
 *
 * `proposalDigest` is the content binding. These specs pin exactly what it covers — because a digest
 * that omits a field silently authorizes changes to that field, and the omission is invisible from
 * the outside.
 *
 * The citation tuple is the case that motivated this file. Binding only `knowledgeId` and `version`
 * meant a command citing the SAME knowledge at the SAME version but from a different `source`, or
 * with a different content `digest`, produced an identical proposal digest — so Core's decision about
 * one set of evidence would have validated against a command carrying another.
 */
import { describe, expect, it } from 'vitest';

import type { KnowledgeCitation } from '@qf-jarvis/agent-runtime';

import { validateResponse } from '../adapter/validate-response.js';
import { buildCoreCommand, effectiveProposedReplyBody } from '../contracts/command.js';
import { canonicalJson } from '../contracts/digest.js';
import { DEFAULT_CORE_DECISION_PROTOCOL } from '../contracts/protocol.js';
import { serializeCommand } from '../transport/core-decision-transport.js';
import { coreRequest, syntheticCitation } from '../testing/index.js';

const createdAt = '2026-07-25T00:00:00Z';

/** One command over the default request, varying only what a case names. */
function build(over: Parameters<typeof coreRequest>[0] = {}) {
  return buildCoreCommand({
    request: coreRequest(over),
    protocol: DEFAULT_CORE_DECISION_PROTOCOL,
    correlationId: 'run.1',
    createdAt,
  });
}

/** The baseline citation, and variants differing in exactly ONE field each. */
const BASE: KnowledgeCitation = syntheticCitation();
const OTHER_DIGEST: KnowledgeCitation = Object.freeze({ ...BASE, digest: 'beef0123' });
const OTHER_SOURCE: KnowledgeCitation = Object.freeze({ ...BASE, source: 'doc://elsewhere' });

describe('(A) a changed citation digest changes the proposal digest', () => {
  it('same identity and body, different citation content digest → different proposalDigest', () => {
    const a = build({ citations: [BASE] });
    const b = build({ citations: [OTHER_DIGEST] });

    // Everything that identifies the proposal is untouched...
    expect(b.proposalId).toBe(a.proposalId);
    expect(b.proposalVersion).toBe(a.proposalVersion);
    expect(b.conversationId).toBe(a.conversationId);
    expect(b.expectedRevision).toBe(a.expectedRevision);
    expect(b.proposedReplyBody).toBe(a.proposedReplyBody);
    // ...including the idempotency key, which must NOT move: the same logical proposal keeps the
    // same idempotency identity so Core still deduplicates a genuine retry.
    expect(b.idempotencyKey).toBe(a.idempotencyKey);

    // Only the evidence changed, and only the content digest reports it.
    expect(b.proposalDigest).not.toBe(a.proposalDigest);
  });
});

describe('(B) a changed citation source changes the proposal digest', () => {
  it('same knowledgeId, version and content digest, different source → different proposalDigest', () => {
    const a = build({ citations: [BASE] });
    const b = build({ citations: [OTHER_SOURCE] });
    expect(b.idempotencyKey).toBe(a.idempotencyKey);
    expect(b.proposalDigest).not.toBe(a.proposalDigest);
  });

  it('the reduced tuple would NOT have caught either case (regression witness)', () => {
    // Both variants share `knowledgeId` and `version` with the baseline. A digest over only those
    // two fields is identical for all three, which is exactly the defect this file exists to pin.
    for (const variant of [OTHER_DIGEST, OTHER_SOURCE]) {
      expect(variant.knowledgeId).toBe(BASE.knowledgeId);
      expect(variant.version).toBe(BASE.version);
      expect(build({ citations: [variant] }).proposalDigest).not.toBe(
        build({ citations: [BASE] }).proposalDigest,
      );
    }
  });
});

describe('(C) identical full citation tuples are deterministic', () => {
  it('two separately constructed but equal citations produce the same proposalDigest', () => {
    // Distinct objects, equal field-by-field. A digest that depended on identity rather than value
    // would fail here, and a genuine Core retry would then look like tampering.
    const a = build({ citations: [syntheticCitation()] });
    const b = build({
      citations: [Object.freeze({ ...syntheticCitation() })],
    });
    expect(b.proposalDigest).toBe(a.proposalDigest);
  });

  it('citation ORDER is part of the proposal, not normalized away', () => {
    const one = syntheticCitation('kb.one', 1);
    const two = syntheticCitation('kb.two', 1);
    expect(build({ citations: [one, two] }).proposalDigest).not.toBe(
      build({ citations: [two, one] }).proposalDigest,
    );
  });

  it('an added citation changes the digest; an empty citation set is its own value', () => {
    const base = build({ citations: [BASE] });
    expect(build({ citations: [BASE, syntheticCitation('kb.extra', 2)] }).proposalDigest).not.toBe(
      base.proposalDigest,
    );
    expect(build({ citations: [] }).proposalDigest).not.toBe(base.proposalDigest);
  });
});

describe('(D) the full citation still reaches Core unchanged', () => {
  it('the command and the wire form carry every citation field verbatim', () => {
    const command = build({ citations: [BASE] });
    expect(command.citations).toEqual([
      { knowledgeId: 'kb.fact', version: 1, source: 'doc://synthetic', digest: 'abcdef01' },
    ]);
    const wire = JSON.parse(serializeCommand(command)) as {
      citations: readonly KnowledgeCitation[];
      proposalDigest: string;
    };
    expect(wire.citations).toEqual([
      { knowledgeId: 'kb.fact', version: 1, source: 'doc://synthetic', digest: 'abcdef01' },
    ]);
    // The digest travels alongside it, so Core can echo what it was actually sent.
    expect(wire.proposalDigest).toBe(command.proposalDigest);
    expect(wire.proposalDigest).toMatch(/^[0-9a-f]{8,64}$/);
  });
});

describe('(E) a stale ACCEPTED for other evidence cannot authorize this proposal', () => {
  it('a valid response for citation A fails closed against the same proposal citing B', () => {
    // The consequence of (A)/(B), stated as the failure it prevents. Run A cited BASE and Core
    // accepted it. Run B is the SAME logical proposal -- same id, same version, same conversation,
    // same revision, same body -- but cites different evidence. Replaying run A's response against
    // it must not validate, or Core's decision about one set of sources would authorize another.
    const commandA = build({ citations: [BASE] });
    const commandB = build({ citations: [OTHER_DIGEST] });

    // The replay really is indistinguishable by identity alone.
    expect(commandB.proposalId).toBe(commandA.proposalId);
    expect(commandB.idempotencyKey).toBe(commandA.idempotencyKey);
    expect(commandB.commandId).toBe(commandA.commandId);
    expect(commandB.expectedRevision).toBe(commandA.expectedRevision);

    const acceptedForA = canonicalJson({
      protocol: commandA.protocol,
      commandId: commandA.commandId,
      idempotencyKey: commandA.idempotencyKey,
      proposalId: commandA.proposalId,
      proposalVersion: commandA.proposalVersion,
      conversationId: commandA.conversationId,
      boundRevision: commandA.expectedRevision,
      proposalDigest: commandA.proposalDigest,
      outcome: 'ACCEPTED',
      reason: 'core-decided',
      decidedAt: '2026-07-25T00:00:05Z',
    });

    // Against its own command it is a perfectly good acceptance...
    const honest = validateResponse(acceptedForA, commandA);
    expect(honest.ok).toBe(true);

    // ...and against the differently-cited one it fails closed.
    const replayed = validateResponse(acceptedForA, commandB);
    expect(replayed.ok).toBe(false);
    if (!replayed.ok) {
      expect(replayed.reason).toBe('adapter-identity-mismatch');
    }
  });
});

describe('the rest of the bound tuple, restated', () => {
  it.each([
    ['assignedActor', { assignedActor: 'ANISHA' as const }],
    ['partyType', { partyType: 'VENDOR' as const }],
    ['policyRevision', { policyRevision: 'policy.rev.2' }],
    ['evaluationRef', { evaluationRef: 'evref-000001' }],
    ['structuredIntent', { structuredIntent: { taskClass: 'RESPONSE_GENERATION' } }],
    ['proposedReplyBody', { proposedReplyBody: 'a different answer' }],
  ])('a changed %s changes the proposal digest but not the idempotency key', (_label, over) => {
    const a = build();
    const b = build(over);
    expect(b.idempotencyKey).toBe(a.idempotencyKey);
    expect(b.proposalDigest).not.toBe(a.proposalDigest);
  });

  it('a body attached to a NON-text-carrying kind is excluded from the digest, as from the wire', () => {
    // The digest binds the EFFECTIVE body -- exactly what `buildCoreCommand` forwards. For a kind
    // Core receives no text for, two commands differing only in a body Core never sees must be the
    // same proposal, or the digest would report a difference that never left this process.
    const withBody = build({ proposalKind: 'ESCALATE_TO_HUMAN', proposedReplyBody: 'unsent text' });
    const withoutBody = build({ proposalKind: 'ESCALATE_TO_HUMAN', proposedReplyBody: undefined });
    expect(effectiveProposedReplyBody(withBody)).toBeUndefined();
    expect(withBody.proposedReplyBody).toBeUndefined();
    expect(withBody.proposalDigest).toBe(withoutBody.proposalDigest);
  });

  it('no raw body or citation text is smuggled into any identifier', () => {
    const command = build({ proposedReplyBody: 'a very recognisable sentence' });
    for (const identifier of [
      command.proposalDigest,
      command.idempotencyKey,
      command.commandId,
      command.proposalId,
    ]) {
      expect(identifier).not.toContain('recognisable');
      expect(identifier).not.toContain('doc://');
    }
    expect(command.proposalDigest).toMatch(/^[0-9a-f]{8,64}$/);
  });
});
