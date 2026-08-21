/**
 * The customer-care behaviour kernel, proved deterministically.
 *
 * Two things are asserted throughout and they are the reason this package exists separately:
 *
 * 1. PRECEDENCE. Every gate that removes the model runs before every gate that keeps it. A turn
 *    that is simultaneously paused and a complaint is paused. Reordering those branches is a
 *    behaviour change, so the order is asserted rather than trusted.
 * 2. SCOPE. This agent is CLIENT / CUSTOMER_CARE. A VENDOR turn is the sibling package's and is
 *    refused before any model is reached; a SALES turn is Riya's and is REFERRED, not refused.
 *
 * Nothing here reaches a model, a transport, a network or a credential.
 */
import { describe, expect, it } from 'vitest';

import {
  ANISHA_CARE_ACTOR,
  ANISHA_CARE_SUPPORTED_PARTY,
  decideCareTurn,
} from '../behaviour/decide-care-turn.js';
import type { CareTurnInput } from '../behaviour/decide-care-turn.js';
import {
  ANISHA_CARE_SERVICE_LINE,
  CARE_INTENTS,
  classifyCareIntent,
} from '../contracts/care-intent.js';
import {
  CARE_DISPOSITIONS,
  CARE_MODEL_ELIGIBLE_DISPOSITIONS,
  isCareModelEligibleDisposition,
} from '../contracts/care-outcome.js';
import { CARE_ESCALATION_REASONS } from '../contracts/escalation.js';

const PROMPT = 'care.prompt.v1';

function turn(over: Partial<CareTurnInput> = {}): CareTurnInput {
  return {
    partyType: 'CLIENT',
    signals: {},
    promptRef: PROMPT,
    humanTakeover: false,
    aiPaused: false,
    ...over,
  };
}

describe('identity is fixed, never a parameter', () => {
  it('speaks as ANISHA on the CLIENT party, in the CUSTOMER_CARE service line', () => {
    expect(ANISHA_CARE_ACTOR).toBe('ANISHA');
    expect(ANISHA_CARE_SUPPORTED_PARTY).toBe('CLIENT');
    expect(ANISHA_CARE_SERVICE_LINE).toBe('CUSTOMER_CARE');
    const decision = decideCareTurn(turn());
    expect(decision.actor).toBe('ANISHA');
    expect(decision.serviceLine).toBe('CUSTOMER_CARE');
  });

  it('every decision is frozen', () => {
    const decision = decideCareTurn(turn());
    expect(Object.isFrozen(decision)).toBe(true);
  });
});

describe('SCOPE — vendor work is refused, sales work is referred', () => {
  it('a VENDOR turn is a scope violation and reaches no model', () => {
    // The mirror image of the vendor package refusing client work. Vendor journey belongs to
    // @qf-jarvis/anisha-agent, and this package must not answer for it.
    const decision = decideCareTurn(turn({ partyType: 'VENDOR' }));
    expect(decision.disposition).toBe('REFUSE');
    expect(decision.reason).toBe('runtime-scope-violation');
    expect(decision.modelReplyEligible).toBe(false);
  });

  it('an UNKNOWN party is refused too', () => {
    const decision = decideCareTurn(turn({ partyType: 'UNKNOWN' }));
    expect(decision.disposition).toBe('REFUSE');
    expect(decision.reason).toBe('runtime-scope-violation');
  });

  it('a turn owned by another actor is not this package’s to answer', () => {
    for (const actor of ['RIYA', 'JARVIS', 'HUMAN', 'SYSTEM'] as const) {
      const decision = decideCareTurn(turn({ currentActor: actor }));
      expect(decision.disposition).toBe('REFUSE');
      expect(decision.reason).toBe('runtime-scope-violation');
    }
    // Its own actor is fine.
    expect(decideCareTurn(turn({ currentActor: 'ANISHA' })).disposition).not.toBe('REFUSE');
  });

  it('a SALES enquiry is REFERRED rather than refused', () => {
    // The client reached the wrong agent, not the wrong company. Declining them would be a worse
    // outcome than routing them, and a refusal would lose the fact that someone can help.
    const decision = decideCareTurn(turn({ signals: { salesEnquiry: true } }));
    expect(decision.intent).toBe('SALES_REQUEST_NOT_CARE');
    expect(decision.disposition).toBe('REFER_TO_SALES_AGENT');
    expect(decision.disposition).not.toBe('REFUSE');
    // Referral still reaches no model here: the sibling agent owns the reply.
    expect(decision.modelReplyEligible).toBe(false);
  });
});

describe('PRECEDENCE — every model-removing gate runs first', () => {
  it('human takeover beats every content signal', () => {
    const decision = decideCareTurn(
      turn({
        humanTakeover: true,
        signals: { complaintRaised: true, refundCancellationOrBilling: true },
      }),
    );
    expect(decision.reason).toBe('runtime-human-takeover');
    expect(decision.disposition).toBe('REFUSE');
    expect(decision.modelReplyEligible).toBe(false);
  });

  it('an AI pause beats every content signal', () => {
    const decision = decideCareTurn(turn({ aiPaused: true, signals: { complaintRaised: true } }));
    expect(decision.reason).toBe('runtime-ai-paused');
    expect(decision.modelReplyEligible).toBe(false);
  });

  it('scope is checked BEFORE takeover and pause', () => {
    // A vendor turn under takeover is reported as the scope violation it is: the turn was never
    // this package's, and reporting it as a takeover would hide that.
    const decision = decideCareTurn(
      turn({ partyType: 'VENDOR', humanTakeover: true, aiPaused: true }),
    );
    expect(decision.reason).toBe('runtime-scope-violation');
  });

  it('takeover is checked before pause', () => {
    const decision = decideCareTurn(turn({ humanTakeover: true, aiPaused: true }));
    expect(decision.reason).toBe('runtime-human-takeover');
  });

  it('an invalid envelope fails CLOSED and describes nothing about itself', () => {
    const decision = decideCareTurn({
      ...turn(),
      // An empty prompt ref fails the bounded schema.
      promptRef: '',
    });
    expect(decision.reason).toBe('runtime-envelope-invalid');
    expect(decision.disposition).toBe('REFUSE');
    expect(decision.modelReplyEligible).toBe(false);
    // The rejected value is not echoed back.
    expect(decision.promptRef).toBe('care.prompt.unresolved');
  });

  it('an unknown signal key is refused rather than dropped', () => {
    const decision = decideCareTurn({
      ...turn(),
      signals: { orderTotal: 420000 } as never,
    });
    expect(decision.reason).toBe('runtime-envelope-invalid');
  });
});

describe('intent classification is deterministic and total', () => {
  it('classifies the empty signal set as the ordinary care turn', () => {
    expect(classifyCareIntent({})).toBe('ROUTINE_CARE_QUERY');
  });

  it('escalation-required outranks every other content signal', () => {
    expect(
      classifyCareIntent({
        escalationRequired: true,
        humanRequested: true,
        complaintRaised: true,
        refundCancellationOrBilling: true,
        salesEnquiry: true,
      }),
    ).toBe('ESCALATION_REQUIRED_MATTER');
  });

  it('out-of-scope outranks everything, including escalation', () => {
    expect(classifyCareIntent({ outOfScope: true, escalationRequired: true })).toBe(
      'UNSUPPORTED_NON_CARE_REQUEST',
    );
  });

  it('a sales enquiry outranks the care content branches', () => {
    // So a sales turn that happens to mention delivery is not quietly served here.
    expect(classifyCareIntent({ salesEnquiry: true, schedulingOrDelivery: true })).toBe(
      'SALES_REQUEST_NOT_CARE',
    );
  });

  it('money-adjacent outranks the remaining care branches', () => {
    expect(
      classifyCareIntent({
        refundCancellationOrBilling: true,
        warrantyOrAftercare: true,
        schedulingOrDelivery: true,
        orderOrProjectStatus: true,
      }),
    ).toBe('REFUND_CANCELLATION_OR_BILLING_MATTER');
  });

  it('is total — every closed intent is reachable from some signal set', () => {
    const reached = new Set([
      classifyCareIntent({ outOfScope: true }),
      classifyCareIntent({ salesEnquiry: true }),
      classifyCareIntent({ escalationRequired: true }),
      classifyCareIntent({ humanRequested: true }),
      classifyCareIntent({ complaintRaised: true }),
      classifyCareIntent({ orderOrProjectStatus: true }),
      classifyCareIntent({ schedulingOrDelivery: true }),
      classifyCareIntent({ warrantyOrAftercare: true }),
      classifyCareIntent({ refundCancellationOrBilling: true }),
      classifyCareIntent({}),
    ]);
    expect(reached.size).toBe(CARE_INTENTS.length);
    for (const intent of CARE_INTENTS) {
      expect(reached.has(intent)).toBe(true);
    }
  });
});

describe('money-adjacent matters escalate — they are never acknowledged with an outcome', () => {
  it('a refund, cancellation or billing matter escalates', () => {
    const decision = decideCareTurn(turn({ signals: { refundCancellationOrBilling: true } }));
    expect(decision.disposition).toBe('REQUEST_CARE_ESCALATION');
    expect(decision.escalationReason).toBe('COMMERCIAL_DECISION_REQUIRED');
    // No model: care may never state an amount, an eligibility or a date.
    expect(decision.modelReplyEligible).toBe(false);
  });

  it('a human request escalates and names why', () => {
    const decision = decideCareTurn(turn({ signals: { humanRequested: true } }));
    expect(decision.disposition).toBe('REQUEST_CARE_ESCALATION');
    expect(decision.escalationReason).toBe('CLIENT_REQUESTED_HUMAN');
  });

  it('a first complaint is acknowledged; a repeat one gets an owner', () => {
    const first = decideCareTurn(turn({ signals: { complaintRaised: true } }));
    expect(first.disposition).toBe('ACKNOWLEDGE_AND_RECORD');
    expect(first.escalationReason).toBeUndefined();
    expect(first.modelReplyEligible).toBe(true);

    const repeat = decideCareTurn(
      turn({ signals: { complaintRaised: true }, context: { previouslyEscalated: true } }),
    );
    // A repeat escalation is not the same event as a first one: handling it as fresh is how a
    // client ends up explaining themselves three times.
    expect(repeat.disposition).toBe('REQUEST_CARE_ESCALATION');
    expect(repeat.escalationReason).toBe('REPEAT_ESCALATION');
  });

  it('an escalation reason is present ONLY when escalating', () => {
    for (const signals of [
      {},
      { complaintRaised: true },
      { warrantyOrAftercare: true },
      { salesEnquiry: true },
      { outOfScope: true },
    ]) {
      const decision = decideCareTurn(turn({ signals }));
      if (decision.disposition === 'REQUEST_CARE_ESCALATION') {
        expect(decision.escalationReason).toBeDefined();
      } else {
        // An escalation reason on a non-escalating turn would be read by an operator as one that is.
        expect(decision.escalationReason).toBeUndefined();
      }
    }
  });

  it('every escalating turn names a reason from the closed vocabulary', () => {
    for (const signals of [
      { escalationRequired: true },
      { humanRequested: true },
      { refundCancellationOrBilling: true },
    ]) {
      const decision = decideCareTurn(turn({ signals }));
      expect(decision.disposition).toBe('REQUEST_CARE_ESCALATION');
      expect(CARE_ESCALATION_REASONS).toContain(decision.escalationReason);
    }
  });

  it('an OVERDUE matter escalates as overdue when nothing more specific applies', () => {
    const decision = decideCareTurn(
      turn({ signals: { escalationRequired: true }, context: { ageBand: 'OVERDUE' } }),
    );
    expect(decision.escalationReason).toBe('MATTER_OVERDUE');
  });
});

describe('status and scheduling answer only about a KNOWN engagement', () => {
  it('clarifies when the turn was never told which engagement it concerns', () => {
    for (const signals of [{ orderOrProjectStatus: true }, { schedulingOrDelivery: true }]) {
      const decision = decideCareTurn(turn({ signals }));
      // The honest next move is to ask, not to answer about an unknown order.
      expect(decision.disposition).toBe('CONTINUE_CLARIFICATION');
    }
  });

  it('drafts a reply once an engagement reference is present', () => {
    for (const signals of [{ orderOrProjectStatus: true }, { schedulingOrDelivery: true }]) {
      const decision = decideCareTurn(
        turn({ signals, context: { engagementRef: 'eng.abc-123', stage: 'IN_PRODUCTION' } }),
      );
      expect(decision.disposition).toBe('DRAFT_REPLY');
      expect(decision.modelReplyEligible).toBe(true);
    }
  });
});

describe('model eligibility is DERIVED, never asserted', () => {
  it('matches the closed eligible-disposition list on every reachable path', () => {
    const inputs: CareTurnInput[] = [
      turn(),
      turn({ signals: { complaintRaised: true } }),
      turn({ signals: { warrantyOrAftercare: true } }),
      turn({ signals: { orderOrProjectStatus: true } }),
      turn({ signals: { orderOrProjectStatus: true }, context: { engagementRef: 'eng.a' } }),
      turn({ signals: { refundCancellationOrBilling: true } }),
      turn({ signals: { salesEnquiry: true } }),
      turn({ signals: { outOfScope: true } }),
      turn({ humanTakeover: true }),
      turn({ aiPaused: true }),
      turn({ partyType: 'VENDOR' }),
    ];
    for (const input of inputs) {
      const decision = decideCareTurn(input);
      expect(decision.modelReplyEligible).toBe(
        isCareModelEligibleDisposition(decision.disposition),
      );
    }
  });

  it('no escalation, referral or refusal path may reach a model', () => {
    for (const disposition of CARE_DISPOSITIONS) {
      if (
        disposition === 'REQUEST_CARE_ESCALATION' ||
        disposition === 'REFER_TO_SALES_AGENT' ||
        disposition === 'REFUSE'
      ) {
        expect(isCareModelEligibleDisposition(disposition)).toBe(false);
      }
    }
    expect([...CARE_MODEL_ELIGIBLE_DISPOSITIONS].sort()).toStrictEqual([
      'ACKNOWLEDGE_AND_RECORD',
      'CONTINUE_CLARIFICATION',
      'DRAFT_REPLY',
    ]);
  });
});
