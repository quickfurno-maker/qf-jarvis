/**
 * AVG-6 — omnichannel identity and the WhatsApp channel handoff (ADR-0123).
 *
 * The claim under test is narrow: Aarohi can hold EVIDENCE about whether an Instagram handle and a
 * WhatsApp handle belong to one prospect, can RECOMMEND that a human review them as one, and can
 * prepare an inert channel-transition candidate — and can do none of the things a reader might
 * assume follow. Nothing here merges an identity, learns a phone number, or sends.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  AAROHI_AVG6_CONTRACT_VERSION,
  AAROHI_AVG6_HANDOFF_SOURCE_CHANNEL,
  AAROHI_AVG6_HANDOFF_TARGET_CHANNEL,
  AAROHI_AVG6_IDENTITY_CHANNELS,
  CORE_PARTY_STATUSES,
  IDENTITY_EVIDENCE_RELATIONS,
  IDENTITY_EVIDENCE_SOURCE_KINDS,
  IDENTITY_EVIDENCE_SOURCE_POSTURE,
  IDENTITY_LINK_OUTCOMES,
  IDENTITY_LINK_POSTURE,
  IDENTITY_LINK_REASON_CODES,
  IDENTITY_SOURCE_ROLE,
  MAX_IDENTITY_EVIDENCE_CLAIMS,
  WHATSAPP_CHANNEL_HANDOFF_OUTCOME,
  appendCrossChannelIdentityEvidence,
  appendInstagramInboundObservation,
  createCrossChannelIdentityEvidenceBundle,
  createCrossChannelIdentityEvidenceClaim,
  createEnrichmentClaim,
  createInstagramConversation,
  evaluateCrossChannelIdentityLink,
  identityEvidenceBundleSchema,
  identityEvidenceClaimSchema,
  identityLinkRecommendationSchema,
  parseCrossChannelIdentityEvidenceBundle,
  parseCrossChannelIdentityLinkRecommendation,
  parseInstagramInboundObservation,
  prepareWhatsAppChannelHandoffCandidate,
  whatsappChannelHandoffCandidateSchema,
} from '../index.js';
import type {
  CorePartyStatus,
  CrossChannelIdentityEvidenceBundle,
  CrossChannelIdentityEvidenceClaim,
  CrossChannelIdentityLinkRecommendation,
  InstagramConversationSnapshot,
} from '../index.js';

/** Widened to `string` so instant comparisons in the specs are evaluated rather than folded. */
function canonicalInstant(value: string): string {
  return value;
}

const PROSPECT = 'prospect.avg6.alpha';
const OTHER_PROSPECT = 'prospect.avg6.beta';
const IG_PARTICIPANT = 'ig.participant.alpha';
const OTHER_IG_PARTICIPANT = 'ig.participant.beta';
const WA_PARTICIPANT = 'wa.participant.alpha';
const OTHER_WA_PARTICIPANT = 'wa.participant.beta';
const CONVERSATION = 'ig.conversation.alpha';
const THREAD = 'ig.thread.alpha';
const AT = '2026-08-27T09:00:00Z';
const LATER = '2026-08-27T09:05:00Z';

function claimInput(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    evidenceRef: 'ev.001',
    prospectRef: PROSPECT,
    instagramParticipantRef: IG_PARTICIPANT,
    whatsappParticipantRef: WA_PARTICIPANT,
    relation: 'SUPPORTS_SAME_PARTY',
    sourceKind: 'PROSPECT_SELF_ASSERTED',
    sourceRef: 'src.conversation.001',
    observedAt: AT,
    ...over,
  };
}

function claim(over: Record<string, unknown> = {}): CrossChannelIdentityEvidenceClaim {
  const built = createCrossChannelIdentityEvidenceClaim(claimInput(over));
  if (!built.ok) throw new Error(`claim fixture refused: ${built.refusal}`);
  return built.claim;
}

function emptyBundle(over: Record<string, unknown> = {}): CrossChannelIdentityEvidenceBundle {
  const built = createCrossChannelIdentityEvidenceBundle({
    prospectRef: PROSPECT,
    instagramParticipantRef: IG_PARTICIPANT,
    whatsappParticipantRef: WA_PARTICIPANT,
    ...over,
  });
  if (!built.ok) throw new Error(`bundle fixture refused: ${built.refusal}`);
  return built.bundle;
}

function bundleOf(
  claims: readonly CrossChannelIdentityEvidenceClaim[],
): CrossChannelIdentityEvidenceBundle {
  let bundle = emptyBundle();
  for (const one of claims) {
    const appended = appendCrossChannelIdentityEvidence(bundle, one);
    if (!appended.ok) throw new Error(`append refused: ${appended.refusal}`);
    bundle = appended.bundle;
  }
  return bundle;
}

/** A hand-assembled bundle, built the way a caller would rather than by the builder. */
function forgedBundle(
  claims: readonly CrossChannelIdentityEvidenceClaim[],
  over: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    contractVersion: AAROHI_AVG6_CONTRACT_VERSION,
    prospectRef: PROSPECT,
    instagramParticipantRef: IG_PARTICIPANT,
    whatsappParticipantRef: WA_PARTICIPANT,
    claims: [...claims],
    ...over,
  };
}

/** Two independent corroborating legs, no contradiction: the only shape that recommends a link. */
function sufficientEvidence(): readonly CrossChannelIdentityEvidenceClaim[] {
  return [
    claim({ evidenceRef: 'ev.001', sourceKind: 'PROSPECT_SELF_ASSERTED', sourceRef: 'src.a' }),
    claim({
      evidenceRef: 'ev.002',
      sourceKind: 'OPERATOR_REVIEWED',
      sourceRef: 'src.b',
      observedAt: LATER,
    }),
  ];
}

function recommendationFor(
  claims: readonly CrossChannelIdentityEvidenceClaim[],
  over: Record<string, unknown> = {},
): CrossChannelIdentityLinkRecommendation {
  const built = evaluateCrossChannelIdentityLink({
    recommendationRef: 'rec.001',
    bundle: bundleOf(claims),
    createdAt: LATER,
    ...over,
  });
  if (built === undefined) throw new Error('recommendation fixture refused');
  return built;
}

function conversation(over: Record<string, unknown> = {}): InstagramConversationSnapshot {
  const built = createInstagramConversation({
    prospectRef: PROSPECT,
    instagramConversationRef: CONVERSATION,
    instagramThreadRef: THREAD,
    instagramParticipantRef: IG_PARTICIPANT,
    ...over,
  });
  if (!built.ok) throw new Error(`conversation fixture refused: ${built.refusal}`);
  return built.conversation;
}

/** One canonical AVG-5 inbound turn, bound to this prospect's conversation. */
function inboundTurn(over: Record<string, unknown> = {}): unknown {
  const built = parseInstagramInboundObservation({
    prospectRef: PROSPECT,
    instagramConversationRef: CONVERSATION,
    instagramThreadRef: THREAD,
    instagramParticipantRef: IG_PARTICIPANT,
    instagramMessageRef: 'ig.message.001',
    body: 'Hello',
    observedAt: AT,
    ...over,
  });
  if (!built.ok) throw new Error(`observation fixture refused: ${built.refusal}`);
  return built.observation;
}

function observation(status: CorePartyStatus, prospectRef = PROSPECT): unknown {
  return {
    prospectRef,
    coreLookupRef: `lookup-${status.toLowerCase().replace(/_/gu, '-')}`,
    status,
  };
}

/**
 * A hand-written recommendation that rests on nothing.
 *
 * Schema-valid in every respect a schema can see: canonical version, closed outcome, closed reason
 * code, sorted unique references, the canonical posture copied verbatim from the public constant,
 * and bindings that match the conversation. Its evidence references name claims that exist nowhere.
 */
function forgedPositiveRecommendation(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    contractVersion: AAROHI_AVG6_CONTRACT_VERSION,
    recommendationRef: 'rec.001',
    prospectRef: PROSPECT,
    instagramParticipantRef: IG_PARTICIPANT,
    whatsappParticipantRef: WA_PARTICIPANT,
    outcome: 'LINK_RECOMMENDED',
    reasonCode: 'SUFFICIENT_INDEPENDENT_SUPPORT',
    supportingEvidenceRefs: ['ev.fake.a', 'ev.fake.b'],
    contradictingEvidenceRefs: [],
    createdAt: LATER,
    posture: { ...IDENTITY_LINK_POSTURE },
    ...over,
  };
}

function handoffInput(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    candidateRef: 'wa.candidate.alpha',
    conversation: conversation(),
    evidenceBundle: bundleOf(sufficientEvidence()),
    recommendation: recommendationFor(sufficientEvidence()),
    coreObservation: observation('NOT_REGISTERED'),
    preparedAt: LATER,
    ...over,
  };
}

// ===========================================================================
// Version, channels, and the two different handoffs.
// ===========================================================================

describe('the AVG-6 vocabulary is an identity vocabulary', () => {
  it('is version 1, and names exactly the two channels the transition runs between', () => {
    expect(AAROHI_AVG6_CONTRACT_VERSION).toBe(1);
    expect([...AAROHI_AVG6_IDENTITY_CHANNELS]).toStrictEqual(['instagram', 'whatsapp']);
    expect(AAROHI_AVG6_HANDOFF_SOURCE_CHANNEL).toBe('instagram');
    expect(AAROHI_AVG6_HANDOFF_TARGET_CHANNEL).toBe('whatsapp');
    expect([...IDENTITY_EVIDENCE_RELATIONS]).toStrictEqual([
      'SUPPORTS_SAME_PARTY',
      'CONTRADICTS_SAME_PARTY',
    ]);
    // No PROVES_SAME_PARTY. Nothing available here proves identity.
    expect(IDENTITY_EVIDENCE_RELATIONS as readonly string[]).not.toContain('PROVES_SAME_PARTY');
    expect([...IDENTITY_LINK_OUTCOMES]).toStrictEqual(['LINK_RECOMMENDED', 'REVIEW_REQUIRED']);
  });

  it('assigns every source kind a role, so a new one cannot inherit the ability to corroborate', () => {
    for (const kind of IDENTITY_EVIDENCE_SOURCE_KINDS) {
      expect(IDENTITY_SOURCE_ROLE[kind], kind).toBeDefined();
    }
    expect(IDENTITY_SOURCE_ROLE.UNKNOWN).toBe('NON_CORROBORATING');
    expect(IDENTITY_SOURCE_ROLE.PUBLIC_REFERENCE_CORROBORATION).toBe('WEAK_CORROBORATING');
    expect(IDENTITY_SOURCE_ROLE.PROSPECT_SELF_ASSERTED).toBe('CORROBORATING');
    expect(IDENTITY_SOURCE_ROLE.OPERATOR_REVIEWED).toBe('CORROBORATING');
  });
});

// ===========================================================================
// The WhatsApp handle is a handle, not a destination.
// ===========================================================================

describe('a WhatsApp participant reference carries no destination', () => {
  it('accepts an opaque channel-local handle', () => {
    expect(createCrossChannelIdentityEvidenceClaim(claimInput()).ok).toBe(true);
    for (const ref of ['wa.participant.abc123', 'WA:participant-1', 'wa_p_9']) {
      expect(
        createCrossChannelIdentityEvidenceClaim(claimInput({ whatsappParticipantRef: ref })).ok,
        ref,
      ).toBe(true);
    }
  });

  it('refuses every shape that could be dialled, fetched or delivered to', () => {
    for (const destination of [
      // A number, however it is written. The bare run is the one the character class would admit.
      '+919812345678',
      '919812345678',
      '9812345678',
      '91-98-1234-5678',
      'tel:+919812345678',
      // A link. The last one carries no digits and no platform name, so only the fetchable-location
      // shape stands between it and the package.
      'https://wa.me/919812345678',
      'https://example.com/x',
      'wa.me/919812345678',
      'https://api.whatsapp.com/send?phone=919812345678',
      'whatsapp.com/919812345678',
      'www.example.com',
      // An address, and a handle.
      'someone@example.com',
      '@someone',
      // A path.
      '/wa/participant/1',
      'wa/participant/1',
      // Empty and oversized.
      '',
      'x'.repeat(129),
    ]) {
      expect(
        createCrossChannelIdentityEvidenceClaim(claimInput({ whatsappParticipantRef: destination }))
          .ok,
        destination,
      ).toBe(false);
    }
  });

  it('screens the source reference the same way, because provenance is a place to hide one', () => {
    for (const destination of ['919812345678', 'https://wa.me/1', 'someone@example.com']) {
      expect(
        createCrossChannelIdentityEvidenceClaim(claimInput({ sourceRef: destination })).ok,
        destination,
      ).toBe(false);
    }
  });

  it('concludes nothing from two channel handles that happen to be spelled the same', () => {
    // Matching text across channels is a coincidence, not an identity. Nothing derives one handle
    // from the other, and equality earns no evidence, no recommendation and no candidate.
    const same = 'shared.handle.001';
    const bound = { instagramParticipantRef: same, whatsappParticipantRef: same };

    const bundle = createCrossChannelIdentityEvidenceBundle({ prospectRef: PROSPECT, ...bound });
    if (!bundle.ok) throw new Error(`bundle fixture refused: ${bundle.refusal}`);

    const recommendation = evaluateCrossChannelIdentityLink({
      recommendationRef: 'rec.same',
      bundle: bundle.bundle,
      createdAt: LATER,
    });
    // Identical handles, and an empty bundle. The equality contributed exactly nothing.
    expect(recommendation?.outcome).toBe('REVIEW_REQUIRED');
    expect(recommendation?.reasonCode).toBe('INSUFFICIENT_EVIDENCE');

    // One claim about them is still one claim, whatever the handles say.
    const appended = appendCrossChannelIdentityEvidence(bundle.bundle, claim(bound));
    if (!appended.ok) throw new Error(`append refused: ${appended.refusal}`);
    const single = evaluateCrossChannelIdentityLink({
      recommendationRef: 'rec.same.one',
      bundle: appended.bundle,
      createdAt: LATER,
    });
    expect(single?.outcome).toBe('REVIEW_REQUIRED');
  });
});

// ===========================================================================
// The evidence claim.
// ===========================================================================

describe('an identity evidence claim is evidence, and says so', () => {
  it('canonicalizes support and contradiction, and stamps the posture itself', () => {
    for (const relation of IDENTITY_EVIDENCE_RELATIONS) {
      const built = claim({ relation });
      expect(built.contractVersion).toBe(AAROHI_AVG6_CONTRACT_VERSION);
      expect(built.relation).toBe(relation);
      expect(built.sourcePosture).toBe('INJECTED_OFFLINE_IDENTITY_EVIDENCE');
      expect(IDENTITY_EVIDENCE_SOURCE_POSTURE).toBe('INJECTED_OFFLINE_IDENTITY_EVIDENCE');
      expect(identityEvidenceClaimSchema.safeParse(built).success).toBe(true);
      expect(Object.isFrozen(built)).toBe(true);
    }
  });

  it('gives a caller no way to claim its fixture was verified or authenticated', () => {
    for (const forged of [
      { sourcePosture: 'CORE_VERIFIED' },
      { sourcePosture: 'INJECTED_OFFLINE_IDENTITY_EVIDENCE' },
      { contractVersion: 2 },
      { relation: 'PROVES_SAME_PARTY' },
      { sourceKind: 'CORE_ATTESTED' },
    ]) {
      expect(
        createCrossChannelIdentityEvidenceClaim(claimInput(forged)).ok,
        JSON.stringify(forged),
      ).toBe(false);
    }
  });

  it('refuses every authority, destination and content field a caller might attach', () => {
    for (const forbidden of [
      { phone: '919812345678' },
      { phoneNumber: '919812345678' },
      { e164: '+919812345678' },
      { whatsappNumber: '919812345678' },
      { waId: '919812345678' },
      { phoneNumberId: '1' },
      { wabaId: '1' },
      { email: 'a@b.com' },
      { url: 'https://example.com' },
      { handle: '@someone' },
      { accessToken: 'x' },
      { token: 'x' },
      { providerCredential: 'x' },
      { consent: true },
      { optedIn: true },
      { optedOut: true },
      { approved: true },
      { authorized: true },
      { identityVerified: true },
      { resolvedIdentity: true },
      { mergedIdentity: true },
      { vendorId: 'v1' },
      { coreVendorId: 'v1' },
      { registeredVendor: true },
      { activeVendor: true },
      { sendAllowed: true },
      { sendNow: true },
      { message: 'hi' },
      { body: 'hi' },
      { text: 'hi' },
      { template: 'welcome' },
      { executionIntent: 'i1' },
      { confidence: 0.9 },
    ]) {
      expect(
        createCrossChannelIdentityEvidenceClaim(claimInput(forbidden)).ok,
        JSON.stringify(forbidden),
      ).toBe(false);
    }
  });

  it('requires a real canonical UTC instant', () => {
    for (const bad of [
      '2026-02-30T09:00:00Z',
      '2026-13-01T09:00:00Z',
      '2026-08-27 09:00:00Z',
      '2026-08-27T09:00:00',
      '2026-08-27T25:00:00Z',
    ]) {
      expect(createCrossChannelIdentityEvidenceClaim(claimInput({ observedAt: bad })).ok, bad).toBe(
        false,
      );
    }
    for (const good of ['2026-08-27T09:00:00Z', '2026-08-27T09:00:00.000Z']) {
      expect(
        createCrossChannelIdentityEvidenceClaim(claimInput({ observedAt: good })).ok,
        good,
      ).toBe(true);
    }
  });
});

// ===========================================================================
// The evidence bundle aggregate.
// ===========================================================================

describe('a bundle binds every claim it contains', () => {
  it('creates an empty canonical bundle and appends without mutating it', () => {
    const before = emptyBundle();
    expect(before.claims).toStrictEqual([]);
    const after = appendCrossChannelIdentityEvidence(before, claim());
    if (!after.ok) throw new Error(`append refused: ${after.refusal}`);
    expect(before.claims).toHaveLength(0);
    expect(after.bundle.claims).toHaveLength(1);
    expect(Object.isFrozen(after.bundle)).toBe(true);
    expect(Object.isFrozen(after.bundle.claims)).toBe(true);
    expect(Object.isFrozen(after.bundle.claims[0])).toBe(true);
    expect(identityEvidenceBundleSchema.safeParse(after.bundle).success).toBe(true);
  });

  it('refuses a claim about another prospect or another pair of handles', () => {
    for (const over of [
      { prospectRef: OTHER_PROSPECT },
      { instagramParticipantRef: OTHER_IG_PARTICIPANT },
      { whatsappParticipantRef: OTHER_WA_PARTICIPANT },
    ]) {
      const result = appendCrossChannelIdentityEvidence(emptyBundle(), claim(over));
      expect(result.ok, JSON.stringify(over)).toBe(false);
      if (!result.ok) expect(result.refusal).toBe('IDENTITY_BINDING_MISMATCH');

      // And the PUBLIC parser refuses the same aggregate, which is the half AVG-5 got wrong first.
      const forged = forgedBundle([claim(over)]);
      expect(identityEvidenceBundleSchema.safeParse(forged).success, JSON.stringify(over)).toBe(
        false,
      );
      expect(parseCrossChannelIdentityEvidenceBundle(forged)).toBeUndefined();
    }
  });

  it('refuses a repeated evidence reference, by either door', () => {
    // Counting one observation twice is exactly how a single weak signal comes to look independent.
    const first = bundleOf([claim({ evidenceRef: 'ev.dup' })]);
    const again = appendCrossChannelIdentityEvidence(
      first,
      claim({ evidenceRef: 'ev.dup', sourceRef: 'src.other', observedAt: LATER }),
    );
    expect(again.ok).toBe(false);
    if (!again.ok) expect(again.refusal).toBe('IDENTITY_EVIDENCE_DUPLICATE');

    const forged = forgedBundle([
      claim({ evidenceRef: 'ev.dup', observedAt: '2026-08-27T09:00:01Z' }),
      claim({ evidenceRef: 'ev.dup', observedAt: '2026-08-27T09:00:02Z' }),
    ]);
    expect(identityEvidenceBundleSchema.safeParse(forged).success).toBe(false);
    expect(parseCrossChannelIdentityEvidenceBundle(forged)).toBeUndefined();
  });

  it('holds a finite number of claims', () => {
    let bundle = emptyBundle();
    for (let index = 0; index < MAX_IDENTITY_EVIDENCE_CLAIMS; index += 1) {
      const appended = appendCrossChannelIdentityEvidence(
        bundle,
        claim({ evidenceRef: `ev.${String(index).padStart(3, '0')}` }),
      );
      if (!appended.ok) throw new Error(`append ${String(index)} refused: ${appended.refusal}`);
      bundle = appended.bundle;
    }
    expect(bundle.claims).toHaveLength(MAX_IDENTITY_EVIDENCE_CLAIMS);
    const overflow = appendCrossChannelIdentityEvidence(bundle, claim({ evidenceRef: 'ev.over' }));
    expect(overflow.ok).toBe(false);
    if (!overflow.ok) expect(overflow.refusal).toBe('IDENTITY_EVIDENCE_LIMIT_REACHED');
  });

  it('orders claims by the semantic UTC instant, not the spelling of it', () => {
    // AVG-5 shipped a comparator that compared timestamp strings and had to be corrected. The
    // grammar makes milliseconds optional, so lexicographic order is not chronological order:
    // `.` sorts before `Z`, which puts `09:00:00.500Z` ahead of `09:00:00Z`.
    // Widened to `string`: comparing two singleton literals is a question TypeScript answers
    // without running anything, and what these specs are about is what the VALUES do.
    const wholeSecond = canonicalInstant('2026-08-27T09:00:00Z');
    const halfSecondLater = canonicalInstant('2026-08-27T09:00:00.500Z');
    expect(wholeSecond < halfSecondLater).toBe(false);
    expect(Date.parse(wholeSecond) < Date.parse(halfSecondLater)).toBe(true);

    const earlier = claim({ evidenceRef: 'ev.a', observedAt: wholeSecond });
    const later = claim({ evidenceRef: 'ev.b', observedAt: halfSecondLater });

    for (const arrival of [
      [earlier, later],
      [later, earlier],
    ]) {
      expect(bundleOf(arrival).claims.map((one) => one.evidenceRef)).toStrictEqual([
        'ev.a',
        'ev.b',
      ]);
    }
    expect(identityEvidenceBundleSchema.safeParse(forgedBundle([earlier, later])).success).toBe(
      true,
    );
    expect(identityEvidenceBundleSchema.safeParse(forgedBundle([later, earlier])).success).toBe(
      false,
    );
  });

  it('treats two spellings of one instant as one instant, and ties on the evidence reference', () => {
    const wholeSecond = '2026-08-27T09:00:00Z';
    const sameWithMillis = '2026-08-27T09:00:00.000Z';
    expect(Date.parse(wholeSecond)).toBe(Date.parse(sameWithMillis));

    // Reference order and spelling order DISAGREE here: `.000Z` sorts first as text, `ev.a` sorts
    // first as a reference. Only the reference may decide.
    const refAWholeSecond = claim({ evidenceRef: 'ev.a', observedAt: wholeSecond });
    const refZMillis = claim({ evidenceRef: 'ev.z', observedAt: sameWithMillis });
    expect(refZMillis.observedAt < refAWholeSecond.observedAt).toBe(true);

    for (const arrival of [
      [refAWholeSecond, refZMillis],
      [refZMillis, refAWholeSecond],
    ]) {
      expect(bundleOf(arrival).claims.map((one) => one.evidenceRef)).toStrictEqual([
        'ev.a',
        'ev.z',
      ]);
    }
    expect(
      identityEvidenceBundleSchema.safeParse(forgedBundle([refAWholeSecond, refZMillis])).success,
    ).toBe(true);
    expect(
      identityEvidenceBundleSchema.safeParse(forgedBundle([refZMillis, refAWholeSecond])).success,
    ).toBe(false);
  });

  it('refuses an unsorted bundle rather than reordering it, and rebuilds what it accepts', () => {
    const unsorted = forgedBundle([
      claim({ evidenceRef: 'ev.b', observedAt: '2026-08-27T09:00:02Z' }),
      claim({ evidenceRef: 'ev.a', observedAt: '2026-08-27T09:00:01Z' }),
    ]);
    expect(identityEvidenceBundleSchema.safeParse(unsorted).success).toBe(false);
    expect(parseCrossChannelIdentityEvidenceBundle(unsorted)).toBeUndefined();

    const claims = [claim()];
    const parsed = parseCrossChannelIdentityEvidenceBundle(forgedBundle(claims));
    if (parsed === undefined) throw new Error('expected a canonical bundle to parse');
    claims.length = 0;
    expect(parsed.claims).toHaveLength(1);
    expect(Object.isFrozen(parsed.claims)).toBe(true);
  });
});

// ===========================================================================
// The recommendation. Never a merge.
// ===========================================================================

describe('the identity link is a recommendation, and the policy is deterministic', () => {
  it('recommends a link only on two independent corroborating legs', () => {
    const recommendation = recommendationFor(sufficientEvidence());
    expect(recommendation.outcome).toBe('LINK_RECOMMENDED');
    expect(recommendation.reasonCode).toBe('SUFFICIENT_INDEPENDENT_SUPPORT');
    expect([...recommendation.supportingEvidenceRefs]).toStrictEqual(['ev.001', 'ev.002']);
    expect([...recommendation.contradictingEvidenceRefs]).toStrictEqual([]);
    expect(recommendation.prospectRef).toBe(PROSPECT);
    expect(recommendation.instagramParticipantRef).toBe(IG_PARTICIPANT);
    expect(recommendation.whatsappParticipantRef).toBe(WA_PARTICIPANT);
    expect(identityLinkRecommendationSchema.safeParse(recommendation).success).toBe(true);
    expect(Object.isFrozen(recommendation)).toBe(true);
    expect(Object.isFrozen(recommendation.supportingEvidenceRefs)).toBe(true);
  });

  it('says a person should look when there is not enough, and names why', () => {
    // Nothing at all.
    expect(recommendationFor([]).outcome).toBe('REVIEW_REQUIRED');
    expect(recommendationFor([]).reasonCode).toBe('INSUFFICIENT_EVIDENCE');

    // One claim is one claim, however strong its source.
    const single = recommendationFor([claim({ sourceKind: 'OPERATOR_REVIEWED' })]);
    expect(single.outcome).toBe('REVIEW_REQUIRED');
    expect(single.reasonCode).toBe('INSUFFICIENT_EVIDENCE');
  });

  it('counts independence by SOURCE, so one observation recorded twice is still one', () => {
    // Two evidence references, one source reference. That is a single observation written down
    // twice, and it is the most natural way for weak evidence to look corroborated.
    const sameSource = recommendationFor([
      claim({ evidenceRef: 'ev.001', sourceKind: 'PROSPECT_SELF_ASSERTED', sourceRef: 'src.a' }),
      claim({
        evidenceRef: 'ev.002',
        sourceKind: 'OPERATOR_REVIEWED',
        sourceRef: 'src.a',
        observedAt: LATER,
      }),
    ]);
    expect(sameSource.outcome).toBe('REVIEW_REQUIRED');
    expect(sameSource.reasonCode).toBe('INSUFFICIENT_EVIDENCE');
  });

  it('gives unrecorded provenance no weight at all', () => {
    const unknownOnly = recommendationFor([
      claim({ evidenceRef: 'ev.001', sourceKind: 'UNKNOWN', sourceRef: 'src.a' }),
      claim({
        evidenceRef: 'ev.002',
        sourceKind: 'UNKNOWN',
        sourceRef: 'src.b',
        observedAt: LATER,
      }),
    ]);
    expect(unknownOnly.outcome).toBe('REVIEW_REQUIRED');
    expect(unknownOnly.reasonCode).toBe('NON_CORROBORATING_EVIDENCE_ONLY');

    // And it cannot top up a real leg into a recommendation either.
    const oneRealPlusUnknown = recommendationFor([
      claim({ evidenceRef: 'ev.001', sourceKind: 'OPERATOR_REVIEWED', sourceRef: 'src.a' }),
      claim({
        evidenceRef: 'ev.002',
        sourceKind: 'UNKNOWN',
        sourceRef: 'src.b',
        observedAt: LATER,
      }),
    ]);
    expect(oneRealPlusUnknown.outcome).toBe('REVIEW_REQUIRED');
  });

  it('refuses to recommend on public coincidence alone, however much of it there is', () => {
    // Public data repeats itself. Two listings quoting the same directory are one observation.
    const publicOnly = recommendationFor(
      [
        claim({
          evidenceRef: 'ev.001',
          sourceKind: 'PUBLIC_REFERENCE_CORROBORATION',
          sourceRef: 'src.a',
        }),
        claim({
          evidenceRef: 'ev.002',
          sourceKind: 'PUBLIC_REFERENCE_CORROBORATION',
          sourceRef: 'src.b',
          observedAt: LATER,
        }),
        claim({
          evidenceRef: 'ev.003',
          sourceKind: 'PUBLIC_REFERENCE_CORROBORATION',
          sourceRef: 'src.c',
          observedAt: '2026-08-27T09:10:00Z',
        }),
      ],
      { createdAt: '2026-08-27T09:10:00Z' },
    );
    expect(publicOnly.outcome).toBe('REVIEW_REQUIRED');
    expect(publicOnly.reasonCode).toBe('NON_CORROBORATING_EVIDENCE_ONLY');

    // One non-public leg alongside it is enough, because the weak leg still counts for independence.
    const mixed = recommendationFor([
      claim({
        evidenceRef: 'ev.001',
        sourceKind: 'PUBLIC_REFERENCE_CORROBORATION',
        sourceRef: 'src.a',
      }),
      claim({
        evidenceRef: 'ev.002',
        sourceKind: 'PROSPECT_SELF_ASSERTED',
        sourceRef: 'src.b',
        observedAt: LATER,
      }),
    ]);
    expect(mixed.outcome).toBe('LINK_RECOMMENDED');
  });

  it('lets one denial outweigh any amount of agreement', () => {
    const contradicted = recommendationFor(
      [
        ...sufficientEvidence(),
        claim({
          evidenceRef: 'ev.003',
          relation: 'CONTRADICTS_SAME_PARTY',
          sourceKind: 'OPERATOR_REVIEWED',
          sourceRef: 'src.c',
          observedAt: '2026-08-27T09:10:00Z',
        }),
      ],
      { createdAt: '2026-08-27T09:10:00Z' },
    );
    expect(contradicted.outcome).toBe('REVIEW_REQUIRED');
    expect(contradicted.reasonCode).toBe('CONFLICTING_EVIDENCE');
    expect([...contradicted.contradictingEvidenceRefs]).toStrictEqual(['ev.003']);
  });

  it('carries no score, no prose, and no way for a caller to state the outcome', () => {
    const recommendation = recommendationFor(sufficientEvidence());
    for (const key of Object.keys(recommendation)) {
      for (const forbidden of ['confidence', 'score', 'probability', 'explanation', 'reasoning']) {
        expect(key.toLowerCase(), `${key} must not carry ${forbidden}`).not.toContain(forbidden);
      }
    }
    // The caller states a reference, a bundle and an instant. Not a verdict.
    for (const forged of [
      { outcome: 'LINK_RECOMMENDED' },
      { reasonCode: 'SUFFICIENT_INDEPENDENT_SUPPORT' },
      { posture: { identityMerged: true } },
      { supportingEvidenceRefs: ['ev.001', 'ev.002'] },
      { confidence: 0.99 },
    ]) {
      expect(
        evaluateCrossChannelIdentityLink({
          recommendationRef: 'rec.forged',
          bundle: bundleOf(sufficientEvidence()),
          createdAt: LATER,
          ...forged,
        }),
        JSON.stringify(forged),
      ).toBeUndefined();
    }
  });

  it('states that nothing was merged, verified, consented or authorized', () => {
    const posture = recommendationFor(sufficientEvidence()).posture as unknown as Readonly<
      Record<string, unknown>
    >;
    expect(posture['recommendationOnly']).toBe(true);
    for (const declared of [
      'identityMerged',
      'coreIdentityMutated',
      'identityVerified',
      'consentEstablished',
      'communicationAuthorized',
    ]) {
      expect(posture[declared], declared).toBe(false);
    }
  });

  it('fails closed on a bundle it cannot read, and on a hand-built contradictory recommendation', () => {
    for (const bad of [undefined, null, {}, { claims: [] }, 'bundle']) {
      expect(
        evaluateCrossChannelIdentityLink({
          recommendationRef: 'rec.bad',
          bundle: bad,
          createdAt: LATER,
        }),
        JSON.stringify(bad),
      ).toBeUndefined();
    }
    // A forged mixed-prospect bundle cannot produce a recommendation either.
    expect(
      evaluateCrossChannelIdentityLink({
        recommendationRef: 'rec.forged',
        bundle: forgedBundle([claim({ prospectRef: OTHER_PROSPECT })]),
        createdAt: LATER,
      }),
    ).toBeUndefined();

    // And the recommendation parser refuses a value whose outcome and reason disagree.
    const good = recommendationFor(sufficientEvidence());
    expect(parseCrossChannelIdentityLinkRecommendation(good)).toBeDefined();
    for (const broken of [
      { ...good, reasonCode: 'INSUFFICIENT_EVIDENCE' as const },
      { ...good, outcome: 'REVIEW_REQUIRED' as const },
      { ...good, contradictingEvidenceRefs: ['ev.009'] },
      { ...good, supportingEvidenceRefs: ['ev.002', 'ev.001'] },
      { ...good, supportingEvidenceRefs: ['ev.001', 'ev.001'] },
    ]) {
      expect(
        parseCrossChannelIdentityLinkRecommendation(broken),
        JSON.stringify(broken.reasonCode),
      ).toBeUndefined();
    }
    expect([...IDENTITY_LINK_REASON_CODES]).toContain('IDENTITY_BUNDLE_INVALID');
  });
});

// ===========================================================================
// The WhatsApp CHANNEL handoff candidate.
// ===========================================================================

describe('the WhatsApp channel handoff candidate is inert, and is not the other handoff', () => {
  it('prepares a candidate from a canonical conversation, a link and current NOT_REGISTERED', () => {
    const built = prepareWhatsAppChannelHandoffCandidate(handoffInput());
    if (!built.ok) throw new Error(`candidate refused: ${built.refusal}`);
    const candidate = built.candidate;

    expect(candidate.contractVersion).toBe(AAROHI_AVG6_CONTRACT_VERSION);
    expect(candidate.sourceChannel).toBe('instagram');
    expect(candidate.targetChannel).toBe('whatsapp');
    expect(candidate.outcome).toBe('READY_FOR_FUTURE_CORE_WHATSAPP_HANDOFF_REVIEW');
    expect(WHATSAPP_CHANNEL_HANDOFF_OUTCOME).toBe('READY_FOR_FUTURE_CORE_WHATSAPP_HANDOFF_REVIEW');
    expect(candidate.prospectRef).toBe(PROSPECT);
    expect(candidate.instagramConversationRef).toBe(CONVERSATION);
    expect(candidate.instagramThreadRef).toBe(THREAD);
    expect(candidate.instagramParticipantRef).toBe(IG_PARTICIPANT);
    expect(candidate.whatsappParticipantRef).toBe(WA_PARTICIPANT);
    expect(candidate.identityRecommendationRef).toBe('rec.001');
    expect(candidate.coreStatus).toBe('NOT_REGISTERED');
    expect(candidate.coreLookupRef).toBe('lookup-not-registered');
    expect(whatsappChannelHandoffCandidateSchema.safeParse(candidate).success).toBe(true);
    expect(Object.isFrozen(candidate)).toBe(true);
  });

  it('carries no message, template, number or provider identity', () => {
    const built = prepareWhatsAppChannelHandoffCandidate(handoffInput());
    if (!built.ok) throw new Error('candidate refused');
    for (const forbidden of [
      'body',
      'text',
      'message',
      'template',
      'phone',
      'e164',
      'recipient',
      'token',
      'waId',
      'phoneNumberId',
    ]) {
      expect(Object.keys(built.candidate), forbidden).not.toContain(forbidden);
    }
    // Nor could a caller supply one: the builder's input is strict and has no such field.
    for (const forged of [
      { body: 'hello' },
      { message: 'hello' },
      { template: 'welcome' },
      { whatsappParticipantRef: 'wa.participant.other' },
      // The prospect comes from the certified conversation. A caller that could name one would be
      // a caller that could silently re-point a candidate at somebody else.
      { prospectRef: OTHER_PROSPECT },
      { instagramParticipantRef: OTHER_IG_PARTICIPANT },
      { identityRecommendationRef: 'rec.other' },
      { targetChannel: 'sms' },
      { sourceChannel: 'whatsapp' },
      { outcome: 'READY_TO_SEND' },
      { coreStatus: 'NOT_REGISTERED' },
    ]) {
      expect(
        prepareWhatsAppChannelHandoffCandidate(handoffInput(forged)).ok,
        JSON.stringify(forged),
      ).toBe(false);
    }
  });

  it('states every effect that did not happen, including the OTHER handoff', () => {
    const built = prepareWhatsAppChannelHandoffCandidate(handoffInput());
    if (!built.ok) throw new Error('candidate refused');
    const posture = built.candidate.posture;

    expect(posture.candidateOnly).toBe(true);
    expect(posture.identityRecommendationOnly).toBe(true);
    expect(posture.identityMergeExecuted).toBe(false);
    expect(posture.coreIdentityMutated).toBe(false);
    expect(posture.requiresCoreRecipientResolution).toBe(true);
    expect(posture.requiresCoreConsentRevalidation).toBe(true);
    expect(posture.requiresCoreExecutionTimeEligibilityRevalidation).toBe(true);
    expect(posture.recipientResolvedByCore).toBe(false);
    expect(posture.consentEstablished).toBe(false);
    expect(posture.communicationRequestCreated).toBe(false);
    expect(posture.approvalRequestCreated).toBe(false);
    expect(posture.approvalDecisionCreated).toBe(false);
    expect(posture.communicationAuthorizationCreated).toBe(false);
    expect(posture.executionIntentCreated).toBe(false);
    expect(posture.n8nExecutionRequested).toBe(false);
    expect(posture.providerSendRequested).toBe(false);
    expect(posture.whatsappSendRequested).toBe(false);
    expect(posture.sent).toBe(false);
    expect(posture.delivered).toBe(false);
    // The two that keep a CHANNEL transition distinct from Aarohi's ownership passing to Anisha.
    expect(posture.acquisitionCaseMutated).toBe(false);
    expect(posture.anishaHandoffExecuted).toBe(false);
    expect(posture.productionMutation).toBe(false);
    expect(posture.businessEffect).toBe(false);

    const serialized = JSON.stringify(built.candidate).toUpperCase();
    for (const forbidden of ['HANDED_OFF_TO_ANISHA', 'ACTIVE', 'AUTHORIZED', 'SENT":TRUE']) {
      expect(serialized, forbidden).not.toContain(forbidden);
    }
  });

  it('refuses anything short of a positive, matching recommendation', () => {
    // REVIEW_REQUIRED is a person looking, not a slower yes.
    const review = prepareWhatsAppChannelHandoffCandidate(
      handoffInput({
        recommendation: recommendationFor([claim()]),
        evidenceBundle: bundleOf([claim()]),
      }),
    );
    expect(review.ok).toBe(false);
    if (!review.ok) expect(review.refusal).toBe('IDENTITY_LINK_NOT_RECOMMENDED');

    // A recommendation about somebody else is a different question entirely.
    const otherProspect = evaluateCrossChannelIdentityLink({
      recommendationRef: 'rec.other',
      bundle: (() => {
        const bundle = createCrossChannelIdentityEvidenceBundle({
          prospectRef: OTHER_PROSPECT,
          instagramParticipantRef: IG_PARTICIPANT,
          whatsappParticipantRef: WA_PARTICIPANT,
        });
        if (!bundle.ok) throw new Error('bundle fixture refused');
        let current = bundle.bundle;
        for (const one of [
          claim({ prospectRef: OTHER_PROSPECT, evidenceRef: 'ev.001', sourceRef: 'src.a' }),
          claim({
            prospectRef: OTHER_PROSPECT,
            evidenceRef: 'ev.002',
            sourceKind: 'OPERATOR_REVIEWED',
            sourceRef: 'src.b',
            observedAt: LATER,
          }),
        ]) {
          const appended = appendCrossChannelIdentityEvidence(current, one);
          if (!appended.ok) throw new Error(`append refused: ${appended.refusal}`);
          current = appended.bundle;
        }
        return current;
      })(),
      createdAt: LATER,
    });
    expect(otherProspect?.outcome).toBe('LINK_RECOMMENDED');
    const crossed = prepareWhatsAppChannelHandoffCandidate(
      handoffInput({ recommendation: otherProspect }),
    );
    expect(crossed.ok).toBe(false);
    if (!crossed.ok) expect(crossed.refusal).toBe('IDENTITY_BINDING_MISMATCH');

    // And a malformed recommendation is refused rather than half-read.
    for (const bad of [undefined, null, {}, { outcome: 'LINK_RECOMMENDED' }]) {
      const result = prepareWhatsAppChannelHandoffCandidate(handoffInput({ recommendation: bad }));
      expect(result.ok, JSON.stringify(bad)).toBe(false);
      if (!result.ok) expect(result.refusal).toBe('IDENTITY_RECOMMENDATION_INVALID');
    }
  });

  it('refuses a conversation it cannot certify, including a forged mixed-prospect one', () => {
    expect(prepareWhatsAppChannelHandoffCandidate(handoffInput({ conversation: {} })).ok).toBe(
      false,
    );

    // AVG-5's aggregate gate, inherited. The turn is individually canonical; the conversation is not.
    const forgedConversation = {
      ...conversation(),
      inboundTurns: [inboundTurn({ prospectRef: OTHER_PROSPECT })],
    };
    const result = prepareWhatsAppChannelHandoffCandidate(
      handoffInput({ conversation: forgedConversation }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.refusal).toBe('INSTAGRAM_CONVERSATION_INVALID');

    // A conversation with an honest turn still works, so the refusal above is the aggregate gate
    // rather than the handoff builder having stopped accepting conversations.
    const honest = appendInstagramInboundObservation(conversation(), inboundTurn());
    if (!honest.ok) throw new Error(`append refused: ${honest.refusal}`);
    expect(
      prepareWhatsAppChannelHandoffCandidate(handoffInput({ conversation: honest.conversation }))
        .ok,
    ).toBe(true);
  });

  it('refuses a recommendation about another Instagram participant', () => {
    // The conversation names one handle and the recommendation names another. Neither is wrong on
    // its own; together they describe two different people, and the candidate would bind both.
    const bundle = createCrossChannelIdentityEvidenceBundle({
      prospectRef: PROSPECT,
      instagramParticipantRef: OTHER_IG_PARTICIPANT,
      whatsappParticipantRef: WA_PARTICIPANT,
    });
    if (!bundle.ok) throw new Error(`bundle fixture refused: ${bundle.refusal}`);
    let current = bundle.bundle;
    for (const one of [
      claim({
        evidenceRef: 'ev.001',
        instagramParticipantRef: OTHER_IG_PARTICIPANT,
        sourceRef: 'src.a',
      }),
      claim({
        evidenceRef: 'ev.002',
        instagramParticipantRef: OTHER_IG_PARTICIPANT,
        sourceKind: 'OPERATOR_REVIEWED',
        sourceRef: 'src.b',
        observedAt: LATER,
      }),
    ]) {
      const appended = appendCrossChannelIdentityEvidence(current, one);
      if (!appended.ok) throw new Error(`append refused: ${appended.refusal}`);
      current = appended.bundle;
    }
    const elsewhere = evaluateCrossChannelIdentityLink({
      recommendationRef: 'rec.elsewhere',
      bundle: current,
      createdAt: LATER,
    });
    expect(elsewhere?.outcome).toBe('LINK_RECOMMENDED');

    const built = prepareWhatsAppChannelHandoffCandidate(
      handoffInput({ recommendation: elsewhere }),
    );
    expect(built.ok).toBe(false);
    if (!built.ok) expect(built.refusal).toBe('IDENTITY_BINDING_MISMATCH');
  });

  it('refuses a candidate prepared before the recommendation it rests on', () => {
    const recommendation = recommendationFor(sufficientEvidence());
    expect(recommendation.createdAt).toBe(LATER);

    const earlier = prepareWhatsAppChannelHandoffCandidate(
      handoffInput({ preparedAt: '2026-08-27T09:04:59Z' }),
    );
    expect(earlier.ok).toBe(false);
    if (!earlier.ok) expect(earlier.refusal).toBe('PREPARED_BEFORE_RECOMMENDATION');

    // The same instant is coherent; later is the ordinary case.
    expect(prepareWhatsAppChannelHandoffCandidate(handoffInput({ preparedAt: LATER })).ok).toBe(
      true,
    );
    const later = prepareWhatsAppChannelHandoffCandidate(
      handoffInput({ preparedAt: '2026-08-27T10:00:00Z' }),
    );
    expect(later.ok).toBe(true);
    if (later.ok) expect(later.candidate.preparedAt).toBe('2026-08-27T10:00:00Z');
  });

  it('re-runs the CURRENT Core gate, and no amount of evidence bypasses it', () => {
    for (const status of CORE_PARTY_STATUSES) {
      const built = prepareWhatsAppChannelHandoffCandidate(
        handoffInput({ coreObservation: observation(status) }),
      );
      if (status === 'NOT_REGISTERED') {
        expect(built.ok, status).toBe(true);
        continue;
      }
      expect(built.ok, status).toBe(false);
      if (!built.ok) expect(built.refusal, status).toBe('CORE_GATE_REFUSED');
    }

    // A cross-prospect observation fails closed rather than being read as weak evidence.
    expect(
      prepareWhatsAppChannelHandoffCandidate(
        handoffInput({ coreObservation: observation('NOT_REGISTERED', OTHER_PROSPECT) }),
      ).ok,
    ).toBe(false);

    // A full evidence bundle and a positive recommendation still lose to current suppression: they
    // answer a different question, with a different authority.
    const rich: CrossChannelIdentityEvidenceClaim[] = [];
    for (let index = 0; index < 8; index += 1) {
      rich.push(
        claim({
          evidenceRef: `ev.${String(index).padStart(3, '0')}`,
          sourceKind: index % 2 === 0 ? 'PROSPECT_SELF_ASSERTED' : 'OPERATOR_REVIEWED',
          sourceRef: `src.${String(index)}`,
          observedAt: `2026-08-27T09:0${String(index)}:00Z`,
        }),
      );
    }
    const strong = recommendationFor(rich, {
      recommendationRef: 'rec.strong',
      createdAt: '2026-08-27T09:10:00Z',
    });
    expect(strong.outcome).toBe('LINK_RECOMMENDED');
    const strongInput = {
      recommendation: strong,
      evidenceBundle: bundleOf(rich),
      preparedAt: '2026-08-27T09:10:00Z',
    };
    // Honest, fully evidenced, and eligible: this is the shape the loop below suppresses, proved
    // here so the refusals below are the Core gate rather than the new provenance check.
    expect(prepareWhatsAppChannelHandoffCandidate(handoffInput(strongInput)).ok).toBe(true);
    for (const status of ['DO_NOT_CONTACT', 'REGISTERED', 'ACTIVE', 'UNKNOWN'] as const) {
      const built = prepareWhatsAppChannelHandoffCandidate(
        handoffInput({ ...strongInput, coreObservation: observation(status) }),
      );
      expect(built.ok, status).toBe(false);
      if (!built.ok) expect(built.refusal, status).toBe('CORE_GATE_REFUSED');
    }
  });
});

// ===========================================================================
// OWNER REVIEW, finding 1 — a parsed recommendation is not a policy proof.
//
// Everything in this section describes the same defect from two sides: a schema can certify what an
// object SAYS, and only the evidence can certify what it RESTS ON.
// ===========================================================================

describe('a positive recommendation cannot claim support it does not name', () => {
  it('refuses LINK_RECOMMENDED naming fewer than two supporting references', () => {
    for (const refs of [[], ['ev.001']]) {
      const forged = forgedPositiveRecommendation({ supportingEvidenceRefs: refs });
      expect(identityLinkRecommendationSchema.safeParse(forged).success, JSON.stringify(refs)).toBe(
        false,
      );
      // The public parser is the same invariant, because it is the same schema.
      expect(
        parseCrossChannelIdentityLinkRecommendation(forged),
        JSON.stringify(refs),
      ).toBeUndefined();
    }
  });

  it('accepts two, because this is a floor on self-consistency and not a policy proof', () => {
    // Two INVENTED references satisfy it. That is the point of the next section: the schema is shown
    // one object, and independence is a property of the sources behind claims it was never given.
    const forged = forgedPositiveRecommendation();
    expect(identityLinkRecommendationSchema.safeParse(forged).success).toBe(true);
    expect(parseCrossChannelIdentityLinkRecommendation(forged)?.outcome).toBe('LINK_RECOMMENDED');
  });
});

describe('the WhatsApp handoff re-runs the policy over the evidence it was shown', () => {
  it('requires the evidence bundle, and refuses a caller who omits it', () => {
    const { evidenceBundle: _omitted, ...withoutBundle } = handoffInput();
    const built = prepareWhatsAppChannelHandoffCandidate(withoutBundle);
    expect(built.ok).toBe(false);
    if (!built.ok) expect(built.refusal).toBe('HANDOFF_INPUT_INVALID');

    // And a bundle it cannot certify is a shape failure, told apart from a policy failure.
    for (const bad of [undefined, null, {}, forgedBundle([claim(), claim()])]) {
      const result = prepareWhatsAppChannelHandoffCandidate(handoffInput({ evidenceBundle: bad }));
      expect(result.ok, JSON.stringify(bad)).toBe(false);
      if (!result.ok) expect(result.refusal).toBe('IDENTITY_EVIDENCE_BUNDLE_INVALID');
    }
  });

  it('refuses a forged positive recommendation against every bundle that does not earn it', () => {
    // Each of these bundles is canonical and each fails the policy for a different reason. The
    // recommendation is byte-for-byte the same forgery every time.
    const cases: readonly (readonly [string, CrossChannelIdentityEvidenceBundle])[] = [
      ['empty', bundleOf([])],
      ['one claim only', bundleOf([claim({ evidenceRef: 'ev.001', sourceRef: 'src.a' })])],
      [
        'two claims from one source',
        bundleOf([
          claim({ evidenceRef: 'ev.001', sourceRef: 'src.a' }),
          claim({ evidenceRef: 'ev.002', sourceRef: 'src.a', observedAt: LATER }),
        ]),
      ],
      [
        'public corroboration only',
        bundleOf([
          claim({
            evidenceRef: 'ev.001',
            sourceKind: 'PUBLIC_REFERENCE_CORROBORATION',
            sourceRef: 'src.a',
          }),
          claim({
            evidenceRef: 'ev.002',
            sourceKind: 'PUBLIC_REFERENCE_CORROBORATION',
            sourceRef: 'src.b',
            observedAt: LATER,
          }),
        ]),
      ],
      [
        'unrecorded provenance only',
        bundleOf([
          claim({ evidenceRef: 'ev.001', sourceKind: 'UNKNOWN', sourceRef: 'src.a' }),
          claim({
            evidenceRef: 'ev.002',
            sourceKind: 'UNKNOWN',
            sourceRef: 'src.b',
            observedAt: LATER,
          }),
        ]),
      ],
      [
        'sufficient support, and a denial',
        bundleOf([
          ...sufficientEvidence(),
          claim({
            evidenceRef: 'ev.003',
            relation: 'CONTRADICTS_SAME_PARTY',
            sourceKind: 'OPERATOR_REVIEWED',
            sourceRef: 'src.c',
            observedAt: LATER,
          }),
        ]),
      ],
    ];

    for (const [label, evidenceBundle] of cases) {
      const built = prepareWhatsAppChannelHandoffCandidate(
        handoffInput({ recommendation: forgedPositiveRecommendation(), evidenceBundle }),
      );
      expect(built.ok, label).toBe(false);
      if (!built.ok) {
        expect(built.refusal, label).toBe('IDENTITY_RECOMMENDATION_POLICY_MISMATCH');
      }
    }
  });

  it('compares the exact evidence references, not merely the outcome', () => {
    // Three genuine, independent, corroborating supports. The policy really does recommend a link.
    const honest = [
      claim({ evidenceRef: 'ev.001', sourceKind: 'PROSPECT_SELF_ASSERTED', sourceRef: 'src.a' }),
      claim({
        evidenceRef: 'ev.002',
        sourceKind: 'OPERATOR_REVIEWED',
        sourceRef: 'src.b',
        observedAt: '2026-08-27T09:01:00Z',
      }),
      claim({
        evidenceRef: 'ev.003',
        sourceKind: 'OPERATOR_REVIEWED',
        sourceRef: 'src.c',
        observedAt: '2026-08-27T09:02:00Z',
      }),
    ];
    const evidenceBundle = bundleOf(honest);
    expect(recommendationFor(honest).outcome).toBe('LINK_RECOMMENDED');

    // Same outcome, same reason, same bindings, same instant — different evidence.
    for (const [label, supportingEvidenceRefs] of [
      ['invented', ['ev.fake.a', 'ev.fake.b']],
      ['one real support omitted', ['ev.001', 'ev.002']],
      ['one invented support added', ['ev.001', 'ev.002', 'ev.003', 'ev.zzz']],
      ['one real support swapped out', ['ev.001', 'ev.002', 'ev.zzz']],
    ] as const) {
      const built = prepareWhatsAppChannelHandoffCandidate(
        handoffInput({
          recommendation: forgedPositiveRecommendation({ supportingEvidenceRefs }),
          evidenceBundle,
        }),
      );
      expect(built.ok, label).toBe(false);
      if (!built.ok) {
        expect(built.refusal, label).toBe('IDENTITY_RECOMMENDATION_POLICY_MISMATCH');
      }
    }

    // The honestly evaluated recommendation over the same bundle still builds a candidate, so the
    // refusals above are the evidence comparison rather than the builder having stopped working.
    expect(
      prepareWhatsAppChannelHandoffCandidate(
        handoffInput({ recommendation: recommendationFor(honest), evidenceBundle }),
      ).ok,
    ).toBe(true);
  });

  it('refuses a recommendation whose reason code re-evaluation does not reproduce', () => {
    // A denial is present, so the canonical policy says CONFLICTING_EVIDENCE. This recommendation is
    // honest about its outcome, its references and its bindings, and wrong about WHY — which is the
    // difference between a reviewer reading "somebody denied this" and "we found little".
    const claims = [
      ...sufficientEvidence(),
      claim({
        evidenceRef: 'ev.003',
        relation: 'CONTRADICTS_SAME_PARTY',
        sourceKind: 'OPERATOR_REVIEWED',
        sourceRef: 'src.c',
        observedAt: LATER,
      }),
    ];
    const canonical = recommendationFor(claims);
    expect(canonical.reasonCode).toBe('CONFLICTING_EVIDENCE');

    const built = prepareWhatsAppChannelHandoffCandidate(
      handoffInput({
        evidenceBundle: bundleOf(claims),
        recommendation: {
          ...canonical,
          reasonCode: 'INSUFFICIENT_EVIDENCE',
          supportingEvidenceRefs: [...canonical.supportingEvidenceRefs],
          contradictingEvidenceRefs: [...canonical.contradictingEvidenceRefs],
        },
      }),
    );
    expect(built.ok).toBe(false);
    // Emphatically NOT the same refusal as an honest REVIEW_REQUIRED: this object misdescribes its
    // own evidence, and collapsing the two codes would lose exactly that.
    if (!built.ok) expect(built.refusal).toBe('IDENTITY_RECOMMENDATION_POLICY_MISMATCH');

    // The same again for the denial itself: naming a contradiction that is not the one in the
    // bundle misdescribes the evidence, and a reviewer following the reference would find nothing.
    const misnamedDenial = prepareWhatsAppChannelHandoffCandidate(
      handoffInput({
        evidenceBundle: bundleOf(claims),
        recommendation: {
          ...canonical,
          supportingEvidenceRefs: [...canonical.supportingEvidenceRefs],
          contradictingEvidenceRefs: ['ev.somebody.else'],
        },
      }),
    );
    expect(misnamedDenial.ok).toBe(false);
    if (!misnamedDenial.ok) {
      expect(misnamedDenial.refusal).toBe('IDENTITY_RECOMMENDATION_POLICY_MISMATCH');
    }

    const honest = prepareWhatsAppChannelHandoffCandidate(
      handoffInput({ evidenceBundle: bundleOf(claims), recommendation: canonical }),
    );
    expect(honest.ok).toBe(false);
    if (!honest.ok) expect(honest.refusal).toBe('IDENTITY_LINK_NOT_RECOMMENDED');
  });

  it('refuses a self-consistent bundle and recommendation about the wrong conversation', () => {
    // Everything here agrees with everything else EXCEPT the conversation: the bundle and the
    // recommendation are about one person, and the conversation whose turns the candidate would
    // carry is about another. This is the case the conversation binding exists for, and no amount
    // of internal consistency between the evidence and the recommendation substitutes for it.
    const elsewhere = (
      over: Record<string, unknown>,
    ): { bundle: CrossChannelIdentityEvidenceBundle; recommendation: unknown } => {
      const opened = createCrossChannelIdentityEvidenceBundle({
        prospectRef: PROSPECT,
        instagramParticipantRef: IG_PARTICIPANT,
        whatsappParticipantRef: WA_PARTICIPANT,
        ...over,
      });
      if (!opened.ok) throw new Error(`bundle fixture refused: ${opened.refusal}`);
      let bundle = opened.bundle;
      for (const one of [
        claim({ evidenceRef: 'ev.001', sourceRef: 'src.a', ...over }),
        claim({
          evidenceRef: 'ev.002',
          sourceKind: 'OPERATOR_REVIEWED',
          sourceRef: 'src.b',
          observedAt: LATER,
          ...over,
        }),
      ]) {
        const appended = appendCrossChannelIdentityEvidence(bundle, one);
        if (!appended.ok) throw new Error(`append refused: ${appended.refusal}`);
        bundle = appended.bundle;
      }
      const recommendation = evaluateCrossChannelIdentityLink({
        recommendationRef: 'rec.elsewhere',
        bundle,
        createdAt: LATER,
      });
      expect(recommendation?.outcome).toBe('LINK_RECOMMENDED');
      return { bundle, recommendation };
    };

    for (const [label, over] of [
      ['another prospect', { prospectRef: OTHER_PROSPECT }],
      ['another Instagram handle', { instagramParticipantRef: OTHER_IG_PARTICIPANT }],
    ] as const) {
      const { bundle, recommendation } = elsewhere(over);
      const built = prepareWhatsAppChannelHandoffCandidate(
        handoffInput({ evidenceBundle: bundle, recommendation }),
      );
      expect(built.ok, label).toBe(false);
      if (!built.ok) expect(built.refusal, label).toBe('IDENTITY_BINDING_MISMATCH');
    }
  });

  it('refuses a bundle about a different person or a different pair of handles', () => {
    const recommendation = recommendationFor(sufficientEvidence());

    const elsewhereBundle = (
      binding: Record<string, unknown>,
      over: Record<string, unknown>,
    ): CrossChannelIdentityEvidenceBundle => {
      const opened = createCrossChannelIdentityEvidenceBundle({
        prospectRef: PROSPECT,
        instagramParticipantRef: IG_PARTICIPANT,
        whatsappParticipantRef: WA_PARTICIPANT,
        ...binding,
      });
      if (!opened.ok) throw new Error(`bundle fixture refused: ${opened.refusal}`);
      let current = opened.bundle;
      for (const one of [
        claim({ evidenceRef: 'ev.001', sourceRef: 'src.a', ...over }),
        claim({
          evidenceRef: 'ev.002',
          sourceKind: 'OPERATOR_REVIEWED',
          sourceRef: 'src.b',
          observedAt: LATER,
          ...over,
        }),
      ]) {
        const appended = appendCrossChannelIdentityEvidence(current, one);
        if (!appended.ok) throw new Error(`append refused: ${appended.refusal}`);
        current = appended.bundle;
      }
      return current;
    };

    for (const [label, evidenceBundle] of [
      [
        'another prospect',
        elsewhereBundle({ prospectRef: OTHER_PROSPECT }, { prospectRef: OTHER_PROSPECT }),
      ],
      [
        'another Instagram handle',
        elsewhereBundle(
          { instagramParticipantRef: OTHER_IG_PARTICIPANT },
          { instagramParticipantRef: OTHER_IG_PARTICIPANT },
        ),
      ],
      [
        'another WhatsApp handle',
        elsewhereBundle(
          { whatsappParticipantRef: OTHER_WA_PARTICIPANT },
          { whatsappParticipantRef: OTHER_WA_PARTICIPANT },
        ),
      ],
    ] as const) {
      const built = prepareWhatsAppChannelHandoffCandidate(
        handoffInput({ recommendation, evidenceBundle }),
      );
      expect(built.ok, label).toBe(false);
      if (!built.ok) expect(built.refusal, label).toBe('IDENTITY_BINDING_MISMATCH');
    }
  });
});

// ===========================================================================
// OWNER REVIEW, finding 2 — a recommendation cannot predate its own evidence.
// ===========================================================================

describe('a recommendation must have been possible when it says it was made', () => {
  it('refuses a recommendation made before the evidence it names existed', () => {
    // The supports are at 09:00 and 09:05. A recommendation stamped 09:00 could not have read the
    // second one, so it is not a weak recommendation — it is an impossible one.
    expect(
      evaluateCrossChannelIdentityLink({
        recommendationRef: 'rec.001',
        bundle: bundleOf(sufficientEvidence()),
        createdAt: AT,
      }),
    ).toBeUndefined();
  });

  it('allows the same instant, and any instant after it', () => {
    for (const createdAt of [LATER, '2026-08-27T09:05:00.000Z', '2026-08-27T10:00:00Z']) {
      expect(
        evaluateCrossChannelIdentityLink({
          recommendationRef: 'rec.001',
          bundle: bundleOf(sufficientEvidence()),
          createdAt,
        })?.outcome,
        createdAt,
      ).toBe('LINK_RECOMMENDED');
    }
  });

  it('compares the instant a timestamp means, not the way it is spelled', () => {
    const halfPast = canonicalInstant('2026-08-27T09:00:00.500Z');
    const wholeSecond = canonicalInstant('2026-08-27T09:00:00Z');
    // As STRINGS `.500Z` sorts before `Z`, so a lexicographic check reaches both of these answers
    // backwards. Each direction is asserted, because only one of them is wrong per comparison.
    expect(halfPast < wholeSecond).toBe(true);

    const evidenceAtHalfPast = bundleOf([
      claim({ evidenceRef: 'ev.001', sourceRef: 'src.a', observedAt: halfPast }),
      claim({
        evidenceRef: 'ev.002',
        sourceKind: 'OPERATOR_REVIEWED',
        sourceRef: 'src.b',
        observedAt: halfPast,
      }),
    ]);
    // Half a second AFTER the recommendation: refused, though the strings say otherwise.
    expect(
      evaluateCrossChannelIdentityLink({
        recommendationRef: 'rec.001',
        bundle: evidenceAtHalfPast,
        createdAt: wholeSecond,
      }),
    ).toBeUndefined();

    // And the mirror: evidence on the whole second, recommendation half a second later. Coherent,
    // though a lexicographic check would refuse it.
    const evidenceAtWholeSecond = bundleOf([
      claim({ evidenceRef: 'ev.001', sourceRef: 'src.a', observedAt: wholeSecond }),
      claim({
        evidenceRef: 'ev.002',
        sourceKind: 'OPERATOR_REVIEWED',
        sourceRef: 'src.b',
        observedAt: wholeSecond,
      }),
    ]);
    expect(
      evaluateCrossChannelIdentityLink({
        recommendationRef: 'rec.001',
        bundle: evidenceAtWholeSecond,
        createdAt: halfPast,
      })?.outcome,
    ).toBe('LINK_RECOMMENDED');

    // Two spellings of one moment are one moment.
    expect(
      evaluateCrossChannelIdentityLink({
        recommendationRef: 'rec.001',
        bundle: evidenceAtWholeSecond,
        createdAt: canonicalInstant('2026-08-27T09:00:00.000Z'),
      })?.outcome,
    ).toBe('LINK_RECOMMENDED');
  });

  it('reads the latest claim, not the first, and asks nothing at all of an empty bundle', () => {
    const spread = [
      claim({ evidenceRef: 'ev.001', sourceRef: 'src.a', observedAt: AT }),
      claim({
        evidenceRef: 'ev.002',
        sourceKind: 'OPERATOR_REVIEWED',
        sourceRef: 'src.b',
        observedAt: '2026-08-27T09:10:00Z',
      }),
    ];
    // After the FIRST claim but before the last: still impossible.
    expect(
      evaluateCrossChannelIdentityLink({
        recommendationRef: 'rec.001',
        bundle: bundleOf(spread),
        createdAt: LATER,
      }),
    ).toBeUndefined();
    expect(
      evaluateCrossChannelIdentityLink({
        recommendationRef: 'rec.001',
        bundle: bundleOf(spread),
        createdAt: '2026-08-27T09:10:00Z',
      })?.outcome,
    ).toBe('LINK_RECOMMENDED');

    // An empty bundle names no evidence, so no instant can be impossible.
    expect(
      evaluateCrossChannelIdentityLink({
        recommendationRef: 'rec.001',
        bundle: emptyBundle(),
        createdAt: '2020-01-01T00:00:00Z',
      })?.reasonCode,
    ).toBe('INSUFFICIENT_EVIDENCE');
  });

  it('carries the refusal into the handoff, because the pairing cannot be re-evaluated', () => {
    // The recommendation is canonical on its own: it was evaluated against evidence at 09:00 and is
    // stamped 09:05. Paired with LATER evidence it becomes an impossible pairing, and the handoff
    // finds that out by re-running the policy rather than by trusting the object.
    const early = recommendationFor(sufficientEvidence());
    expect(early.outcome).toBe('LINK_RECOMMENDED');

    const lateEvidence = bundleOf([
      claim({ evidenceRef: 'ev.001', sourceRef: 'src.a', observedAt: '2026-08-27T09:10:00Z' }),
      claim({
        evidenceRef: 'ev.002',
        sourceKind: 'OPERATOR_REVIEWED',
        sourceRef: 'src.b',
        observedAt: '2026-08-27T09:11:00Z',
      }),
    ]);
    const built = prepareWhatsAppChannelHandoffCandidate(
      handoffInput({ recommendation: early, evidenceBundle: lateEvidence }),
    );
    expect(built.ok).toBe(false);
    if (!built.ok) expect(built.refusal).toBe('IDENTITY_RECOMMENDATION_POLICY_MISMATCH');
  });
});

// ===========================================================================
// OWNER REVIEW, finding 3 — a destination is a destination however it is punctuated.
// ===========================================================================

describe('a reference cannot carry a destination past a separator', () => {
  const SPLIT_DESTINATIONS = [
    '919812345678',
    '9_1_9_8_1_2_3_4_5_6_7_8',
    '91:98:12:34:56:78',
    'wa:91_9812_345678',
    'tel:91_98_12_34_56_78',
    'wa.91.98.12.34.56.78',
    'wa-9198-1234-5678',
    'ref9x1y9z8a1b2c3d4e5f6g7h8',
  ] as const;

  it('refuses a WhatsApp handle carrying seven or more digits, however they are separated', () => {
    for (const destination of SPLIT_DESTINATIONS) {
      expect(
        createCrossChannelIdentityEvidenceClaim(claimInput({ whatsappParticipantRef: destination }))
          .ok,
        destination,
      ).toBe(false);
    }
  });

  it('refuses a bare dialable run as an Instagram handle, where the shape is the only screen', () => {
    // The digit COUNT deliberately does not reach this field — that is the documented scope. The
    // dialable-run SHAPE does, and it is the whole reason a bare number cannot enter here.
    for (const destination of [
      '919812345678',
      '9812345678',
      '91-98-1234-5678',
      '91 98 1234 5678',
      '(91) 98 1234 5678',
    ]) {
      expect(
        createCrossChannelIdentityEvidenceClaim(
          claimInput({ instagramParticipantRef: destination }),
        ).ok,
        destination,
      ).toBe(false);
      expect(
        createCrossChannelIdentityEvidenceBundle({
          prospectRef: PROSPECT,
          instagramParticipantRef: destination,
          whatsappParticipantRef: WA_PARTICIPANT,
        }).ok,
        destination,
      ).toBe(false);
    }
  });

  it('refuses the same forms in sourceRef, so provenance is not a side channel', () => {
    for (const destination of SPLIT_DESTINATIONS) {
      expect(
        createCrossChannelIdentityEvidenceClaim(claimInput({ sourceRef: destination })).ok,
        destination,
      ).toBe(false);
    }
  });

  it('still accepts an ordinary opaque handle, and stops short of banning digits', () => {
    // Six digits is the boundary: the shortest number anybody would recognise as dialable is seven.
    for (const ref of ['wa.participant.abc123', 'WA:participant-1', 'wa_p_9', 'wa.123456']) {
      expect(
        createCrossChannelIdentityEvidenceClaim(claimInput({ whatsappParticipantRef: ref })).ok,
        ref,
      ).toBe(true);
      expect(createCrossChannelIdentityEvidenceClaim(claimInput({ sourceRef: ref })).ok, ref).toBe(
        true,
      );
    }
  });

  it('refuses them at every public parser boundary, not only in the claim builder', () => {
    for (const destination of SPLIT_DESTINATIONS) {
      expect(
        parseCrossChannelIdentityEvidenceBundle(
          forgedBundle([], { whatsappParticipantRef: destination }),
        ),
        destination,
      ).toBeUndefined();
      expect(
        parseCrossChannelIdentityLinkRecommendation(
          forgedPositiveRecommendation({ whatsappParticipantRef: destination }),
        ),
        destination,
      ).toBeUndefined();
      expect(
        createCrossChannelIdentityEvidenceBundle({
          prospectRef: PROSPECT,
          instagramParticipantRef: IG_PARTICIPANT,
          whatsappParticipantRef: destination,
        }).ok,
        destination,
      ).toBe(false);
    }
  });

  it('refuses a candidate that would carry one', () => {
    const built = prepareWhatsAppChannelHandoffCandidate(handoffInput());
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    for (const destination of SPLIT_DESTINATIONS) {
      expect(
        whatsappChannelHandoffCandidateSchema.safeParse({
          ...built.candidate,
          whatsappParticipantRef: destination,
        }).success,
        destination,
      ).toBe(false);
    }
  });

  it('leaves the AVG-5 Instagram grammar exactly where it found it', () => {
    // SCOPE, asserted rather than described. The stricter digit count deliberately does not reach
    // the Instagram handle: that grammar is AVG-5's certified contract, and tightening it here would
    // mean a conversation AVG-5 calls canonical could be refused by AVG-6 — a cross-stage
    // incompatibility rather than a containment improvement.
    //
    // The handle below is exactly the shape finding 3 was about: twelve digits, split by a character
    // the opaque class permits. AVG-5 certifies it, so AVG-6 must too — and the SAME string is
    // refused as a WhatsApp handle and as a sourceRef, which is where a destination would actually
    // be going.
    const digitHeavy = 'ig.participant.9_1_9_8_1_2_3_4_5_6_7_8';
    expect(
      createCrossChannelIdentityEvidenceClaim(claimInput({ whatsappParticipantRef: digitHeavy }))
        .ok,
    ).toBe(false);
    expect(createCrossChannelIdentityEvidenceClaim(claimInput({ sourceRef: digitHeavy })).ok).toBe(
      false,
    );

    const conversationBuilt = createInstagramConversation({
      prospectRef: PROSPECT,
      instagramConversationRef: CONVERSATION,
      instagramThreadRef: THREAD,
      instagramParticipantRef: digitHeavy,
    });
    expect(conversationBuilt.ok).toBe(true);
    expect(
      createCrossChannelIdentityEvidenceClaim(claimInput({ instagramParticipantRef: digitHeavy }))
        .ok,
    ).toBe(true);

    // A conversation AVG-5 certifies still reaches a candidate end to end.
    if (!conversationBuilt.ok) return;
    const claims = [
      claim({
        evidenceRef: 'ev.001',
        instagramParticipantRef: digitHeavy,
        sourceKind: 'PROSPECT_SELF_ASSERTED',
        sourceRef: 'src.a',
      }),
      claim({
        evidenceRef: 'ev.002',
        instagramParticipantRef: digitHeavy,
        sourceKind: 'OPERATOR_REVIEWED',
        sourceRef: 'src.b',
        observedAt: LATER,
      }),
    ];
    const opened = createCrossChannelIdentityEvidenceBundle({
      prospectRef: PROSPECT,
      instagramParticipantRef: digitHeavy,
      whatsappParticipantRef: WA_PARTICIPANT,
    });
    if (!opened.ok) throw new Error(`bundle fixture refused: ${opened.refusal}`);
    let bundle = opened.bundle;
    for (const one of claims) {
      const appended = appendCrossChannelIdentityEvidence(bundle, one);
      if (!appended.ok) throw new Error(`append refused: ${appended.refusal}`);
      bundle = appended.bundle;
    }
    const recommendation = evaluateCrossChannelIdentityLink({
      recommendationRef: 'rec.001',
      bundle,
      createdAt: LATER,
    });
    expect(recommendation?.outcome).toBe('LINK_RECOMMENDED');
    expect(
      prepareWhatsAppChannelHandoffCandidate(
        handoffInput({
          conversation: conversationBuilt.conversation,
          evidenceBundle: bundle,
          recommendation,
        }),
      ).ok,
    ).toBe(true);
  });
});

// ===========================================================================
// OWNER REVIEW, finding 4 — the canonical roadmap must not contradict itself.
// ===========================================================================

describe('the roadmap overlay stays true on both sides of a merge', () => {
  const overlay = readFileSync(
    fileURLToPath(
      new URL(
        '../../../../docs/architecture/aarohi-vendor-growth-roadmap-overlay.md',
        import.meta.url,
      ),
    ),
    'utf8',
  );

  it('no longer says everything after AVG-0 is unimplemented', () => {
    // The document's own status block records AVG-0..AVG-5 as certified offline domains, so the
    // AVG-0 section saying the opposite was the same file contradicting itself.
    expect(overlay).toContain('AVG-0 through AVG-5 — implemented as certified offline domains');
    expect(overlay).not.toContain('everything after it is planned and unimplemented');
    expect(overlay).toContain('ADR-0123');
  });

  it('encodes no branch state, so landing it cannot turn it into a lie', () => {
    const lowered = overlay.toLowerCase();
    for (const forbidden of [
      'not merged',
      'proposed in this branch',
      'current branch',
      'after merge',
      'this pr',
    ]) {
      expect(lowered, forbidden).not.toContain(forbidden);
    }
  });
});

// ===========================================================================
// The restated grammars must agree with the siblings they were restated from.
// ===========================================================================

describe('AVG-6 restates AVG-2 and AVG-5 grammars without drifting from them', () => {
  it('agrees with AVG-2 on what a contact shape is', () => {
    // AVG-2 screens enrichment labels for the same shapes. If the two ever disagreed, a destination
    // refused by one package could enter through the other.
    for (const destination of [
      'someone@example.com',
      'https://example.com/x',
      'www.example.com',
      '919812345678',
      '98 1234 5678',
    ]) {
      const asLabel = createEnrichmentClaim({
        prospectRef: PROSPECT,
        attribute: 'BUSINESS_DISPLAY_NAME',
        value: destination,
        source: { kind: 'MANUAL_REVIEW', sourceRef: 'avg6-drift' },
        observedAt: AT,
        evidenceQuality: 'UNVERIFIED_OPERATOR_ENTERED',
      }).ok;
      const asRef = createCrossChannelIdentityEvidenceClaim(
        claimInput({ whatsappParticipantRef: destination }),
      ).ok;
      expect(asRef, destination).toBe(false);
      expect(asLabel, destination).toBe(false);
    }
    // And an ordinary business name is a label but not a reference: the reference has a narrower
    // character class as well, which is the point of having both.
    expect(
      createEnrichmentClaim({
        prospectRef: PROSPECT,
        attribute: 'BUSINESS_DISPLAY_NAME',
        value: 'Alpha Interiors',
        source: { kind: 'MANUAL_REVIEW', sourceRef: 'avg6-drift' },
        observedAt: AT,
        evidenceQuality: 'UNVERIFIED_OPERATOR_ENTERED',
      }).ok,
    ).toBe(true);
    expect(
      createCrossChannelIdentityEvidenceClaim(
        claimInput({ whatsappParticipantRef: 'Alpha Interiors' }),
      ).ok,
    ).toBe(false);
  });

  it('agrees with AVG-5 on the opaque reference and the canonical instant', () => {
    for (const value of ['ok.ref-1', 'A:B_c', 'x'.repeat(128)]) {
      const asObservationRef = parseInstagramInboundObservation({
        prospectRef: PROSPECT,
        instagramConversationRef: CONVERSATION,
        instagramThreadRef: THREAD,
        instagramParticipantRef: IG_PARTICIPANT,
        instagramMessageRef: value,
        body: 'Hello',
        observedAt: AT,
      }).ok;
      const asEvidenceRef = createCrossChannelIdentityEvidenceClaim(
        claimInput({ evidenceRef: value }),
      ).ok;
      expect(asEvidenceRef, value).toBe(asObservationRef);
    }
    for (const bad of ['has space', 'slash/ref', '', 'x'.repeat(129)]) {
      expect(
        createCrossChannelIdentityEvidenceClaim(claimInput({ evidenceRef: bad })).ok,
        bad,
      ).toBe(false);
    }
    for (const instant of ['2026-08-27T09:00:00Z', '2026-08-27T09:00:00.000Z']) {
      const asObservation = parseInstagramInboundObservation({
        prospectRef: PROSPECT,
        instagramConversationRef: CONVERSATION,
        instagramThreadRef: THREAD,
        instagramParticipantRef: IG_PARTICIPANT,
        instagramMessageRef: 'ig.message.001',
        body: 'Hello',
        observedAt: instant,
      }).ok;
      expect(
        createCrossChannelIdentityEvidenceClaim(claimInput({ observedAt: instant })).ok,
        instant,
      ).toBe(asObservation);
    }
  });
});
