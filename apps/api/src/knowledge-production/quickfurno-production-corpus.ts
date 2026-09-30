import { createHash } from 'node:crypto';

import {
  normalizeSourceDocument,
  type KnowledgeSourceDocumentInput,
} from '@qf-jarvis/knowledge-ingestion';

import { KNOWLEDGE_FRESHNESS_SOURCE_MANIFEST_PROTOCOL } from '../knowledge-freshness/create-manifest-source-port.js';

/**
 * First curated QuickFurno production knowledge corpus.
 *
 * Business text is copied only from the current production QuickFurno source-of-truth files pinned by
 * QUICKFURNO_KNOWLEDGE_SOURCE_REVISION. Volatile operational facts (prices, packages, credits,
 * availability, lead/vendor state, assignment state and payment state) are deliberately excluded and
 * remain QuickFurno Core/live-tool authority.
 *
 * This module cannot self-approve. A caller must supply an attributable owner approval before it can
 * emit ACTIVE source documents. That keeps "the code exists" separate from "a human approved these
 * exact words for production".
 */
export const QUICKFURNO_KNOWLEDGE_SOURCE_REVISION =
  'c567b58a2c380b53d98a246a1b87b13f92e4aeda' as const;

export const QUICKFURNO_KNOWLEDGE_SOURCE_MANIFEST_REVISION =
  'quickfurno.prod.knowledge.source.v1.c567b58a2c38' as const;

export const QUICKFURNO_KNOWLEDGE_REFRESH_DAYS = 90 as const;

const SOURCE_OWNER = 'quickfurno.business';
const GLOBAL = 'GLOBAL';

type Candidate = Omit<
  KnowledgeSourceDocumentInput,
  'approvedBy' | 'approvedAt' | 'effectiveFrom' | 'expiresAt' | 'lifecycleState'
>;

const candidates: readonly Candidate[] = Object.freeze([
  Object.freeze({
    knowledgeId: 'qf.public.marketplace-overview',
    version: 1,
    topic: 'quickfurno-overview',
    sourceLayer: 'POLICY_FAQ',
    sourceType: 'POLICY',
    authorityTier: 'APPROVED_BUSINESS_RULE',
    contentFormat: 'PLAIN_TEXT',
    payload: {
      kind: 'TEXT' as const,
      text:
        'QuickFurno is a marketplace that connects homeowners with eligible home-service vendors in Pune. ' +
        'QuickFurno helps a homeowner share a requirement and get matched; QuickFurno does not carry out the vendor work itself. ' +
        'Client enquiries are free. Matching uses the service required and the client city and area. ' +
        'Any agreement, pricing and work scope is between the client and the vendor.',
    },
    sourceRef: 'github://quickfurno-marketplace/app/terms/page.tsx',
    sourceRevision: QUICKFURNO_KNOWLEDGE_SOURCE_REVISION,
    owner: SOURCE_OWNER,
    classification: 'HOSTED_ALLOWED',
    permissions: {
      tenantScope: GLOBAL,
      allowedAgentScopes: ['CLIENT', 'VENDOR', 'PROSPECT'],
      allowedPurposes: ['CLIENT_RESPONSE', 'VENDOR_RESPONSE', 'PROSPECT_RESPONSE'],
    },
  }),
  Object.freeze({
    knowledgeId: 'qf.public.matching-process',
    version: 1,
    topic: 'matching-process',
    sourceLayer: 'POLICY_FAQ',
    sourceType: 'POLICY',
    authorityTier: 'APPROVED_BUSINESS_RULE',
    contentFormat: 'PLAIN_TEXT',
    payload: {
      kind: 'TEXT' as const,
      text:
        'A client enquiry may be shared with up to 3 eligible vendors initially. ' +
        'If those vendors are unavailable, non-responsive or unable to serve the requirement, QuickFurno may manually connect the client with additional eligible vendors. ' +
        'Vendors contact the client directly with quotes. Submitting an enquiry does not obligate the client to hire a vendor.',
    },
    sourceRef: 'github://quickfurno-marketplace/app/terms/page.tsx',
    sourceRevision: QUICKFURNO_KNOWLEDGE_SOURCE_REVISION,
    owner: SOURCE_OWNER,
    classification: 'HOSTED_ALLOWED',
    permissions: {
      tenantScope: GLOBAL,
      allowedAgentScopes: ['CLIENT', 'VENDOR'],
      allowedPurposes: ['CLIENT_RESPONSE', 'VENDOR_RESPONSE'],
    },
  }),
  Object.freeze({
    knowledgeId: 'qf.public.vendor-listing-policy',
    version: 1,
    topic: 'vendor-listing-policy',
    sourceLayer: 'POLICY_FAQ',
    sourceType: 'POLICY',
    authorityTier: 'APPROVED_BUSINESS_RULE',
    contentFormat: 'PLAIN_TEXT',
    payload: {
      kind: 'TEXT' as const,
      text:
        'QuickFurno reviews vendor submissions before approved profiles can go live. ' +
        'Only approved, active vendors that pass the public-listing controls appear as active public listings. ' +
        'Pending, rejected, suspended or hidden profiles are not shown as active public vendors. ' +
        'Vendors remain responsible for the accuracy of their business details, the quality of their work and their conduct with clients.',
    },
    sourceRef: 'github://quickfurno-marketplace/app/terms/page.tsx',
    sourceRevision: QUICKFURNO_KNOWLEDGE_SOURCE_REVISION,
    owner: SOURCE_OWNER,
    classification: 'HOSTED_ALLOWED',
    permissions: {
      tenantScope: GLOBAL,
      allowedAgentScopes: ['CLIENT', 'VENDOR', 'PROSPECT'],
      allowedPurposes: ['CLIENT_RESPONSE', 'VENDOR_RESPONSE', 'PROSPECT_RESPONSE'],
    },
  }),
  Object.freeze({
    knowledgeId: 'qf.public.lead-sharing-privacy',
    version: 1,
    topic: 'lead-sharing-privacy',
    sourceLayer: 'POLICY_FAQ',
    sourceType: 'POLICY',
    authorityTier: 'APPROVED_BUSINESS_RULE',
    contentFormat: 'PLAIN_TEXT',
    payload: {
      kind: 'TEXT' as const,
      text:
        'When a client submits a requirement, QuickFurno collects the details the client provides, including name, phone number, city, area, service needed, budget, timeline and notes. ' +
        'If the client allows it, QuickFurno may also capture approximate location and source or campaign attribution. ' +
        'The enquiry may be shared with up to 3 eligible vendors initially so they can contact the client. ' +
        'If those vendors cannot serve the request, QuickFurno may manually connect additional eligible vendors. ' +
        'QuickFurno states that it does not sell client details or list them on an open marketplace.',
    },
    sourceRef: 'github://quickfurno-marketplace/app/privacy/page.tsx',
    sourceRevision: QUICKFURNO_KNOWLEDGE_SOURCE_REVISION,
    owner: SOURCE_OWNER,
    classification: 'HOSTED_ALLOWED',
    permissions: {
      tenantScope: GLOBAL,
      allowedAgentScopes: ['CLIENT', 'VENDOR'],
      allowedPurposes: ['CLIENT_RESPONSE', 'VENDOR_RESPONSE'],
    },
  }),
  Object.freeze({
    knowledgeId: 'qf.public.service-categories',
    version: 1,
    topic: 'service-categories',
    sourceLayer: 'POLICY_FAQ',
    sourceType: 'FAQ',
    authorityTier: 'APPROVED_WEBSITE_CONTENT',
    contentFormat: 'PLAIN_TEXT',
    payload: {
      kind: 'TEXT' as const,
      text:
        'QuickFurno currently exposes these Pune marketplace categories: Interior Designers, Carpenters, Modular Factory, Premium Interiors, Sofa, Painter, Civil Work and False Ceiling. ' +
        'Category availability for a particular enquiry still depends on current marketplace supply and eligibility.',
    },
    sourceRef: 'github://quickfurno-marketplace/lib/quickfurno-data.ts',
    sourceRevision: QUICKFURNO_KNOWLEDGE_SOURCE_REVISION,
    owner: SOURCE_OWNER,
    classification: 'HOSTED_ALLOWED',
    permissions: {
      tenantScope: GLOBAL,
      allowedAgentScopes: ['CLIENT', 'VENDOR', 'PROSPECT'],
      allowedPurposes: ['CLIENT_RESPONSE', 'VENDOR_RESPONSE', 'PROSPECT_RESPONSE'],
    },
  }),
  Object.freeze({
    knowledgeId: 'qf.public.pune-service-areas',
    version: 1,
    topic: 'pune-service-areas',
    sourceLayer: 'POLICY_FAQ',
    sourceType: 'FAQ',
    authorityTier: 'APPROVED_WEBSITE_CONTENT',
    contentFormat: 'PLAIN_TEXT',
    payload: {
      kind: 'TEXT' as const,
      text:
        'QuickFurno is currently launched in Pune and PCMC. Common locality options shown by the launch surface include Kharadi, Viman Nagar, Koregaon Park, Baner, Wakad, Hinjewadi, Magarpatta, Kothrud, Aundh, Hadapsar, Pimpri-Chinchwad, Kalyani Nagar, Wagholi, Pimple Saudagar, Bavdhan, Warje, Sinhagad Road, Undri, NIBM and Ravet. ' +
        'A listed locality is not a guarantee that matching supply is available. A client may still submit an enquiry when a locality is not listed.',
    },
    sourceRef: 'github://quickfurno-marketplace/lib/homepage-content.ts',
    sourceRevision: QUICKFURNO_KNOWLEDGE_SOURCE_REVISION,
    owner: SOURCE_OWNER,
    classification: 'HOSTED_ALLOWED',
    permissions: {
      tenantScope: GLOBAL,
      allowedAgentScopes: ['CLIENT', 'VENDOR', 'PROSPECT'],
      allowedPurposes: ['CLIENT_RESPONSE', 'VENDOR_RESPONSE', 'PROSPECT_RESPONSE'],
    },
  }),
  Object.freeze({
    knowledgeId: 'qf.public.vendor-join-overview',
    version: 1,
    topic: 'vendor-join-overview',
    sourceLayer: 'POLICY_FAQ',
    sourceType: 'PROCESS_GUIDE',
    authorityTier: 'APPROVED_WEBSITE_CONTENT',
    contentFormat: 'PLAIN_TEXT',
    payload: {
      kind: 'TEXT' as const,
      text:
        'Pune home-service professionals may apply to join QuickFurno. Public profiles are reviewed and approved before they go live. ' +
        'An approved vendor can receive relevant homeowner enquiries when the vendor is eligible for the requirement. ' +
        'QuickFurno does not promise a fixed lead volume merely because a vendor applies or is listed.',
    },
    sourceRef: 'github://quickfurno-marketplace/components/home/LaunchSections.tsx',
    sourceRevision: QUICKFURNO_KNOWLEDGE_SOURCE_REVISION,
    owner: SOURCE_OWNER,
    classification: 'HOSTED_ALLOWED',
    permissions: {
      tenantScope: GLOBAL,
      allowedAgentScopes: ['VENDOR', 'PROSPECT'],
      allowedPurposes: ['VENDOR_RESPONSE', 'PROSPECT_RESPONSE'],
    },
  }),
]);

export interface QuickFurnoKnowledgeApproval {
  readonly approvedBy: string;
  readonly approvedAt: string;
  readonly approvalRef: string;
}

export interface QuickFurnoKnowledgeSourceManifest {
  readonly protocol: typeof KNOWLEDGE_FRESHNESS_SOURCE_MANIFEST_PROTOCOL;
  readonly revision: typeof QUICKFURNO_KNOWLEDGE_SOURCE_MANIFEST_REVISION;
  readonly sources: readonly {
    readonly fingerprint: Readonly<{
      sourceRef: string;
      sourceRevision: string;
      contentDigest: string;
      ownerRef: string;
      approvedForProduction: true;
      approvalRef: string;
    }>;
    readonly document: KnowledgeSourceDocumentInput;
  }[];
}

function approvalInstant(value: string): string {
  const ms = Date.parse(value);
  if (
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/u.test(value) ||
    !Number.isFinite(ms)
  ) {
    throw new TypeError('quickfurno-knowledge-approval-invalid');
  }
  return value;
}

function expiryFrom(instant: string): string {
  const ms = Date.parse(instant) + QUICKFURNO_KNOWLEDGE_REFRESH_DAYS * 86_400_000;
  return new Date(ms).toISOString();
}

function approvedDocument(candidate: Candidate, approval: QuickFurnoKnowledgeApproval): KnowledgeSourceDocumentInput {
  const approvedAt = approvalInstant(approval.approvedAt);
  return Object.freeze({
    ...candidate,
    lifecycleState: 'ACTIVE' as const,
    approvedBy: approval.approvedBy,
    approvedAt,
    effectiveFrom: approvedAt,
    expiresAt: expiryFrom(approvedAt),
  });
}

export function createApprovedQuickFurnoKnowledgeSourceManifest(
  approval: QuickFurnoKnowledgeApproval,
): QuickFurnoKnowledgeSourceManifest {
  if (
    !/^[A-Za-z0-9._:-]{1,128}$/u.test(approval.approvedBy) ||
    !/^[A-Za-z0-9._:-]{1,128}$/u.test(approval.approvalRef)
  ) {
    throw new TypeError('quickfurno-knowledge-approval-invalid');
  }

  const sources = candidates.map((candidate) => {
    const document = approvedDocument(candidate, approval);
    const normalized = normalizeSourceDocument(document);
    return Object.freeze({
      fingerprint: Object.freeze({
        sourceRef: document.sourceRef,
        sourceRevision: document.sourceRevision,
        contentDigest: normalized.contentDigest,
        ownerRef: document.owner,
        approvedForProduction: true as const,
        approvalRef: approval.approvalRef,
      }),
      document,
    });
  });

  return Object.freeze({
    protocol: KNOWLEDGE_FRESHNESS_SOURCE_MANIFEST_PROTOCOL,
    revision: QUICKFURNO_KNOWLEDGE_SOURCE_MANIFEST_REVISION,
    sources: Object.freeze(sources),
  });
}

/**
 * Content/governance address used for the PostgreSQL immutable release.
 *
 * It is derived only after an explicit approval has been applied, so changing content, source SHA,
 * permissions, approval identity or effective window necessarily creates a new release identity.
 */
export function deriveQuickFurnoKnowledgeReleaseRevision(
  manifest: QuickFurnoKnowledgeSourceManifest,
): string {
  const canonical = [...manifest.sources]
    .sort((a, b) => a.document.knowledgeId.localeCompare(b.document.knowledgeId))
    .map(({ fingerprint, document }) => [
      document.knowledgeId,
      document.version,
      document.topic,
      fingerprint.sourceRef,
      fingerprint.sourceRevision,
      fingerprint.contentDigest,
      fingerprint.ownerRef,
      fingerprint.approvalRef,
      document.approvedBy ?? null,
      document.approvedAt ?? null,
      document.effectiveFrom,
      document.expiresAt ?? null,
      document.classification,
      document.lifecycleState,
      document.permissions.tenantScope,
      [...document.permissions.allowedAgentScopes],
      [...document.permissions.allowedPurposes],
    ]);

  const digest = createHash('sha256').update(JSON.stringify(canonical), 'utf8').digest('hex');
  return 'qfkb.sha256.' + digest;
}

export const QUICKFURNO_KNOWLEDGE_CANDIDATE_COUNT = candidates.length;
