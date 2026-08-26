/**
 * AVG-5 — the Aarohi Instagram conversation offline domain (ADR-0122).
 *
 * The claim under test is narrow and worth stating before the assertions: Aarohi can OBSERVE an
 * Instagram conversation and PREPARE an outbound candidate, and can do neither of the things a
 * reader might assume follow from that. Nothing here sends, and nothing here may quietly acquire the
 * ability to.
 */
import { describe, expect, it } from 'vitest';

import {
  AAROHI_AVG5_CHANNEL,
  AAROHI_AVG5_CONTRACT_VERSION,
  CORE_PARTY_STATUSES,
  INSTAGRAM_BINDING_POSTURE,
  parseInstagramConversation,
  INSTAGRAM_CONTINUATION_OUTCOMES,
  INSTAGRAM_OBSERVATION_SOURCE_POSTURE,
  INSTAGRAM_OUTBOUND_CANDIDATE_OUTCOME,
  INSTAGRAM_TURN_DIRECTIONS,
  MAX_INSTAGRAM_CONVERSATION_TURNS,
  MAX_INSTAGRAM_MESSAGE_LENGTH,
  appendInstagramInboundObservation,
  createEnrichmentClaim,
  createEnrichmentProfile,
  createInstagramConversation,
  createWorkspaceDraft,
  evaluateInstagramAcquisitionContinuation,
  instagramConversationSnapshotSchema,
  instagramInboundObservationSchema,
  instagramOutboundCandidateSchema,
  parseInstagramInboundObservation,
  prepareInstagramOutboundCandidate,
  transitionWorkspaceDraft,
  workspaceDraftSchema,
} from '../index.js';
import type {
  CorePartyStatus,
  EnrichmentAttribute,
  EnrichmentClaim,
  EnrichmentProfile,
  InstagramConversationSnapshot,
  InstagramInboundObservation,
  WorkspaceDraft,
} from '../index.js';

const PROSPECT = 'prospect.avg5.alpha';
const OTHER_PROSPECT = 'prospect.avg5.beta';
const CONVERSATION = 'ig.conversation.alpha';
const THREAD = 'ig.thread.alpha';
const PARTICIPANT = 'ig.participant.alpha';
const AT = '2026-08-26T09:00:00Z';
const LATER = '2026-08-26T09:05:00Z';

function claim(
  attribute: EnrichmentAttribute,
  value: string,
  prospectRef = PROSPECT,
): EnrichmentClaim {
  const built = createEnrichmentClaim({
    prospectRef,
    attribute,
    value,
    source: { kind: 'MANUAL_REVIEW', sourceRef: `avg5-${attribute.toLowerCase()}` },
    observedAt: AT,
    evidenceQuality: 'UNVERIFIED_OPERATOR_ENTERED',
  });
  if (!built.ok) throw new Error(`claim fixture refused: ${built.refusal}`);
  return built.claim;
}

function makeProfile(prospectRef = PROSPECT): EnrichmentProfile {
  const built = createEnrichmentProfile(prospectRef, [
    claim('BUSINESS_DISPLAY_NAME', 'Alpha Interiors', prospectRef),
    claim('CITY_LABEL', 'Pune', prospectRef),
  ]);
  if (!built.ok) throw new Error(`profile fixture refused: ${built.refusal}`);
  return built.profile;
}

function observation(status: CorePartyStatus, prospectRef = PROSPECT): unknown {
  return {
    prospectRef,
    coreLookupRef: `lookup-${status.toLowerCase().replace(/_/gu, '-')}`,
    status,
  };
}

function openDraft(prospectRef = PROSPECT, body = 'Hello from QuickFurno.'): WorkspaceDraft {
  const result = createWorkspaceDraft({
    draftRef: 'draft.avg5.alpha',
    profile: makeProfile(prospectRef),
    body,
    changedByRef: 'operator.founder',
    changedAt: AT,
  });
  if (!result.ok) throw new Error(`draft fixture refused: ${result.refusal}`);
  return result.draft;
}

function inbound(over: Record<string, unknown> = {}): InstagramInboundObservation {
  const built = parseInstagramInboundObservation({
    prospectRef: PROSPECT,
    instagramConversationRef: CONVERSATION,
    instagramThreadRef: THREAD,
    instagramParticipantRef: PARTICIPANT,
    instagramMessageRef: 'ig.message.001',
    body: 'Hi, what do you do?',
    observedAt: AT,
    ...over,
  });
  if (!built.ok) throw new Error(`observation fixture refused: ${built.refusal}`);
  return built.observation;
}

function conversation(prospectRef = PROSPECT): InstagramConversationSnapshot {
  const built = createInstagramConversation({
    prospectRef,
    instagramConversationRef: CONVERSATION,
    instagramThreadRef: THREAD,
    instagramParticipantRef: PARTICIPANT,
  });
  if (!built.ok) throw new Error(`conversation fixture refused: ${built.refusal}`);
  return built.conversation;
}

function candidateInput(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    candidateRef: 'ig.candidate.alpha',
    draft: openDraft(),
    profile: makeProfile(),
    coreObservation: observation('NOT_REGISTERED'),
    conversation: conversation(),
    preparedAt: LATER,
    ...over,
  };
}

// ===========================================================================
// Identity and version.
// ===========================================================================

describe('the AVG-5 channel token is Aarohi-local', () => {
  it('is version 1 and exactly the Instagram conversation token', () => {
    expect(AAROHI_AVG5_CONTRACT_VERSION).toBe(1);
    expect(AAROHI_AVG5_CHANNEL).toBe('instagram');
    // The only direction a TURN may have. There is no OUTBOUND member to append a candidate to.
    expect([...INSTAGRAM_TURN_DIRECTIONS]).toStrictEqual(['INBOUND']);
  });

  it('never lets a channel-local participant become a prospect or a Core identity', () => {
    const built = inbound();
    // Two independent fields. Nothing derives one from the other, in either direction.
    expect(built.prospectRef).toBe(PROSPECT);
    expect(built.instagramParticipantRef).toBe(PARTICIPANT);
    expect(built.prospectRef).not.toBe(built.instagramParticipantRef);

    // A conversation whose participant handle happens to equal ANOTHER prospect's handle merges
    // nothing: the prospect is whatever the caller bound, and the participant is a channel handle.
    const built2 = inbound({ prospectRef: OTHER_PROSPECT, instagramParticipantRef: PROSPECT });
    expect(built2.prospectRef).toBe(OTHER_PROSPECT);
    expect(built2.instagramParticipantRef).toBe(PROSPECT);

    // And there is no field anywhere that could hold a Core vendor identity.
    for (const forbidden of ['vendorId', 'coreVendorId', 'identityResolved', 'resolvedIdentity']) {
      expect(Object.keys(built), forbidden).not.toContain(forbidden);
    }
  });

  it('refuses references that are not opaque', () => {
    for (const bad of [
      'https://instagram.example/thread/1',
      '/path/to/thread',
      'ref with spaces',
      'ref/with/slash',
      '',
      'x'.repeat(129),
    ]) {
      expect(
        parseInstagramInboundObservation({
          prospectRef: PROSPECT,
          instagramConversationRef: CONVERSATION,
          instagramThreadRef: bad,
          instagramParticipantRef: PARTICIPANT,
          instagramMessageRef: 'ig.message.001',
          body: 'Hello',
          observedAt: AT,
        }).ok,
        bad,
      ).toBe(false);
    }
  });
});

// ===========================================================================
// Inbound observation.
// ===========================================================================

describe('an inbound observation is an observation, and says so', () => {
  it('canonicalizes a valid message and stamps the posture itself', () => {
    const built = inbound();
    expect(built.contractVersion).toBe(AAROHI_AVG5_CONTRACT_VERSION);
    expect(built.channel).toBe('instagram');
    expect(built.direction).toBe('INBOUND');
    expect(built.sourcePosture).toBe('INJECTED_OFFLINE_INSTAGRAM_OBSERVATION');
    expect(INSTAGRAM_OBSERVATION_SOURCE_POSTURE).toBe('INJECTED_OFFLINE_INSTAGRAM_OBSERVATION');
    expect(instagramInboundObservationSchema.safeParse(built).success).toBe(true);
  });

  it('gives a caller no way to claim its fixture was provider-authenticated', () => {
    // The posture is STAMPED, never accepted. There is no input field for it, and the schema is
    // strict, so an injected fixture cannot describe itself as anything but injected.
    for (const forged of [
      { sourcePosture: 'PROVIDER_AUTHENTICATED' },
      { sourcePosture: 'INJECTED_OFFLINE_INSTAGRAM_OBSERVATION' },
      { channel: 'whatsapp' },
      { direction: 'OUTBOUND' },
      { contractVersion: 2 },
    ]) {
      expect(
        parseInstagramInboundObservation({
          prospectRef: PROSPECT,
          instagramConversationRef: CONVERSATION,
          instagramThreadRef: THREAD,
          instagramParticipantRef: PARTICIPANT,
          instagramMessageRef: 'ig.message.001',
          body: 'Hello',
          observedAt: AT,
          ...forged,
        }).ok,
        JSON.stringify(forged),
      ).toBe(false);
    }
  });

  it('refuses every authority-shaped field a caller might attach', () => {
    for (const forbidden of [
      { consent: true },
      { consentGranted: true },
      { optedIn: true },
      { optedOut: true },
      { stop: true },
      { doNotContact: true },
      { identityVerified: true },
      { registeredVendor: true },
      { activeVendor: true },
      { approved: true },
      { authorization: 'granted' },
      { sendAllowed: true },
      { executionIntent: 'intent-1' },
      { providerAccepted: true },
      { delivered: true },
      { sent: true },
      { providerCredential: 'x' },
      { accessToken: 'x' },
      { metaToken: 'x' },
      { webhookSecret: 'x' },
      { phone: '+910000000000' },
      { whatsappNumber: '+910000000000' },
      { packagePrice: 999 },
      { vendorId: 'v-1' },
      { coreVendorId: 'v-1' },
      { identityResolved: true },
      { targetChannel: 'whatsapp' },
      { sendNow: true },
    ]) {
      expect(
        parseInstagramInboundObservation({
          prospectRef: PROSPECT,
          instagramConversationRef: CONVERSATION,
          instagramThreadRef: THREAD,
          instagramParticipantRef: PARTICIPANT,
          instagramMessageRef: 'ig.message.001',
          body: 'Hello',
          observedAt: AT,
          ...forbidden,
        }).ok,
        JSON.stringify(forbidden),
      ).toBe(false);
    }
  });

  it('bounds the body, refuses control characters and normalizes line endings', () => {
    expect(
      parseInstagramInboundObservation({ ...bodyInput('a'.repeat(MAX_INSTAGRAM_MESSAGE_LENGTH)) })
        .ok,
    ).toBe(true);
    expect(
      parseInstagramInboundObservation({
        ...bodyInput('a'.repeat(MAX_INSTAGRAM_MESSAGE_LENGTH + 1)),
      }).ok,
    ).toBe(false);
    expect(parseInstagramInboundObservation({ ...bodyInput('') }).ok).toBe(false);
    expect(parseInstagramInboundObservation({ ...bodyInput('   ') }).ok).toBe(false);

    for (const control of ['\u0000', '\u0007', '\u000b', '\u001f', '\u007f']) {
      expect(
        parseInstagramInboundObservation({ ...bodyInput(`hello${control}there`) }).ok,
        JSON.stringify(control),
      ).toBe(false);
    }

    // CR is canonicalized deterministically, and the resulting body carries no CR at all.
    const crlf = parseInstagramInboundObservation({ ...bodyInput('line one\r\nline two') });
    const cr = parseInstagramInboundObservation({ ...bodyInput('line one\rline two') });
    const lf = parseInstagramInboundObservation({ ...bodyInput('line one\nline two') });
    if (!crlf.ok || !cr.ok || !lf.ok) throw new Error('expected all three line endings to parse');
    expect(crlf.observation.body).toBe('line one\nline two');
    expect(cr.observation.body).toBe('line one\nline two');
    expect(lf.observation.body).toBe('line one\nline two');
  });

  it('preserves the user’s words rather than interpreting them', () => {
    // "STOP" is a suppression keyword in a governed channel. Here it is text, and only text: nothing
    // in this package reads it, and Core owns the decision it might otherwise seem to imply.
    const built = inbound({ body: 'STOP. do not contact me. unsubscribe.' });
    expect(built.body).toBe('STOP. do not contact me. unsubscribe.');
    // No field on the RESULT concluded anything from those words either. A parser that read the
    // text and set a flag would be Aarohi deciding a suppression question that is Core's.
    for (const key of Object.keys(built)) {
      for (const conclusion of [
        'consent',
        'suppress',
        'optout',
        'optin',
        'donotcontact',
        'stop',
        'verified',
        'approved',
      ]) {
        expect(key.toLowerCase(), `${key} must not conclude ${conclusion}`).not.toContain(
          conclusion,
        );
      }
    }
    // The observation shape is exactly the reviewed one, so a new field is a decision.
    expect(Object.keys(built).sort()).toStrictEqual([
      'body',
      'channel',
      'contractVersion',
      'direction',
      'instagramConversationRef',
      'instagramMessageRef',
      'instagramParticipantRef',
      'instagramThreadRef',
      'observedAt',
      'prospectRef',
      'sourcePosture',
    ]);
  });

  it('hands back a frozen value a caller cannot rewrite', () => {
    const built = inbound();
    expect(Object.isFrozen(built)).toBe(true);
    try {
      (built as unknown as Record<string, unknown>)['body'] = 'rewritten';
    } catch {
      /* frozen in strict mode */
    }
    expect(built.body).toBe('Hi, what do you do?');
  });
});

function bodyInput(body: string): Record<string, unknown> {
  return {
    prospectRef: PROSPECT,
    instagramConversationRef: CONVERSATION,
    instagramThreadRef: THREAD,
    instagramParticipantRef: PARTICIPANT,
    instagramMessageRef: 'ig.message.001',
    body,
    observedAt: AT,
  };
}

// ===========================================================================
// The conversation snapshot.
// ===========================================================================

describe('the conversation snapshot is immutable, bounded and deduplicated', () => {
  it('creates an empty canonical conversation', () => {
    const snapshot = conversation();
    expect(snapshot.contractVersion).toBe(AAROHI_AVG5_CONTRACT_VERSION);
    expect(snapshot.channel).toBe('instagram');
    expect(snapshot.bindingPosture).toBe('CALLER_ASSERTED_OFFLINE_INSTAGRAM_BINDING');
    expect(INSTAGRAM_BINDING_POSTURE).toBe('CALLER_ASSERTED_OFFLINE_INSTAGRAM_BINDING');
    expect(snapshot.inboundTurns).toStrictEqual([]);
    expect(instagramConversationSnapshotSchema.safeParse(snapshot).success).toBe(true);
    expect(Object.isFrozen(snapshot)).toBe(true);
    expect(Object.isFrozen(snapshot.inboundTurns)).toBe(true);
  });

  it('appends an inbound turn without mutating the snapshot it came from', () => {
    const before = conversation();
    const after = appendInstagramInboundObservation(before, inbound());
    if (!after.ok) throw new Error(`append refused: ${after.refusal}`);
    expect(before.inboundTurns).toHaveLength(0);
    expect(after.conversation.inboundTurns).toHaveLength(1);
    expect(after.conversation.inboundTurns[0]?.body).toBe('Hi, what do you do?');
    expect(Object.isFrozen(after.conversation.inboundTurns)).toBe(true);
    expect(Object.isFrozen(after.conversation.inboundTurns[0])).toBe(true);
  });

  it('refuses a repeated message reference', () => {
    // Provider redelivery is normal. Counting one message twice would make a conversation look
    // busier than it was, and a human reads that number.
    const first = appendInstagramInboundObservation(conversation(), inbound());
    if (!first.ok) throw new Error('expected the first append to succeed');
    const again = appendInstagramInboundObservation(
      first.conversation,
      inbound({ body: 'different words, same message reference' }),
    );
    expect(again.ok).toBe(false);
    if (!again.ok) expect(again.refusal).toBe('MESSAGE_DUPLICATE');
  });

  it('refuses a turn bound to another prospect, conversation, thread or participant', () => {
    const snapshot = conversation();
    for (const over of [
      { prospectRef: OTHER_PROSPECT },
      { instagramConversationRef: 'ig.conversation.beta' },
      { instagramThreadRef: 'ig.thread.beta' },
      { instagramParticipantRef: 'ig.participant.beta' },
    ]) {
      const result = appendInstagramInboundObservation(snapshot, inbound(over));
      expect(result.ok, JSON.stringify(over)).toBe(false);
      if (!result.ok) expect(result.refusal).toBe('BINDING_MISMATCH');
    }
  });

  it('holds a finite number of turns', () => {
    let snapshot = conversation();
    for (let index = 0; index < MAX_INSTAGRAM_CONVERSATION_TURNS; index += 1) {
      const result = appendInstagramInboundObservation(
        snapshot,
        inbound({ instagramMessageRef: `ig.message.${String(index).padStart(4, '0')}` }),
      );
      if (!result.ok) throw new Error(`append ${String(index)} refused: ${result.refusal}`);
      snapshot = result.conversation;
    }
    expect(snapshot.inboundTurns).toHaveLength(MAX_INSTAGRAM_CONVERSATION_TURNS);
    const overflow = appendInstagramInboundObservation(
      snapshot,
      inbound({ instagramMessageRef: 'ig.message.overflow' }),
    );
    expect(overflow.ok).toBe(false);
    if (!overflow.ok) expect(overflow.refusal).toBe('TURN_LIMIT_REACHED');
  });

  it('orders turns canonically rather than by arrival', () => {
    // Provider events arrive out of order, so arrival order is not chronology and the snapshot never
    // pretends it is. Ordering is by `observedAt`, then by message reference to break ties.
    let snapshot = conversation();
    for (const [ref, at] of [
      ['ig.message.c', '2026-08-26T09:00:03Z'],
      ['ig.message.a', '2026-08-26T09:00:01Z'],
      ['ig.message.b', '2026-08-26T09:00:02Z'],
    ] as const) {
      const result = appendInstagramInboundObservation(
        snapshot,
        inbound({ instagramMessageRef: ref, observedAt: at }),
      );
      if (!result.ok) throw new Error(`append refused: ${result.refusal}`);
      snapshot = result.conversation;
    }
    expect(snapshot.inboundTurns.map((turn) => turn.instagramMessageRef)).toStrictEqual([
      'ig.message.a',
      'ig.message.b',
      'ig.message.c',
    ]);

    // Same instant: the message reference decides, deterministically.
    let tied = conversation();
    for (const ref of ['ig.message.z', 'ig.message.m']) {
      const result = appendInstagramInboundObservation(
        tied,
        inbound({ instagramMessageRef: ref, observedAt: AT }),
      );
      if (!result.ok) throw new Error(`append refused: ${result.refusal}`);
      tied = result.conversation;
    }
    expect(tied.inboundTurns.map((turn) => turn.instagramMessageRef)).toStrictEqual([
      'ig.message.m',
      'ig.message.z',
    ]);
  });

  it('has no shape into which an outbound candidate could be recorded as said', () => {
    // The turn schema pins `direction` to INBOUND, so a candidate cannot be appended even if a
    // caller reshaped it to look like a turn — and the candidate has no `direction` at all.
    const built = prepareInstagramOutboundCandidate(candidateInput());
    if (!built.ok) throw new Error(`candidate refused: ${built.refusal}`);
    expect(Object.keys(built.candidate)).not.toContain('direction');
    const asTurn = { ...built.candidate, direction: 'OUTBOUND' };
    expect(instagramInboundObservationSchema.safeParse(asTurn).success).toBe(false);
    const appended = appendInstagramInboundObservation(conversation(), asTurn);
    expect(appended.ok).toBe(false);
  });

  it('rebuilds rather than retains, so a caller keeps no handle into the result', () => {
    const turns = [inbound()];
    const forged = {
      contractVersion: AAROHI_AVG5_CONTRACT_VERSION,
      channel: 'instagram',
      bindingPosture: INSTAGRAM_BINDING_POSTURE,
      prospectRef: PROSPECT,
      instagramConversationRef: CONVERSATION,
      instagramThreadRef: THREAD,
      instagramParticipantRef: PARTICIPANT,
      inboundTurns: turns,
    };
    const appended = appendInstagramInboundObservation(
      forged,
      inbound({ instagramMessageRef: 'ig.message.002' }),
    );
    if (!appended.ok) throw new Error(`append refused: ${appended.refusal}`);
    // Mutating the array the caller still holds changes nothing in the returned snapshot.
    turns.length = 0;
    expect(appended.conversation.inboundTurns).toHaveLength(2);
    expect(appended.conversation.inboundTurns).not.toBe(turns);
  });
});

// ===========================================================================
// Continuation: receiving a message is not permission.
// ===========================================================================

describe('continuation reuses the Core gate and restates none of it', () => {
  it('continues review on the one allowlisted status', () => {
    const verdict = evaluateInstagramAcquisitionContinuation(
      conversation(),
      observation('NOT_REGISTERED'),
    );
    expect(verdict.outcome).toBe('CONTINUE_AAROHI_ACQUISITION_REVIEW');
    if (verdict.outcome === 'CONTINUE_AAROHI_ACQUISITION_REVIEW') {
      expect(verdict.coreStatus).toBe('NOT_REGISTERED');
      expect(verdict.prospectRef).toBe(PROSPECT);
    }
    expect([...INSTAGRAM_CONTINUATION_OUTCOMES]).toStrictEqual([
      'CONTINUE_AAROHI_ACQUISITION_REVIEW',
      'STOP_AAROHI_ACQUISITION',
    ]);
  });

  it('stops on EVERY other Core status, including the ones that mean not knowing', () => {
    for (const status of CORE_PARTY_STATUSES) {
      if (status === 'NOT_REGISTERED') continue;
      const verdict = evaluateInstagramAcquisitionContinuation(conversation(), observation(status));
      expect(verdict.outcome, status).toBe('STOP_AAROHI_ACQUISITION');
    }
    // Named individually too, because the ones that stop for different reasons are the ones a
    // future reader is most likely to try to special-case.
    for (const status of [
      'REGISTERED',
      'ACTIVE',
      'PREVIOUSLY_CONTACTED',
      'DUPLICATE',
      'DO_NOT_CONTACT',
      'UNKNOWN',
      'AMBIGUOUS',
      'CORE_UNAVAILABLE',
    ] as const) {
      const verdict = evaluateInstagramAcquisitionContinuation(conversation(), observation(status));
      expect(verdict.outcome, status).toBe('STOP_AAROHI_ACQUISITION');
    }
  });

  it('stops on an observation about a different prospect, and on a malformed one', () => {
    const crossed = evaluateInstagramAcquisitionContinuation(
      conversation(),
      observation('NOT_REGISTERED', OTHER_PROSPECT),
    );
    expect(crossed.outcome).toBe('STOP_AAROHI_ACQUISITION');
    for (const bad of [undefined, null, {}, { status: 'NOT_REGISTERED' }, 'NOT_REGISTERED']) {
      expect(
        evaluateInstagramAcquisitionContinuation(conversation(), bad).outcome,
        JSON.stringify(bad),
      ).toBe('STOP_AAROHI_ACQUISITION');
    }
    // A conversation that is not canonical is a stop as well, not a gap.
    expect(
      evaluateInstagramAcquisitionContinuation(
        { prospectRef: PROSPECT },
        observation('NOT_REGISTERED'),
      ).outcome,
    ).toBe('STOP_AAROHI_ACQUISITION');
  });

  it('accepts no priority, and therefore cannot be talked round by one', () => {
    // The signature has two parameters and neither is a score. A high-priority prospect that Core
    // has suppressed still stops.
    expect(evaluateInstagramAcquisitionContinuation.length).toBe(2);
    const verdict = evaluateInstagramAcquisitionContinuation(
      conversation(),
      observation('DO_NOT_CONTACT'),
    );
    expect(verdict.outcome).toBe('STOP_AAROHI_ACQUISITION');
  });
});

// ===========================================================================
// The outbound candidate.
// ===========================================================================

describe('an outbound candidate carries the reviewed draft, and no permission', () => {
  it('prepares a candidate from an OPEN draft and current NOT_REGISTERED truth', () => {
    const built = prepareInstagramOutboundCandidate(candidateInput());
    if (!built.ok) throw new Error(`candidate refused: ${built.refusal}`);
    const candidate = built.candidate;

    expect(candidate.contractVersion).toBe(AAROHI_AVG5_CONTRACT_VERSION);
    expect(candidate.channel).toBe('instagram');
    expect(candidate.outcome).toBe('READY_FOR_FUTURE_CORE_INSTAGRAM_COMMUNICATION_PATH');
    expect(INSTAGRAM_OUTBOUND_CANDIDATE_OUTCOME).toBe(
      'READY_FOR_FUTURE_CORE_INSTAGRAM_COMMUNICATION_PATH',
    );
    expect(candidate.prospectRef).toBe(PROSPECT);
    expect(candidate.draftRef).toBe('draft.avg5.alpha');
    expect(candidate.draftRevision).toBe(1);
    expect(candidate.body).toBe(openDraft().body);
    expect(candidate.instagramConversationRef).toBe(CONVERSATION);
    expect(candidate.instagramThreadRef).toBe(THREAD);
    expect(candidate.instagramParticipantRef).toBe(PARTICIPANT);
    expect(candidate.bindingPosture).toBe('CALLER_ASSERTED_OFFLINE_INSTAGRAM_BINDING');
    expect(candidate.coreStatus).toBe('NOT_REGISTERED');
    expect(candidate.coreLookupRef).toBe('lookup-not-registered');
    expect(instagramOutboundCandidateSchema.safeParse(candidate).success).toBe(true);
    expect(Object.isFrozen(candidate)).toBe(true);
    expect(Object.isFrozen(candidate.posture)).toBe(true);
  });

  it('says nothing was created, requested, sent or delivered', () => {
    const built = prepareInstagramOutboundCandidate(candidateInput());
    if (!built.ok) throw new Error(`candidate refused: ${built.refusal}`);
    const posture = built.candidate.posture;

    expect(posture.candidateOnly).toBe(true);
    expect(posture.requiresCoreExecutionTimeRevalidation).toBe(true);
    expect(posture.communicationRequestCreated).toBe(false);
    expect(posture.approvalRequestCreated).toBe(false);
    expect(posture.approvalDecisionCreated).toBe(false);
    expect(posture.communicationAuthorizationCreated).toBe(false);
    expect(posture.executionIntentCreated).toBe(false);
    expect(posture.n8nExecutionRequested).toBe(false);
    expect(posture.metaApiCalled).toBe(false);
    expect(posture.providerSendRequested).toBe(false);
    expect(posture.sent).toBe(false);
    expect(posture.delivered).toBe(false);
    expect(posture.businessEffect).toBe(false);
    expect(posture.productionMutation).toBe(false);

    // And the candidate has no state field that could ever hold one of those words.
    const serialized = JSON.stringify(built.candidate).toUpperCase();
    for (const forbidden of ['"SENT":TRUE', '"DELIVERED":TRUE', 'AUTHORIZED', 'EXECUTED']) {
      expect(serialized, forbidden).not.toContain(forbidden);
    }
  });

  it('takes the words from the draft, because there is nowhere else to take them from', () => {
    // No `body` field on the builder's input, and the schema is strict — so a caller cannot review
    // one message and prepare a different one.
    expect(prepareInstagramOutboundCandidate(candidateInput({ body: 'something else' })).ok).toBe(
      false,
    );
    for (const forged of [
      { message: 'something else' },
      { text: 'something else' },
      { outcome: 'READY_TO_SEND' },
      { channel: 'whatsapp' },
      { posture: { sent: true } },
      { coreStatus: 'NOT_REGISTERED' },
      { contractVersion: 2 },
      { sendNow: true },
      { targetChannel: 'whatsapp' },
      { accessToken: 'x' },
    ]) {
      expect(
        prepareInstagramOutboundCandidate(candidateInput(forged)).ok,
        JSON.stringify(forged),
      ).toBe(false);
    }

    // A revised draft's words, and its revision, are the ones that travel.
    const revised = { ...openDraft(), body: 'Revised words for review.', revision: 2 };
    expect(workspaceDraftSchema.safeParse(revised).success).toBe(true);
    const built = prepareInstagramOutboundCandidate(candidateInput({ draft: revised }));
    if (!built.ok) throw new Error(`candidate refused: ${built.refusal}`);
    expect(built.candidate.body).toBe('Revised words for review.');
    expect(built.candidate.draftRevision).toBe(2);
  });

  it('refuses a draft that is not OPEN', () => {
    for (const state of ['HELD', 'REJECTED'] as const) {
      const moved = transitionWorkspaceDraft(openDraft(), state, {
        changedByRef: 'operator.founder',
        changedAt: LATER,
      });
      if (!moved.ok) throw new Error(`transition refused: ${moved.refusal}`);
      const built = prepareInstagramOutboundCandidate(candidateInput({ draft: moved.draft }));
      expect(built.ok, state).toBe(false);
      if (!built.ok) expect(built.refusal).toBe('WORKSPACE_DRAFT_NOT_OPEN');
    }
  });

  it('refuses when the draft, profile and conversation do not describe one prospect', () => {
    const mismatchedProfile = prepareInstagramOutboundCandidate(
      candidateInput({ profile: makeProfile(OTHER_PROSPECT) }),
    );
    expect(mismatchedProfile.ok).toBe(false);

    const mismatchedConversation = prepareInstagramOutboundCandidate(
      candidateInput({ conversation: conversation(OTHER_PROSPECT) }),
    );
    expect(mismatchedConversation.ok).toBe(false);
    if (!mismatchedConversation.ok) {
      expect(mismatchedConversation.refusal).toBe('PROSPECT_MISMATCH');
    }

    expect(prepareInstagramOutboundCandidate(candidateInput({ draft: {} })).ok).toBe(false);
    expect(prepareInstagramOutboundCandidate(candidateInput({ profile: {} })).ok).toBe(false);
    expect(prepareInstagramOutboundCandidate(candidateInput({ conversation: {} })).ok).toBe(false);
  });

  it('re-runs the CURRENT Core gate, so no earlier review is permission', () => {
    for (const status of CORE_PARTY_STATUSES) {
      const built = prepareInstagramOutboundCandidate(
        candidateInput({ coreObservation: observation(status) }),
      );
      if (status === 'NOT_REGISTERED') {
        expect(built.ok, status).toBe(true);
        continue;
      }
      expect(built.ok, status).toBe(false);
      if (!built.ok) expect(built.refusal, status).toBe('CORE_GATE_REFUSED');
    }

    // The specific pairs owner review named. An earlier eligible review is a fact about the past.
    const previouslyEligible = prepareInstagramOutboundCandidate(candidateInput());
    expect(previouslyEligible.ok).toBe(true);
    for (const status of ['DO_NOT_CONTACT', 'REGISTERED', 'ACTIVE', 'UNKNOWN'] as const) {
      const now = prepareInstagramOutboundCandidate(
        candidateInput({ coreObservation: observation(status) }),
      );
      expect(now.ok, status).toBe(false);
    }

    // A cross-prospect observation fails closed rather than being read as weak evidence.
    expect(
      prepareInstagramOutboundCandidate(
        candidateInput({ coreObservation: observation('NOT_REGISTERED', OTHER_PROSPECT) }),
      ).ok,
    ).toBe(false);
  });

  it('accepts no priority at all, so a score can neither buy nor block a candidate', () => {
    // The richest possible evidence and a suppressed prospect: still no candidate.
    const rich = createEnrichmentProfile(PROSPECT, [
      claim('BUSINESS_DISPLAY_NAME', 'Alpha Interiors'),
      claim('BUSINESS_CATEGORY_LABEL', 'Interior Design'),
      claim('SERVICE_LABEL', 'Modular Kitchen'),
      claim('CITY_LABEL', 'Pune'),
      claim('LOCALITY_LABEL', 'Kharadi'),
      claim('BUSINESS_DESCRIPTION', 'Residential interior studio'),
      claim('WEBSITE_PRESENCE', 'OBSERVED'),
      claim('PUBLIC_SOCIAL_PRESENCE', 'OBSERVED'),
      claim('PORTFOLIO_SIGNAL', 'OBSERVED'),
    ]);
    if (!rich.ok) throw new Error('rich profile fixture refused');
    const suppressed = prepareInstagramOutboundCandidate(
      candidateInput({ profile: rich.profile, coreObservation: observation('DO_NOT_CONTACT') }),
    );
    expect(suppressed.ok).toBe(false);

    // And the thinnest evidence with a valid NOT_REGISTERED still prepares one: priority is not a
    // gate in either direction.
    const thin = createEnrichmentProfile(PROSPECT, []);
    if (!thin.ok) throw new Error('thin profile fixture refused');
    const thinDraft = createWorkspaceDraft({
      draftRef: 'draft.avg5.thin',
      profile: thin.profile,
      body: 'Hello from QuickFurno.',
      changedByRef: 'operator.founder',
      changedAt: AT,
    });
    if (!thinDraft.ok) throw new Error('thin draft fixture refused');
    const built = prepareInstagramOutboundCandidate(
      candidateInput({ profile: thin.profile, draft: thinDraft.draft }),
    );
    expect(built.ok).toBe(true);
  });

  it('is the only positive outcome, and it names the FUTURE path', () => {
    const built = prepareInstagramOutboundCandidate(candidateInput());
    if (!built.ok) throw new Error('candidate refused');
    for (const forbidden of [
      'READY_TO_SEND',
      'SEND_ALLOWED',
      'AUTHORIZED',
      'EXECUTABLE',
      'PROVIDER_READY',
      'APPROVED',
    ]) {
      expect(built.candidate.outcome, forbidden).not.toBe(forbidden);
    }
    expect(built.candidate.outcome).toContain('FUTURE');
    expect(built.candidate.posture.requiresCoreExecutionTimeRevalidation).toBe(true);
  });
});

// ===========================================================================
// Grammar agreement with AVG-4, so the restated primitives cannot drift.
// ===========================================================================

describe('AVG-5 restates AVG-4’s grammars without drifting from them', () => {
  it('agrees on the opaque reference, the instant and the control-character rule', () => {
    const draft = openDraft();
    for (const value of ['ok.ref-1', 'A:B_c', 'x'.repeat(128)]) {
      const asDraft = workspaceDraftSchema.safeParse({ ...draft, draftRef: value }).success;
      const asObservation = parseInstagramInboundObservation({
        ...bodyInput('Hello'),
        instagramMessageRef: value,
      }).ok;
      expect(asObservation, value).toBe(asDraft);
    }
    for (const bad of ['has space', 'slash/ref', '', 'x'.repeat(129)]) {
      expect(workspaceDraftSchema.safeParse({ ...draft, draftRef: bad }).success, bad).toBe(false);
      expect(
        parseInstagramInboundObservation({ ...bodyInput('Hello'), instagramMessageRef: bad }).ok,
        bad,
      ).toBe(false);
    }
    for (const instant of ['2026-08-26T09:00:00Z', '2026-08-26T09:00:00.000Z']) {
      expect(workspaceDraftSchema.safeParse({ ...draft, changedAt: instant }).success).toBe(true);
      expect(
        parseInstagramInboundObservation({ ...bodyInput('Hello'), observedAt: instant }).ok,
      ).toBe(true);
    }
    for (const instant of ['2026-08-26 09:00:00Z', '2026-13-26T09:00:00Z', '2026-08-26T09:00:00']) {
      expect(
        workspaceDraftSchema.safeParse({ ...draft, changedAt: instant }).success,
        instant,
      ).toBe(false);
      expect(
        parseInstagramInboundObservation({ ...bodyInput('Hello'), observedAt: instant }).ok,
        instant,
      ).toBe(false);
    }
    // The control-character rule is the same rule, checked against the same characters.
    for (const control of ['\u0000', '\u000b', '\u001f', '\u007f']) {
      expect(
        workspaceDraftSchema.safeParse({ ...draft, body: `a${control}b` }).success,
        JSON.stringify(control),
      ).toBe(false);
      expect(
        parseInstagramInboundObservation({ ...bodyInput(`a${control}b`) }).ok,
        JSON.stringify(control),
      ).toBe(false);
    }
  });
});

// ===========================================================================
// The AGGREGATE invariant. A bag of canonical turns is not a canonical conversation.
// ===========================================================================

/**
 * A hand-assembled snapshot, built the way a caller would rather than by the builder.
 *
 * This is the whole point of these specs. `appendInstagramInboundObservation` checked every
 * aggregate property as it added a turn, and the PUBLIC schema and parser checked none of them --
 * so a forged snapshot went in one door and came out canonical. These tests come in that door.
 */
function forgedSnapshot(
  turns: readonly InstagramInboundObservation[],
  over: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    contractVersion: AAROHI_AVG5_CONTRACT_VERSION,
    channel: AAROHI_AVG5_CHANNEL,
    bindingPosture: INSTAGRAM_BINDING_POSTURE,
    prospectRef: PROSPECT,
    instagramConversationRef: CONVERSATION,
    instagramThreadRef: THREAD,
    instagramParticipantRef: PARTICIPANT,
    inboundTurns: [...turns],
    ...over,
  };
}

describe('a canonical conversation binds every turn it contains', () => {
  it('refuses a turn belonging to another prospect, conversation, thread or participant', () => {
    // Each of these forged snapshots contains ONE turn that is itself perfectly canonical. The
    // aggregate is what is wrong, and nothing but an aggregate check can see it.
    for (const [field, value] of [
      ['prospectRef', OTHER_PROSPECT],
      ['instagramConversationRef', 'ig.conversation.beta'],
      ['instagramThreadRef', 'ig.thread.beta'],
      ['instagramParticipantRef', 'ig.participant.beta'],
    ] as const) {
      const stranger = inbound({ [field]: value });
      // The turn on its own is canonical...
      expect(instagramInboundObservationSchema.safeParse(stranger).success, field).toBe(true);
      // ...and the conversation containing it is not.
      const snapshot = forgedSnapshot([stranger]);
      expect(instagramConversationSnapshotSchema.safeParse(snapshot).success, field).toBe(false);
      expect(parseInstagramConversation(snapshot), field).toBeUndefined();
    }
  });

  it('refuses a repeated message reference already sitting in the array', () => {
    const twice = [
      inbound({ instagramMessageRef: 'ig.message.a', observedAt: '2026-08-26T09:00:01Z' }),
      inbound({ instagramMessageRef: 'ig.message.a', observedAt: '2026-08-26T09:00:02Z' }),
    ];
    for (const turn of twice) {
      expect(instagramInboundObservationSchema.safeParse(turn).success).toBe(true);
    }
    // Strictly increasing by instant, so ordering alone would have admitted this pair. Uniqueness
    // is a separate question and is asked separately.
    const snapshot = forgedSnapshot(twice);
    expect(instagramConversationSnapshotSchema.safeParse(snapshot).success).toBe(false);
    expect(parseInstagramConversation(snapshot)).toBeUndefined();
  });

  it('refuses valid turns supplied out of canonical order rather than reordering them', () => {
    // The owner's preference, and the right one: a public canonical parser certifies the value it
    // was shown. Silently repairing a producer's contract violation would hide the violation.
    const unsorted = [
      inbound({ instagramMessageRef: 'ig.message.b', observedAt: '2026-08-26T09:00:02Z' }),
      inbound({ instagramMessageRef: 'ig.message.a', observedAt: '2026-08-26T09:00:01Z' }),
    ];
    const snapshot = forgedSnapshot(unsorted);
    expect(instagramConversationSnapshotSchema.safeParse(snapshot).success).toBe(false);
    expect(parseInstagramConversation(snapshot)).toBeUndefined();

    // Same instant, tie broken by message reference the wrong way round.
    const tied = forgedSnapshot([
      inbound({ instagramMessageRef: 'ig.message.z', observedAt: AT }),
      inbound({ instagramMessageRef: 'ig.message.m', observedAt: AT }),
    ]);
    expect(instagramConversationSnapshotSchema.safeParse(tied).success).toBe(false);
    expect(parseInstagramConversation(tied)).toBeUndefined();
  });

  it('accepts what the builder produces, including out-of-arrival-order observations', () => {
    let snapshot = conversation();
    for (const [ref, at] of [
      ['ig.message.c', '2026-08-26T09:00:03Z'],
      ['ig.message.a', '2026-08-26T09:00:01Z'],
      ['ig.message.b', '2026-08-26T09:00:02Z'],
    ] as const) {
      const result = appendInstagramInboundObservation(
        snapshot,
        inbound({ instagramMessageRef: ref, observedAt: at }),
      );
      if (!result.ok) throw new Error(`append refused: ${result.refusal}`);
      snapshot = result.conversation;
    }
    // The builder ACCEPTS them in any arrival order and stores canonical order, so what it produces
    // is by construction what the parser certifies.
    expect(instagramConversationSnapshotSchema.safeParse(snapshot).success).toBe(true);
    const parsed = parseInstagramConversation(snapshot);
    expect(parsed?.inboundTurns.map((turn) => turn.instagramMessageRef)).toStrictEqual([
      'ig.message.a',
      'ig.message.b',
      'ig.message.c',
    ]);
    expect(parseInstagramConversation(conversation())).toBeDefined();
  });

  it('still detaches and freezes what it returns', () => {
    const turns = [inbound()];
    const snapshot = forgedSnapshot(turns);
    const parsed = parseInstagramConversation(snapshot);
    if (parsed === undefined) throw new Error('expected a canonical snapshot to parse');
    expect(Object.isFrozen(parsed)).toBe(true);
    expect(Object.isFrozen(parsed.inboundTurns)).toBe(true);
    expect(Object.isFrozen(parsed.inboundTurns[0])).toBe(true);
    turns.length = 0;
    expect(parsed.inboundTurns).toHaveLength(1);
  });

  it('refuses to append to a snapshot that was never canonical', () => {
    // The builder reads its input through the same parser, so a forged snapshot is not a base a
    // caller can extend into a real-looking one.
    const forged = forgedSnapshot([inbound({ prospectRef: OTHER_PROSPECT })]);
    const result = appendInstagramInboundObservation(
      forged,
      inbound({ instagramMessageRef: 'ig.message.002' }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.refusal).toBe('CONVERSATION_INVALID');
  });
});

describe('every consumer of a conversation inherits the aggregate gate', () => {
  const FORGED = {
    'a turn from another prospect': () =>
      forgedSnapshot([inbound({ prospectRef: OTHER_PROSPECT })]),
    'a turn from another thread': () =>
      forgedSnapshot([inbound({ instagramThreadRef: 'ig.thread.beta' })]),
    'a repeated message reference': () =>
      forgedSnapshot([
        inbound({ instagramMessageRef: 'ig.message.a', observedAt: '2026-08-26T09:00:01Z' }),
        inbound({ instagramMessageRef: 'ig.message.a', observedAt: '2026-08-26T09:00:02Z' }),
      ]),
    'turns out of canonical order': () =>
      forgedSnapshot([
        inbound({ instagramMessageRef: 'ig.message.b', observedAt: '2026-08-26T09:00:02Z' }),
        inbound({ instagramMessageRef: 'ig.message.a', observedAt: '2026-08-26T09:00:01Z' }),
      ]),
  };

  it('stops acquisition continuation, even on the one Core status that would continue', () => {
    for (const [label, build] of Object.entries(FORGED)) {
      const verdict = evaluateInstagramAcquisitionContinuation(
        build(),
        observation('NOT_REGISTERED'),
      );
      expect(verdict.outcome, label).toBe('STOP_AAROHI_ACQUISITION');
      if (verdict.outcome === 'STOP_AAROHI_ACQUISITION') {
        expect(verdict.refusal, label).toBe('CONVERSATION_INVALID');
      }
    }
  });

  it('refuses an outbound candidate, even with an OPEN draft and NOT_REGISTERED truth', () => {
    for (const [label, build] of Object.entries(FORGED)) {
      const built = prepareInstagramOutboundCandidate(candidateInput({ conversation: build() }));
      expect(built.ok, label).toBe(false);
      if (!built.ok) expect(built.refusal, label).toBe('CONVERSATION_INVALID');
    }
    // And the honest snapshot in the same position still prepares one, so the refusals above are
    // the aggregate gate rather than the candidate builder having stopped working.
    expect(prepareInstagramOutboundCandidate(candidateInput()).ok).toBe(true);
  });
});

// ===========================================================================
// A candidate cannot predate the revision it quotes.
// ===========================================================================

describe('the candidate’s stated instants are consistent with one another', () => {
  it('refuses a candidate prepared before the draft revision whose words it carries', () => {
    const draft = openDraft();
    expect(draft.changedAt).toBe(AT);

    // Earlier than the revision: refused. Nothing can have quoted words that did not yet exist.
    const earlier = prepareInstagramOutboundCandidate(
      candidateInput({ preparedAt: '2026-08-26T08:59:59Z' }),
    );
    expect(earlier.ok).toBe(false);
    if (!earlier.ok) expect(earlier.refusal).toBe('PREPARED_BEFORE_DRAFT_REVISION');

    // The same instant is coherent, and later is the ordinary case.
    const same = prepareInstagramOutboundCandidate(candidateInput({ preparedAt: AT }));
    expect(same.ok).toBe(true);
    const later = prepareInstagramOutboundCandidate(candidateInput({ preparedAt: LATER }));
    expect(later.ok).toBe(true);
    if (later.ok) expect(later.candidate.preparedAt).toBe(LATER);
  });
});

// ===========================================================================
// Canonical order is by the INSTANT, not by the spelling of the instant.
// ===========================================================================

/**
 * The canonical UTC grammar makes milliseconds optional, so one moment has more than one canonical
 * spelling — and lexicographic order is not chronological order across those spellings. The
 * character after the seconds is `.` in one form and `Z` in the other, and `.` sorts first, so a raw
 * string comparison puts `09:00:00.500Z` before `09:00:00Z`: half a second earlier than a moment it
 * actually follows.
 *
 * Every assertion below fails under a string comparator and passes under an instant comparator.
 */
/**
 * Widened to `string` rather than left as singleton literal types.
 *
 * Two literal types with no overlap are a comparison TypeScript answers without running anything,
 * and the point of the assertions below is what the VALUES do at runtime. Going through this
 * function says that in one place instead of annotating three.
 */
function canonicalInstant(value: string): string {
  return value;
}

const WHOLE_SECOND = canonicalInstant('2026-08-26T09:00:00Z');
const HALF_SECOND_LATER = canonicalInstant('2026-08-26T09:00:00.500Z');
const SAME_INSTANT_WITH_MILLIS = canonicalInstant('2026-08-26T09:00:00.000Z');

function appendAll(turns: readonly InstagramInboundObservation[]): InstagramConversationSnapshot {
  let snapshot = conversation();
  for (const turn of turns) {
    const result = appendInstagramInboundObservation(snapshot, turn);
    if (!result.ok) throw new Error(`append refused: ${result.refusal}`);
    snapshot = result.conversation;
  }
  return snapshot;
}

describe('canonical order follows the UTC instant, whatever precision it was written with', () => {
  it('proves the two orderings genuinely disagree', () => {
    // Stated as a fact about the data rather than left as an assumption about string collation, so
    // that a reader can see the tests below are not testing nothing.
    expect(WHOLE_SECOND < HALF_SECOND_LATER).toBe(false);
    expect(Date.parse(WHOLE_SECOND) < Date.parse(HALF_SECOND_LATER)).toBe(true);
    expect(Date.parse(WHOLE_SECOND)).toBe(Date.parse(SAME_INSTANT_WITH_MILLIS));
    expect(WHOLE_SECOND === SAME_INSTANT_WITH_MILLIS).toBe(false);
    // Both spellings are canonical, which is why this matters at all.
    for (const instant of [WHOLE_SECOND, HALF_SECOND_LATER, SAME_INSTANT_WITH_MILLIS]) {
      expect(
        parseInstagramInboundObservation({ ...bodyInput('Hello'), observedAt: instant }).ok,
        instant,
      ).toBe(true);
    }
  });

  it('builds chronological order from either arrival order', () => {
    const earlier = inbound({ instagramMessageRef: 'ig.message.a', observedAt: WHOLE_SECOND });
    const later = inbound({ instagramMessageRef: 'ig.message.b', observedAt: HALF_SECOND_LATER });

    // Later message first: the builder must still put the earlier instant first.
    expect(
      appendAll([later, earlier]).inboundTurns.map((t) => t.instagramMessageRef),
    ).toStrictEqual(['ig.message.a', 'ig.message.b']);
    // And in arrival order, unchanged.
    expect(
      appendAll([earlier, later]).inboundTurns.map((t) => t.instagramMessageRef),
    ).toStrictEqual(['ig.message.a', 'ig.message.b']);
  });

  it('certifies the chronological arrangement and refuses the reversed one', () => {
    const earlier = inbound({ instagramMessageRef: 'ig.message.a', observedAt: WHOLE_SECOND });
    const later = inbound({ instagramMessageRef: 'ig.message.b', observedAt: HALF_SECOND_LATER });

    const chronological = forgedSnapshot([earlier, later]);
    expect(instagramConversationSnapshotSchema.safeParse(chronological).success).toBe(true);
    expect(parseInstagramConversation(chronological)).toBeDefined();

    // A raw string comparator would have accepted exactly this one and refused the one above.
    const reversed = forgedSnapshot([later, earlier]);
    expect(instagramConversationSnapshotSchema.safeParse(reversed).success).toBe(false);
    expect(parseInstagramConversation(reversed)).toBeUndefined();
  });

  it('treats two spellings of one instant as one instant, and ties on the message reference', () => {
    // `...00Z` and `...00.000Z` are the same moment, so nothing about the timestamps decides the
    // order between them. The reference does, and only the reference.
    const wholeSecondZ = inbound({ instagramMessageRef: 'ig.message.z', observedAt: WHOLE_SECOND });
    const millisA = inbound({
      instagramMessageRef: 'ig.message.a',
      observedAt: SAME_INSTANT_WITH_MILLIS,
    });

    for (const arrival of [
      [wholeSecondZ, millisA],
      [millisA, wholeSecondZ],
    ]) {
      expect(appendAll(arrival).inboundTurns.map((t) => t.instagramMessageRef)).toStrictEqual([
        'ig.message.a',
        'ig.message.z',
      ]);
    }

    expect(
      instagramConversationSnapshotSchema.safeParse(forgedSnapshot([millisA, wholeSecondZ]))
        .success,
    ).toBe(true);
    expect(
      instagramConversationSnapshotSchema.safeParse(forgedSnapshot([wholeSecondZ, millisA]))
        .success,
    ).toBe(false);
    expect(parseInstagramConversation(forgedSnapshot([millisA, wholeSecondZ]))).toBeDefined();
    expect(parseInstagramConversation(forgedSnapshot([wholeSecondZ, millisA]))).toBeUndefined();

    // THE OTHER DIRECTION, and the one that actually pins the rule.
    //
    // Above, the reference order and the spelling order happen to agree -- `ig.message.a` sorts
    // first and so does `...00.000Z` -- so a comparator that consulted the spelling would have
    // produced the same answer and gone unnoticed. Here they disagree: by reference the whole-second
    // turn comes first, by spelling the millisecond one does. Only the reference may decide.
    const wholeSecondA = inbound({
      instagramMessageRef: 'ig.message.a',
      observedAt: WHOLE_SECOND,
    });
    const millisZ = inbound({
      instagramMessageRef: 'ig.message.z',
      observedAt: SAME_INSTANT_WITH_MILLIS,
    });
    expect(millisZ.observedAt < wholeSecondA.observedAt).toBe(true);
    expect(millisZ.instagramMessageRef < wholeSecondA.instagramMessageRef).toBe(false);

    for (const arrival of [
      [wholeSecondA, millisZ],
      [millisZ, wholeSecondA],
    ]) {
      expect(appendAll(arrival).inboundTurns.map((t) => t.instagramMessageRef)).toStrictEqual([
        'ig.message.a',
        'ig.message.z',
      ]);
    }
    expect(
      instagramConversationSnapshotSchema.safeParse(forgedSnapshot([wholeSecondA, millisZ]))
        .success,
    ).toBe(true);
    expect(
      instagramConversationSnapshotSchema.safeParse(forgedSnapshot([millisZ, wholeSecondA]))
        .success,
    ).toBe(false);
    expect(parseInstagramConversation(forgedSnapshot([wholeSecondA, millisZ]))).toBeDefined();
    expect(parseInstagramConversation(forgedSnapshot([millisZ, wholeSecondA]))).toBeUndefined();
  });

  it('still refuses a repeated reference across equivalent timestamp spellings', () => {
    // Uniqueness is a property of the reference, not of how its instant was written down.
    const asSeconds = inbound({ instagramMessageRef: 'ig.message.a', observedAt: WHOLE_SECOND });
    const asMillis = inbound({
      instagramMessageRef: 'ig.message.a',
      observedAt: SAME_INSTANT_WITH_MILLIS,
    });

    const appended = appendInstagramInboundObservation(appendAll([asSeconds]), asMillis);
    expect(appended.ok).toBe(false);
    if (!appended.ok) expect(appended.refusal).toBe('MESSAGE_DUPLICATE');

    const forged = forgedSnapshot([asSeconds, asMillis]);
    expect(instagramConversationSnapshotSchema.safeParse(forged).success).toBe(false);
    expect(parseInstagramConversation(forged)).toBeUndefined();

    // And across a genuinely different instant, which the ordering check alone would have admitted.
    const later = inbound({ instagramMessageRef: 'ig.message.a', observedAt: HALF_SECOND_LATER });
    expect(
      instagramConversationSnapshotSchema.safeParse(forgedSnapshot([asSeconds, later])).success,
    ).toBe(false);
  });
});
