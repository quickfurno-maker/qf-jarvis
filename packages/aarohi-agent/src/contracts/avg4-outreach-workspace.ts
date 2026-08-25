/**
 * AVG-4 - Aarohi outreach workspace offline domain (ADR-0113).
 *
 * This file models three inert things only:
 * 1. a review item that shows canonical AVG-2 evidence beside AVG-3 priority and Core-gated contact eligibility;
 * 2. an immutable, human-reviewable draft lifecycle; and
 * 3. readiness to hand an OPEN draft to the repository's existing Core approval-request path later.
 *
 * Readiness is NOT an approval request. An approval request is NOT authorization. Authorization is NOT
 * execution. Aarohi owns none of those later decisions or effects.
 *
 * Pure domain only: no runtime, persistence, model call, network, provider, channel, credential or send path.
 */
import { z } from 'zod';

import { parseEnrichmentProfile } from './enrichment-profile.js';
import type { EnrichmentProfile } from './enrichment-profile.js';
import {
  evaluateAcquisitionContactEligibility,
  evaluateProspectPriority,
} from './avg3-scoring-eligibility.js';
import type {
  AcquisitionContactEligibilityVerdict,
  ProspectPriorityAssessment,
} from './avg3-scoring-eligibility.js';
import type { AcquisitionRefusalReason, CorePartyStatus } from './existing-vendor-gate.js';

/** Version of the complete AVG-4 offline workspace contract in this package. */
export const AAROHI_AVG4_CONTRACT_VERSION = 1 as const;
export type AarohiAvg4ContractVersion = typeof AAROHI_AVG4_CONTRACT_VERSION;

const OPAQUE_REF = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9._:-]+$/u);

const UTC_INSTANT_PATTERN = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{3}))?Z$/u;

function isCanonicalUtcInstant(value: string): boolean {
  const parts = UTC_INSTANT_PATTERN.exec(value);
  if (parts === null) return false;

  const year = Number(parts[1] ?? '');
  const month = Number(parts[2] ?? '');
  const day = Number(parts[3] ?? '');
  const hour = Number(parts[4] ?? '');
  const minute = Number(parts[5] ?? '');
  const second = Number(parts[6] ?? '');

  if (month < 1 || month > 12 || day < 1 || day > 31) return false;
  if (hour > 23 || minute > 59 || second > 59) return false;

  const roundTrip = new Date(Date.UTC(year, month - 1, day, hour, minute, second));
  return (
    roundTrip.getUTCFullYear() === year &&
    roundTrip.getUTCMonth() === month - 1 &&
    roundTrip.getUTCDate() === day
  );
}

const UTC_INSTANT = z.string().refine(isCanonicalUtcInstant);

/** Draft text is bounded because the workspace is a review surface, not an unbounded document store. */
export const MAX_WORKSPACE_DRAFT_LENGTH = 2_000;

function hasRefusedControlCharacter(value: string): boolean {
  for (const character of value) {
    const code = character.charCodeAt(0);
    if (
      (code >= 0 && code <= 8) ||
      code === 11 ||
      code === 12 ||
      (code >= 14 && code <= 31) ||
      code === 127
    ) {
      return true;
    }
  }
  return false;
}

const DRAFT_BODY = z
  .string()
  .min(1)
  .max(MAX_WORKSPACE_DRAFT_LENGTH)
  .refine((one: string) => one === one.trim())
  .refine((one: string) => !one.includes('\r'))
  .refine((one: string) => !hasRefusedControlCharacter(one));

function canonicalizeBody(value: string): string {
  return value.replace(/\r\n?/gu, '\n').trim();
}

/**
 * Draft state is deliberately missing APPROVED/SENT/EXECUTED.
 *
 * OPEN means editable and eligible for a readiness check. HELD is a human pause. REJECTED is terminal.
 * The actual approval lifecycle is owned by shared approval infrastructure and Core.
 */
export const WORKSPACE_DRAFT_STATES = ['OPEN', 'HELD', 'REJECTED'] as const;
export type WorkspaceDraftState = (typeof WORKSPACE_DRAFT_STATES)[number];

const DRAFT_TRANSITIONS: Readonly<Record<WorkspaceDraftState, readonly WorkspaceDraftState[]>> =
  Object.freeze({
    OPEN: Object.freeze(['HELD', 'REJECTED'] as const),
    HELD: Object.freeze(['OPEN', 'REJECTED'] as const),
    REJECTED: Object.freeze([] as const),
  });

const MAX_WORKSPACE_DRAFT_REVISION = 1_000;

export interface WorkspaceDraft {
  readonly contractVersion: AarohiAvg4ContractVersion;
  readonly draftRef: string;
  readonly prospectRef: string;
  readonly revision: number;
  readonly state: WorkspaceDraftState;
  readonly body: string;
  /** Opaque actor reference supplied by the caller; never an approval authority token. */
  readonly changedByRef: string;
  /** Caller-supplied canonical UTC instant; no clock is read here. */
  readonly changedAt: string;
}

/** Canonical schema for a built AVG-4 draft revision. */
export const workspaceDraftSchema = z
  .object({
    contractVersion: z.literal(AAROHI_AVG4_CONTRACT_VERSION),
    draftRef: OPAQUE_REF,
    prospectRef: OPAQUE_REF,
    revision: z.number().int().min(1).max(MAX_WORKSPACE_DRAFT_REVISION),
    state: z.enum(WORKSPACE_DRAFT_STATES),
    body: DRAFT_BODY,
    changedByRef: OPAQUE_REF,
    changedAt: UTC_INSTANT,
  })
  .strict();

export function parseWorkspaceDraft(value: unknown): WorkspaceDraft | undefined {
  const parsed = workspaceDraftSchema.safeParse(value);
  if (!parsed.success) return undefined;
  return Object.freeze({ ...parsed.data });
}

export const WORKSPACE_DRAFT_REFUSALS = [
  'DRAFT_INPUT_INVALID',
  'PROFILE_INVALID',
  'DRAFT_INVALID',
  'CHANGE_INPUT_INVALID',
  'BODY_INVALID',
  'BODY_UNCHANGED',
  'DRAFT_NOT_OPEN',
  'DRAFT_TERMINAL',
  'TRANSITION_NOT_PERMITTED',
  'REVISION_LIMIT_REACHED',
  'CHANGE_TIME_BEFORE_CURRENT',
] as const;
export type WorkspaceDraftRefusal = (typeof WORKSPACE_DRAFT_REFUSALS)[number];

export type WorkspaceDraftResult =
  | { readonly ok: true; readonly draft: WorkspaceDraft }
  | { readonly ok: false; readonly refusal: WorkspaceDraftRefusal };

const createDraftInputSchema = z
  .object({
    draftRef: OPAQUE_REF,
    profile: z.unknown(),
    body: z.string(),
    changedByRef: OPAQUE_REF,
    changedAt: UTC_INSTANT,
  })
  .strict();

export function createWorkspaceDraft(value: unknown): WorkspaceDraftResult {
  const parsed = createDraftInputSchema.safeParse(value);
  if (!parsed.success) {
    return Object.freeze({ ok: false as const, refusal: 'DRAFT_INPUT_INVALID' as const });
  }

  const profile = parseEnrichmentProfile(parsed.data.profile);
  if (profile === undefined) {
    return Object.freeze({ ok: false as const, refusal: 'PROFILE_INVALID' as const });
  }

  const body = canonicalizeBody(parsed.data.body);
  if (!DRAFT_BODY.safeParse(body).success) {
    return Object.freeze({ ok: false as const, refusal: 'BODY_INVALID' as const });
  }

  return Object.freeze({
    ok: true as const,
    draft: Object.freeze({
      contractVersion: AAROHI_AVG4_CONTRACT_VERSION,
      draftRef: parsed.data.draftRef,
      prospectRef: profile.prospectRef,
      revision: 1,
      state: 'OPEN' as const,
      body,
      changedByRef: parsed.data.changedByRef,
      changedAt: parsed.data.changedAt,
    }),
  });
}

const draftChangeInputSchema = z
  .object({
    body: z.string(),
    changedByRef: OPAQUE_REF,
    changedAt: UTC_INSTANT,
  })
  .strict();

const draftTransitionInputSchema = z
  .object({
    changedByRef: OPAQUE_REF,
    changedAt: UTC_INSTANT,
  })
  .strict();

function changeTimeIsBefore(current: WorkspaceDraft, nextInstant: string): boolean {
  return Date.parse(nextInstant) < Date.parse(current.changedAt);
}

export function reviseWorkspaceDraft(current: unknown, change: unknown): WorkspaceDraftResult {
  const draft = parseWorkspaceDraft(current);
  if (draft === undefined) {
    return Object.freeze({ ok: false as const, refusal: 'DRAFT_INVALID' as const });
  }
  if (draft.state !== 'OPEN') {
    return Object.freeze({ ok: false as const, refusal: 'DRAFT_NOT_OPEN' as const });
  }
  if (draft.revision >= MAX_WORKSPACE_DRAFT_REVISION) {
    return Object.freeze({ ok: false as const, refusal: 'REVISION_LIMIT_REACHED' as const });
  }

  const parsed = draftChangeInputSchema.safeParse(change);
  if (!parsed.success) {
    return Object.freeze({ ok: false as const, refusal: 'CHANGE_INPUT_INVALID' as const });
  }
  if (changeTimeIsBefore(draft, parsed.data.changedAt)) {
    return Object.freeze({ ok: false as const, refusal: 'CHANGE_TIME_BEFORE_CURRENT' as const });
  }

  const body = canonicalizeBody(parsed.data.body);
  if (!DRAFT_BODY.safeParse(body).success) {
    return Object.freeze({ ok: false as const, refusal: 'BODY_INVALID' as const });
  }
  if (body === draft.body) {
    return Object.freeze({ ok: false as const, refusal: 'BODY_UNCHANGED' as const });
  }

  return Object.freeze({
    ok: true as const,
    draft: Object.freeze({
      ...draft,
      revision: draft.revision + 1,
      body,
      changedByRef: parsed.data.changedByRef,
      changedAt: parsed.data.changedAt,
    }),
  });
}

export function transitionWorkspaceDraft(
  current: unknown,
  to: unknown,
  change: unknown,
): WorkspaceDraftResult {
  const draft = parseWorkspaceDraft(current);
  if (draft === undefined) {
    return Object.freeze({ ok: false as const, refusal: 'DRAFT_INVALID' as const });
  }
  if (draft.state === 'REJECTED') {
    return Object.freeze({ ok: false as const, refusal: 'DRAFT_TERMINAL' as const });
  }
  if (draft.revision >= MAX_WORKSPACE_DRAFT_REVISION) {
    return Object.freeze({ ok: false as const, refusal: 'REVISION_LIMIT_REACHED' as const });
  }

  const target = z.enum(WORKSPACE_DRAFT_STATES).safeParse(to);
  const parsed = draftTransitionInputSchema.safeParse(change);
  if (!target.success || !parsed.success) {
    return Object.freeze({ ok: false as const, refusal: 'CHANGE_INPUT_INVALID' as const });
  }
  if (!DRAFT_TRANSITIONS[draft.state].includes(target.data)) {
    return Object.freeze({ ok: false as const, refusal: 'TRANSITION_NOT_PERMITTED' as const });
  }
  if (changeTimeIsBefore(draft, parsed.data.changedAt)) {
    return Object.freeze({ ok: false as const, refusal: 'CHANGE_TIME_BEFORE_CURRENT' as const });
  }

  return Object.freeze({
    ok: true as const,
    draft: Object.freeze({
      ...draft,
      revision: draft.revision + 1,
      state: target.data,
      changedByRef: parsed.data.changedByRef,
      changedAt: parsed.data.changedAt,
    }),
  });
}

export interface WorkspaceReviewItem {
  readonly contractVersion: AarohiAvg4ContractVersion;
  readonly prospectRef: string;
  readonly profile: EnrichmentProfile;
  readonly priority: ProspectPriorityAssessment;
  readonly contactEligibility: AcquisitionContactEligibilityVerdict;
}

export type WorkspaceReviewResult =
  | { readonly ok: true; readonly item: WorkspaceReviewItem }
  | { readonly ok: false; readonly refusal: 'PROFILE_INVALID' };

export function buildWorkspaceReviewItem(
  profile: unknown,
  coreObservation: unknown,
): WorkspaceReviewResult {
  const parsed = parseEnrichmentProfile(profile);
  if (parsed === undefined) {
    return Object.freeze({ ok: false as const, refusal: 'PROFILE_INVALID' as const });
  }

  const priority = evaluateProspectPriority(parsed);
  if (!priority.ok) {
    return Object.freeze({ ok: false as const, refusal: 'PROFILE_INVALID' as const });
  }

  const contactEligibility = evaluateAcquisitionContactEligibility(parsed, coreObservation);

  return Object.freeze({
    ok: true as const,
    item: Object.freeze({
      contractVersion: AAROHI_AVG4_CONTRACT_VERSION,
      prospectRef: parsed.prospectRef,
      profile: parsed,
      priority: priority.assessment,
      contactEligibility,
    }),
  });
}

/**
 * A positive readiness result says only that this OPEN draft may be handed to the existing Core
 * approval-request path. It does not create ApprovalRequestV1, does not mark anything approved and does
 * not confer communication authorization.
 */
export const WORKSPACE_APPROVAL_READINESS_OUTCOME = 'READY_FOR_CORE_APPROVAL_REQUEST' as const;
export type WorkspaceApprovalReadinessOutcome = typeof WORKSPACE_APPROVAL_READINESS_OUTCOME;

export const WORKSPACE_APPROVAL_READINESS_REFUSALS = [
  'DRAFT_INVALID',
  'PROFILE_INVALID',
  'PROSPECT_MISMATCH',
  'DRAFT_NOT_OPEN',
  'CORE_GATE_REFUSED',
] as const;
export type WorkspaceApprovalReadinessRefusal =
  (typeof WORKSPACE_APPROVAL_READINESS_REFUSALS)[number];

export type WorkspaceApprovalReadiness =
  | {
      readonly contractVersion: AarohiAvg4ContractVersion;
      readonly ready: true;
      readonly outcome: WorkspaceApprovalReadinessOutcome;
      readonly prospectRef: string;
      readonly draftRef: string;
      readonly draftRevision: number;
      readonly coreStatus: CorePartyStatus;
    }
  | {
      readonly contractVersion: AarohiAvg4ContractVersion;
      readonly ready: false;
      readonly refusal: Exclude<WorkspaceApprovalReadinessRefusal, 'CORE_GATE_REFUSED'>;
    }
  | {
      readonly contractVersion: AarohiAvg4ContractVersion;
      readonly ready: false;
      readonly refusal: 'CORE_GATE_REFUSED';
      readonly coreReason: AcquisitionRefusalReason;
    };

export function evaluateWorkspaceApprovalReadiness(
  draftValue: unknown,
  profileValue: unknown,
  coreObservation: unknown,
): WorkspaceApprovalReadiness {
  const draft = parseWorkspaceDraft(draftValue);
  if (draft === undefined) {
    return Object.freeze({
      contractVersion: AAROHI_AVG4_CONTRACT_VERSION,
      ready: false as const,
      refusal: 'DRAFT_INVALID' as const,
    });
  }

  const profile = parseEnrichmentProfile(profileValue);
  if (profile === undefined) {
    return Object.freeze({
      contractVersion: AAROHI_AVG4_CONTRACT_VERSION,
      ready: false as const,
      refusal: 'PROFILE_INVALID' as const,
    });
  }

  if (draft.prospectRef !== profile.prospectRef) {
    return Object.freeze({
      contractVersion: AAROHI_AVG4_CONTRACT_VERSION,
      ready: false as const,
      refusal: 'PROSPECT_MISMATCH' as const,
    });
  }

  if (draft.state !== 'OPEN') {
    return Object.freeze({
      contractVersion: AAROHI_AVG4_CONTRACT_VERSION,
      ready: false as const,
      refusal: 'DRAFT_NOT_OPEN' as const,
    });
  }

  const eligibility = evaluateAcquisitionContactEligibility(profile, coreObservation);
  if (!eligibility.eligible) {
    if (eligibility.refusal === 'PROFILE_INVALID') {
      return Object.freeze({
        contractVersion: AAROHI_AVG4_CONTRACT_VERSION,
        ready: false as const,
        refusal: 'PROFILE_INVALID' as const,
      });
    }
    return Object.freeze({
      contractVersion: AAROHI_AVG4_CONTRACT_VERSION,
      ready: false as const,
      refusal: 'CORE_GATE_REFUSED' as const,
      coreReason: eligibility.coreReason,
    });
  }

  return Object.freeze({
    contractVersion: AAROHI_AVG4_CONTRACT_VERSION,
    ready: true as const,
    outcome: WORKSPACE_APPROVAL_READINESS_OUTCOME,
    prospectRef: profile.prospectRef,
    draftRef: draft.draftRef,
    draftRevision: draft.revision,
    coreStatus: eligibility.coreStatus,
  });
}
