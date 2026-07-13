/**
 * **Static validation of the checked-in QuickFurno compatibility manifest.**
 *
 * ### What this suite is, and what it deliberately is not
 *
 * It validates **the reviewed manifest** (`docs/compatibility/quickfurno-compatibility-manifest.json`)
 * against **the Phase 2 contracts already in this repository**. That is the whole scope.
 *
 * - It **does not** fetch QuickFurno. **CI must never reach across a network to another
 *   repository's moving `main`** — a test whose result depends on somebody else's merge is a
 *   test that fails for reasons nobody in this repository caused. The **pinned, checked-in
 *   manifest IS the reviewed baseline** (ADR-0025 §6), and refreshing the snapshot is an
 *   explicit, reviewed act rather than a dependency bump.
 * - It **declares and imports no connector client.** The contracts package depends on **`zod` and
 *   nothing else** — no database driver, no HTTP client, no provider SDK — and this file
 *   statically imports exactly three modules, none of which speaks a network protocol. That is
 *   what is proved, and **it is deliberately not stated more strongly than that**: see the
 *   `declares and imports no connector client` suite for why.
 * - It **asserts nothing about QuickFurno's behaviour**, because it cannot see QuickFurno. It
 *   asserts that **our record of QuickFurno is internally consistent, complete, and does not
 *   quietly hand Jarvis authority it may never have.**
 *
 * ### The assertion that matters most
 *
 * `jarvisForbidden` and `jarvisNeverAuthoritativeFor` are the machine-readable form of the
 * permanent rule — **Jarvis recommends, QuickFurno Core authorizes**. If a future edit ever
 * makes Jarvis authoritative for money, consent, assignment, activation, suspension, or
 * communication eligibility, **these tests fail**. They are not to be "fixed" by relaxing them.
 */

import { readFile } from 'node:fs/promises';

import { describe, expect, it } from 'vitest';

import {
  CANONICAL_EVENT_TYPES,
  derivedObservationSchema,
  isFreeOfProhibitedContent,
  observationPayloadV2Schema,
  INITIAL_BATCH_NUMBER,
  isRegisteredCanonicalEvent,
  MAX_VENDORS_PER_BATCH,
  MAX_VENDORS_PER_LEAD_CATEGORY,
  REPLACEMENT_BATCH_NUMBER,
} from '../index.js';

/** A 40-character lowercase hex commit SHA. Nothing shorter, nothing abbreviated. */
const COMMIT_SHA_PATTERN = /^[0-9a-f]{40}$/;

interface Entity {
  readonly id: string;
  readonly owner: string;
  readonly sourceFiles: readonly string[];
}

interface EventMapping {
  readonly id: string;
  readonly canonicalEvent: string | null;
  readonly canonicalEventVersion: number | null;
  readonly contractStatus: string;
  readonly gapId?: string;
  readonly producer: string;
  readonly sourceFiles: readonly string[];
}

interface SourceEvent {
  readonly name: string;
  readonly disposition: string;
  readonly canonicalEvent: string | null;
  readonly sourceFiles: readonly string[];
}

interface AuthorityEntry {
  readonly action: string;
  readonly authoritativeOwner: string;
  readonly jarvisMayRecommend: boolean;
  readonly jarvisForbidden: boolean;
  readonly sourceFiles: readonly string[];
}

interface Gap {
  readonly id: string;
  readonly summary: string;
  readonly resolutionPhase: string;
}

interface SecurityFinding {
  readonly id: string;
  readonly severity: string;
  readonly evidenceSource: readonly string[];
  readonly affectedEntity: string;
  readonly currentExposure: string;
  readonly requiredRemediation: string;
  readonly remediationOwner: string;
  readonly remediationStage: string;
  readonly blockingPhase: string;
  readonly hardBlocker: boolean;
  /** Present on the canonical-payload gap, in the owner's vocabulary. */
  readonly status?: string;
  readonly owner?: string;
  readonly blocking_phase?: string;
  readonly resolution_phase?: string;
  readonly isKnownGapNotAcceptedRisk?: boolean;
  readonly mayBeDeferredToPhase11?: boolean;
  /** Present once resolved. The finding is retained as evidence, never deleted. */
  readonly resolvedInStage?: string;
  readonly historicalEvidence?: string;
  readonly implementation_status?: string;
  readonly historical_status?: string;
  readonly resolution_stage?: string;
}

interface PhaseGate {
  readonly blockedBy: readonly string[];
  readonly rationale: string;
  /** Present once a gate has been satisfied: what satisfied it. */
  readonly satisfiedBy?: readonly string[];
}

interface Manifest {
  readonly quickfurno: { readonly repository: string; readonly snapshotSha: string };
  readonly jarvis: { readonly repository: string; readonly snapshotSha: string };
  readonly databaseBoundary: Record<string, unknown>;
  readonly assignmentPolicy: {
    readonly observed_current_core_policy: {
      readonly initial_max: number;
      readonly manual_total_max: number;
      readonly explicit_replacement_batch: boolean;
    };
    readonly owner_approved_target_policy: {
      readonly initial_batch_max: number;
      readonly replacement_batch_max: number;
      readonly lifetime_unique_max_per_lead_category: number;
      readonly overlap_allowed: boolean;
      readonly initial_batch_number: number;
      readonly replacement_batch_number: number;
      readonly jarvis_may_assign_vendors: boolean;
      readonly jarvis_may_request_replacement: boolean;
      readonly final_authority: string;
    };
    readonly conflict: { readonly id: string; readonly status: string };
    readonly jarvisConstraint: {
      readonly jarvisMayGenerateAssignmentAboveOwnerLimits: boolean;
      readonly jarvisMayRecommendAssignmentAboveOwnerLimits: boolean;
      readonly jarvisMayNormalizeObservedNineIntoTarget: boolean;
    };
  };
  readonly whatsappPolicy: {
    readonly LIVE_WHATSAPP_BEFORE_PHASE_11A: string;
    readonly observedEdgeFunction: {
      readonly status: string;
      readonly remediation_required_before: string;
      readonly liveCapable: boolean;
      readonly authorized: boolean;
      readonly callsMetaGraphApi: boolean;
      readonly canReadNextJsFeatureFlags: boolean;
      readonly whatsappSendingEnabledFlagGovernsThisFunction: boolean;
    };
    readonly queuedRecordsConstituteAuthorization: boolean;
    readonly jarvisRecommendationMayTriggerDelivery: boolean;
    readonly authorizedDeliveryChain: readonly string[];
    readonly requiredCoreChecksBeforeLiveDelivery: readonly string[];
  };
  readonly securityFindings: readonly SecurityFinding[];
  readonly eventCounts: {
    readonly sourceTransitions: number;
    readonly withCanonicalEvent: number;
    readonly contractGaps: number;
    readonly unsupported: number;
    readonly uniqueCanonicalEventsTargeted: number;
  };
  readonly prohibitedPayloadFields: {
    readonly refusedByKey: readonly string[];
    readonly gpsBearingFreeTextPermitted: boolean;
    readonly coreFreeTextFieldsNeverMapped: readonly string[];
    readonly openGapId: string;
    readonly closedByStage: string;
    readonly gapImplementationStatus: string;
  };
  readonly adapterConstraints: {
    readonly coreFreeTextForwardingPermitted: boolean;
    readonly mayForwardLeadsMessage: boolean;
    readonly mayForwardRawRequirementText: boolean;
    readonly mustMapReasonCodesAndBoundedSignalsOnly: boolean;
  };
  readonly phaseGates: {
    readonly stage_3_2_signed_ingestion: PhaseGate;
    readonly phase_11_live_core_integration: PhaseGate;
    readonly phase_11a_live_communication: PhaseGate;
    readonly [key: string]: PhaseGate | string;
  };
  readonly entities: readonly Entity[];
  readonly sourceEvents: {
    readonly n8n: readonly SourceEvent[];
    readonly internal: readonly SourceEvent[];
    readonly preview: readonly SourceEvent[];
  };
  readonly eventMappings: readonly EventMapping[];
  readonly knownGaps: readonly Gap[];
  readonly authority: readonly AuthorityEntry[];
  readonly jarvisNeverAuthoritativeFor: readonly string[];
  readonly deprecatedNames: readonly string[];
  readonly stageStatus: Record<string, string>;
  readonly retiredCanonicalVersions: Record<string, unknown>;
  readonly taxonomyLabelRule: Record<string, unknown>;
}

const MANIFEST_URL = new URL(
  '../../../../docs/compatibility/quickfurno-compatibility-manifest.json',
  import.meta.url,
);

const raw = await readFile(MANIFEST_URL, 'utf8');
const manifest = JSON.parse(raw) as Manifest;

const allSourceEvents: readonly SourceEvent[] = [
  ...manifest.sourceEvents.n8n,
  ...manifest.sourceEvents.internal,
  ...manifest.sourceEvents.preview,
];

/**
 * The canonical-payload privacy gap. Fetched by id rather than by index, and it **must exist** —
 * a missing finding here would silently turn every assertion about it into a no-op.
 */
function gpsFinding(): SecurityFinding {
  const finding = manifest.securityFindings.find(
    (candidate) => candidate.id === 'gps-value-shape-not-refused',
  );

  if (finding === undefined) {
    throw new Error(
      'The canonical-payload privacy gap "gps-value-shape-not-refused" is missing from the ' +
        'manifest. It is a known, open contract gap that blocks Stage 3.2 — it may not be ' +
        'deleted, and it may not be quietly downgraded.',
    );
  }

  return finding;
}

/** Every disposition a current QuickFurno event may be given. There is no "unclassified". */
const VALID_DISPOSITIONS = new Set([
  'retain',
  'rename',
  'version',
  'split',
  'replace',
  'deprecate',
  'unsupported',
  'gap',
]);

describe('the manifest is pinned to a reviewed snapshot', () => {
  it('records the QuickFurno snapshot SHA in full', () => {
    expect(manifest.quickfurno.snapshotSha).toMatch(COMMIT_SHA_PATTERN);
    expect(manifest.quickfurno.repository).toBe('quickfurno-maker/quickfurno-marketplace');
  });

  it('records the Jarvis snapshot SHA in full', () => {
    // Both sides are pinned. A compatibility claim between two moving targets is not a claim.
    expect(manifest.jarvis.snapshotSha).toMatch(COMMIT_SHA_PATTERN);
  });
});

describe('identifiers are unique', () => {
  it('entity ids are unique', () => {
    const ids = manifest.entities.map((entity) => entity.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('event mapping ids are unique', () => {
    const ids = manifest.eventMappings.map((mapping) => mapping.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('a source event name appears exactly once', () => {
    const names = allSourceEvents.map((event) => event.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it('gap ids are unique', () => {
    const ids = manifest.knownGaps.map((gap) => gap.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('every mapped canonical event is real, or is an explicit contract gap', () => {
  it.each(manifest.eventMappings.map((mapping) => [mapping.id, mapping] as const))(
    '%s resolves to a registered canonical event or a declared gap',
    (_id, mapping) => {
      if (mapping.canonicalEvent === null) {
        // No canonical event ⇒ it is either an admitted GAP (with a named resolution) or a
        // deliberate UNSUPPORTED decision (Core-internal telemetry Jarvis must not ingest, such
        // as Core's own lead score). An unmapped operation that is neither is an operation
        // nobody decided about, and that is the state this refuses.
        expect(['contract-gap', 'unsupported']).toContain(mapping.contractStatus);

        if (mapping.contractStatus === 'contract-gap') {
          expect(mapping.gapId).toBeTypeOf('string');
        }
        return;
      }

      // A named canonical event must actually exist in the Phase 2 registry — at the exact
      // version claimed. A mapping to an event we do not have is a mapping to nothing.
      expect(CANONICAL_EVENT_TYPES).toContain(mapping.canonicalEvent);
      expect(mapping.canonicalEventVersion).toBeTypeOf('number');
      expect(
        isRegisteredCanonicalEvent(mapping.canonicalEvent, mapping.canonicalEventVersion ?? 0),
      ).toBe(true);
    },
  );

  it('every gapId on a mapping points at a declared gap', () => {
    const declared = new Set(manifest.knownGaps.map((gap) => gap.id));

    for (const mapping of manifest.eventMappings) {
      if (mapping.gapId !== undefined) {
        expect(declared).toContain(mapping.gapId);
      }
    }
  });

  it('every declared gap has a proposed resolution phase', () => {
    expect(manifest.knownGaps.length).toBeGreaterThan(0);

    for (const gap of manifest.knownGaps) {
      // "We will deal with it later" is not a resolution. A phase is.
      expect(gap.resolutionPhase.trim()).not.toBe('');
      expect(gap.summary.trim()).not.toBe('');
    }
  });

  it('every canonical event a source event maps to is registered', () => {
    for (const event of allSourceEvents) {
      if (event.canonicalEvent !== null) {
        expect(CANONICAL_EVENT_TYPES).toContain(event.canonicalEvent);
      }
    }
  });
});

describe('every current QuickFurno event is accounted for', () => {
  it('classifies all 29 named events (21 n8n + 4 internal + 4 preview)', () => {
    expect(manifest.sourceEvents.n8n).toHaveLength(21);
    expect(manifest.sourceEvents.internal).toHaveLength(4);
    expect(manifest.sourceEvents.preview).toHaveLength(4);
    expect(allSourceEvents).toHaveLength(29);
  });

  it.each(allSourceEvents.map((event) => [event.name, event] as const))(
    '%s has a valid disposition',
    (_name, event) => {
      // No event may be left unclassified. "We never looked at it" is the state this prevents.
      expect(VALID_DISPOSITIONS).toContain(event.disposition);
    },
  );

  it('an event mapped to a canonical target is not also deprecated', () => {
    const deprecated = new Set(manifest.deprecatedNames);

    for (const event of allSourceEvents) {
      if (event.canonicalEvent !== null) {
        expect(deprecated).not.toContain(event.name);
      }
    }
  });
});

describe('authority: exactly one owner, and it is never Jarvis', () => {
  it('every action has exactly one authoritative owner', () => {
    const actions = manifest.authority.map((entry) => entry.action);
    expect(new Set(actions).size).toBe(actions.length);

    for (const entry of manifest.authority) {
      expect(entry.authoritativeOwner.trim()).not.toBe('');
    }
  });

  it.each(manifest.authority.map((entry) => [entry.action, entry] as const))(
    'Jarvis is not the authoritative owner of %s',
    (_action, entry) => {
      // The permanent rule, asserted mechanically. Jarvis recommends; Core authorizes.
      expect(entry.authoritativeOwner).not.toBe('qf-jarvis');
      expect(entry.authoritativeOwner).toBe('quickfurno-core');
    },
  );

  it('a forbidden action may not also be recommendable', () => {
    for (const entry of manifest.authority) {
      if (entry.jarvisForbidden) {
        // "Forbidden, but Jarvis may suggest it" is not forbidden.
        expect(entry.jarvisMayRecommend).toBe(false);
      }
    }
  });

  it('every event mapping is produced by Core, never by Jarvis', () => {
    for (const mapping of manifest.eventMappings) {
      expect(mapping.producer).toBe('quickfurno-core');
    }
  });

  it('every entity is owned by Core', () => {
    for (const entity of manifest.entities) {
      expect(entity.owner).toBe('quickfurno-core');
    }
  });
});

describe('Jarvis is never authoritative for money, consent, assignment, activation, suspension or communication eligibility', () => {
  const REQUIRED_PROHIBITIONS = [
    'money',
    'consent',
    'assignment',
    'activation',
    'suspension',
    'communication-eligibility',
  ] as const;

  it.each(REQUIRED_PROHIBITIONS)('%s is declared off-limits to Jarvis', (prohibition) => {
    expect(manifest.jarvisNeverAuthoritativeFor).toContain(prohibition);
  });

  /**
   * The money-, consent- and settings-adjacent actions Jarvis may not even *propose*.
   *
   * Assignment, activation and suspension are absent from this list **on purpose**: Jarvis may
   * *recommend* on them (advise readiness, advise risk) — it simply may never be the
   * authoritative owner, which the suite above asserts separately. Deducting a credit, however,
   * is not a thing an advisory system proposes at all.
   */
  const MUST_BE_FORBIDDEN = [
    'change-consent',
    'deduct-credit',
    'refund-credit',
    'record-payment',
    'modify-runtime-settings',
  ] as const;

  it.each(MUST_BE_FORBIDDEN)('%s is explicitly forbidden to Jarvis', (action) => {
    const entry = manifest.authority.find((candidate) => candidate.action === action);

    expect(entry, `authority entry "${action}" is missing from the manifest`).toBeDefined();
    expect(entry?.jarvisForbidden).toBe(true);
    expect(entry?.jarvisMayRecommend).toBe(false);
  });

  it('communication is executed by n8n, never by Jarvis', () => {
    const send = manifest.authority.find((entry) => entry.action === 'send-whatsapp');

    expect(send).toBeDefined();
    // Jarvis may PROPOSE a communication. It may never send one, and it has no provider path.
    expect(send?.authoritativeOwner).toBe('quickfurno-core');
  });
});

describe('the OBSERVED QuickFurno policy is preserved as evidence', () => {
  const observed = manifest.assignmentPolicy.observed_current_core_policy;

  it("records Core's manual recovery cap as 9 — the real number, not the one we wish it were", () => {
    // This is the assertion that stops the finding being tidied away. The owner-approved cap is
    // 6; Core's implemented cap is 9. If somebody "fixes" the manifest by writing 6 here, the
    // conflict becomes invisible and the remediation loses its reason to exist. **The observed
    // value is evidence, and evidence is not edited to match the conclusion.**
    expect(observed.manual_total_max).toBe(9);
  });

  it("records Core's automatic cap as 3", () => {
    expect(observed.initial_max).toBe(3);
  });

  it('records that Core has no explicit replacement batch', () => {
    expect(observed.explicit_replacement_batch).toBe(false);
  });
});

describe('the OWNER-APPROVED target policy is 3 + 3, lifetime 6', () => {
  const target = manifest.assignmentPolicy.owner_approved_target_policy;

  it('the initial batch cap is 3, cross-checked against the contract constant', () => {
    // Checked against the exported contract constant rather than a bare literal, so the manifest
    // cannot drift away from the schema that actually enforces the cap.
    expect(target.initial_batch_max).toBe(MAX_VENDORS_PER_BATCH);
    expect(target.initial_batch_max).toBe(3);
    expect(target.initial_batch_number).toBe(INITIAL_BATCH_NUMBER);
  });

  it('the replacement batch cap is 3, and it is a SEPARATE batch', () => {
    expect(target.replacement_batch_max).toBe(MAX_VENDORS_PER_BATCH);
    expect(target.replacement_batch_max).toBe(3);
    expect(target.replacement_batch_number).toBe(REPLACEMENT_BATCH_NUMBER);
    expect(target.replacement_batch_number).not.toBe(target.initial_batch_number);
  });

  it('the lifetime unique cap is 6 per lead-category', () => {
    expect(target.lifetime_unique_max_per_lead_category).toBe(MAX_VENDORS_PER_LEAD_CATEGORY);
    expect(target.lifetime_unique_max_per_lead_category).toBe(6);
    // The lifetime cap is the sum of the two batches, and never more.
    expect(target.lifetime_unique_max_per_lead_category).toBe(
      target.initial_batch_max + target.replacement_batch_max,
    );
  });

  it('vendors may not overlap between batches', () => {
    // Overlap would let a "replacement" re-offer the lead to a vendor the client already saw,
    // and would make the lifetime-cap arithmetic a lie.
    expect(target.overlap_allowed).toBe(false);
  });

  it('Jarvis may request a replacement, and may never assign', () => {
    expect(target.jarvis_may_request_replacement).toBe(true);
    expect(target.jarvis_may_assign_vendors).toBe(false);
    expect(target.final_authority).toBe('quickfurno-core');
  });
});

describe('the observed and target policies are explicitly different, and the conflict is open', () => {
  const { observed_current_core_policy: observed, owner_approved_target_policy: target } =
    manifest.assignmentPolicy;

  it('the observed maximum exceeds the owner-approved lifetime maximum', () => {
    // 9 > 6. Asserted as a relationship rather than as two constants, so that closing the gap
    // in the manifest without closing it in Core is not possible.
    expect(observed.manual_total_max).toBeGreaterThan(target.lifetime_unique_max_per_lead_category);
    expect(observed.manual_total_max).not.toBe(target.lifetime_unique_max_per_lead_category);
  });

  it('Core lacks the two-batch model the target policy requires', () => {
    expect(observed.explicit_replacement_batch).toBe(false);
  });

  it('the conflict status is core_remediation_required', () => {
    expect(manifest.assignmentPolicy.conflict.status).toBe('core_remediation_required');
    expect(manifest.assignmentPolicy.conflict.id).toBe('vendor-cap-conflict');
  });

  it('Jarvis may not generate, recommend, or normalize an assignment above the owner limits', () => {
    const constraint = manifest.assignmentPolicy.jarvisConstraint;

    expect(constraint.jarvisMayGenerateAssignmentAboveOwnerLimits).toBe(false);
    expect(constraint.jarvisMayRecommendAssignmentAboveOwnerLimits).toBe(false);
    // And it may not quietly rewrite 9 into 6 to make the numbers agree. That would be a
    // projection asserting a cap the authoritative system does not enforce — green, plausible,
    // and false, which is the worst of the three.
    expect(constraint.jarvisMayNormalizeObservedNineIntoTarget).toBe(false);
  });

  it('Jarvis is not authoritative for assignment', () => {
    expect(manifest.jarvisNeverAuthoritativeFor).toContain('assignment');

    const assign = manifest.authority.find((entry) => entry.action === 'assign-vendors');
    expect(assign?.authoritativeOwner).toBe('quickfurno-core');
  });
});

describe('live WhatsApp before Phase 11A is PROHIBITED', () => {
  const policy = manifest.whatsappPolicy;
  const fn = policy.observedEdgeFunction;

  it('the owner decision is recorded as a literal prohibition', () => {
    expect(policy.LIVE_WHATSAPP_BEFORE_PHASE_11A).toBe('PROHIBITED');
  });

  it('the Edge Function is marked live-capable but NOT authorized', () => {
    expect(fn.status).toBe('live_capable_not_authorized');
    expect(fn.remediation_required_before).toBe('phase_11a');
    expect(fn.liveCapable).toBe(true);
    expect(fn.authorized).toBe(false);
    expect(fn.callsMetaGraphApi).toBe(true);
  });

  it('the Next.js feature flags are NOT described as governing the Edge Function', () => {
    // The whole point. The Edge Function is Deno, deployed separately; it cannot import a
    // constant from the Next.js bundle. A flag the dangerous path cannot see is not a control —
    // it is a comment that looks like one, and everybody believes it, including the README.
    expect(fn.canReadNextJsFeatureFlags).toBe(false);
    expect(fn.whatsappSendingEnabledFlagGovernsThisFunction).toBe(false);
  });

  it('a queued record is not authorization, and no Jarvis recommendation may trigger delivery', () => {
    expect(policy.queuedRecordsConstituteAuthorization).toBe(false);
    expect(policy.jarvisRecommendationMayTriggerDelivery).toBe(false);
  });

  it('the authorized delivery chain runs through Core and n8n, never Jarvis-to-provider', () => {
    expect(policy.authorizedDeliveryChain[0]).toBe('quickfurno-core-authorization');
    expect(policy.authorizedDeliveryChain).toContain('execution-intent');
    expect(policy.authorizedDeliveryChain).toContain('n8n');
    expect(policy.authorizedDeliveryChain).not.toContain('qf-jarvis');
  });

  it.each([
    'recipient-resolution',
    'consent',
    'opt-out-dnc',
    'communication-eligibility',
    'quiet-hours',
    'message-purpose',
    'approval-level',
    'idempotency',
    'at-most-once-execution',
    'audit-trail',
  ])('Core must check %s before any live delivery', (check) => {
    expect(policy.requiredCoreChecksBeforeLiveDelivery).toContain(check);
  });
});

describe('every confirmed safety finding is actionable', () => {
  const criticalOrHigh = manifest.securityFindings.filter((finding) =>
    ['critical', 'high'].includes(finding.severity),
  );

  it('there is at least one critical finding, and it is the WhatsApp path', () => {
    const whatsapp = manifest.securityFindings.find(
      (finding) => finding.id === 'uncontrolled-whatsapp-delivery',
    );

    expect(whatsapp?.severity).toBe('critical');
    expect(whatsapp?.hardBlocker).toBe(true);
    expect(whatsapp?.blockingPhase).toBe('phase-11a');
  });

  it.each(criticalOrHigh.map((finding) => [finding.id, finding] as const))(
    '%s names a remediation owner and a blocking phase',
    (_id, finding) => {
      // A finding without an owner is a finding nobody will fix, and a finding without a
      // blocking phase is one that ships.
      expect(finding.remediationOwner.trim()).not.toBe('');
      expect(finding.blockingPhase.trim()).not.toBe('');
      expect(finding.requiredRemediation.trim()).not.toBe('');
      expect(finding.currentExposure.trim()).not.toBe('');
      expect(finding.affectedEntity.trim()).not.toBe('');
      expect(finding.evidenceSource.length).toBeGreaterThan(0);
    },
  );

  it('the assignment-cap conflict is a hard blocker before Phase 11', () => {
    const cap = manifest.securityFindings.find((finding) => finding.id === 'vendor-cap-conflict');

    expect(cap?.hardBlocker).toBe(true);
    expect(cap?.blockingPhase).toBe('phase-11');
  });

  it('missing RLS and anonymous mutation of operational controls are hard blockers', () => {
    for (const id of ['missing-rls', 'anon-writable-runtime-settings']) {
      const finding = manifest.securityFindings.find((candidate) => candidate.id === id);

      expect(finding?.hardBlocker).toBe(true);
      expect(finding?.blockingPhase).toBe('phase-11');
    }
  });

  it('unrestricted status transitions block lifecycle-changing recommendations', () => {
    const finding = manifest.securityFindings.find(
      (candidate) => candidate.id === 'unrestricted-status-transitions',
    );

    expect(finding?.hardBlocker).toBe(true);
    expect(finding?.blockingPhase).toBe('phase-11');
  });
});

describe('the event counts reconcile — no unexplained numerical mismatch', () => {
  const counts = manifest.eventCounts;

  it('the declared totals match the actual mappings', () => {
    const withCanonical = manifest.eventMappings.filter(
      (mapping) => mapping.canonicalEvent !== null,
    ).length;
    const gaps = manifest.eventMappings.filter(
      (mapping) => mapping.contractStatus === 'contract-gap',
    ).length;
    const unsupported = manifest.eventMappings.filter(
      (mapping) => mapping.contractStatus === 'unsupported',
    ).length;

    expect(counts.sourceTransitions).toBe(manifest.eventMappings.length);
    expect(counts.withCanonicalEvent).toBe(withCanonical);
    expect(counts.contractGaps).toBe(gaps);
    expect(counts.unsupported).toBe(unsupported);
  });

  it('sourceTransitions = withCanonicalEvent + contractGaps + unsupported', () => {
    // The identity that closes the 33-vs-26 question the owner raised. Every catalogued Core
    // transition lands in exactly one of three buckets, and the buckets sum to the total.
    expect(counts.sourceTransitions).toBe(
      counts.withCanonicalEvent + counts.contractGaps + counts.unsupported,
    );
  });

  it('unique canonical events targeted is smaller than the transitions that target them', () => {
    const unique = new Set(
      manifest.eventMappings
        .filter((mapping) => mapping.canonicalEvent !== null)
        .map((mapping) => mapping.canonicalEvent),
    );

    expect(counts.uniqueCanonicalEventsTargeted).toBe(unique.size);
    // Several Core transitions legitimately share one canonical event — a lead being captured
    // and a lead being qualified are two Core stages of the single canonical fact "requirement
    // completed". That is a fan-in, not an omission, and this asserts the direction.
    expect(counts.uniqueCanonicalEventsTargeted).toBeLessThan(counts.withCanonicalEvent);
  });

  it('the declared unique count never exceeds the registry', () => {
    expect(counts.uniqueCanonicalEventsTargeted).toBeLessThanOrEqual(CANONICAL_EVENT_TYPES.length);
  });
});

describe('no canonical payload may carry GPS-bearing free text', () => {
  it('the manifest forbids it, and names the Core field that must never be mapped', () => {
    expect(manifest.prohibitedPayloadFields.gpsBearingFreeTextPermitted).toBe(false);
    // Core's coordinates live inside leads.message. Naming it here means an adapter author
    // cannot claim nobody told them.
    expect(manifest.prohibitedPayloadFields.coreFreeTextFieldsNeverMapped).toContain(
      'leads.message',
    );
  });

  it.each(['body', 'notes', 'freetext', 'raw'])(
    'the governed payload refuses the free-text carrier key "%s"',
    (key) => {
      // Asserted against the REAL schema, not against a manifest string. These four keys are
      // where Core's whole record would get copied, one convenient field at a time — and
      // leads.message is exactly such a field.
      expect(derivedObservationSchema.safeParse({ [key]: 'GPS: 18.5204, 73.8567' }).success).toBe(
        false,
      );
      expect(manifest.prohibitedPayloadFields.refusedByKey).toContain(key);
    },
  );

  it.each(['phone', 'email', 'address'])(
    'the governed payload refuses the contact key "%s"',
    (key) => {
      expect(derivedObservationSchema.safeParse({ [key]: 'x' }).success).toBe(false);
    },
  );

  it('the governed payload refuses a contact-shaped VALUE even under a benign key', () => {
    expect(derivedObservationSchema.safeParse({ signal: 'reach me at a@b.example' }).success).toBe(
      false,
    );
    expect(derivedObservationSchema.safeParse({ signal: '+91 98765 43210' }).success).toBe(false);
  });

  it('a bounded, reason-coded signal is accepted — the payload is usable, not merely strict', () => {
    expect(derivedObservationSchema.safeParse({ completeness: 'high' }).success).toBe(true);
  });

  /**
   * **The honest limit of the control above — recorded as a GAP, never as safe behaviour.**
   *
   * The key-level and contact-value defences hold. A **coordinate pair** under an
   * arbitrarily-named permitted key is **not** refused by value shape: it is not an email, not
   * an E.164 number, and has no ten-digit run. The schema alone does not stop it — and Core
   * stores precise client coordinates *inside* `leads.message`, so the exposure is concrete.
   *
   * Closing it is a **contract change**, which Stage 3.1.2 is forbidden from making. So the gap
   * is asserted rather than glossed, and it is gated: it **blocks Stage 3.2** and resolves in
   * **Stage 3.1.4**. It may **not** be deferred to Phase 11 — *signing a payload that can
   * smuggle coordinates only makes the smuggling authenticated.*
   */
  it('the gap is CLOSED: a coordinate hidden in an arbitrary string is now refused', () => {
    // This test used to assert the OPPOSITE — that a coordinate in an arbitrary string was
    // accepted — and it was written that way deliberately, so that closing the gap would fail it
    // loudly. Stage 3.1.4 closed it, and this is that notification arriving.
    expect(isFreeOfProhibitedContent({ requirement: 'GPS: 18.5204, 73.8567' })).toBe(false);
    expect(isFreeOfProhibitedContent({ signal: '18.5204, 73.8567' })).toBe(false);
    expect(isFreeOfProhibitedContent({ latitude: 18.5204, longitude: 73.8567 })).toBe(false);
    expect(isFreeOfProhibitedContent({ point: [18.5204, 73.8567] })).toBe(false);
  });

  it('and the PRIMARY control is the schema, not the detector — there is no field to put it in', () => {
    // The detector is the second lock. The first is that a v2 payload has nowhere to carry free
    // text at all: `detail` is gone. A payload with no field for a coordinate does not need to be
    // searched for one.
    const withDetail = observationPayloadV2Schema.safeParse({
      reasonCode: 'requirement.complete',
      detail: 'GPS: 18.5204, 73.8567',
    });

    expect(withDetail.success).toBe(false);
  });

  it('the finding is FIXED PENDING ACCEPTANCE — implemented, not yet accepted, never deleted', () => {
    const finding = gpsFinding();

    // The distinction the owner insisted on, and it is the right one: **an implementation is not
    // an acceptance.** The hardening is written and tested; ADR-0026 is Proposed and the PR is
    // unmerged. Marking this "resolved" would clear a gate nobody has agreed to clear.
    expect(finding.implementation_status).toBe('fixed_pending_acceptance');
    expect(finding.resolution_stage).toBe('stage_3_1_4');

    // And the history survives. Erasing it would erase the reason the hardening exists, and the
    // next person tempted to widen a payload would have nothing to read.
    expect(finding.historical_status).toBe('contract_gap');
    expect(finding.historicalEvidence).toBeTypeOf('string');
    expect(finding.isKnownGapNotAcceptedRisk).toBe(true);
    expect(finding.owner).toBe('qf-jarvis');

    // It never was deferrable to Phase 11, and the record still says so.
    expect(finding.mayBeDeferredToPhase11).toBe(false);
  });

  it('Stage 3.2 remains BLOCKED until Stage 3.1.4 is accepted and merged', () => {
    // The gate is not cleared by writing the code. It is cleared by the owner accepting it.
    expect(manifest.phaseGates.stage_3_2_signed_ingestion.blockedBy).toContain('stage-3.1.4');
    expect(manifest.stageStatus['stage_3_2']).toBe('blocked_by_stage_3_1_4');
    expect(manifest.stageStatus['adr_0026']).toBe('Proposed');
    expect(manifest.stageStatus['stage_3_1_4']).toContain('pending_owner_review');
  });

  it('still forbids any adapter from transmitting Core free text', () => {
    const constraints = manifest.adapterConstraints;

    expect(constraints.coreFreeTextForwardingPermitted).toBe(false);
    expect(constraints.mayForwardLeadsMessage).toBe(false);
    expect(constraints.mayForwardRawRequirementText).toBe(false);
    expect(constraints.mustMapReasonCodesAndBoundedSignalsOnly).toBe(true);

    // The fix is implemented and NOT accepted, so the gap id stays visible. The schema now
    // enforces the constraint structurally; the discipline is no longer the only thing holding —
    // but the gate does not clear until the owner clears it.
    expect(manifest.prohibitedPayloadFields.openGapId).toBe('gps-value-shape-not-refused');
    expect(manifest.prohibitedPayloadFields.gapImplementationStatus).toBe(
      'fixed_pending_acceptance',
    );
    expect(manifest.prohibitedPayloadFields.closedByStage).toBe('3.1.4');
  });
});

describe('phase gates: nothing starts while its own blocker is open', () => {
  it('Phase 11 remains blocked by BOTH Stage 3.1.3 and Stage 3.1.4', () => {
    const gate = manifest.phaseGates.phase_11_live_core_integration;

    // **Neither is accepted.** Stage 3.1.4's hardening is written and tested; ADR-0026 is Proposed
    // and the PR is unmerged. Phase 11 is where real personal data first crosses the boundary, and
    // it may not begin on the strength of code nobody has reviewed. **An implementation is not an
    // acceptance**, and this test is what stops that sentence from being merely a slogan.
    expect(gate.blockedBy).toContain('stage-3.1.3');
    expect(gate.blockedBy).toContain('stage-3.1.4');
  });

  it('Phase 11A additionally requires Phase 11 to have succeeded', () => {
    const gate = manifest.phaseGates.phase_11a_live_communication;

    expect(gate.blockedBy).toContain('stage-3.1.3');
    expect(gate.blockedBy).toContain('stage-3.1.4');
    expect(gate.blockedBy).toContain('phase-11');
  });

  it('every phase gate states a rationale, and a satisfied gate says what satisfied it', () => {
    for (const gate of Object.values(manifest.phaseGates)) {
      if (typeof gate === 'string') continue; // the $comment
      expect(gate.rationale.trim()).not.toBe('');

      // A gate with no blockers left has been satisfied, and must name what satisfied it.
      // "Unblocked, reason unrecorded" is how a gate quietly stops meaning anything. Right now
      // every gate still has a blocker, because nothing has been accepted.
      if (gate.blockedBy.length === 0) {
        expect(gate.satisfiedBy?.length ?? 0).toBeGreaterThan(0);
      }
    }
  });
});

describe('the database boundary is explicit', () => {
  const REQUIRED_FALSE = [
    'sharedDatabase',
    'sharedCredentials',
    'sharedRuntimePackages',
    'jarvisReadsCoreTables',
    'jarvisWritesCoreTables',
    'coreReadsJarvisTables',
    'coreWritesJarvisTables',
  ] as const;

  it.each(REQUIRED_FALSE)('%s is explicitly false', (key) => {
    // Explicitly false, not merely absent. An absent key is a question nobody answered.
    expect(manifest.databaseBoundary).toHaveProperty(key);
    expect(manifest.databaseBoundary[key]).toBe(false);
  });

  it("QuickFurno Core's Supabase project is recorded as permanently forbidden", () => {
    expect(manifest.databaseBoundary['quickfurnoCoreSupabaseProject']).toBe(
      'permanently-forbidden-to-jarvis',
    );
  });
});

describe('every claim names its evidence', () => {
  it('every entity cites at least one source file', () => {
    for (const entity of manifest.entities) {
      expect(entity.sourceFiles.length).toBeGreaterThan(0);
      for (const file of entity.sourceFiles) {
        expect(file.trim()).not.toBe('');
      }
    }
  });

  it('every event mapping cites at least one source file', () => {
    for (const mapping of manifest.eventMappings) {
      expect(mapping.sourceFiles.length).toBeGreaterThan(0);
    }
  });

  it('every source event cites at least one source file', () => {
    for (const event of allSourceEvents) {
      expect(event.sourceFiles.length).toBeGreaterThan(0);
    }
  });

  it('every authority entry cites at least one source file', () => {
    for (const entry of manifest.authority) {
      expect(entry.sourceFiles.length).toBeGreaterThan(0);
    }
  });
});

describe('the manifest carries no personal data, credentials, or live connection details', () => {
  /**
   * A compatibility manifest describes a system that holds real people's phone numbers, home
   * addresses and GPS coordinates. **The one thing it must never do is carry any of them.**
   *
   * These patterns are checked against the raw file text — not the parsed object — so a secret
   * hidden in a comment, a key name, or a stray field is caught just the same.
   */
  const FORBIDDEN_PATTERNS: readonly (readonly [string, RegExp])[] = [
    ['an email address', /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/],
    // Deliberately precise rather than greedy. A looser "any long digit run" pattern flags a
    // migration timestamp (20260701000022), a commit SHA, and an ISO date — and a check that
    // cries wolf on its own manifest is a check somebody switches off. This matches an
    // international number, an Indian mobile (10 digits, leading 6-9), and a separated number,
    // and it matches none of those three.
    ['a phone number', /\+\d[\d\s().-]{7,}\d|\b[6-9]\d{9}\b|\b\d{3}[-.\s]\d{3}[-.\s]\d{4}\b/],
    ['a Supabase project ref or host', /\b[a-z]{20}\.supabase\.(?:co|com)\b/i],
    ['a Supabase management token', /\bsbp_[A-Za-z0-9]+/],
    ['a JWT / API key', /\beyJ[A-Za-z0-9_-]{10,}/],
    ['a PostgreSQL connection URL', /\bpostgres(?:ql)?:\/\//i],
    ['an http(s) URL', /\bhttps?:\/\//i],
    ['a private key block', /-----BEGIN (?:[A-Z ]+ )?PRIVATE KEY-----/],
    ['a service-role key reference', /SUPABASE_SERVICE_ROLE_KEY\s*[:=]\s*["'][^"']+["']/],
  ];

  it.each(FORBIDDEN_PATTERNS)('contains no %s', (_label, pattern) => {
    expect(raw).not.toMatch(pattern);
  });

  it('contains no example client or vendor names', () => {
    // The Core repository ships fabricated sample clients ("Aarav Mehta", "Nisha Rao") in its
    // CRM placeholder. Copying an example person into a compatibility artifact is how a fake
    // record starts being treated as a real one.
    expect(raw).not.toMatch(/Aarav Mehta|Nisha Rao/i);
  });
});

describe('this compatibility suite declares and imports no connector client', () => {
  /**
   * **Two corrections are baked into this suite's name, and both are worth keeping visible.**
   *
   * **The first.** An earlier version asserted `process.env.DATABASE_URL` was `undefined` as its
   * proof of "opens no database". It passed locally and **failed in CI**, because CI exports
   * `DATABASE_URL` at the *job* level — for the integration tests — so the unit tests see it
   * too. The failure was correct and the test was wrong: **it asserted an environment fact and
   * called it a structural property.** Whether a variable happens to be set says nothing about
   * whether this code opens a database.
   *
   * **The second, and the reason this suite is named the way it is.** The replacement then
   * *overclaimed in the other direction* — it said the package "could not connect if it tried",
   * reasoning from the absence of a connector dependency. **That is broader than the proof.**
   * Node exposes network capability through **global `fetch`**, through built-in modules
   * (`node:net`, `node:https`, …), and through **dynamic import** — **none of which requires a
   * package dependency.** Absence of a dependency is evidence about what this code *reaches
   * for*; it is **not** a proof that network access is impossible, and no assertion here is
   * capable of establishing that.
   *
   * **So the claim is narrowed to exactly what the checks below establish:**
   *
   * - the contracts package **declares** no database, provider or HTTP-client dependency;
   * - this file **statically imports** only `node:fs/promises`, `vitest` and the contracts barrel;
   * - the Stage 3.1.2 implementation **contains** no connector client, database operation or
   *   live integration;
   * - the suite reads **only the checked-in manifest**, and CI does **not** fetch QuickFurno.
   *
   * **It does not claim that an arbitrary Node program is incapable of opening a network
   * connection.** These are regression guards on *what this repository declares and imports* —
   * which is a real and useful thing to guard — and they are not a sandbox.
   */
  const FORBIDDEN_CONNECTOR_MODULES = [
    // Database drivers
    'pg',
    'postgres',
    'mysql',
    'mysql2',
    'sqlite3',
    'better-sqlite3',
    'mongodb',
    'redis',
    'ioredis',
    // HTTP / socket clients
    'axios',
    'node-fetch',
    'undici',
    'got',
    'superagent',
    'ws',
    // Node built-ins that speak a network protocol
    'node:http',
    'node:https',
    'node:http2',
    'node:net',
    'node:tls',
    'node:dgram',
    // Provider SDKs
    '@supabase/supabase-js',
    '@supabase/ssr',
  ];

  it('the contracts package declares no database, provider or HTTP-client dependency', async () => {
    const packageJson = await readFile(new URL('../../package.json', import.meta.url), 'utf8');
    const parsed = JSON.parse(packageJson) as {
      readonly dependencies?: Record<string, string>;
      readonly devDependencies?: Record<string, string>;
    };

    const declared = Object.keys({ ...parsed.dependencies, ...parsed.devDependencies });

    for (const connector of FORBIDDEN_CONNECTOR_MODULES) {
      expect(declared).not.toContain(connector);
    }

    // Pinned to the exact bounded set, so "no connector" is a fact about a short list rather
    // than a hopeful statement about a long one. A new dependency of any kind fails this.
    expect(parsed.dependencies).toStrictEqual({ zod: '4.4.3' });
  });

  it('statically imports exactly node:fs/promises, vitest and the contracts barrel', async () => {
    const source = await readFile(new URL(import.meta.url), 'utf8');
    const imports = [...source.matchAll(/^import[^;]*?from\s+'([^']+)';/gm)].map(
      (match) => match[1],
    );

    expect(imports.toSorted()).toStrictEqual(['../index.js', 'node:fs/promises', 'vitest']);

    for (const connector of FORBIDDEN_CONNECTOR_MODULES) {
      expect(imports).not.toContain(connector);
    }
  });

  it('reads only the checked-in manifest', () => {
    // The pinned manifest IS the reviewed baseline, and CI does not fetch QuickFurno. A test
    // that reached across a network to another repository's moving `main` would be a test whose
    // result depended on somebody else's merge. Refreshing the snapshot is an explicit,
    // reviewed act (ADR-0025 §6).
    expect(MANIFEST_URL.pathname).toContain('quickfurno-compatibility-manifest.json');
    expect(raw.length).toBeGreaterThan(0);
  });
});
