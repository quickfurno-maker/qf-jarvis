import { describe, expect, it } from 'vitest';

import {
  AAROHI_AVG4_CONTRACT_VERSION,
  MAX_WORKSPACE_DRAFT_LENGTH,
  WORKSPACE_APPROVAL_READINESS_OUTCOME,
  WORKSPACE_DRAFT_STATES,
  buildWorkspaceReviewItem,
  createEnrichmentClaim,
  createEnrichmentProfile,
  createWorkspaceDraft,
  evaluateProspectPriority,
  evaluateWorkspaceApprovalReadiness,
  parseWorkspaceDraft,
  reviseWorkspaceDraft,
  transitionWorkspaceDraft,
  workspaceDraftSchema,
} from '../index.js';
import type {
  CorePartyStatus,
  EnrichmentAttribute,
  EnrichmentClaim,
  EnrichmentProfile,
  WorkspaceDraft,
} from '../index.js';

const PROSPECT = 'prospect.avg4.alpha';
const OTHER_PROSPECT = 'prospect.avg4.beta';
const CREATED_AT = '2026-08-25T03:30:00Z';
const LATER = '2026-08-25T03:30:01Z';
const LATER_2 = '2026-08-25T03:30:02Z';

function claim(attribute: EnrichmentAttribute, value: string): EnrichmentClaim {
  const built = createEnrichmentClaim({
    prospectRef: PROSPECT,
    attribute,
    value,
    source: { kind: 'MANUAL_REVIEW', sourceRef: `avg4-${attribute.toLowerCase()}` },
    observedAt: CREATED_AT,
    evidenceQuality: 'UNVERIFIED_OPERATOR_ENTERED',
  });
  if (!built.ok) throw new Error(`claim fixture refused: ${built.refusal}`);
  return built.claim;
}

function makeProfile(
  prospectRef = PROSPECT,
  claims: readonly EnrichmentClaim[] = [],
): EnrichmentProfile {
  const adjusted = claims.map((one) =>
    one.prospectRef === prospectRef ? one : { ...one, prospectRef },
  );
  const built = createEnrichmentProfile(prospectRef, adjusted);
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

function openDraft(profile = makeProfile()): WorkspaceDraft {
  const result = createWorkspaceDraft({
    draftRef: 'draft.avg4.alpha',
    profile,
    body: 'Hello from QuickFurno.',
    changedByRef: 'operator.founder',
    changedAt: CREATED_AT,
  });
  if (!result.ok) throw new Error(`draft fixture refused: ${result.refusal}`);
  return result.draft;
}

const fullEvidence = (): readonly EnrichmentClaim[] => [
  claim('BUSINESS_DISPLAY_NAME', 'Alpha Interiors'),
  claim('BUSINESS_CATEGORY_LABEL', 'Interior Design'),
  claim('SERVICE_LABEL', 'Modular Kitchen'),
  claim('CITY_LABEL', 'Pune'),
  claim('LOCALITY_LABEL', 'Kharadi'),
  claim('BUSINESS_DESCRIPTION', 'Residential interior studio'),
  claim('WEBSITE_PRESENCE', 'OBSERVED'),
  claim('PUBLIC_SOCIAL_PRESENCE', 'OBSERVED'),
  claim('PORTFOLIO_SIGNAL', 'OBSERVED'),
];

describe('AVG-4 review items keep evidence, priority and Core permission visibly separate', () => {
  it('builds one frozen review item from canonical evidence', () => {
    const profile = makeProfile();
    const result = buildWorkspaceReviewItem(profile, observation('NOT_REGISTERED'));
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.item.contractVersion).toBe(AAROHI_AVG4_CONTRACT_VERSION);
    expect(result.item.prospectRef).toBe(PROSPECT);
    expect(result.item.profile).toStrictEqual(profile);
    expect(result.item.priority.points).toBe(0);
    expect(result.item.contactEligibility).toMatchObject({
      eligible: true,
      coreStatus: 'NOT_REGISTERED',
    });
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.item)).toBe(true);
  });

  it('keeps maximum evidence priority refused when Core says DO_NOT_CONTACT', () => {
    const profile = makeProfile(PROSPECT, fullEvidence());
    const result = buildWorkspaceReviewItem(profile, observation('DO_NOT_CONTACT'));
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.item.priority.points).toBe(9);
    expect(result.item.contactEligibility).toMatchObject({
      eligible: false,
      refusal: 'CORE_GATE_REFUSED',
      coreReason: 'CORE_SUPPRESSED',
    });
  });

  it('keeps a zero-point profile eligible when Core says NOT_REGISTERED', () => {
    const result = buildWorkspaceReviewItem(makeProfile(), observation('NOT_REGISTERED'));
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.item.priority.points).toBe(0);
    expect(result.item.contactEligibility).toMatchObject({
      eligible: true,
      coreStatus: 'NOT_REGISTERED',
    });
  });

  it('keeps a malformed or cross-prospect Core observation as a refusal inside a reviewable item', () => {
    for (const core of [{}, observation('NOT_REGISTERED', OTHER_PROSPECT)]) {
      const result = buildWorkspaceReviewItem(makeProfile(), core);
      expect(result.ok).toBe(true);
      if (!result.ok) continue;
      expect(result.item.contactEligibility).toMatchObject({
        eligible: false,
        refusal: 'CORE_GATE_REFUSED',
        coreReason: 'OBSERVATION_INVALID',
      });
    }
  });

  it('refuses a non-canonical profile rather than making a workspace item from it', () => {
    expect(
      buildWorkspaceReviewItem(
        { prospectRef: PROSPECT, claims: [] },
        observation('NOT_REGISTERED'),
      ),
    ).toStrictEqual({ ok: false, refusal: 'PROFILE_INVALID' });
  });
});

describe('AVG-4 drafts are inert, immutable workspace revisions', () => {
  it('creates revision 1 OPEN and canonicalises line endings and outer whitespace', () => {
    const result = createWorkspaceDraft({
      draftRef: 'draft.avg4.alpha',
      profile: makeProfile(),
      body: '  Hello.\r\nSecond line.  ',
      changedByRef: 'operator.founder',
      changedAt: CREATED_AT,
    });
    expect(result).toStrictEqual({
      ok: true,
      draft: {
        contractVersion: AAROHI_AVG4_CONTRACT_VERSION,
        draftRef: 'draft.avg4.alpha',
        prospectRef: PROSPECT,
        revision: 1,
        state: 'OPEN',
        body: 'Hello.\nSecond line.',
        changedByRef: 'operator.founder',
        changedAt: CREATED_AT,
      },
    });
    if (!result.ok) return;
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.draft)).toBe(true);
    expect(workspaceDraftSchema.safeParse(result.draft).success).toBe(true);
  });

  it('publishes no APPROVED, SENT or EXECUTED draft state', () => {
    expect(WORKSPACE_DRAFT_STATES).toStrictEqual(['OPEN', 'HELD', 'REJECTED']);
    expect(WORKSPACE_DRAFT_STATES.join('|')).not.toMatch(/APPROVED|SENT|EXECUTED/u);
  });

  it('strictly refuses authority, destination, channel and provider-shaped extra input fields', () => {
    for (const extra of [
      { approved: true },
      { approvalDecision: 'APPROVED' },
      { destination: 'someone' },
      { channel: 'some-channel' },
      { provider: 'some-provider' },
      { recipient: 'someone' },
    ]) {
      const result = createWorkspaceDraft({
        draftRef: 'draft.avg4.alpha',
        profile: makeProfile(),
        body: 'Hello.',
        changedByRef: 'operator.founder',
        changedAt: CREATED_AT,
        ...extra,
      });
      expect(result).toStrictEqual({ ok: false, refusal: 'DRAFT_INPUT_INVALID' });
    }
  });

  it('refuses invalid profile, ref, actor or timestamp input', () => {
    const base = {
      draftRef: 'draft.avg4.alpha',
      profile: makeProfile(),
      body: 'Hello.',
      changedByRef: 'operator.founder',
      changedAt: CREATED_AT,
    };
    for (const candidate of [
      { ...base, profile: { prospectRef: PROSPECT, claims: [] } },
      { ...base, draftRef: 'has space' },
      { ...base, changedByRef: 'has space' },
      { ...base, changedAt: '2026-02-31T00:00:00Z' },
    ]) {
      expect(createWorkspaceDraft(candidate).ok).toBe(false);
    }
  });

  it('bounds and validates the canonical body', () => {
    expect(
      createWorkspaceDraft({
        draftRef: 'draft.avg4.alpha',
        profile: makeProfile(),
        body: '   ',
        changedByRef: 'operator.founder',
        changedAt: CREATED_AT,
      }),
    ).toStrictEqual({ ok: false, refusal: 'BODY_INVALID' });

    expect(
      createWorkspaceDraft({
        draftRef: 'draft.avg4.alpha',
        profile: makeProfile(),
        body: 'x'.repeat(MAX_WORKSPACE_DRAFT_LENGTH + 1),
        changedByRef: 'operator.founder',
        changedAt: CREATED_AT,
      }),
    ).toStrictEqual({ ok: false, refusal: 'BODY_INVALID' });
  });

  it('parses only canonical built revisions and rejects forged keys or states', () => {
    const draft = openDraft();
    expect(parseWorkspaceDraft(draft)).toStrictEqual(draft);
    expect(parseWorkspaceDraft({ ...draft, approved: true })).toBeUndefined();
    expect(parseWorkspaceDraft({ ...draft, state: 'APPROVED' })).toBeUndefined();
    expect(parseWorkspaceDraft({ ...draft, revision: 0 })).toBeUndefined();
    expect(parseWorkspaceDraft({ ...draft, contractVersion: 99 })).toBeUndefined();
  });

  it('revises only OPEN drafts and increments the immutable revision', () => {
    const first = openDraft();
    const result = reviseWorkspaceDraft(first, {
      body: 'Revised introduction.',
      changedByRef: 'operator.founder',
      changedAt: LATER,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(first.revision).toBe(1);
    expect(first.body).toBe('Hello from QuickFurno.');
    expect(result.draft).toMatchObject({
      draftRef: first.draftRef,
      prospectRef: PROSPECT,
      revision: 2,
      state: 'OPEN',
      body: 'Revised introduction.',
      changedByRef: 'operator.founder',
      changedAt: LATER,
    });
  });

  it('refuses no-op revisions and time moving backwards', () => {
    const draft = openDraft();
    expect(
      reviseWorkspaceDraft(draft, {
        body: draft.body,
        changedByRef: 'operator.founder',
        changedAt: LATER,
      }),
    ).toStrictEqual({ ok: false, refusal: 'BODY_UNCHANGED' });

    expect(
      reviseWorkspaceDraft(draft, {
        body: 'Different.',
        changedByRef: 'operator.founder',
        changedAt: '2026-08-25T03:29:59Z',
      }),
    ).toStrictEqual({ ok: false, refusal: 'CHANGE_TIME_BEFORE_CURRENT' });
  });

  it('supports OPEN -> HELD -> OPEN without creating any approval state', () => {
    const first = openDraft();
    const held = transitionWorkspaceDraft(first, 'HELD', {
      changedByRef: 'operator.founder',
      changedAt: LATER,
    });
    expect(held.ok).toBe(true);
    if (!held.ok) return;
    expect(held.draft).toMatchObject({ revision: 2, state: 'HELD', body: first.body });

    const reopened = transitionWorkspaceDraft(held.draft, 'OPEN', {
      changedByRef: 'operator.founder',
      changedAt: LATER_2,
    });
    expect(reopened.ok).toBe(true);
    if (!reopened.ok) return;
    expect(reopened.draft).toMatchObject({ revision: 3, state: 'OPEN', body: first.body });
  });

  it('makes REJECTED terminal and refuses an invalid transition', () => {
    const first = openDraft();
    expect(
      transitionWorkspaceDraft(first, 'OPEN', {
        changedByRef: 'operator.founder',
        changedAt: LATER,
      }),
    ).toStrictEqual({ ok: false, refusal: 'TRANSITION_NOT_PERMITTED' });

    const rejected = transitionWorkspaceDraft(first, 'REJECTED', {
      changedByRef: 'operator.founder',
      changedAt: LATER,
    });
    expect(rejected.ok).toBe(true);
    if (!rejected.ok) return;

    expect(
      transitionWorkspaceDraft(rejected.draft, 'OPEN', {
        changedByRef: 'operator.founder',
        changedAt: LATER_2,
      }),
    ).toStrictEqual({ ok: false, refusal: 'DRAFT_TERMINAL' });
  });

  it('requires a draft to be OPEN before it can be revised', () => {
    const held = transitionWorkspaceDraft(openDraft(), 'HELD', {
      changedByRef: 'operator.founder',
      changedAt: LATER,
    });
    if (!held.ok) throw new Error('hold must succeed');

    expect(
      reviseWorkspaceDraft(held.draft, {
        body: 'Changed while held.',
        changedByRef: 'operator.founder',
        changedAt: LATER_2,
      }),
    ).toStrictEqual({ ok: false, refusal: 'DRAFT_NOT_OPEN' });
  });
});

describe('AVG-4 readiness stops at the shared Core approval-request boundary', () => {
  it('returns READY_FOR_CORE_APPROVAL_REQUEST only for an OPEN matching draft with fresh Core eligibility', () => {
    expect(
      evaluateWorkspaceApprovalReadiness(openDraft(), makeProfile(), observation('NOT_REGISTERED')),
    ).toStrictEqual({
      contractVersion: AAROHI_AVG4_CONTRACT_VERSION,
      ready: true,
      outcome: WORKSPACE_APPROVAL_READINESS_OUTCOME,
      prospectRef: PROSPECT,
      draftRef: 'draft.avg4.alpha',
      draftRevision: 1,
      coreStatus: 'NOT_REGISTERED',
    });
  });

  it('the positive result carries no approval decision, execution intent, destination or send authority', () => {
    const result = evaluateWorkspaceApprovalReadiness(
      openDraft(),
      makeProfile(),
      observation('NOT_REGISTERED'),
    );
    expect(result.ready).toBe(true);
    const keys = Object.keys(result).sort();
    expect(keys).toStrictEqual([
      'contractVersion',
      'coreStatus',
      'draftRef',
      'draftRevision',
      'outcome',
      'prospectRef',
      'ready',
    ]);
    expect(JSON.stringify(result)).not.toMatch(
      /"approved"|"decision"|"destination"|"channel"|"provider"|"send"/iu,
    );
  });

  it('fails closed for held and rejected drafts', () => {
    const held = transitionWorkspaceDraft(openDraft(), 'HELD', {
      changedByRef: 'operator.founder',
      changedAt: LATER,
    });
    if (!held.ok) throw new Error('hold must succeed');

    const rejected = transitionWorkspaceDraft(openDraft(), 'REJECTED', {
      changedByRef: 'operator.founder',
      changedAt: LATER,
    });
    if (!rejected.ok) throw new Error('reject must succeed');

    for (const draft of [held.draft, rejected.draft]) {
      expect(
        evaluateWorkspaceApprovalReadiness(draft, makeProfile(), observation('NOT_REGISTERED')),
      ).toMatchObject({ ready: false, refusal: 'DRAFT_NOT_OPEN' });
    }
  });

  it('fails closed when draft and canonical profile describe different prospects', () => {
    const other = makeProfile(OTHER_PROSPECT);
    expect(
      evaluateWorkspaceApprovalReadiness(
        openDraft(),
        other,
        observation('NOT_REGISTERED', OTHER_PROSPECT),
      ),
    ).toStrictEqual({
      contractVersion: AAROHI_AVG4_CONTRACT_VERSION,
      ready: false,
      refusal: 'PROSPECT_MISMATCH',
    });
  });

  it('rechecks Core and propagates suppression rather than trusting an earlier review', () => {
    const profile = makeProfile();
    const review = buildWorkspaceReviewItem(profile, observation('NOT_REGISTERED'));
    expect(review.ok && review.item.contactEligibility.eligible).toBe(true);

    expect(
      evaluateWorkspaceApprovalReadiness(
        openDraft(profile),
        profile,
        observation('DO_NOT_CONTACT'),
      ),
    ).toMatchObject({
      ready: false,
      refusal: 'CORE_GATE_REFUSED',
      coreReason: 'CORE_SUPPRESSED',
    });
  });

  it('fails closed on unresolved, malformed and cross-prospect Core truth', () => {
    for (const core of [
      observation('UNKNOWN'),
      observation('CORE_UNAVAILABLE'),
      {},
      observation('NOT_REGISTERED', OTHER_PROSPECT),
    ]) {
      const result = evaluateWorkspaceApprovalReadiness(openDraft(), makeProfile(), core);
      expect(result.ready).toBe(false);
      if (!result.ready && result.refusal === 'CORE_GATE_REFUSED') {
        expect(result.coreReason).toMatch(/CORE_TRUTH_UNRESOLVED|OBSERVATION_INVALID/u);
      }
    }
  });

  it('priority cannot grant readiness: 9/9 plus DO_NOT_CONTACT still fails', () => {
    const profile = makeProfile(PROSPECT, fullEvidence());
    const priority = evaluateProspectPriority(profile);
    expect(priority.ok).toBe(true);
    if (!priority.ok) return;
    expect(priority.assessment.points).toBe(9);

    expect(
      evaluateWorkspaceApprovalReadiness(
        openDraft(profile),
        profile,
        observation('DO_NOT_CONTACT'),
      ),
    ).toMatchObject({
      ready: false,
      refusal: 'CORE_GATE_REFUSED',
      coreReason: 'CORE_SUPPRESSED',
    });
  });

  it('low priority cannot create a refusal: 0/9 plus NOT_REGISTERED is ready', () => {
    const profile = makeProfile();
    const priority = evaluateProspectPriority(profile);
    expect(priority.ok).toBe(true);
    if (!priority.ok) return;
    expect(priority.assessment.points).toBe(0);

    expect(
      evaluateWorkspaceApprovalReadiness(
        openDraft(profile),
        profile,
        observation('NOT_REGISTERED'),
      ),
    ).toMatchObject({
      ready: true,
      outcome: WORKSPACE_APPROVAL_READINESS_OUTCOME,
    });
  });

  it('keeps review, draft and readiness APIs structurally separate', () => {
    expect(buildWorkspaceReviewItem.length).toBe(2);
    expect(createWorkspaceDraft.length).toBe(1);
    expect(reviseWorkspaceDraft.length).toBe(2);
    expect(transitionWorkspaceDraft.length).toBe(3);
    expect(evaluateWorkspaceApprovalReadiness.length).toBe(3);
  });
});
