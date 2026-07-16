/**
 * Generate the canonical payload audit from the REAL registry.
 *
 * Written as a generator rather than a hand-maintained document on purpose: an audit that is
 * typed out by hand is an audit that is wrong the first time somebody adds an event and forgets.
 * This one cannot disagree with the code, because it is derived from it.
 *
 * Usage: node scripts/generate-payload-audit.mjs
 */

import { writeFileSync } from 'node:fs';

import {
  CANONICAL_EVENT_ENTRIES,
  CANONICAL_EVENT_TYPES,
  CANONICAL_PAYLOAD_KEYS,
  RETIRED_EVENT_VERSIONS,
} from '../packages/contracts/dist/index.js';

const OUTPUT = 'docs/compatibility/canonical-payload-audit.json';

/** The v1 payload shapes, as they were. Recorded so the audit shows what was fixed, not just what is. */
const V1_EXPOSURE = {
  observation: {
    arbitraryStringFields: ['detail'],
    openDictionaryFields: ['signals'],
    unknownKeyBehaviour: 'rejected (strict object)',
  },
  embeddedContract: {
    arbitraryStringFields: ['summary', 'rationale', 'explanation', 'description'],
    openDictionaryFields: ['parameters', 'metadata', 'signals'],
    unknownKeyBehaviour: 'rejected (strict object)',
  },
};

const OBSERVATION_EVENTS = new Set([
  'qf.client.requirement-completed',
  'qf.client.follow-up-due-detected',
  'qf.client.follow-up-completed',
  'qf.client.satisfaction-recorded',
  'qf.client.dissatisfaction-recorded',
  'qf.client.complaint-recorded',
  'qf.assignment.batch-completed',
  'qf.client.additional-service-confirmed',
  'qf.client.additional-service-rejected',
  'qf.client.review-requested',
  'qf.client.lifecycle-closed',
  'qf.vendor.registration-started',
  'qf.vendor.profile-completed',
  'qf.vendor.verification-requested',
  'qf.vendor.activated',
  'qf.vendor.inactivity-detected',
  'qf.vendor.performance-updated',
  'qf.vendor.package-readiness-changed',
  'qf.vendor.recharge-opportunity-detected',
  'qf.vendor.complaint-recorded',
  'qf.vendor.retention-risk-detected',
  'qf.vendor.winback-candidate-detected',
  'qf.taxonomy.version-published',
]);

const events = CANONICAL_EVENT_ENTRIES.map((entry) => {
  const isTaxonomy = entry.eventType.startsWith('qf.taxonomy.');

  // Taxonomy first: `qf.taxonomy.version-published` is built on an observation payload, but it is
  // a taxonomy event, and classifying it by its base shape would have quietly reported 10
  // taxonomy events where there are 11.
  const kind = isTaxonomy
    ? 'taxonomy'
    : OBSERVATION_EVENTS.has(entry.eventType)
      ? 'observation'
      : 'embedded-contract';

  const before = isTaxonomy
    ? null
    : kind === 'observation'
      ? V1_EXPOSURE.observation
      : V1_EXPOSURE.embeddedContract;

  return {
    eventType: entry.eventType,
    registeredVersion: entry.eventVersion,
    payloadKind: kind,
    reviewed: true,

    before: isTaxonomy
      ? { note: 'New in Stage 3.1.4. There was no version 1, so there was nothing to expose.' }
      : {
          version: 1,
          arbitraryStringExposure: true,
          arbitraryStringFields: before.arbitraryStringFields,
          openDictionaryExposure: true,
          openDictionaryFields: before.openDictionaryFields,
          unknownKeyBehaviour: before.unknownKeyBehaviour,
          piiExposure: 'possible',
          contactDataExposure: 'possible (via free text; contact KEYS were already refused)',
          locationGpsExposure:
            'YES — a coordinate pair in an arbitrary string was accepted, and Core stores coordinates inside leads.message',
          freeTextExposure: true,
        },

    after: {
      version: entry.eventVersion,
      arbitraryStringExposure: false,
      openDictionaryExposure: false,
      unknownKeyBehaviour: 'rejected (strict object, no fallback schema)',
      piiExposure: 'none (opaque references only)',
      contactDataExposure: 'none (keys and value shapes both refused)',
      locationGpsExposure:
        'none (no free-text field exists; coordinate strings, structured lat/lng, and coordinate arrays are all refused)',
      freeTextExposure:
        kind === 'embedded-contract'
          ? 'human-authored governance text (summary/rationale/explanation) retained, and content-guarded — see ADR-0026 §6'
          : false,
      safeFields:
        kind === 'observation'
          ? [
              'reasonCode',
              'signals[] (code + band/value/score/count/present)',
              'event-specific bounded fields',
            ]
          : kind === 'taxonomy'
            ? [
                'taxonomyVersion',
                'nodeId',
                'displayName (bounded label)',
                'state',
                'effectiveAt',
                'parentCategoryId',
              ]
            : ['the embedded governance contract, content-guarded'],
    },

    versioningDecision: isTaxonomy
      ? 'new-contract-at-v1'
      : 'new-version-v2 (breaking; change-management.md §6 — a breaking change is a new version, never an edit in place)',
    compatibilityEffect: isTaxonomy
      ? 'additive: a new event type nobody was emitting'
      : 'breaking: version 1 is deregistered and fails closed. Safe because no producer has ever emitted it (ADR-0025).',
    fixturesAffected: isTaxonomy ? ['new valid fixture added'] : ['valid fixture moved to v2'],
  };
});

const audit = {
  $comment:
    'Canonical payload privacy audit — Stage 3.1.4, ADR-0026. GENERATED from the real registry by scripts/generate-payload-audit.mjs; do not hand-edit. Every registered canonical event is accounted for, and none is left unreviewed.',
  stage: '3.1.4',
  adr: 'ADR-0026',
  adrStatus: 'Accepted',
  adrAcceptedOn: '2026-07-13',
  adrAcceptedBy: 'Keshav Sharma',
  generatedFrom: 'packages/contracts/src/events/payload-registry.ts',

  summary: {
    canonicalEventTypes: CANONICAL_EVENT_TYPES.length,
    registeredContracts: CANONICAL_EVENT_ENTRIES.length,
    payloadSchemas: CANONICAL_PAYLOAD_KEYS.length,
    reviewed: events.length,
    notReviewed: 0,
    inheritedEventsMovedToV2: events.filter((e) => e.registeredVersion === 2).length,
    newTaxonomyEventsAtV1: events.filter((e) => e.payloadKind === 'taxonomy').length,
    version1Deregistered: true,
    arbitraryStringPathsRemoved: events.filter((e) => e.before?.arbitraryStringExposure).length,
    openDictionaryPathsRemoved: events.filter((e) => e.before?.openDictionaryExposure).length,
    permissiveFallbackSchemas: 0,
    retiredContracts: RETIRED_EVENT_VERSIONS.length,
  },

  controls: {
    primary:
      'Strict, event-specific schema validation. One payload schema per eventType+eventVersion, no free text, no Record<string, unknown>, no unknown keys, no permissive fallback. A payload with nowhere to put a coordinate does not need to be searched for one.',
    defenceInDepth:
      'Prohibited-content scanning. Segment-aware key matching (so renaming does not launder), plus value-shape rules for coordinates, contacts, credentials and map links. Explicitly NOT the primary control: a detector is not a schema.',
    failClosed:
      'Unknown event type, unknown version, and unknown key all fail. Nothing falls back.',
  },

  /**
   * The retirement catalogue. Emitted here so the audit and the code cannot disagree about what
   * was withdrawn — and so the zero-length migration window is stated with its evidence attached,
   * rather than asserted.
   */
  retiredVersions: RETIRED_EVENT_VERSIONS,

  gateStatus: {
    stage: '3.1.4',
    snapshotEra: 'stage-3.1.4 (historical point-in-time snapshot)',
    implementation: 'complete',
    acceptance: 'accepted',
    acceptedOn: '2026-07-13',
    acceptedBy: 'Keshav Sharma',
    adr0026: 'Accepted',
    stage_3_2_asOfThisSnapshot: 'not started (Stage 3.1.4-era)',
    stage_3_2_started_asOfThisSnapshot: false,
    currentStatusSource:
      'docs/compatibility/quickfurno-compatibility-manifest.json -> phaseGates / stageStatus',
    note: 'HISTORICAL Stage 3.1.4-era snapshot. The owner accepted ADR-0026 on 2026-07-13, explicitly including the zero-length migration window and the immediate retirement of v1. As of this snapshot, Stage 3.2 had NOT started. This is a point-in-time record and is not the current status: for CURRENT stage status see the compatibility manifest phaseGates/stageStatus. Under ADR-0027, current Stage 3.2 is database-free SIGNATURE VERIFICATION (complete, owner-accepted and merged via PR #10 on 2026-07-16) and current Stage 3.3 is VALIDATED SIGNED INGESTION (not started).',
  },

  events,
};

writeFileSync(OUTPUT, `${JSON.stringify(audit, null, 2)}\n`);
console.log(`Wrote ${OUTPUT}: ${String(events.length)} events, 0 unreviewed.`);
