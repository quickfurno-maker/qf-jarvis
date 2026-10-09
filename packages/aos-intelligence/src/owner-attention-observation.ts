import { AOS_RECOMMENDATION_ACTIONS, type AosRecommendationAction } from './contracts.js';
import {
  AOS_ATTENTION_LANES,
  type AosAttentionLane,
  type AosOwnerAttentionItem,
} from './attention.js';
import { AOS_PRIORITIES, type AosPriority } from './contracts.js';

const REF = /^[A-Za-z0-9._:-]{1,128}$/u;
const CONTACT_LIKE_DIGITS = /\d{7,}/u;
const REASON = /^[A-Z0-9_:-]{1,96}$/u;
const MAX_ITEMS = 200;
const MAX_REASONS = 12;

export interface AosOwnerAttentionObservationItem extends AosOwnerAttentionItem {
  readonly recommendationAction?: AosRecommendationAction;
}

export interface AosOwnerAttentionObservation {
  readonly protocol: 'qfj.aos.owner-attention-observation.v1';
  readonly cycleId: string;
  readonly emittedAt: string;
  readonly mode: 'SHADOW';
  readonly items: readonly AosOwnerAttentionObservationItem[];
  readonly outboundNotificationAuthorized: false;
  readonly executionAuthority: 'NONE';
  readonly businessEffect: false;
}

function validInstant(value: string): boolean {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) && new Date(parsed).toISOString() === value;
}

function validPriority(value: unknown): value is AosPriority {
  return typeof value === 'string' && AOS_PRIORITIES.includes(value as AosPriority);
}

function validLane(value: unknown): value is AosAttentionLane {
  return typeof value === 'string' && AOS_ATTENTION_LANES.includes(value as AosAttentionLane);
}

function validAction(value: unknown): value is AosRecommendationAction {
  return (
    typeof value === 'string' &&
    AOS_RECOMMENDATION_ACTIONS.includes(value as AosRecommendationAction)
  );
}

function parseItem(input: unknown): AosOwnerAttentionObservationItem {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) {
    throw new TypeError('aos-owner-attention-observation-item-invalid');
  }
  const raw = input as Readonly<Record<string, unknown>>;
  const keys = Object.keys(raw).sort();
  const allowed = [
    'attentionScore',
    'businessEffect',
    'caseId',
    'executionAuthority',
    'lane',
    'priority',
    'reasonCodes',
    'recommendationAction',
    'requiresOwnerReview',
  ].sort();
  if (keys.some((key) => !allowed.includes(key))) {
    throw new TypeError('aos-owner-attention-observation-item-invalid');
  }
  if (
    typeof raw['caseId'] !== 'string' ||
    !REF.test(raw['caseId']) ||
    CONTACT_LIKE_DIGITS.test(raw['caseId']) ||
    !validPriority(raw['priority']) ||
    !validLane(raw['lane']) ||
    !Number.isInteger(raw['attentionScore']) ||
    (raw['attentionScore'] as number) < 0 ||
    (raw['attentionScore'] as number) > 100 ||
    !Array.isArray(raw['reasonCodes']) ||
    raw['reasonCodes'].length > MAX_REASONS ||
    raw['reasonCodes'].some((reason) => typeof reason !== 'string' || !REASON.test(reason)) ||
    typeof raw['requiresOwnerReview'] !== 'boolean' ||
    raw['executionAuthority'] !== 'NONE' ||
    raw['businessEffect'] !== false ||
    (raw['recommendationAction'] !== undefined && !validAction(raw['recommendationAction']))
  ) {
    throw new TypeError('aos-owner-attention-observation-item-invalid');
  }

  return Object.freeze({
    caseId: raw['caseId'],
    priority: raw['priority'],
    lane: raw['lane'],
    attentionScore: raw['attentionScore'] as number,
    reasonCodes: Object.freeze([...(raw['reasonCodes'] as string[])]),
    requiresOwnerReview: raw['requiresOwnerReview'],
    ...(raw['recommendationAction'] === undefined
      ? {}
      : { recommendationAction: raw['recommendationAction'] }),
    executionAuthority: 'NONE' as const,
    businessEffect: false as const,
  });
}

export function parseAosOwnerAttentionObservation(input: unknown): AosOwnerAttentionObservation {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) {
    throw new TypeError('aos-owner-attention-observation-invalid');
  }
  const raw = input as Readonly<Record<string, unknown>>;
  const exactKeys = [
    'businessEffect',
    'cycleId',
    'emittedAt',
    'executionAuthority',
    'items',
    'mode',
    'outboundNotificationAuthorized',
    'protocol',
  ].sort();
  if (
    Object.keys(raw).sort().join('|') !== exactKeys.join('|') ||
    raw['protocol'] !== 'qfj.aos.owner-attention-observation.v1' ||
    typeof raw['cycleId'] !== 'string' ||
    !REF.test(raw['cycleId']) ||
    typeof raw['emittedAt'] !== 'string' ||
    !validInstant(raw['emittedAt']) ||
    raw['mode'] !== 'SHADOW' ||
    !Array.isArray(raw['items']) ||
    raw['items'].length > MAX_ITEMS ||
    raw['outboundNotificationAuthorized'] !== false ||
    raw['executionAuthority'] !== 'NONE' ||
    raw['businessEffect'] !== false
  ) {
    throw new TypeError('aos-owner-attention-observation-invalid');
  }

  const items = Object.freeze(raw['items'].map(parseItem));
  return Object.freeze({
    protocol: 'qfj.aos.owner-attention-observation.v1' as const,
    cycleId: raw['cycleId'],
    emittedAt: raw['emittedAt'],
    mode: 'SHADOW' as const,
    items,
    outboundNotificationAuthorized: false as const,
    executionAuthority: 'NONE' as const,
    businessEffect: false as const,
  });
}

export function createAosOwnerAttentionObservation(input: {
  readonly cycleId: string;
  readonly emittedAt: string;
  readonly items: readonly AosOwnerAttentionObservationItem[];
}): AosOwnerAttentionObservation {
  return parseAosOwnerAttentionObservation({
    protocol: 'qfj.aos.owner-attention-observation.v1',
    cycleId: input.cycleId,
    emittedAt: input.emittedAt,
    mode: 'SHADOW',
    items: input.items,
    outboundNotificationAuthorized: false,
    executionAuthority: 'NONE',
    businessEffect: false,
  });
}
