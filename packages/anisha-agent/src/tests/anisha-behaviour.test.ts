/**
 * QFJ-S3-D-A — Anisha vendor-journey behaviour (ADR-0070).
 *
 * The kernel only. There is no runtime here: no orchestrator, no model port, no proposal, no Core.
 * What these specs pin down is that a validated vendor-journey turn produces exactly one frozen
 * decision, that the role boundary and the safety ordering hold before anything else, and that the
 * governed money rule — bands, never balances — has no field it could be violated through.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { AnishaBehaviourError, ANISHA_ERROR_CODES } from '../contracts/errors.js';
import {
  createVendorJourneyContext,
  VENDOR_JOURNEY_CONTEXT_COMPLETENESS_FROZEN,
  VENDOR_JOURNEY_CONTEXT_FIELDS_FROZEN,
} from '../contracts/vendor-journey-context.js';
import type {
  VendorJourneyContext,
  VendorJourneyContextInput,
} from '../contracts/vendor-journey-context.js';
import {
  ANISHA_BEHAVIOUR_VERSION,
  classifyVendorJourneyIntent,
  isVendorJourneySignals,
  PACKAGE_READINESS_BANDS_FROZEN,
  VENDOR_JOURNEY_INTENTS_FROZEN,
} from '../contracts/vendor-journey-intent.js';
import type {
  PackageReadinessBand,
  VendorJourneyIntent,
  VendorJourneySignals,
} from '../contracts/vendor-journey-intent.js';
import {
  ANISHA_ACTOR,
  ANISHA_DISPOSITIONS_FROZEN,
  ANISHA_SUPPORTED_PARTY,
  decideAnishaTurn,
} from '../behaviour/decide-anisha-turn.js';
import type { AnishaTurnInput } from '../behaviour/decide-anisha-turn.js';

const PROMPT_REF = 'prompt.anisha.vendor.v1';

function signals(over: Partial<VendorJourneySignals> = {}): VendorJourneySignals {
  return {
    hasPriorVendorContext: false,
    requestedHumanAssistance: false,
    raisedComplaint: false,
    askedAboutPackageOrRecharge: false,
    askedAboutOnboardingOrProfile: false,
    askedAboutLeadResponse: false,
    askedRoutineQuestion: false,
    matterRequiresEscalation: false,
    outOfVendorScope: false,
    missingContextFieldCount: 0,
    ...over,
  };
}

function context(over: Partial<VendorJourneyContextInput> = {}): VendorJourneyContext {
  return createVendorJourneyContext({ completeness: 'SUFFICIENT_FOR_CORE_REVIEW', ...over });
}

function turn(over: Partial<AnishaTurnInput> = {}): AnishaTurnInput {
  return {
    partyType: 'VENDOR',
    signals: signals(),
    promptRef: PROMPT_REF,
    humanTakeover: false,
    aiPaused: false,
    ...over,
  };
}

// ---------------------------------------------------------------------------
// A. Signals.
// ---------------------------------------------------------------------------

describe('(A) the vendor-journey signal contract', () => {
  it('accepts a valid minimal signal set', () => {
    expect(isVendorJourneySignals(signals())).toBe(true);
  });

  it('requires every boolean and rejects a string stand-in', () => {
    const keys = Object.keys(signals()).filter((k) => k !== 'missingContextFieldCount');
    for (const key of keys) {
      // Rebuilt without the key rather than deleted from a copy: a dynamic delete is banned by lint,
      // and omission is what a real caller would actually do.
      const missing = Object.fromEntries(
        Object.entries(signals()).filter(([name]) => name !== key),
      );
      expect(isVendorJourneySignals(missing)).toBe(false);
      expect(isVendorJourneySignals({ ...signals(), [key]: 'true' })).toBe(false);
    }
    expect(keys).toHaveLength(9);
  });

  it('bounds missingContextFieldCount to an integer 0-32', () => {
    for (const good of [0, 1, 32]) {
      expect(isVendorJourneySignals(signals({ missingContextFieldCount: good }))).toBe(true);
    }
    for (const bad of [-1, 33, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(isVendorJourneySignals(signals({ missingContextFieldCount: bad }))).toBe(false);
    }
  });

  it('rejects an unknown field, null, an array and a non-object', () => {
    expect(isVendorJourneySignals({ ...signals(), vendorName: 'Acme' })).toBe(false);
    expect(isVendorJourneySignals({ ...signals(), walletBalance: 500 })).toBe(false);
    expect(isVendorJourneySignals(null)).toBe(false);
    expect(isVendorJourneySignals([])).toBe(false);
    expect(isVendorJourneySignals('signals')).toBe(false);
  });

  it('accepts every governed band and rejects any other', () => {
    expect([...PACKAGE_READINESS_BANDS_FROZEN]).toEqual(['low', 'medium', 'high', 'critical']);
    for (const band of PACKAGE_READINESS_BANDS_FROZEN) {
      expect(
        isVendorJourneySignals(
          signals({ askedAboutPackageOrRecharge: true, packageReadinessBand: band }),
        ),
      ).toBe(true);
    }
    for (const bad of ['LOW', 'urgent', '500', 0, null]) {
      expect(
        isVendorJourneySignals({
          ...signals({ askedAboutPackageOrRecharge: true }),
          packageReadinessBand: bad,
        }),
      ).toBe(false);
    }
  });

  it('refuses a band on a turn that is neither package-related nor an ongoing journey', () => {
    expect(isVendorJourneySignals(signals({ packageReadinessBand: 'low' }))).toBe(false);
    expect(
      isVendorJourneySignals(
        signals({ askedAboutPackageOrRecharge: true, packageReadinessBand: 'low' }),
      ),
    ).toBe(true);
    expect(
      isVendorJourneySignals(signals({ hasPriorVendorContext: true, packageReadinessBand: 'low' })),
    ).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// B. Intent precedence.
// ---------------------------------------------------------------------------

describe('(B) intent classification is deterministic and safety-ordered', () => {
  it('the vocabulary is exactly the nine expected values, in order', () => {
    expect([...VENDOR_JOURNEY_INTENTS_FROZEN]).toEqual([
      'UNSUPPORTED_NON_VENDOR_REQUEST',
      'ESCALATION_REQUIRED_MATTER',
      'HUMAN_VENDOR_SUPPORT_REQUEST',
      'COMPLAINT_INTAKE',
      'PACKAGE_OR_RECHARGE_READINESS',
      'ONBOARDING_OR_PROFILE_GUIDANCE',
      'LEAD_RESPONSE_GUIDANCE',
      'ROUTINE_VENDOR_QUERY',
      'INSUFFICIENT_CONTEXT',
    ]);
  });

  /** Every signal that could compete, so each precedence step is proven against a loud rival. */
  const ALL_COMPETING: Partial<VendorJourneySignals> = {
    hasPriorVendorContext: true,
    requestedHumanAssistance: true,
    raisedComplaint: true,
    askedAboutPackageOrRecharge: true,
    askedAboutOnboardingOrProfile: true,
    askedAboutLeadResponse: true,
    askedRoutineQuestion: true,
    matterRequiresEscalation: true,
    missingContextFieldCount: 4,
  };

  const ladder: readonly {
    readonly name: string;
    readonly on: Partial<VendorJourneySignals>;
    readonly expect: VendorJourneyIntent;
  }[] = [
    {
      name: 'out-of-scope beats everything',
      on: { ...ALL_COMPETING, outOfVendorScope: true },
      expect: 'UNSUPPORTED_NON_VENDOR_REQUEST',
    },
    {
      name: 'escalation-required beats human, complaint and every commercial signal',
      on: ALL_COMPETING,
      expect: 'ESCALATION_REQUIRED_MATTER',
    },
    {
      name: 'a human request beats complaint and commercial',
      on: { ...ALL_COMPETING, matterRequiresEscalation: false },
      expect: 'HUMAN_VENDOR_SUPPORT_REQUEST',
    },
    {
      name: 'a complaint beats package, onboarding, lead and routine',
      on: { ...ALL_COMPETING, matterRequiresEscalation: false, requestedHumanAssistance: false },
      expect: 'COMPLAINT_INTAKE',
    },
    {
      name: 'package beats onboarding, lead and routine',
      on: {
        ...ALL_COMPETING,
        matterRequiresEscalation: false,
        requestedHumanAssistance: false,
        raisedComplaint: false,
      },
      expect: 'PACKAGE_OR_RECHARGE_READINESS',
    },
    {
      name: 'onboarding beats lead and routine',
      on: {
        ...ALL_COMPETING,
        matterRequiresEscalation: false,
        requestedHumanAssistance: false,
        raisedComplaint: false,
        askedAboutPackageOrRecharge: false,
      },
      expect: 'ONBOARDING_OR_PROFILE_GUIDANCE',
    },
    {
      name: 'lead response beats routine',
      on: {
        ...ALL_COMPETING,
        matterRequiresEscalation: false,
        requestedHumanAssistance: false,
        raisedComplaint: false,
        askedAboutPackageOrRecharge: false,
        askedAboutOnboardingOrProfile: false,
      },
      expect: 'LEAD_RESPONSE_GUIDANCE',
    },
    {
      name: 'routine is reachable',
      on: { hasPriorVendorContext: true, askedRoutineQuestion: true },
      expect: 'ROUTINE_VENDOR_QUERY',
    },
    {
      name: 'insufficient context is the default',
      on: { missingContextFieldCount: 4 },
      expect: 'INSUFFICIENT_CONTEXT',
    },
  ];

  for (const step of ladder) {
    it(step.name, () => {
      expect(classifyVendorJourneyIntent(signals(step.on))).toBe(step.expect);
    });
  }

  it('every one of the nine intents is reachable', () => {
    const reached = new Set(ladder.map((s) => classifyVendorJourneyIntent(signals(s.on))));
    expect(reached.size).toBe(VENDOR_JOURNEY_INTENTS_FROZEN.length);
  });

  it('prior context alone manufactures no intent, and a missing count overrides nothing', () => {
    expect(classifyVendorJourneyIntent(signals({ hasPriorVendorContext: true }))).toBe(
      'INSUFFICIENT_CONTEXT',
    );
    expect(
      classifyVendorJourneyIntent(
        signals({ askedRoutineQuestion: true, missingContextFieldCount: 32 }),
      ),
    ).toBe('ROUTINE_VENDOR_QUERY');
  });
});

// ---------------------------------------------------------------------------
// C. Context validation.
// ---------------------------------------------------------------------------

describe('(C) the vendor-journey context is bounded and self-consistent', () => {
  it('accepts a context with no references at all', () => {
    expect(context().completeness).toBe('SUFFICIENT_FOR_CORE_REVIEW');
  });

  it('accepts every optional reference and every band', () => {
    const built = context({
      vendorStageRef: 'stage.onboarding',
      onboardingStepRef: 'step.3',
      verificationStatusRef: 'verify.pending',
      packageReadinessBand: 'high',
    });
    expect(built.vendorStageRef).toBe('stage.onboarding');
    expect(built.onboardingStepRef).toBe('step.3');
    expect(built.verificationStatusRef).toBe('verify.pending');
    expect(built.packageReadinessBand).toBe('high');
  });

  it('rejects an unbounded, slashed, spaced or empty reference', () => {
    for (const bad of ['a/b', 'has space', '', 'x'.repeat(129), 'https://x.example']) {
      expect(() => context({ vendorStageRef: bad })).toThrow(AnishaBehaviourError);
    }
  });

  it('rejects an unknown field', () => {
    expect(() =>
      createVendorJourneyContext({
        completeness: 'SUFFICIENT_FOR_CORE_REVIEW',
        vendorName: 'Acme',
      } as unknown as VendorJourneyContextInput),
    ).toThrow(AnishaBehaviourError);
  });

  it('rejects duplicate missing fields', () => {
    expect(() =>
      context({
        completeness: 'MORE_CONTEXT_REQUIRED',
        missingFields: ['VENDOR_STAGE', 'VENDOR_STAGE'],
      }),
    ).toThrow(AnishaBehaviourError);
  });

  it('rejects SUFFICIENT_FOR_CORE_REVIEW while fields are still missing', () => {
    expect(() =>
      context({ completeness: 'SUFFICIENT_FOR_CORE_REVIEW', missingFields: ['ONBOARDING_STEP'] }),
    ).toThrow(AnishaBehaviourError);
  });

  it('rejects MORE_CONTEXT_REQUIRED with nothing listed missing', () => {
    expect(() => context({ completeness: 'MORE_CONTEXT_REQUIRED' })).toThrow(AnishaBehaviourError);
    expect(() => context({ completeness: 'MORE_CONTEXT_REQUIRED', missingFields: [] })).toThrow(
      AnishaBehaviourError,
    );
  });

  it('permits HUMAN_REVIEW_REQUIRED with zero or with several missing fields', () => {
    expect(context({ completeness: 'HUMAN_REVIEW_REQUIRED' }).missingFields).toEqual([]);
    expect(
      context({
        completeness: 'HUMAN_REVIEW_REQUIRED',
        missingFields: ['VENDOR_STAGE', 'PACKAGE_READINESS'],
      }).missingFields,
    ).toEqual(['VENDOR_STAGE', 'PACKAGE_READINESS']);
  });

  it('rejects a field listed missing whose value was supplied, for every closed field', () => {
    const supplied: Record<string, unknown> = {
      VENDOR_STAGE: { vendorStageRef: 'stage.1' },
      ONBOARDING_STEP: { onboardingStepRef: 'step.1' },
      VERIFICATION_STATUS: { verificationStatusRef: 'verify.1' },
      PACKAGE_READINESS: { packageReadinessBand: 'low' as PackageReadinessBand },
    };
    for (const field of VENDOR_JOURNEY_CONTEXT_FIELDS_FROZEN) {
      expect(() =>
        context({
          completeness: 'MORE_CONTEXT_REQUIRED',
          missingFields: [field],
          ...(supplied[field] as Partial<VendorJourneyContextInput>),
        }),
      ).toThrow(AnishaBehaviourError);
      // The same field listed missing with the value absent is fine.
      expect(
        context({ completeness: 'MORE_CONTEXT_REQUIRED', missingFields: [field] }).missingFields,
      ).toEqual([field]);
    }
    expect(VENDOR_JOURNEY_CONTEXT_FIELDS_FROZEN).toHaveLength(4);
  });

  it('every completeness value is reachable and the vocabularies are exact', () => {
    expect([...VENDOR_JOURNEY_CONTEXT_COMPLETENESS_FROZEN]).toEqual([
      'SUFFICIENT_FOR_CORE_REVIEW',
      'MORE_CONTEXT_REQUIRED',
      'HUMAN_REVIEW_REQUIRED',
    ]);
    expect([...VENDOR_JOURNEY_CONTEXT_FIELDS_FROZEN]).toEqual([
      'VENDOR_STAGE',
      'ONBOARDING_STEP',
      'VERIFICATION_STATUS',
      'PACKAGE_READINESS',
    ]);
  });

  it('freezes the context and its missing-field list', () => {
    const built = context({
      completeness: 'HUMAN_REVIEW_REQUIRED',
      missingFields: ['VENDOR_STAGE'],
    });
    expect(Object.isFrozen(built)).toBe(true);
    expect(Object.isFrozen(built.missingFields)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// D. Role boundary.
// ---------------------------------------------------------------------------

describe('(D) the role boundary is enforced before any intent is classified', () => {
  it('a VENDOR turn with ANISHA or with no assigned actor is served', () => {
    expect(decideAnishaTurn(turn({ currentActor: 'ANISHA' })).disposition).not.toBe('REFUSE');
    expect(decideAnishaTurn(turn()).disposition).not.toBe('REFUSE');
    expect(ANISHA_ACTOR).toBe('ANISHA');
    expect(ANISHA_SUPPORTED_PARTY).toBe('VENDOR');
  });

  const blocked: readonly {
    readonly name: string;
    readonly input: Partial<AnishaTurnInput>;
    readonly reason: string;
  }[] = [
    { name: 'a CLIENT party', input: { partyType: 'CLIENT' }, reason: 'runtime-scope-violation' },
    {
      name: 'an UNKNOWN party',
      input: { partyType: 'UNKNOWN' },
      reason: 'runtime-scope-violation',
    },
    { name: 'RIYA ownership', input: { currentActor: 'RIYA' }, reason: 'runtime-scope-violation' },
    {
      name: 'JARVIS ownership',
      input: { currentActor: 'JARVIS' },
      reason: 'runtime-scope-violation',
    },
    { name: 'HUMAN ownership', input: { currentActor: 'HUMAN' }, reason: 'runtime-human-takeover' },
    {
      name: 'SYSTEM ownership',
      input: { currentActor: 'SYSTEM' },
      reason: 'runtime-human-takeover',
    },
    { name: 'AI pause', input: { aiPaused: true }, reason: 'runtime-ai-paused' },
    { name: 'human takeover', input: { humanTakeover: true }, reason: 'runtime-human-takeover' },
  ];

  for (const scenario of blocked) {
    it(`${scenario.name} refuses with ${scenario.reason} and zero model eligibility`, () => {
      const decided = decideAnishaTurn(turn(scenario.input));
      expect(decided.disposition).toBe('REFUSE');
      expect(decided.reason).toBe(scenario.reason);
      expect(decided.modelReplyEligible).toBe(false);
      expect(decided.intent).toBe('INSUFFICIENT_CONTEXT');
    });
  }

  it('pause outranks every commercial signal', () => {
    const decided = decideAnishaTurn(
      turn({
        aiPaused: true,
        signals: signals({ askedAboutPackageOrRecharge: true, hasPriorVendorContext: true }),
        context: context(),
      }),
    );
    expect(decided.disposition).toBe('REFUSE');
    expect(decided.modelReplyEligible).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// E-H. Dispositions.
// ---------------------------------------------------------------------------

describe('(E-H) every disposition maps exactly', () => {
  it('the disposition vocabulary is exactly the five expected values', () => {
    expect([...ANISHA_DISPOSITIONS_FROZEN]).toEqual([
      'DRAFT_REPLY',
      'CONTINUE_CLARIFICATION',
      'PROPOSE_VENDOR_FOLLOW_UP',
      'REQUEST_VENDOR_ESCALATION',
      'REFUSE',
    ]);
  });

  const cases: readonly {
    readonly name: string;
    readonly input: Partial<AnishaTurnInput>;
    readonly intent: VendorJourneyIntent;
    readonly disposition: string;
    readonly reason: string;
    readonly model: boolean;
  }[] = [
    {
      name: 'out of scope refuses',
      input: { signals: signals({ outOfVendorScope: true }) },
      intent: 'UNSUPPORTED_NON_VENDOR_REQUEST',
      disposition: 'REFUSE',
      reason: 'runtime-escalation-required',
      model: false,
    },
    {
      name: 'an escalation-required matter escalates',
      input: { signals: signals({ matterRequiresEscalation: true }) },
      intent: 'ESCALATION_REQUIRED_MATTER',
      disposition: 'REQUEST_VENDOR_ESCALATION',
      reason: 'runtime-escalation-required',
      model: false,
    },
    {
      name: 'a human request escalates',
      input: { signals: signals({ requestedHumanAssistance: true }) },
      intent: 'HUMAN_VENDOR_SUPPORT_REQUEST',
      disposition: 'REQUEST_VENDOR_ESCALATION',
      reason: 'runtime-escalation-required',
      model: false,
    },
    {
      name: 'a complaint is acknowledged',
      input: { signals: signals({ raisedComplaint: true }) },
      intent: 'COMPLAINT_INTAKE',
      disposition: 'DRAFT_REPLY',
      reason: 'runtime-assigned',
      model: true,
    },
    {
      name: 'a complaint needing human review escalates',
      input: {
        signals: signals({ raisedComplaint: true }),
        context: context({ completeness: 'HUMAN_REVIEW_REQUIRED' }),
      },
      intent: 'COMPLAINT_INTAKE',
      disposition: 'REQUEST_VENDOR_ESCALATION',
      reason: 'runtime-escalation-required',
      model: false,
    },
    {
      name: 'package readiness with sufficient context proposes a follow-up',
      input: { signals: signals({ askedAboutPackageOrRecharge: true }), context: context() },
      intent: 'PACKAGE_OR_RECHARGE_READINESS',
      disposition: 'PROPOSE_VENDOR_FOLLOW_UP',
      reason: 'runtime-assigned',
      model: true,
    },
    {
      name: 'package readiness with more context required clarifies',
      input: {
        signals: signals({ askedAboutPackageOrRecharge: true }),
        context: context({
          completeness: 'MORE_CONTEXT_REQUIRED',
          missingFields: ['VENDOR_STAGE'],
        }),
      },
      intent: 'PACKAGE_OR_RECHARGE_READINESS',
      disposition: 'CONTINUE_CLARIFICATION',
      reason: 'runtime-assigned',
      model: true,
    },
    {
      name: 'package readiness with no context clarifies',
      input: { signals: signals({ askedAboutPackageOrRecharge: true }) },
      intent: 'PACKAGE_OR_RECHARGE_READINESS',
      disposition: 'CONTINUE_CLARIFICATION',
      reason: 'runtime-assigned',
      model: true,
    },
    {
      name: 'package readiness needing human review escalates',
      input: {
        signals: signals({ askedAboutPackageOrRecharge: true }),
        context: context({ completeness: 'HUMAN_REVIEW_REQUIRED' }),
      },
      intent: 'PACKAGE_OR_RECHARGE_READINESS',
      disposition: 'REQUEST_VENDOR_ESCALATION',
      reason: 'runtime-escalation-required',
      model: false,
    },
    {
      name: 'onboarding guidance drafts a reply',
      input: { signals: signals({ askedAboutOnboardingOrProfile: true }) },
      intent: 'ONBOARDING_OR_PROFILE_GUIDANCE',
      disposition: 'DRAFT_REPLY',
      reason: 'runtime-assigned',
      model: true,
    },
    {
      name: 'onboarding guidance needing human review escalates',
      input: {
        signals: signals({ askedAboutOnboardingOrProfile: true }),
        context: context({ completeness: 'HUMAN_REVIEW_REQUIRED' }),
      },
      intent: 'ONBOARDING_OR_PROFILE_GUIDANCE',
      disposition: 'REQUEST_VENDOR_ESCALATION',
      reason: 'runtime-escalation-required',
      model: false,
    },
    {
      name: 'lead-response guidance drafts a reply',
      input: { signals: signals({ askedAboutLeadResponse: true }) },
      intent: 'LEAD_RESPONSE_GUIDANCE',
      disposition: 'DRAFT_REPLY',
      reason: 'runtime-assigned',
      model: true,
    },
    {
      name: 'lead-response guidance needing human review escalates',
      input: {
        signals: signals({ askedAboutLeadResponse: true }),
        context: context({ completeness: 'HUMAN_REVIEW_REQUIRED' }),
      },
      intent: 'LEAD_RESPONSE_GUIDANCE',
      disposition: 'REQUEST_VENDOR_ESCALATION',
      reason: 'runtime-escalation-required',
      model: false,
    },
    {
      name: 'a routine query drafts a reply',
      input: { signals: signals({ askedRoutineQuestion: true }) },
      intent: 'ROUTINE_VENDOR_QUERY',
      disposition: 'DRAFT_REPLY',
      reason: 'runtime-assigned',
      model: true,
    },
    {
      name: 'a routine query needing human review escalates',
      input: {
        signals: signals({ askedRoutineQuestion: true }),
        context: context({ completeness: 'HUMAN_REVIEW_REQUIRED' }),
      },
      intent: 'ROUTINE_VENDOR_QUERY',
      disposition: 'REQUEST_VENDOR_ESCALATION',
      reason: 'runtime-escalation-required',
      model: false,
    },
    {
      name: 'insufficient context clarifies',
      input: {},
      intent: 'INSUFFICIENT_CONTEXT',
      disposition: 'CONTINUE_CLARIFICATION',
      reason: 'runtime-assigned',
      model: true,
    },
  ];

  for (const scenario of cases) {
    it(scenario.name, () => {
      const decided = decideAnishaTurn(turn(scenario.input));
      expect(decided.intent).toBe(scenario.intent);
      expect(decided.disposition).toBe(scenario.disposition);
      expect(decided.reason).toBe(scenario.reason);
      expect(decided.modelReplyEligible).toBe(scenario.model);
      expect(decided.actor).toBe('ANISHA');
    });
  }

  it('every disposition is reachable', () => {
    const reached = new Set(cases.map((c) => decideAnishaTurn(turn(c.input)).disposition));
    expect([...reached].sort()).toEqual([...ANISHA_DISPOSITIONS_FROZEN].sort());
    expect(reached.size).toBe(ANISHA_DISPOSITIONS_FROZEN.length);
    // REFUSE is reachable by a role violation as well as by an out-of-scope request.
    expect(decideAnishaTurn(turn({ partyType: 'CLIENT' })).disposition).toBe('REFUSE');
  });

  it('an escalation signal outranks a complaint, and a package signal does not override one', () => {
    expect(
      decideAnishaTurn(
        turn({ signals: signals({ raisedComplaint: true, matterRequiresEscalation: true }) }),
      ).intent,
    ).toBe('ESCALATION_REQUIRED_MATTER');
    expect(
      decideAnishaTurn(
        turn({ signals: signals({ raisedComplaint: true, askedAboutPackageOrRecharge: true }) }),
      ).intent,
    ).toBe('COMPLAINT_INTAKE');
  });

  it('every model-ineligible path is genuinely model-ineligible', () => {
    for (const scenario of cases.filter((c) => !c.model)) {
      expect(decideAnishaTurn(turn(scenario.input)).modelReplyEligible).toBe(false);
    }
  });
});

// ---------------------------------------------------------------------------
// I. Band consistency.
// ---------------------------------------------------------------------------

describe('(I) the money-adjacent band must agree across both sources', () => {
  it('accepts matching bands', () => {
    const decided = decideAnishaTurn(
      turn({
        signals: signals({ askedAboutPackageOrRecharge: true, packageReadinessBand: 'critical' }),
        context: context({ packageReadinessBand: 'critical' }),
      }),
    );
    expect(decided.intent).toBe('PACKAGE_OR_RECHARGE_READINESS');
  });

  it('throws when the two sources disagree, rather than repairing or preferring one', () => {
    expect(() =>
      decideAnishaTurn(
        turn({
          signals: signals({ askedAboutPackageOrRecharge: true, packageReadinessBand: 'low' }),
          context: context({ packageReadinessBand: 'critical' }),
        }),
      ),
    ).toThrow(AnishaBehaviourError);
  });

  it('accepts either side alone', () => {
    expect(
      decideAnishaTurn(
        turn({
          signals: signals({ askedAboutPackageOrRecharge: true, packageReadinessBand: 'high' }),
          context: context(),
        }),
      ).modelReplyEligible,
    ).toBe(true);
    expect(
      decideAnishaTurn(
        turn({
          signals: signals({ askedAboutPackageOrRecharge: true }),
          context: context({ packageReadinessBand: 'high' }),
        }),
      ).modelReplyEligible,
    ).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// J-L. Determinism, prompt reference, errors.
// ---------------------------------------------------------------------------

describe('(J-L) determinism, the prompt boundary and error normalization', () => {
  it('identical input yields a deeply equal, frozen decision and mutates nothing', () => {
    const input = turn({ signals: signals({ askedRoutineQuestion: true }) });
    const snapshot = JSON.stringify(input);
    const a = decideAnishaTurn(input);
    const b = decideAnishaTurn(input);
    expect(a).toEqual(b);
    expect(Object.isFrozen(a)).toBe(true);
    expect(JSON.stringify(input)).toBe(snapshot);
    expect(a.behaviourVersion).toBe(ANISHA_BEHAVIOUR_VERSION);
    expect(a.behaviourVersion).toBe(1);
    expect(a.promptRef).toBe(PROMPT_REF);
  });

  it('retains the supplied frozen context on the decision', () => {
    const supplied = context({ vendorStageRef: 'stage.7' });
    const decided = decideAnishaTurn(turn({ context: supplied }));
    expect(decided.context).toBe(supplied);
    expect(Object.isFrozen(decided.context)).toBe(true);
  });

  it('rejects an empty, overlong, slashed or spaced prompt reference', () => {
    for (const bad of ['', 'x'.repeat(129), 'prompt/anisha', 'you are a helpful assistant']) {
      expect(() => decideAnishaTurn(turn({ promptRef: bad }))).toThrow(AnishaBehaviourError);
    }
    expect(decideAnishaTurn(turn({ promptRef: 'a' })).promptRef).toBe('a');
    expect(decideAnishaTurn(turn({ promptRef: 'p'.repeat(128) })).promptRef).toHaveLength(128);
  });

  it('rejects an unknown turn field and invalid signals', () => {
    expect(() =>
      decideAnishaTurn({ ...turn(), vendorId: 'v.1' } as unknown as AnishaTurnInput),
    ).toThrow(AnishaBehaviourError);
    expect(() =>
      decideAnishaTurn(turn({ signals: { hasPriorVendorContext: true } as VendorJourneySignals })),
    ).toThrow(AnishaBehaviourError);
  });

  it('normalizes errors to a closed code and a stable repository-owned message', () => {
    expect([...ANISHA_ERROR_CODES]).toEqual([
      'invalid-vendor-journey-context',
      'invalid-turn-input',
    ]);
    const turnError = new AnishaBehaviourError('invalid-turn-input');
    expect(turnError.code).toBe('invalid-turn-input');
    expect(turnError.message).toBe('An Anisha turn input is invalid.');
    expect(turnError.name).toBe('AnishaBehaviourError');
    expect(Object.isFrozen(turnError)).toBe(true);

    // No zod detail, no caller value, no path, no stack content in the public message.
    try {
      decideAnishaTurn(turn({ promptRef: 'leaked/value' }));
      throw new Error('expected a throw');
    } catch (error) {
      expect(error).toBeInstanceOf(AnishaBehaviourError);
      const message = (error as AnishaBehaviourError).message;
      expect(message).toBe('An Anisha turn input is invalid.');
      for (const forbidden of ['leaked', 'zod', 'invalid_string', 'promptRef', 'regex']) {
        expect(message).not.toContain(forbidden);
      }
    }
  });
});

// ---------------------------------------------------------------------------
// M-P. Containment, public API, frozen vocabularies.
// ---------------------------------------------------------------------------

describe('(M-P) authority containment, the public API and frozen vocabularies', () => {
  it('every exported vocabulary array is frozen and mutation-resistant', () => {
    const frozen = [
      VENDOR_JOURNEY_INTENTS_FROZEN,
      PACKAGE_READINESS_BANDS_FROZEN,
      VENDOR_JOURNEY_CONTEXT_COMPLETENESS_FROZEN,
      VENDOR_JOURNEY_CONTEXT_FIELDS_FROZEN,
      ANISHA_DISPOSITIONS_FROZEN,
      ANISHA_ERROR_CODES,
    ];
    for (const array of frozen) {
      expect(Object.isFrozen(array)).toBe(true);
      expect(() => (array as unknown as unknown[]).push('x')).toThrow();
    }
  });

  it('this package invokes nothing and can execute nothing', () => {
    const root = fileURLToPath(new URL('../', import.meta.url));
    const files: string[] = [];
    const walk = (dir: string): void => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = join(dir, entry.name);
        if (entry.isDirectory()) {
          walk(full);
        } else if (entry.name.endsWith('.ts') && !full.includes('tests')) {
          files.push(full);
        }
      }
    };
    walk(root);
    expect(files.length).toBeGreaterThan(0);
    for (const file of files) {
      // Comments legitimately EXPLAIN the forbidden powers, so they are stripped before the scan.
      const code = readFileSync(file, 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .split(String.fromCharCode(10))
        .filter((line) => !/^\s*\/\//.test(line))
        .join(String.fromCharCode(10));
      for (const forbidden of [
        'ModelReplyPort',
        'model-reply-adapter',
        'model-gateway',
        'core-decision-adapter',
        'jarvis-runtime',
        'riya-agent',
        'orchestrateInbound',
        'runAgentTurn',
        'createProposal',
        'PENDING_CORE_VALIDATION',
        'RuntimeProposal',
        'fetch(',
        'node:fs',
        'node:http',
        'child_process',
        'process.env',
        'retry',
        'fallback',
        'console.',
        'groq',
        'whatsapp',
        'n8n',
        'supabase',
        'walletBalance',
        'creditCount',
        'paymentStatus',
        'leadQualityScore',
      ]) {
        expect(code.toLowerCase()).not.toContain(forbidden.toLowerCase());
      }
    }
  });

  it('the root surface is exactly fourteen runtime symbols', async () => {
    const barrel = (await import('../index.js')) as unknown as Record<string, unknown>;
    expect(Object.keys(barrel).sort()).toEqual([
      'ANISHA_ACTOR',
      'ANISHA_BEHAVIOUR_VERSION',
      'ANISHA_DISPOSITIONS_FROZEN',
      'ANISHA_ERROR_CODES',
      'ANISHA_SUPPORTED_PARTY',
      'AnishaBehaviourError',
      'PACKAGE_READINESS_BANDS_FROZEN',
      'VENDOR_JOURNEY_CONTEXT_COMPLETENESS_FROZEN',
      'VENDOR_JOURNEY_CONTEXT_FIELDS_FROZEN',
      'VENDOR_JOURNEY_INTENTS_FROZEN',
      'classifyVendorJourneyIntent',
      'createVendorJourneyContext',
      'decideAnishaTurn',
      'isVendorJourneySignals',
    ]);
    expect(Object.keys(barrel)).toHaveLength(14);
    expect((barrel as { default?: unknown }).default).toBeUndefined();

    // No M1 proposal helper, and no provider/transport/execution symbol.
    for (const absent of [
      'createAnishaProposal',
      'proposalKindFor',
      'ANISHA_PROPOSAL_INTENTS_FROZEN',
      'createProposal',
      'orchestrateInbound',
      'runAgentTurn',
    ]) {
      expect(barrel[absent]).toBeUndefined();
    }
    for (const forbidden of [
      'groq',
      'whatsapp',
      'n8n',
      'http',
      'sql',
      'gateway',
      'wallet',
      'payment',
    ]) {
      expect(Object.keys(barrel).filter((k) => k.toLowerCase().includes(forbidden))).toEqual([]);
    }
  });

  it('the manifest declares exactly the two permitted dependencies', () => {
    const manifestPath = fileURLToPath(new URL('../../package.json', import.meta.url));
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as {
      name: string;
      dependencies: Record<string, string>;
    };
    expect(manifest.name).toBe('@qf-jarvis/anisha-agent');
    expect(Object.keys(manifest.dependencies).sort()).toEqual(['@qf-jarvis/agent-runtime', 'zod']);
  });
});
