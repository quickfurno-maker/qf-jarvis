/**
 * AVG-1 — the prospect domain, the fail-closed gate, and the ACTIVE handoff boundary.
 *
 * Two invariants carry this whole slice and both are asserted exhaustively rather than by example:
 *
 * 1. The existing-vendor gate is an ALLOWLIST. Exactly one Core status proceeds; every other
 *    governed status — including all three shapes of not-knowing — stops. The test iterates the
 *    CLOSED vocabulary, so a status added without a decision fails here rather than defaulting to
 *    contacting somebody.
 * 2. The ACTIVE handoff trusts exactly one authority. The substitutes ADR-0085 rules out — provider
 *    receipt, model inference, conversation claim, agent case state — are enumerated and each is
 *    proved refused even when it asserts `active: true`.
 *
 * Synthetic data only. Nothing here reaches a provider, a channel, a credential or a network.
 */
import { describe, expect, it } from 'vitest';

import {
  ACQUISITION_CASE_STATES,
  ACQUISITION_CASE_TRANSITIONS,
  canTransition,
  isTerminalAcquisitionCaseState,
  openAcquisitionCase,
  TERMINAL_ACQUISITION_CASE_STATES,
  transitionAcquisitionCase,
} from '../contracts/acquisition-case.js';
import type { AcquisitionCase, AcquisitionCaseState } from '../contracts/acquisition-case.js';
import {
  ACTIVATION_AUTHORITIES,
  evaluateHandoffReadiness,
  HANDOFF_REJECTED_AUTHORITIES,
  HANDOFF_TRUSTED_AUTHORITY,
} from '../contracts/active-handoff.js';
import {
  BLOCKED_CORE_STATUSES,
  CORE_PARTY_STATUSES,
  CORE_STATUS_ROLE,
  ELIGIBLE_CORE_STATUSES,
  evaluateAcquisitionEligibility,
} from '../contracts/existing-vendor-gate.js';
import type { CorePartyStatus } from '../contracts/existing-vendor-gate.js';
import {
  AAROHI_AGENT_ID,
  createProspectIdentity,
  PROSPECT_DISCOVERY_SOURCES,
} from '../contracts/prospect-identity.js';

const PROSPECT = 'prospect.abc-001';
const LOOKUP = 'lookup.abc-001';

const observation = (status: CorePartyStatus, prospectRef = PROSPECT): unknown => ({
  prospectRef,
  coreLookupRef: LOOKUP,
  status,
});

describe('a prospect is explicitly NOT a Core vendor identity', () => {
  it('speaks as the governed aarohi agent id', () => {
    expect(AAROHI_AGENT_ID).toBe('aarohi');
  });

  it('builds a frozen identity from opaque references only', () => {
    const identity = createProspectIdentity({
      prospectRef: PROSPECT,
      discoverySource: 'PUBLIC_DIRECTORY',
    });
    expect(identity).toBeDefined();
    expect(Object.isFrozen(identity)).toBe(true);
    expect(identity?.prospectRef).toBe(PROSPECT);
  });

  it('REFUSES any field that would make it a second source of vendor truth', () => {
    // Strict schema: an unknown key is a refusal, not a silent drop. These are exactly the fields
    // that would turn a prospect record into a shadow vendor record.
    for (const extra of [
      { vendorId: 'v-1' },
      { registrationNumber: 'r-1' },
      { isActive: true },
      { phone: '+910000000000' },
      { email: 'a@b.c' },
      { packageTier: 'GOLD' },
    ]) {
      expect(
        createProspectIdentity({
          prospectRef: PROSPECT,
          discoverySource: 'MANUAL_ENTRY',
          ...extra,
        }),
        JSON.stringify(extra),
      ).toBeUndefined();
    }
  });

  it('refuses a malformed or non-opaque reference', () => {
    for (const bad of [
      { prospectRef: '', discoverySource: 'MANUAL_ENTRY' },
      { prospectRef: 'has space', discoverySource: 'MANUAL_ENTRY' },
      { prospectRef: PROSPECT, discoverySource: 'NOT_A_SOURCE' },
      { discoverySource: 'MANUAL_ENTRY' },
      null,
      'text',
    ]) {
      expect(createProspectIdentity(bad)).toBeUndefined();
    }
  });

  it('the discovery source is provenance only — never a permission', () => {
    // Every source, including an inbound one, still has to pass the gate. Nothing about where a
    // business was noticed grants eligibility to contact it.
    for (const source of PROSPECT_DISCOVERY_SOURCES) {
      const identity = createProspectIdentity({ prospectRef: PROSPECT, discoverySource: source });
      expect(identity).toBeDefined();
      expect(identity).not.toHaveProperty('eligible');
      expect(identity).not.toHaveProperty('mayContact');
    }
  });
});

describe('THE GATE — exactly one Core status proceeds, everything else stops', () => {
  it('the allowlist has exactly one member, and it is NOT_REGISTERED', () => {
    expect([...ELIGIBLE_CORE_STATUSES]).toStrictEqual(['NOT_REGISTERED']);
  });

  it('EVERY governed status is either eligible or blocked — never neither, never both', () => {
    // Derived as complements, so the two sets partition the vocabulary by construction.
    expect(ELIGIBLE_CORE_STATUSES.length + BLOCKED_CORE_STATUSES.length).toBe(
      CORE_PARTY_STATUSES.length,
    );
    for (const status of CORE_PARTY_STATUSES) {
      const eligible = ELIGIBLE_CORE_STATUSES.includes(status);
      const blocked = BLOCKED_CORE_STATUSES.includes(status);
      expect(eligible !== blocked, status).toBe(true);
    }
  });

  it('only NOT_REGISTERED is permitted, across the WHOLE closed vocabulary', () => {
    // The exhaustive form. A status added to the vocabulary without a decision fails the role map
    // at compile time; one added WITH a permissive decision fails right here.
    for (const status of CORE_PARTY_STATUSES) {
      const verdict = evaluateAcquisitionEligibility(PROSPECT, observation(status));
      expect(verdict.eligible, status).toBe(status === 'NOT_REGISTERED');
    }
  });

  it('every existing-relationship status the overlay names is refused', () => {
    for (const status of [
      'REGISTERED',
      'ACTIVE',
      'INACTIVE',
      'DORMANT',
      'FORMER',
      'DUPLICATE',
    ] as const) {
      const verdict = evaluateAcquisitionEligibility(PROSPECT, observation(status));
      expect(verdict.eligible).toBe(false);
      if (!verdict.eligible) {
        expect(verdict.reason).toBe('EXISTING_CORE_RELATIONSHIP');
      }
    }
  });

  it('Core suppression is obeyed, never re-decided here', () => {
    for (const status of ['DO_NOT_CONTACT', 'PREVIOUSLY_CONTACTED'] as const) {
      const verdict = evaluateAcquisitionEligibility(PROSPECT, observation(status));
      expect(verdict.eligible).toBe(false);
      if (!verdict.eligible) {
        expect(verdict.reason).toBe('CORE_SUPPRESSED');
      }
    }
  });

  it('absent or ambiguous Core truth is a STOP, not a gap', () => {
    // The half that is easiest to get wrong. Not-knowing is not permission.
    for (const status of ['UNKNOWN', 'AMBIGUOUS', 'CORE_UNAVAILABLE'] as const) {
      const verdict = evaluateAcquisitionEligibility(PROSPECT, observation(status));
      expect(verdict.eligible).toBe(false);
      if (!verdict.eligible) {
        expect(verdict.reason).toBe('CORE_TRUTH_UNRESOLVED');
      }
    }
  });

  it('an observation about a DIFFERENT prospect is no evidence about this one', () => {
    const verdict = evaluateAcquisitionEligibility(
      PROSPECT,
      observation('NOT_REGISTERED', 'prospect.someone-else'),
    );
    expect(verdict.eligible).toBe(false);
    if (!verdict.eligible) {
      expect(verdict.reason).toBe('OBSERVATION_INVALID');
    }
  });

  it('a malformed, absent or unknown-key observation fails closed', () => {
    for (const bad of [
      undefined,
      null,
      {},
      'NOT_REGISTERED',
      { prospectRef: PROSPECT, coreLookupRef: LOOKUP, status: 'MADE_UP' },
      // An extra key is refused rather than ignored: a caller smuggling `override: true` past a
      // permissive schema is exactly the failure this closes.
      { prospectRef: PROSPECT, coreLookupRef: LOOKUP, status: 'NOT_REGISTERED', override: true },
      // No lookup reference means nothing ties this to a Core lookup at all.
      { prospectRef: PROSPECT, status: 'NOT_REGISTERED' },
    ]) {
      const verdict = evaluateAcquisitionEligibility(PROSPECT, bad);
      expect(verdict.eligible, JSON.stringify(bad)).toBe(false);
    }
  });

  it('the role map is TOTAL over the vocabulary', () => {
    for (const status of CORE_PARTY_STATUSES) {
      expect(CORE_STATUS_ROLE[status], status).toBeDefined();
    }
  });
});

describe('the case lifecycle tracks AAROHI’S WORK, never the party’s business state', () => {
  it('names no state that would assert a Core commercial fact', () => {
    // VERIFIED_VENDOR / PAYMENT_CONFIRMED / ACTIVE_VENDOR would each make this package a second
    // source of vendor truth, which is the one thing AVG-1 exists to prevent.
    for (const forbidden of [
      'VERIFIED_VENDOR',
      'PAYMENT_CONFIRMED',
      'ACTIVE_VENDOR',
      'REGISTERED_VENDOR',
      'PAID',
    ]) {
      expect([...ACQUISITION_CASE_STATES]).not.toContain(forbidden);
    }
  });

  it('a new case always starts at DISCOVERED', () => {
    const opened = openAcquisitionCase({ caseRef: 'case.1', prospectRef: PROSPECT });
    expect(opened?.state).toBe('DISCOVERED');
    expect(Object.isFrozen(opened)).toBe(true);
    // A case cannot be created mid-lifecycle by passing a state.
    const injected = openAcquisitionCase({
      caseRef: 'case.1',
      prospectRef: PROSPECT,
      state: 'HANDED_OFF_TO_ANISHA',
    });
    expect(injected).toBeUndefined();
  });

  it('the transition table is TOTAL, and terminal states have no exits', () => {
    for (const state of ACQUISITION_CASE_STATES) {
      expect(ACQUISITION_CASE_TRANSITIONS[state], state).toBeDefined();
    }
    for (const state of TERMINAL_ACQUISITION_CASE_STATES) {
      expect(ACQUISITION_CASE_TRANSITIONS[state]).toStrictEqual([]);
      expect(isTerminalAcquisitionCaseState(state)).toBe(true);
      for (const target of ACQUISITION_CASE_STATES) {
        expect(canTransition(state, target), `${state} -> ${target}`).toBe(false);
      }
    }
  });

  it('a terminal case cannot be reopened — a refused party is not re-approached', () => {
    const refused: AcquisitionCase = Object.freeze({
      caseRef: 'case.1',
      prospectRef: PROSPECT,
      state: 'REFUSED' as const,
      refusalReason: 'CORE_SUPPRESSED' as const,
    });
    for (const target of ACQUISITION_CASE_STATES) {
      const result = transitionAcquisitionCase(refused, target);
      expect(result.ok, target).toBe(false);
      if (!result.ok) {
        expect(result.refusal).toBe('CASE_ALREADY_TERMINAL');
      }
    }
  });

  it('nothing walks backwards to DISCOVERED', () => {
    for (const state of ACQUISITION_CASE_STATES) {
      expect(canTransition(state, 'DISCOVERED'), state).toBe(false);
    }
  });

  it('handoff is reachable ONLY from AWAITING_CORE_ACTIVATION', () => {
    const sources = ACQUISITION_CASE_STATES.filter((one) =>
      canTransition(one, 'HANDED_OFF_TO_ANISHA'),
    );
    expect([...sources]).toStrictEqual(['AWAITING_CORE_ACTIVATION']);
  });

  it('a refusal must name a reason, and nothing else may carry one', () => {
    const opened = openAcquisitionCase({ caseRef: 'case.1', prospectRef: PROSPECT });
    if (opened === undefined) {
      throw new Error('the case must open');
    }
    // A refusal nobody can explain is one nobody can audit.
    const noReason = transitionAcquisitionCase(opened, 'REFUSED');
    expect(noReason.ok).toBe(false);
    if (!noReason.ok) {
      expect(noReason.refusal).toBe('REFUSAL_REASON_REQUIRED');
    }
    const withReason = transitionAcquisitionCase(opened, 'REFUSED', 'CORE_SUPPRESSED');
    expect(withReason.ok).toBe(true);

    const strayReason = transitionAcquisitionCase(opened, 'ELIGIBILITY_PENDING', 'CORE_SUPPRESSED');
    expect(strayReason.ok).toBe(false);
    if (!strayReason.ok) {
      expect(strayReason.refusal).toBe('REFUSAL_REASON_NOT_PERMITTED');
    }
  });

  it('transitions return a NEW frozen case and mutate nothing', () => {
    const opened = openAcquisitionCase({ caseRef: 'case.1', prospectRef: PROSPECT });
    if (opened === undefined) {
      throw new Error('the case must open');
    }
    const next = transitionAcquisitionCase(opened, 'ELIGIBILITY_PENDING');
    expect(next.ok).toBe(true);
    if (next.ok) {
      expect(next.next.state).toBe('ELIGIBILITY_PENDING');
      expect(Object.isFrozen(next.next)).toBe(true);
      // The original is untouched, so "terminal" cannot be edited away in place.
      expect(opened.state).toBe('DISCOVERED');
    }
  });

  it('the happy path reaches handoff and stops there', () => {
    const opened = openAcquisitionCase({ caseRef: 'case.1', prospectRef: PROSPECT });
    if (opened === undefined) {
      throw new Error('the case must open');
    }
    let current: AcquisitionCase = opened;
    for (const step of [
      'ELIGIBILITY_PENDING',
      'ELIGIBLE_NET_NEW',
      'CONTACT_APPROVED',
      'AWAITING_CORE_ACTIVATION',
      'HANDED_OFF_TO_ANISHA',
    ] as AcquisitionCaseState[]) {
      const result = transitionAcquisitionCase(current, step);
      expect(result.ok, step).toBe(true);
      if (result.ok) {
        current = result.next;
      }
    }
    expect(current.state).toBe('HANDED_OFF_TO_ANISHA');
    expect(isTerminalAcquisitionCaseState('HANDED_OFF_TO_ANISHA')).toBe(true);
  });
});

describe('THE HANDOFF BOUNDARY — only QuickFurno Core may confirm ACTIVE', () => {
  const attest = (authority: string, active: boolean, prospectRef = PROSPECT): unknown => ({
    prospectRef,
    coreAttestationRef: 'core.att.1',
    authority,
    active,
  });

  it('Core confirming ACTIVE is ready', () => {
    expect(
      evaluateHandoffReadiness(PROSPECT, attest(HANDOFF_TRUSTED_AUTHORITY, true)),
    ).toStrictEqual({ ready: true });
  });

  it('EVERY non-Core authority is refused, even asserting active:true', () => {
    // The substitutes ADR-0085 names explicitly: a provider receipt, a model's reading of a
    // conversation, and a message claiming payment. Each is enumerated so its refusal is provable
    // rather than merely intended.
    expect([...HANDOFF_REJECTED_AUTHORITIES].sort()).toStrictEqual([
      'AGENT_CASE_STATE',
      'CONVERSATION_CLAIM',
      'MODEL_INFERENCE',
      'PROVIDER_RECEIPT',
    ]);
    for (const authority of HANDOFF_REJECTED_AUTHORITIES) {
      const verdict = evaluateHandoffReadiness(PROSPECT, attest(authority, true));
      expect(verdict.ready, authority).toBe(false);
      if (!verdict.ready) {
        // Refused as a WRONG AUTHORITY, not evaluated as a fact — the ordering is the point.
        expect(verdict.reason).toBe('AUTHORITY_NOT_CORE');
      }
    }
  });

  it('exactly one authority is trusted, across the closed vocabulary', () => {
    const trusted = ACTIVATION_AUTHORITIES.filter(
      (one) => evaluateHandoffReadiness(PROSPECT, attest(one, true)).ready,
    );
    expect([...trusted]).toStrictEqual(['QUICKFURNO_CORE']);
  });

  it('Core declining to confirm is refused for that reason', () => {
    const verdict = evaluateHandoffReadiness(PROSPECT, attest(HANDOFF_TRUSTED_AUTHORITY, false));
    expect(verdict.ready).toBe(false);
    if (!verdict.ready) {
      expect(verdict.reason).toBe('CORE_DID_NOT_CONFIRM_ACTIVE');
    }
  });

  it('an attestation for a different prospect, or a malformed one, fails closed', () => {
    for (const bad of [
      attest(HANDOFF_TRUSTED_AUTHORITY, true, 'prospect.someone-else'),
      undefined,
      null,
      {},
      { prospectRef: PROSPECT, coreAttestationRef: 'core.att.1', active: true },
      // No authority field at all: an attestation that did not say who asserts it is not one.
      {
        prospectRef: PROSPECT,
        coreAttestationRef: 'core.att.1',
        authority: 'NOBODY',
        active: true,
      },
      // Unknown key smuggling.
      {
        prospectRef: PROSPECT,
        coreAttestationRef: 'core.att.1',
        authority: 'QUICKFURNO_CORE',
        active: true,
        force: true,
      },
    ]) {
      expect(evaluateHandoffReadiness(PROSPECT, bad).ready, JSON.stringify(bad)).toBe(false);
    }
  });

  it('readiness moves nothing — it is a verdict, not an action', () => {
    const verdict = evaluateHandoffReadiness(PROSPECT, attest(HANDOFF_TRUSTED_AUTHORITY, true));
    expect(Object.isFrozen(verdict)).toBe(true);
    expect(Object.keys(verdict)).toStrictEqual(['ready']);
  });
});
