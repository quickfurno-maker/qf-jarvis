import { describe, expect, it } from 'vitest';

import {
  AAROHI_OMNICHANNEL_LIVE_CONTRACT_VERSION,
  evaluateAarohiOmnichannelSalesTurn,
} from '../index.js';

const PROSPECT = 'prospect.live.alpha';
const CONVERSATION = 'conv.live.alpha';
const THREAD = 'thread.live.alpha';
const PARTICIPANT = 'party.live.alpha';
const MESSAGE = 'msg.live.001';
const OBSERVED = '2026-10-03T02:20:00Z';
const INTERPRETED = '2026-10-03T02:20:01Z';
const PLANNED = '2026-10-03T02:20:02Z';

function turn(over: Record<string, unknown> = {}) {
  return {
    contractVersion: AAROHI_OMNICHANNEL_LIVE_CONTRACT_VERSION,
    prospectRef: PROSPECT,
    channel: 'WHATSAPP',
    channelConversationRef: CONVERSATION,
    channelThreadRef: THREAD,
    channelParticipantRef: PARTICIPANT,
    channelMessageRef: MESSAGE,
    observedAt: OBSERVED,
    ...over,
  };
}

function interpretation(over: Record<string, unknown> = {}) {
  return {
    contractVersion: AAROHI_OMNICHANNEL_LIVE_CONTRACT_VERSION,
    interpretationRef: 'interp.live.001',
    prospectRef: PROSPECT,
    channel: 'WHATSAPP',
    channelConversationRef: CONVERSATION,
    channelThreadRef: THREAD,
    channelParticipantRef: PARTICIPANT,
    channelMessageRef: MESSAGE,
    intent: 'GENERAL_INFORMATION',
    objectionKind: 'NONE',
    interpretedAt: INTERPRETED,
    sourcePosture: 'QUICKFURNO_STRUCTURED_LIVE_INTERPRETATION',
    ...over,
  };
}

function core(status = 'NOT_REGISTERED', prospectRef = PROSPECT) {
  return {
    prospectRef,
    coreLookupRef: 'core.live.lookup.001',
    status,
  };
}

function input(over: Record<string, unknown> = {}) {
  return {
    planRef: 'plan.live.001',
    turn: turn(),
    interpretation: interpretation(),
    coreObservation: core(),
    plannedAt: PLANNED,
    ...over,
  };
}

describe('AVG-13 live omnichannel sales contract', () => {
  it('accepts a bound WhatsApp prospect only while Core says NOT_REGISTERED', () => {
    const result = evaluateAarohiOmnichannelSalesTurn(input());
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.plan.channel).toBe('WHATSAPP');
    expect(result.plan.prospectRef).toBe(PROSPECT);
    expect(result.plan.coreStatus).toBe('NOT_REGISTERED');
    expect(result.plan.brief.strategy).toBe('PREPARE_NONCOMMERCIAL_REPLY_BRIEF');
    expect(result.plan.brief.futureModelDraftEligible).toBe(true);
  });

  it('reuses the governed AVG-7 strategy policy for commercial and process questions', () => {
    const commercial = evaluateAarohiOmnichannelSalesTurn(
      input({
        interpretation: interpretation({
          intent: 'COMMERCIAL_TERMS',
          objectionKind: 'PRICE_OR_PACKAGE',
        }),
      }),
    );
    expect(commercial.ok).toBe(true);
    if (commercial.ok) {
      expect(commercial.plan.brief.strategy).toBe('REQUEST_CORE_COMMERCIAL_CONTEXT');
      expect(commercial.plan.brief.futureModelDraftEligible).toBe(false);
    }

    const registration = evaluateAarohiOmnichannelSalesTurn(
      input({
        interpretation: interpretation({
          intent: 'REGISTRATION_PROCESS',
          objectionKind: 'NONE',
        }),
      }),
    );
    expect(registration.ok).toBe(true);
    if (registration.ok) {
      expect(registration.plan.brief.strategy).toBe('REQUEST_CORE_PROCESS_CONTEXT');
      expect(registration.plan.brief.futureModelDraftEligible).toBe(false);
    }
  });

  it('refuses any mismatched current-turn binding', () => {
    for (const bad of [
      interpretation({ prospectRef: 'prospect.live.other' }),
      interpretation({ channelConversationRef: 'conv.live.other' }),
      interpretation({ channelThreadRef: 'thread.live.other' }),
      interpretation({ channelParticipantRef: 'party.live.other' }),
      interpretation({ channelMessageRef: 'msg.live.other' }),
      interpretation({ channel: 'INSTAGRAM' }),
    ]) {
      const result = evaluateAarohiOmnichannelSalesTurn(input({ interpretation: bad }));
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.refusal).toBe('BINDING_MISMATCH');
    }
  });

  it('refuses an interpretation stamped before the observed message', () => {
    const result = evaluateAarohiOmnichannelSalesTurn(
      input({ interpretation: interpretation({ interpretedAt: '2026-10-03T02:19:59Z' }) }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.refusal).toBe('STALE_INTERPRETATION');
  });

  it('refuses a plan timestamp before the interpretation', () => {
    const result = evaluateAarohiOmnichannelSalesTurn(input({ plannedAt: '2026-10-03T02:20:00Z' }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.refusal).toBe('STALE_INTERPRETATION');
  });

  it('refuses every Core status that means Aarohi no longer owns acquisition', () => {
    for (const status of ['REGISTERED', 'ACTIVE', 'DO_NOT_CONTACT', 'UNKNOWN']) {
      const result = evaluateAarohiOmnichannelSalesTurn(input({ coreObservation: core(status) }));
      expect(result.ok, status).toBe(false);
      if (!result.ok) expect(result.refusal, status).toBe('CORE_GATE_REFUSED');
    }
  });

  it('refuses a Core observation for another prospect', () => {
    const result = evaluateAarohiOmnichannelSalesTurn(
      input({ coreObservation: core('NOT_REGISTERED', 'prospect.live.other') }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.refusal).toBe('CORE_GATE_REFUSED');
  });

  it('keeps the plan content-free and authority-free', () => {
    const result = evaluateAarohiOmnichannelSalesTurn(input());
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const keys = JSON.stringify(result.plan).toLowerCase();
    for (const forbidden of [
      'replytext',
      '"body"',
      '"price"',
      '"discount"',
      '"paymentconfirmed"',
      '"registrationconfirmed"',
      '"send"',
      '"provider"',
    ]) {
      expect(keys).not.toContain(forbidden);
    }
  });

  it('uses strict schemas so a caller cannot smuggle authority into the live turn', () => {
    const result = evaluateAarohiOmnichannelSalesTurn(
      input({
        turn: turn({ consentGranted: true }),
      }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.refusal).toBe('TURN_INVALID');
  });
});
