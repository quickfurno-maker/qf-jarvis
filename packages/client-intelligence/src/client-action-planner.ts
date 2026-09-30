import {
  parseClientMatchRequest,
  parseClientReassignmentRequest,
  parseExtraVendorReviewRequest,
  type ClientMatchRequestV1,
  type ClientReassignmentRequestV1,
  type ExtraVendorReviewRequestV1,
} from '@qf-jarvis/contracts';

import type { ClientNextBestAction } from './contracts.js';

export const GOVERNED_CLIENT_ACTION_KINDS = [
  'CLIENT_MATCH_REQUEST',
  'CLIENT_REASSIGNMENT_REQUEST',
  'CLIENT_EXTRA_VENDOR_REVIEW_REQUEST',
] as const;

export type GovernedClientActionKind = (typeof GOVERNED_CLIENT_ACTION_KINDS)[number];

export type GovernedClientActionDraft =
  | { readonly kind: 'CLIENT_MATCH_REQUEST'; readonly payload: unknown }
  | { readonly kind: 'CLIENT_REASSIGNMENT_REQUEST'; readonly payload: unknown }
  | { readonly kind: 'CLIENT_EXTRA_VENDOR_REVIEW_REQUEST'; readonly payload: unknown };
export type GovernedClientActionPayload =
  ClientMatchRequestV1 | ClientReassignmentRequestV1 | ExtraVendorReviewRequestV1;

export interface GovernedClientActionProposalV1 {
  readonly version: 1;
  readonly source: 'RIYA_CLIENT_INTELLIGENCE';
  readonly actionKind: GovernedClientActionKind;
  readonly nextBestAction: ClientNextBestAction['action'];
  readonly payload: GovernedClientActionPayload;
  readonly requiresCoreDecision: true;
  readonly businessEffect: false;
  readonly executionAuthorized: false;
}

const EXPECTED_NBA: Readonly<Record<GovernedClientActionKind, ClientNextBestAction['action']>> =
  Object.freeze({
    CLIENT_MATCH_REQUEST: 'REQUEST_MATCH',
    CLIENT_REASSIGNMENT_REQUEST: 'REQUEST_REASSIGNMENT',
    CLIENT_EXTRA_VENDOR_REVIEW_REQUEST: 'REQUEST_EXTRA_VENDOR_REVIEW',
  });

function validateAuthority(action: ClientNextBestAction): void {
  const authority: Readonly<{
    requiresCoreDecision: boolean;
    businessEffect: boolean;
    executionAuthorized: boolean;
  }> = action;
  if (
    !authority.requiresCoreDecision ||
    authority.businessEffect ||
    authority.executionAuthorized
  ) {
    throw new TypeError('governed-client-action-authority-invalid');
  }
}
function parsePayload(draft: GovernedClientActionDraft): GovernedClientActionPayload {
  switch (draft.kind) {
    case 'CLIENT_MATCH_REQUEST':
      return parseClientMatchRequest(draft.payload);
    case 'CLIENT_REASSIGNMENT_REQUEST':
      return parseClientReassignmentRequest(draft.payload);
    case 'CLIENT_EXTRA_VENDOR_REVIEW_REQUEST':
      return parseExtraVendorReviewRequest(draft.payload);
  }
}

export function createGovernedClientActionProposalV1(input: {
  readonly nextBestAction: ClientNextBestAction;
  readonly draft: GovernedClientActionDraft;
}): GovernedClientActionProposalV1 {
  validateAuthority(input.nextBestAction);
  const expected = EXPECTED_NBA[input.draft.kind];
  if (input.nextBestAction.action !== expected) {
    throw new TypeError('governed-client-action-next-best-action-mismatch');
  }

  const payload = parsePayload(input.draft);
  return Object.freeze({
    version: 1 as const,
    source: 'RIYA_CLIENT_INTELLIGENCE' as const,
    actionKind: input.draft.kind,
    nextBestAction: input.nextBestAction.action,
    payload,
    requiresCoreDecision: true as const,
    businessEffect: false as const,
    executionAuthorized: false as const,
  });
}
