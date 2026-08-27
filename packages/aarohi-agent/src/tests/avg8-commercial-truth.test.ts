/**
 * AVG-8 — commercial truth and the package engine (ADR-0125).
 *
 * The claim under test is narrow: Aarohi can carry the commercial facts Core already holds, exactly,
 * and can do none of the things a reader might assume follow. Nothing here invents a price, ranks a
 * package, calls a model, orders anything or reaches QuickFurno.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  AAROHI_AVG8_COMMERCIAL_SCOPES,
  AAROHI_AVG8_COMMERCIAL_SOURCE_POSTURE,
  AAROHI_AVG8_CONTRACT_VERSION,
  AAROHI_COMMERCIAL_FACTS_POSTURE,
  CORE_COMMERCIAL_FACTS_OUTCOME,
  CORE_PARTY_STATUSES,
  MAX_COMMERCIAL_PACKAGES,
  aarohiCommercialFactsBriefSchema,
  aarohiCommercialFactsPostureSchema,
  appendInstagramInboundObservation,
  coreCommercialCatalogSnapshotSchema,
  coreCommercialPackageOptionSchema,
  createAarohiSalesBrainInterpretation,
  createCoreCommercialCatalogSnapshot,
  createInstagramConversation,
  evaluateAarohiSalesTurn,
  parseAarohiSalesTurnPlan,
  parseAarohiCommercialFactsBrief,
  parseCoreCommercialCatalogSnapshot,
  parseInstagramInboundObservation,
  prepareAarohiCommercialFactsBrief,
} from '../index.js';
import type {
  AarohiSalesBrainInterpretation,
  AarohiSalesConversationIntent,
  AarohiSalesObjectionKind,
  AarohiSalesTurnPlan,
  CoreCommercialCatalogSnapshot,
  CorePartyStatus,
  InstagramConversationSnapshot,
} from '../index.js';

const SRC = fileURLToPath(new URL('../', import.meta.url));

/** Widened to `string` so instant comparisons in the specs are evaluated rather than folded. */
function canonicalInstant(value: string): string {
  return value;
}

const PROSPECT = 'prospect.avg8.alpha';
const CONVERSATION = 'ig.conversation.alpha';
const THREAD = 'ig.thread.alpha';
const IG_PARTICIPANT = 'ig.participant.alpha';
const MESSAGE = 'ig.message.001';

const AT = '2026-08-27T09:00:00Z';
const INTERPRETED = '2026-08-27T09:05:00Z';
const PLANNED = '2026-08-27T09:10:00Z';
const OBSERVED = '2026-08-27T09:15:00Z';
const PREPARED = '2026-08-27T09:20:00Z';

/** Core package ids are UUIDs today. Ordered so canonical id order can be told from other orders. */
const PKG_A = '0a1c2d3e-4f56-4789-8abc-def012345678';
const PKG_B = '7b2c3d4e-5f60-4123-9abc-def012345678';
const PKG_C = 'f3d4e5a6-7b80-4234-8abc-def012345678';

// ===========================================================================
// Fixtures.
// ===========================================================================

function conversation(): InstagramConversationSnapshot {
  const built = createInstagramConversation({
    prospectRef: PROSPECT,
    instagramConversationRef: CONVERSATION,
    instagramThreadRef: THREAD,
    instagramParticipantRef: IG_PARTICIPANT,
  });
  if (!built.ok) throw new Error(`conversation fixture refused: ${built.refusal}`);
  const turn = parseInstagramInboundObservation({
    prospectRef: PROSPECT,
    instagramConversationRef: CONVERSATION,
    instagramThreadRef: THREAD,
    instagramParticipantRef: IG_PARTICIPANT,
    instagramMessageRef: MESSAGE,
    body: 'How much is it?',
    observedAt: AT,
  });
  if (!turn.ok) throw new Error(`turn fixture refused: ${turn.refusal}`);
  const appended = appendInstagramInboundObservation(built.conversation, turn.observation);
  if (!appended.ok) throw new Error(`append refused: ${appended.refusal}`);
  return appended.conversation;
}

const CONVERSATION_FIXTURE = conversation();

function interpretation(
  intent: AarohiSalesConversationIntent = 'COMMERCIAL_TERMS',
  objectionKind: AarohiSalesObjectionKind = 'PRICE_OR_PACKAGE',
): AarohiSalesBrainInterpretation {
  const built = createAarohiSalesBrainInterpretation({
    interpretationRef: 'interp.001',
    conversation: CONVERSATION_FIXTURE,
    intent,
    objectionKind,
    interpretedAt: INTERPRETED,
  });
  if (!built.ok) throw new Error(`interpretation fixture refused: ${built.refusal}`);
  return built.interpretation;
}

function observation(status: CorePartyStatus, prospectRef = PROSPECT): unknown {
  return {
    prospectRef,
    coreLookupRef: `lookup-${status.toLowerCase().replace(/_/gu, '-')}`,
    status,
  };
}

/** An honestly evaluated AVG-7 plan for the given signals. */
function salesPlan(
  intent: AarohiSalesConversationIntent = 'COMMERCIAL_TERMS',
  objectionKind: AarohiSalesObjectionKind = 'PRICE_OR_PACKAGE',
): AarohiSalesTurnPlan {
  const built = evaluateAarohiSalesTurn({
    planRef: 'plan.alpha',
    conversation: CONVERSATION_FIXTURE,
    interpretation: interpretation(intent, objectionKind),
    coreObservation: observation('NOT_REGISTERED'),
    plannedAt: PLANNED,
  });
  if (!built.ok) throw new Error(`plan fixture refused: ${built.refusal}`);
  return built.plan;
}

function packageOption(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: PKG_B,
    name: 'Starter',
    lead_count: 25,
    total_price: 4999,
    display_price: 6999,
    validity_days: 30,
    is_active: true,
    ...over,
  };
}

function catalog(
  packages: readonly Record<string, unknown>[] = [packageOption()],
  over: Record<string, unknown> = {},
): CoreCommercialCatalogSnapshot {
  const built = createCoreCommercialCatalogSnapshot({
    snapshotRef: 'snap.alpha',
    observedAt: OBSERVED,
    packages,
    ...over,
  });
  if (!built.ok) throw new Error(`catalog fixture refused: ${built.refusal}`);
  return built.snapshot;
}

/** A hand-assembled snapshot, built the way a caller would rather than by the builder. */
function forgedCatalog(
  packages: readonly Record<string, unknown>[],
  over: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    contractVersion: AAROHI_AVG8_CONTRACT_VERSION,
    snapshotRef: 'snap.alpha',
    observedAt: OBSERVED,
    sourcePosture: AAROHI_AVG8_COMMERCIAL_SOURCE_POSTURE,
    packages: [...packages],
    ...over,
  };
}

function briefInput(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    briefRef: 'brief.alpha',
    conversation: CONVERSATION_FIXTURE,
    interpretation: interpretation(),
    coreObservation: observation('NOT_REGISTERED'),
    salesPlan: salesPlan(),
    commercialCatalog: catalog(),
    query: { scope: 'AVAILABLE_PACKAGE_CATALOG' },
    preparedAt: PREPARED,
    ...over,
  };
}

/** Every primitive leaf and every key of an object, for scans that read values rather than text. */
function walkValues(value: unknown): readonly unknown[] {
  if (Array.isArray(value)) return value.flatMap(walkValues);
  if (typeof value === 'object' && value !== null) {
    return Object.values(value).flatMap(walkValues);
  }
  return [value];
}

function walkKeys(value: unknown): readonly string[] {
  if (Array.isArray(value)) return value.flatMap(walkKeys);
  if (typeof value === 'object' && value !== null) {
    return Object.entries(value).flatMap(([key, nested]) => [key, ...walkKeys(nested)]);
  }
  return [];
}

// ===========================================================================
// The contract lock: exactly Core's read surface, and nothing behind it.
// ===========================================================================

describe('AVG-8 mirrors the Core available-package READ surface, not the table', () => {
  it('is version 1, and names the observation for what it is', () => {
    expect(AAROHI_AVG8_CONTRACT_VERSION).toBe(1);
    expect(AAROHI_AVG8_COMMERCIAL_SOURCE_POSTURE).toBe(
      'INJECTED_OFFLINE_CORE_COMMERCIAL_CATALOG_OBSERVATION',
    );
    expect([...AAROHI_AVG8_COMMERCIAL_SCOPES]).toStrictEqual([
      'AVAILABLE_PACKAGE_CATALOG',
      'EXACT_PACKAGE',
    ]);
    expect(CORE_COMMERCIAL_FACTS_OUTCOME).toBe(
      'CORE_COMMERCIAL_FACTS_READY_FOR_FUTURE_GOVERNED_DRAFT',
    );
  });

  it('declares exactly the seven fields the read service exposes', () => {
    // `listAvailableVendorPackages()` selects id, name, lead_count, total_price, display_price,
    // validity_days, is_active — and nothing else. The list is asserted rather than described so a
    // field cannot be added without a decision.
    expect(Object.keys(coreCommercialPackageOptionSchema.shape).sort()).toStrictEqual([
      'display_price',
      'id',
      'is_active',
      'lead_count',
      'name',
      'total_price',
      'validity_days',
    ]);
  });

  it('does not reach behind the read surface for price_per_lead or created_at', () => {
    // The raw `packages` table has nine columns. Those two are in the table and NOT in the read
    // service, and `price_per_lead` is the one a sales conversation reaches for. It is absent twice
    // over: not accepted as a field, and never calculated from the two that are present.
    const fields = Object.keys(coreCommercialPackageOptionSchema.shape);
    for (const behind of ['price_per_lead', 'created_at']) {
      expect(fields, behind).not.toContain(behind);
      expect(
        coreCommercialPackageOptionSchema.safeParse(packageOption({ [behind]: 1 })).success,
        behind,
      ).toBe(false);
    }
  });

  it('has no field for a value Core did not expose', () => {
    for (const invented of [
      { price_per_lead: 199 },
      { pricePerLead: 199 },
      { currency: 'INR' },
      { discount: 10 },
      { discount_percent: 10 },
      { savings: 2000 },
      { effective_price: 4999 },
      { final_price: 4999 },
      { list_price: 6999 },
      { sale_price: 4999 },
      { description: 'Great value' },
      { features: ['a'] },
      { benefits: ['a'] },
      { tier: 'gold' },
      { rank: 1 },
      { recommendation: 'BEST_VALUE' },
      { best_value: true },
      { suitability: 'HIGH' },
      { eligibility: true },
      { roi: 3 },
      { conversion_rate: 0.2 },
      { offer: 'LAUNCH' },
      { coupon: 'SAVE10' },
    ]) {
      expect(
        coreCommercialPackageOptionSchema.safeParse(packageOption(invented)).success,
        JSON.stringify(invented),
      ).toBe(false);
    }
  });

  it('imports nothing from QuickFurno and opens no database or network path', () => {
    const avg8 = readFileSync(join(SRC, 'contracts', 'avg8-commercial-truth.ts'), 'utf8');
    const code = avg8
      .replace(/\/\*[\s\S]*?\*\//gu, '')
      .split('\n')
      .filter((line) => !/^\s*\/\//u.test(line))
      .join('\n');

    for (const forbidden of [
      'supabase',
      'adminClient',
      'serviceRole',
      'service_role',
      'createClient',
      '.from(',
      '.select(',
      '.rpc(',
      'quickfurno-marketplace',
      'vendorPackageOrderService',
      'packageService',
      'createVendorPackageOrder',
      'createManualPayment',
      'markPaymentPaid',
      'assignPackageToVendor',
      'assignPackageAfterPayment',
      'listAvailableVendorPackages',
      'process.env',
      'fetch(',
      'node:http',
      'model-gateway',
      'prompt-registry',
      '@mastra',
      'embedding',
      'completeCoreActiveHandoff',
    ]) {
      expect(code, `AVG-8 must not name ${forbidden}`).not.toContain(forbidden);
    }

    // It imports exactly zod and AVG-7 — the plan parser and the evaluator it re-derives with.
    const imports = [...code.matchAll(/from '([^']+)'/gu)].map((match) => match[1]);
    expect(imports.sort()).toStrictEqual(['./avg7-sales-brain.js', './avg7-sales-brain.js', 'zod']);
  });
});

// ===========================================================================
// Package values: copied, never judged.
// ===========================================================================

describe('a package option is Core data, validated but never edited', () => {
  it('accepts a canonical package, with a UUID or a numeric Core id', () => {
    for (const id of [PKG_A, '12345', 'pkg.starter', 'PKG:001']) {
      expect(coreCommercialPackageOptionSchema.safeParse(packageOption({ id })).success, id).toBe(
        true,
      );
    }
  });

  it('preserves the name exactly, without trimming or normalising', () => {
    for (const name of ['Starter', ' Starter ', 'STARTER  PLUS', 'Pack One']) {
      const parsed = coreCommercialPackageOptionSchema.safeParse(packageOption({ name }));
      expect(parsed.success, JSON.stringify(name)).toBe(true);
      if (parsed.success) expect(parsed.data.name).toBe(name);
    }
  });

  it('accepts zero and positive counts, and refuses anything that is not a real count', () => {
    for (const field of ['lead_count', 'validity_days'] as const) {
      for (const good of [0, 1, 25, 3650]) {
        expect(
          coreCommercialPackageOptionSchema.safeParse(packageOption({ [field]: good })).success,
          `${field}=${String(good)}`,
        ).toBe(true);
      }
      for (const bad of [-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, '25', null]) {
        expect(
          coreCommercialPackageOptionSchema.safeParse(packageOption({ [field]: bad })).success,
          `${field}=${String(bad)}`,
        ).toBe(false);
      }
    }
  });

  it('accepts any finite non-negative price, and refuses the values arithmetic would poison', () => {
    for (const field of ['total_price', 'display_price'] as const) {
      for (const good of [0, 1, 4999, 0.5, 1234567.89]) {
        expect(
          coreCommercialPackageOptionSchema.safeParse(packageOption({ [field]: good })).success,
          `${field}=${String(good)}`,
        ).toBe(true);
      }
      for (const bad of [-1, Number.NaN, Number.POSITIVE_INFINITY, '4999', null]) {
        expect(
          coreCommercialPackageOptionSchema.safeParse(packageOption({ [field]: bad })).success,
          `${field}=${String(bad)}`,
        ).toBe(false);
      }
    }
  });

  it('refuses an inactive package rather than filtering it out quietly', () => {
    // This contract models the AVAILABLE-package read, which filters on is_active. Dropping a false
    // row silently is how a caller ends up believing a catalog was complete when it was not.
    expect(
      coreCommercialPackageOptionSchema.safeParse(packageOption({ is_active: false })).success,
    ).toBe(false);
    const built = createCoreCommercialCatalogSnapshot({
      snapshotRef: 'snap.alpha',
      observedAt: OBSERVED,
      packages: [packageOption(), packageOption({ id: PKG_A, is_active: false })],
    });
    expect(built.ok).toBe(false);
  });

  it('holds no opinion about the relationship between the two prices', () => {
    // All three directions are Core's business. A schema that required one of them would be this
    // file deciding which price is real, which is the interpretation it exists to refuse.
    for (const [label, total_price, display_price] of [
      ['total below display', 4999, 6999],
      ['total equal to display', 4999, 4999],
      ['total above display', 6999, 4999],
    ] as const) {
      const parsed = coreCommercialPackageOptionSchema.safeParse(
        packageOption({ total_price, display_price }),
      );
      expect(parsed.success, label).toBe(true);
      if (parsed.success) {
        expect(parsed.data.total_price, label).toBe(total_price);
        expect(parsed.data.display_price, label).toBe(display_price);
      }
    }
  });
});

// ===========================================================================
// The catalog aggregate.
// ===========================================================================

describe('a catalog snapshot is a bounded, deduplicated, canonically ordered aggregate', () => {
  it('stamps the version and posture, and refuses a caller who states them', () => {
    const built = catalog();
    expect(built.contractVersion).toBe(1);
    expect(built.sourcePosture).toBe('INJECTED_OFFLINE_CORE_COMMERCIAL_CATALOG_OBSERVATION');
    for (const forged of [
      { contractVersion: 2 },
      { sourcePosture: 'AUTHENTICATED_CORE_READ' },
      { snapshotSourceAuthenticated: true },
    ]) {
      expect(
        createCoreCommercialCatalogSnapshot({
          snapshotRef: 'snap.alpha',
          observedAt: OBSERVED,
          packages: [packageOption()],
          ...forged,
        }).ok,
        JSON.stringify(forged),
      ).toBe(false);
    }
  });

  it('represents an empty catalog, and one and many packages', () => {
    expect(catalog([]).packages).toStrictEqual([]);
    expect(catalog([packageOption()]).packages).toHaveLength(1);
    expect(
      catalog([packageOption(), packageOption({ id: PKG_A }), packageOption({ id: PKG_C })])
        .packages,
    ).toHaveLength(3);
  });

  it('refuses a duplicate Core package id', () => {
    expect(
      createCoreCommercialCatalogSnapshot({
        snapshotRef: 'snap.alpha',
        observedAt: OBSERVED,
        packages: [packageOption(), packageOption({ name: 'Starter again' })],
      }).ok,
    ).toBe(false);
    // And at the public parser, on a hand-assembled snapshot.
    expect(
      parseCoreCommercialCatalogSnapshot(
        forgedCatalog([packageOption(), packageOption({ name: 'Starter again' })]),
      ),
    ).toBeUndefined();
  });

  it('is bounded, and the bound is enforced at the builder and the parser', () => {
    const many = Array.from({ length: MAX_COMMERCIAL_PACKAGES }, (_unused, index) =>
      packageOption({ id: `pkg.${String(index).padStart(3, '0')}` }),
    );
    expect(catalog(many).packages).toHaveLength(MAX_COMMERCIAL_PACKAGES);
    const tooMany = [...many, packageOption({ id: 'pkg.999' })];
    expect(
      createCoreCommercialCatalogSnapshot({
        snapshotRef: 'snap.alpha',
        observedAt: OBSERVED,
        packages: tooMany,
      }).ok,
    ).toBe(false);
    expect(parseCoreCommercialCatalogSnapshot(forgedCatalog(tooMany))).toBeUndefined();
  });

  it('canonicalises by Core package id, and that order is NOT a ranking', () => {
    // The three fixtures are arranged so id order disagrees with every commercial order. If the
    // canonical order ever became one of those, the first row would be a recommendation.
    const cheapestFewestLeads = packageOption({
      id: PKG_C,
      lead_count: 5,
      total_price: 999,
      display_price: 999,
    });
    const middle = packageOption({
      id: PKG_A,
      lead_count: 50,
      total_price: 8999,
      display_price: 9999,
    });
    const dearestMostLeads = packageOption({
      id: PKG_B,
      lead_count: 100,
      total_price: 14999,
      display_price: 19999,
    });

    const built = catalog([dearestMostLeads, cheapestFewestLeads, middle]);
    expect(built.packages.map((one) => one.id)).toStrictEqual([PKG_A, PKG_B, PKG_C]);

    const byLeadCount = [...built.packages]
      .sort((l, r) => l.lead_count - r.lead_count)
      .map((o) => o.id);
    const byTotalPrice = [...built.packages]
      .sort((l, r) => l.total_price - r.total_price)
      .map((o) => o.id);
    const byDisplayPrice = [...built.packages]
      .sort((l, r) => l.display_price - r.display_price)
      .map((o) => o.id);
    const canonical = built.packages.map((one) => one.id);
    expect(canonical).not.toStrictEqual(byLeadCount);
    expect(canonical).not.toStrictEqual(byTotalPrice);
    expect(canonical).not.toStrictEqual(byDisplayPrice);
  });

  it('refuses an unsorted hand-assembled snapshot rather than reordering it', () => {
    // A public canonical parser certifies the value it was shown. Silently repairing a producer's
    // contract violation would hide the fact that a producer is violating it.
    const unsorted = forgedCatalog([packageOption({ id: PKG_C }), packageOption({ id: PKG_A })]);
    expect(parseCoreCommercialCatalogSnapshot(unsorted)).toBeUndefined();
    expect(coreCommercialCatalogSnapshotSchema.safeParse(unsorted).success).toBe(false);
    // The same two packages in canonical order parse.
    expect(
      parseCoreCommercialCatalogSnapshot(
        forgedCatalog([packageOption({ id: PKG_A }), packageOption({ id: PKG_C })]),
      ),
    ).toBeDefined();
  });

  it('screens its OWN snapshot ref, and leaves Core package ids alone', () => {
    // The AVG-7 owner-review lesson: a reference this stage invents gets the local contact screen; a
    // reference Core owns keeps Core's grammar. A numeric package id is an identifier.
    for (const smuggled of [
      '919812345678',
      '9_1_9_8_1_2_3_4_5_6_7_8',
      '91:98:12:34:56:78',
      'someone@example.com',
      'www.example.com',
    ]) {
      expect(
        createCoreCommercialCatalogSnapshot({
          snapshotRef: smuggled,
          observedAt: OBSERVED,
          packages: [packageOption()],
        }).ok,
        smuggled,
      ).toBe(false);
      expect(
        coreCommercialPackageOptionSchema.safeParse(packageOption({ id: smuggled })).success ||
          smuggled.includes('@') ||
          smuggled.includes('www.'),
        smuggled,
      ).toBe(true);
    }
    expect(catalog([packageOption({ id: '919812345678' })]).packages[0]?.id).toBe('919812345678');
    expect(catalog([], { snapshotRef: 'snap.123456' }).snapshotRef).toBe('snap.123456');
  });

  it('returns frozen, detached objects', () => {
    const packages = [packageOption()];
    const built = catalog(packages);
    expect(Object.isFrozen(built)).toBe(true);
    expect(Object.isFrozen(built.packages)).toBe(true);
    expect(Object.isFrozen(built.packages[0])).toBe(true);
    // Mutating the caller's array afterwards changes nothing.
    packages.push(packageOption({ id: PKG_A }));
    expect(built.packages).toHaveLength(1);
    const reparsed = parseCoreCommercialCatalogSnapshot(built);
    expect(reparsed?.packages[0]).not.toBe(built.packages[0]);
  });
});

// ===========================================================================
// The AVG-7 plan is re-derived, not believed.
// ===========================================================================

describe('a commercial brief rests on a plan it re-derives from scratch', () => {
  it('prepares a brief from an honest commercial-context plan', () => {
    const built = prepareAarohiCommercialFactsBrief(briefInput());
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    expect(built.brief.outcome).toBe('CORE_COMMERCIAL_FACTS_READY_FOR_FUTURE_GOVERNED_DRAFT');
    expect(built.brief.salesPlanRef).toBe('plan.alpha');
    expect(built.brief.prospectRef).toBe(PROSPECT);
    expect(built.brief.interpretationRef).toBe('interp.001');
  });

  it('refuses a malformed plan, and a plan the evaluator does not reproduce', () => {
    for (const bad of [undefined, null, {}, { planRef: 'plan.alpha' }]) {
      const built = prepareAarohiCommercialFactsBrief(briefInput({ salesPlan: bad }));
      expect(built.ok, JSON.stringify(bad)).toBe(false);
      if (!built.ok) expect(built.refusal).toBe('SALES_PLAN_INVALID');
    }

    // Every one of these parses as a plan. None of them is what the policy produces for this
    // conversation, this interpretation and this Core observation.
    const honest = salesPlan();
    for (const [label, forged] of [
      ['another prospect', { ...honest, prospectRef: 'prospect.avg8.beta' }],
      ['another interpretation', { ...honest, interpretationRef: 'interp.999' }],
      ['another Core lookup', { ...honest, coreLookupRef: 'lookup-elsewhere' }],
      // An instant EARLIER than the interpretation. Note the asymmetry, and why it is correct: the
      // re-derivation is seeded with the supplied plan's own `plannedAt`, so moving it LATER
      // produces a plan the policy genuinely would have made at that later instant -- an honest
      // plan, not a forgery. Moving it earlier breaks AVG-7's causal chain, and re-derivation
      // refuses to produce anything at all.
      ['an impossible instant', { ...honest, plannedAt: '2026-08-27T09:04:59Z' }],
      ['another conversation', { ...honest, instagramConversationRef: 'ig.conversation.beta' }],
      ['another message', { ...honest, instagramMessageRef: 'ig.message.999' }],
      [
        'a rewritten brief',
        { ...honest, brief: { ...honest.brief, requiresCoreCommercialContext: false } },
      ],
      [
        'a rewritten posture',
        { ...honest, posture: { ...honest.posture, priceOriginatedByBrain: true } },
      ],
    ] as const) {
      const built = prepareAarohiCommercialFactsBrief(briefInput({ salesPlan: forged }));
      expect(built.ok, label).toBe(false);
      if (!built.ok) {
        expect(
          built.refusal === 'SALES_PLAN_POLICY_MISMATCH' || built.refusal === 'SALES_PLAN_INVALID',
          `${label} -> ${built.refusal}`,
        ).toBe(true);
      }
    }
  });

  it('accepts a later plan instant, because that plan is one the policy would have made', () => {
    // The honest reading of the seed asymmetry above. A plan stamped later is not a forged plan; it
    // is the plan AVG-7 produces for that instant, and re-derivation confirms it. What it cannot do
    // is make a stale catalog look fresh -- staleness is measured against this same instant, so
    // moving the plan later only makes the catalog MORE likely to be refused.
    const honest = salesPlan();
    const later = { ...honest, plannedAt: '2026-08-27T09:11:00Z' };
    expect(prepareAarohiCommercialFactsBrief(briefInput({ salesPlan: later })).ok).toBe(true);
    const pushedPastTheCatalog = { ...honest, plannedAt: '2026-08-27T09:16:00Z' };
    const stale = prepareAarohiCommercialFactsBrief(
      briefInput({ salesPlan: pushedPastTheCatalog }),
    );
    expect(stale.ok).toBe(false);
    if (!stale.ok) expect(stale.refusal).toBe('COMMERCIAL_CATALOG_STALE_FOR_PLAN');
  });

  it('refuses an honestly re-derived plan that did not ask for commercial context', () => {
    for (const [intent, objectionKind] of [
      ['GENERAL_INFORMATION', 'NONE'],
      ['SERVICE_FIT', 'TIMING_OR_NOT_READY'],
      ['REGISTRATION_PROCESS', 'NONE'],
      ['PAYMENT_OR_ACTIVATION', 'NONE'],
      ['REJECTION_OR_STOP', 'NONE'],
      ['GENERAL_INFORMATION', 'PRIVACY_OR_CONTACT'],
      ['GENERAL_INFORMATION', 'OTHER'],
      ['OTHER_OR_UNCLEAR', 'NONE'],
    ] as const) {
      const built = prepareAarohiCommercialFactsBrief(
        briefInput({
          interpretation: interpretation(intent, objectionKind),
          salesPlan: salesPlan(intent, objectionKind),
        }),
      );
      expect(built.ok, `${intent}/${objectionKind}`).toBe(false);
      if (!built.ok) {
        expect(built.refusal, `${intent}/${objectionKind}`).toBe('SALES_PLAN_NOT_COMMERCIAL');
      }
    }
  });

  it('cannot be reached by hand-writing the commercial strategy onto a plan', () => {
    // The one forgery worth naming: an ordinary plan re-labelled as a commercial request. AVG-7's
    // own schema refuses the mismatched brief, and re-derivation would refuse it anyway.
    const ordinary = salesPlan('GENERAL_INFORMATION', 'NONE');
    const relabelled = {
      ...ordinary,
      brief: { ...ordinary.brief, strategy: 'REQUEST_CORE_COMMERCIAL_CONTEXT' },
    };
    const built = prepareAarohiCommercialFactsBrief(briefInput({ salesPlan: relabelled }));
    expect(built.ok).toBe(false);
    if (!built.ok) {
      expect(['SALES_PLAN_INVALID', 'SALES_PLAN_POLICY_MISMATCH']).toContain(built.refusal);
    }
  });

  it("refuses a plan wearing another turn's brief, even a perfectly consistent one", () => {
    // Both of these are honest plans. The forgery swaps one's brief onto the other, and AVG-7's plan
    // schema cannot object: the brief is internally consistent, its obligations match its strategy,
    // and nothing in that schema ties a brief to the interpretation the plan names. Only re-deriving
    // the plan and comparing the nested brief catches it.
    const commercial = salesPlan();
    const ordinary = salesPlan('GENERAL_INFORMATION', 'NONE');
    expect(commercial.brief.strategy).toBe('REQUEST_CORE_COMMERCIAL_CONTEXT');
    expect(ordinary.brief.strategy).toBe('PREPARE_NONCOMMERCIAL_REPLY_BRIEF');

    const swapped = { ...commercial, brief: { ...ordinary.brief } };
    // It parses as a plan. That is the point.
    expect(parseAarohiSalesTurnPlan(swapped)).toBeDefined();

    const built = prepareAarohiCommercialFactsBrief(briefInput({ salesPlan: swapped }));
    expect(built.ok).toBe(false);
    if (!built.ok) expect(built.refusal).toBe('SALES_PLAN_POLICY_MISMATCH');

    // And the mirror: a commercial brief swapped onto a plan whose interpretation was ordinary.
    const mirrored = { ...ordinary, brief: { ...commercial.brief } };
    expect(parseAarohiSalesTurnPlan(mirrored)).toBeDefined();
    const other = prepareAarohiCommercialFactsBrief(
      briefInput({
        interpretation: interpretation('GENERAL_INFORMATION', 'NONE'),
        salesPlan: mirrored,
      }),
    );
    expect(other.ok).toBe(false);
    if (!other.ok) expect(other.refusal).toBe('SALES_PLAN_POLICY_MISMATCH');
  });

  it('inherits the CURRENT Core gate, so no status but NOT_REGISTERED reaches a price', () => {
    for (const status of CORE_PARTY_STATUSES) {
      const built = prepareAarohiCommercialFactsBrief(
        briefInput({ coreObservation: observation(status) }),
      );
      if (status === 'NOT_REGISTERED') {
        expect(built.ok, status).toBe(true);
        continue;
      }
      // The plan was made under NOT_REGISTERED; the CURRENT observation says otherwise, so
      // re-derivation cannot reproduce it. A stale eligibility buys nothing.
      expect(built.ok, status).toBe(false);
      if (!built.ok) expect(built.refusal, status).toBe('SALES_PLAN_POLICY_MISMATCH');
    }
  });
});

// ===========================================================================
// Causality: the facts must be no older than the request.
// ===========================================================================

describe('the catalog answers the request, rather than happening to exist', () => {
  it('refuses an observation older than the plan that asked for it', () => {
    const built = prepareAarohiCommercialFactsBrief(
      briefInput({
        commercialCatalog: catalog([packageOption()], { observedAt: '2026-08-27T09:09:59Z' }),
      }),
    );
    expect(built.ok).toBe(false);
    if (!built.ok) expect(built.refusal).toBe('COMMERCIAL_CATALOG_STALE_FOR_PLAN');
  });

  it('allows the same instant and any instant after it', () => {
    for (const observedAt of [PLANNED, '2026-08-27T09:10:00.000Z', OBSERVED]) {
      const built = prepareAarohiCommercialFactsBrief(
        briefInput({
          commercialCatalog: catalog([packageOption()], { observedAt }),
        }),
      );
      expect(built.ok, observedAt).toBe(true);
    }
  });

  it('compares the instant a timestamp means, not the way it is spelled', () => {
    const halfPast = canonicalInstant('2026-08-27T09:10:00.500Z');
    const wholeSecond = canonicalInstant('2026-08-27T09:10:00Z');
    // As STRINGS `.500Z` sorts before `Z`, so a lexicographic check reaches both answers backwards.
    expect(halfPast < wholeSecond).toBe(true);

    // Plan half a second after the catalog: refused, though the strings say otherwise.
    const planHalfPast = evaluateAarohiSalesTurn({
      planRef: 'plan.alpha',
      conversation: CONVERSATION_FIXTURE,
      interpretation: interpretation(),
      coreObservation: observation('NOT_REGISTERED'),
      plannedAt: halfPast,
    });
    expect(planHalfPast.ok).toBe(true);
    if (!planHalfPast.ok) return;
    const stale = prepareAarohiCommercialFactsBrief(
      briefInput({
        salesPlan: planHalfPast.plan,
        commercialCatalog: catalog([packageOption()], { observedAt: wholeSecond }),
      }),
    );
    expect(stale.ok).toBe(false);
    if (!stale.ok) expect(stale.refusal).toBe('COMMERCIAL_CATALOG_STALE_FOR_PLAN');

    // The mirror: plan on the whole second, catalog half a second later. Coherent, though a
    // lexicographic check would refuse it.
    expect(
      prepareAarohiCommercialFactsBrief(
        briefInput({ commercialCatalog: catalog([packageOption()], { observedAt: halfPast }) }),
      ).ok,
    ).toBe(true);
  });

  it('refuses a brief that claims to predate its own catalog', () => {
    const built = prepareAarohiCommercialFactsBrief(
      briefInput({ preparedAt: '2026-08-27T09:14:59Z' }),
    );
    expect(built.ok).toBe(false);
    if (!built.ok) expect(built.refusal).toBe('COMMERCIAL_BRIEF_BEFORE_CATALOG');

    for (const preparedAt of [OBSERVED, '2026-08-27T09:15:00.000Z', PREPARED]) {
      expect(prepareAarohiCommercialFactsBrief(briefInput({ preparedAt })).ok, preparedAt).toBe(
        true,
      );
    }
  });

  it('refuses a timestamp that is not a real instant', () => {
    for (const bad of [
      '2026-02-30T09:20:00Z',
      '2026-13-01T09:20:00Z',
      '2026-08-27T24:00:00Z',
      '2026-08-27T09:20:00',
      '2026-08-27T09:20:00+05:30',
    ]) {
      expect(prepareAarohiCommercialFactsBrief(briefInput({ preparedAt: bad })).ok, bad).toBe(
        false,
      );
      expect(
        createCoreCommercialCatalogSnapshot({
          snapshotRef: 'snap.alpha',
          observedAt: bad,
          packages: [packageOption()],
        }).ok,
        bad,
      ).toBe(false);
    }
  });

  it('holds the whole causal chain, message to brief', () => {
    const built = prepareAarohiCommercialFactsBrief(briefInput());
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    const asMs = (value: string): number => Date.parse(value);
    expect(asMs(AT)).toBeLessThanOrEqual(asMs(INTERPRETED));
    expect(asMs(INTERPRETED)).toBeLessThanOrEqual(asMs(PLANNED));
    expect(asMs(PLANNED)).toBeLessThanOrEqual(asMs(built.brief.catalogObservedAt));
    expect(asMs(built.brief.catalogObservedAt)).toBeLessThanOrEqual(asMs(built.brief.preparedAt));
  });
});

// ===========================================================================
// Selection is lookup, and lookup is all it is.
// ===========================================================================

describe('selection is an identifier lookup, never a choice', () => {
  const THREE = [
    packageOption({ id: PKG_C, lead_count: 5, total_price: 999, display_price: 1499 }),
    packageOption({ id: PKG_A, lead_count: 50, total_price: 8999, display_price: 9999 }),
    packageOption({ id: PKG_B, lead_count: 100, total_price: 14999, display_price: 19999 }),
  ];

  it('returns every available package in catalog scope', () => {
    const built = prepareAarohiCommercialFactsBrief(
      briefInput({ commercialCatalog: catalog(THREE) }),
    );
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    expect(built.brief.scope).toBe('AVAILABLE_PACKAGE_CATALOG');
    expect(built.brief.packages.map((one) => one.id)).toStrictEqual([PKG_A, PKG_B, PKG_C]);
  });

  it('refuses a requested package in catalog scope, and requires one in exact scope', () => {
    expect(
      prepareAarohiCommercialFactsBrief(
        briefInput({ query: { scope: 'AVAILABLE_PACKAGE_CATALOG', requestedPackageRef: PKG_A } }),
      ).ok,
    ).toBe(false);
    expect(
      prepareAarohiCommercialFactsBrief(briefInput({ query: { scope: 'EXACT_PACKAGE' } })).ok,
    ).toBe(false);
  });

  it('returns exactly the requested package, and never a different one', () => {
    const built = prepareAarohiCommercialFactsBrief(
      briefInput({
        commercialCatalog: catalog(THREE),
        query: { scope: 'EXACT_PACKAGE', requestedPackageRef: PKG_A },
      }),
    );
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    expect(built.brief.scope).toBe('EXACT_PACKAGE');
    expect(built.brief.packages).toHaveLength(1);
    expect(built.brief.packages[0]?.id).toBe(PKG_A);
  });

  it('refuses an unknown package id with no fallback whatsoever', () => {
    const built = prepareAarohiCommercialFactsBrief(
      briefInput({
        commercialCatalog: catalog(THREE),
        query: { scope: 'EXACT_PACKAGE', requestedPackageRef: 'pkg.does-not-exist' },
      }),
    );
    expect(built.ok).toBe(false);
    // Not the first, not the cheapest, not the nearest. A package Core does not list does not exist.
    if (!built.ok) expect(built.refusal).toBe('PACKAGE_NOT_IN_CORE_CATALOG');
  });

  it('accepts a numeric or UUID Core id for exact lookup', () => {
    for (const id of [PKG_A, '12345', 'pkg.starter']) {
      const built = prepareAarohiCommercialFactsBrief(
        briefInput({
          commercialCatalog: catalog([packageOption({ id })]),
          query: { scope: 'EXACT_PACKAGE', requestedPackageRef: id },
        }),
      );
      expect(built.ok, id).toBe(true);
      if (built.ok) expect(built.brief.packages[0]?.id, id).toBe(id);
    }
  });

  it('accepts no preference, budget or optimisation target', () => {
    // A function that takes a preference and returns a package is a recommendation engine.
    for (const forged of [
      { scope: 'CHEAPEST' },
      { scope: 'BEST_VALUE' },
      { scope: 'RECOMMENDED' },
      { scope: 'AVAILABLE_PACKAGE_CATALOG', maxBudget: 5000 },
      { scope: 'AVAILABLE_PACKAGE_CATALOG', desiredLeadCount: 50 },
      { scope: 'AVAILABLE_PACKAGE_CATALOG', optimizeFor: 'ROI' },
      { scope: 'EXACT_PACKAGE', requestedPackageRef: PKG_A, orderBy: 'total_price' },
    ]) {
      const built = prepareAarohiCommercialFactsBrief(briefInput({ query: forged }));
      expect(built.ok, JSON.stringify(forged)).toBe(false);
      if (!built.ok) expect(built.refusal).toBe('COMMERCIAL_INPUT_INVALID');
    }
  });

  it('refuses to present an empty catalog as a brief of facts', () => {
    const built = prepareAarohiCommercialFactsBrief(briefInput({ commercialCatalog: catalog([]) }));
    expect(built.ok).toBe(false);
    if (!built.ok) expect(built.refusal).toBe('COMMERCIAL_CATALOG_EMPTY');
  });
});

// ===========================================================================
// The facts are carried whole, and nothing is derived from them.
// ===========================================================================

describe('every Core fact is copied exactly, and no new number is made', () => {
  const ODD = packageOption({
    id: PKG_A,
    name: '  Growth  Pack  ',
    lead_count: 0,
    total_price: 1234.56,
    display_price: 999.99,
    validity_days: 0,
  });

  it('copies all seven fields in catalog scope and in exact scope', () => {
    for (const query of [
      { scope: 'AVAILABLE_PACKAGE_CATALOG' },
      { scope: 'EXACT_PACKAGE', requestedPackageRef: PKG_A },
    ]) {
      const built = prepareAarohiCommercialFactsBrief(
        briefInput({ commercialCatalog: catalog([ODD]), query }),
      );
      expect(built.ok, JSON.stringify(query)).toBe(true);
      if (!built.ok) continue;
      const carried = built.brief.packages[0];
      expect(Object.keys(carried ?? {}).sort()).toStrictEqual([
        'display_price',
        'id',
        'is_active',
        'lead_count',
        'name',
        'total_price',
        'validity_days',
      ]);
      expect(carried?.id).toBe(PKG_A);
      expect(carried?.name).toBe('  Growth  Pack  ');
      expect(carried?.lead_count).toBe(0);
      expect(carried?.total_price).toBe(1234.56);
      expect(carried?.display_price).toBe(999.99);
      expect(carried?.validity_days).toBe(0);
      expect(carried?.is_active).toBe(true);
    }
  });

  it('carries both prices unchanged in all three directions', () => {
    for (const [label, total_price, display_price] of [
      ['below', 4999, 6999],
      ['equal', 4999, 4999],
      ['above', 6999, 4999],
    ] as const) {
      const built = prepareAarohiCommercialFactsBrief(
        briefInput({
          commercialCatalog: catalog([packageOption({ total_price, display_price })]),
        }),
      );
      expect(built.ok, label).toBe(true);
      if (!built.ok) continue;
      expect(built.brief.packages[0]?.total_price, label).toBe(total_price);
      expect(built.brief.packages[0]?.display_price, label).toBe(display_price);
    }
  });

  it('makes no third number out of the numbers it was given', () => {
    const built = prepareAarohiCommercialFactsBrief(
      briefInput({
        commercialCatalog: catalog([
          packageOption({
            lead_count: 25,
            total_price: 4999,
            display_price: 6999,
            validity_days: 30,
          }),
        ]),
      }),
    );
    expect(built.ok).toBe(true);
    if (!built.ok) return;

    // The strongest available statement: the ONLY numbers anywhere in a brief are the contract
    // version and the five Core values. A discount, a saving, a per-lead price and an effective
    // price are all numbers, so counting them is tighter than naming the fields they might arrive in.
    const numbers = walkValues(built.brief).filter((one) => typeof one === 'number');
    expect([...numbers].sort((left, right) => left - right)).toStrictEqual([1, 25, 30, 4999, 6999]);
    // Specifically: the difference, the ratio and the per-lead figure are all absent.
    for (const derived of [2000, 6999 - 4999, 4999 / 25, 6999 / 25, 0.2857]) {
      expect(numbers, String(derived)).not.toContain(derived);
    }
  });

  it('accepts exactly eight input fields, so no override can be added quietly', () => {
    // Read from the source rather than from a list somebody maintains here. The eight are: the
    // brief's own reference, the four artifacts it re-derives or parses, the query scope and the
    // instant. NOT ONE of them is a commercial value, and a ninth field would fail this spec before
    // it could ever carry one.
    const avg8 = readFileSync(join(SRC, 'contracts', 'avg8-commercial-truth.ts'), 'utf8');
    const block = /const commercialBriefInputSchema = z\s*\.object\(\{([\s\S]*?)\}\)/u.exec(avg8);
    expect(block).not.toBeNull();
    const fields = [...(block?.[1] ?? '').matchAll(/^ {4}(\w+):/gmu)].map((match) => match[1]);
    expect(fields.sort()).toStrictEqual([
      'briefRef',
      'commercialCatalog',
      'conversation',
      'coreObservation',
      'interpretation',
      'preparedAt',
      'query',
      'salesPlan',
    ]);
    // And the carried packages are copied, never mapped over: a `.map(` on that line is where a
    // substitution or a rounding would live.
    expect(avg8).toContain('packages: frozenPackages(selected),');
  });

  it('gives the caller no way to state a commercial value', () => {
    for (const forged of [
      { name: 'Renamed' },
      { total_price: 1 },
      { display_price: 1 },
      { lead_count: 999 },
      { validity_days: 999 },
      { is_active: false },
      { currency: 'INR' },
      { discount: 10 },
      { packages: [packageOption({ total_price: 1 })] },
    ]) {
      const built = prepareAarohiCommercialFactsBrief(briefInput(forged));
      expect(built.ok, JSON.stringify(forged)).toBe(false);
      if (!built.ok) expect(built.refusal).toBe('COMMERCIAL_INPUT_INVALID');
    }
  });

  it('carries no key that could hold an invented commercial value', () => {
    const built = prepareAarohiCommercialFactsBrief(briefInput());
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    const declarations = new Set(Object.keys(AAROHI_COMMERCIAL_FACTS_POSTURE));
    const keys = walkKeys(built.brief)
      .filter((key) => !declarations.has(key))
      .map((key) => key.toLowerCase());
    for (const forbidden of [
      'currency',
      'discount',
      'saving',
      'effective',
      'final_price',
      'listprice',
      'saleprice',
      'per_lead',
      'perlead',
      'rank',
      'recommend',
      'suitab',
      'eligib',
      'description',
      'explanation',
      'summary',
      'reply',
      'body',
      'message',
      'pitch',
      'reason',
    ]) {
      expect(
        keys.filter((key) => key.includes(forbidden)),
        forbidden,
      ).toStrictEqual([]);
    }
  });

  it('returns frozen, detached packages', () => {
    const built = prepareAarohiCommercialFactsBrief(briefInput());
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    expect(Object.isFrozen(built)).toBe(true);
    expect(Object.isFrozen(built.brief)).toBe(true);
    expect(Object.isFrozen(built.brief.packages)).toBe(true);
    expect(Object.isFrozen(built.brief.packages[0])).toBe(true);
    expect(Object.isFrozen(built.brief.posture)).toBe(true);
    const reparsed = parseAarohiCommercialFactsBrief(built.brief);
    expect(reparsed).toBeDefined();
    expect(reparsed?.packages[0]).not.toBe(built.brief.packages[0]);
  });
});

// ===========================================================================
// The posture: what a brief cannot claim.
// ===========================================================================

describe('every brief pins the authority ceiling as literals', () => {
  const FALSE_DECLARATIONS = [
    'snapshotSourceAuthenticated',
    'packageRecommended',
    'bestPackageClaimed',
    'packageRanked',
    'packageEligibilityGranted',
    'commercialTruthMutated',
    'commercialCommitmentCreated',
    'priceAdjusted',
    'priceInterpreted',
    'derivedPriceCalculated',
    'discountCreated',
    'savingsCalculated',
    'currencyInvented',
    'offerCreated',
    'materialPackageLimitationHidden',
    'registrationMutated',
    'paymentMutated',
    'packageOrderCreated',
    'packageAssigned',
    'creditsMutated',
    'activationMutated',
    'acquisitionCaseMutated',
    'anishaHandoffExecuted',
    'modelCallExecuted',
    'promptResolved',
    'retrievalExecuted',
    'communicationRequestCreated',
    'approvalRequestCreated',
    'approvalDecisionCreated',
    'communicationAuthorizationCreated',
    'executionIntentCreated',
    'n8nExecutionRequested',
    'providerSendRequested',
    'channelSendRequested',
    'sent',
    'delivered',
    'productionMutation',
    'businessEffect',
  ] as const;

  const TRUE_DECLARATIONS = [
    'referenceFactsOnly',
    'commercialFactsReadyForFutureGovernedDraft',
    'requiresCoreCommercialRevalidationBeforeFutureOutboundUse',
  ] as const;

  it('holds every declaration on every reachable brief', () => {
    for (const query of [
      { scope: 'AVAILABLE_PACKAGE_CATALOG' },
      { scope: 'EXACT_PACKAGE', requestedPackageRef: PKG_B },
    ]) {
      const built = prepareAarohiCommercialFactsBrief(briefInput({ query }));
      expect(built.ok, JSON.stringify(query)).toBe(true);
      if (!built.ok) continue;
      const posture = built.brief.posture as unknown as Readonly<Record<string, unknown>>;
      for (const declared of FALSE_DECLARATIONS) {
        expect(posture[declared], declared).toBe(false);
      }
      for (const declared of TRUE_DECLARATIONS) {
        expect(posture[declared], declared).toBe(true);
      }
    }
  });

  it('is complete: the list and the posture agree, in both directions', () => {
    // A governance list that can quietly lose a member is a list that eventually will. Asserted
    // against the posture rather than against somebody's memory.
    const posture = AAROHI_COMMERCIAL_FACTS_POSTURE as unknown as Readonly<Record<string, unknown>>;
    const falseFields = Object.entries(posture)
      .filter(([, value]) => value === false)
      .map(([key]) => key);
    const trueFields = Object.entries(posture)
      .filter(([, value]) => value === true)
      .map(([key]) => key);
    expect([...FALSE_DECLARATIONS].sort()).toStrictEqual(falseFields.sort());
    expect([...TRUE_DECLARATIONS].sort()).toStrictEqual(trueFields.sort());
  });

  it('fails to construct a posture that says otherwise', () => {
    for (const declared of FALSE_DECLARATIONS) {
      expect(
        aarohiCommercialFactsPostureSchema.safeParse({
          ...AAROHI_COMMERCIAL_FACTS_POSTURE,
          [declared]: true,
        }).success,
        declared,
      ).toBe(false);
    }
    for (const declared of TRUE_DECLARATIONS) {
      expect(
        aarohiCommercialFactsPostureSchema.safeParse({
          ...AAROHI_COMMERCIAL_FACTS_POSTURE,
          [declared]: false,
        }).success,
        declared,
      ).toBe(false);
    }
    expect(
      aarohiCommercialFactsPostureSchema.safeParse({
        ...AAROHI_COMMERCIAL_FACTS_POSTURE,
        extra: true,
      }).success,
    ).toBe(false);
  });

  it('refuses a hand-built brief carrying any of them wrong', () => {
    const built = prepareAarohiCommercialFactsBrief(briefInput());
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    for (const declared of [...FALSE_DECLARATIONS, ...TRUE_DECLARATIONS]) {
      const posture = built.brief.posture as unknown as Readonly<Record<string, unknown>>;
      const forged = {
        ...built.brief,
        posture: { ...posture, [declared]: !(posture[declared] as boolean) },
      };
      expect(aarohiCommercialFactsBriefSchema.safeParse(forged).success, declared).toBe(false);
      expect(parseAarohiCommercialFactsBrief(forged), declared).toBeUndefined();
    }
  });

  it('keeps lead_count a count and not a promise', () => {
    // AVG-7 pins all three guarantees false. A package that entitles somebody to 100 leads is not a
    // promise that 100 leads will arrive, be qualified, or convert.
    const built = prepareAarohiCommercialFactsBrief(
      briefInput({ commercialCatalog: catalog([packageOption({ lead_count: 100 })]) }),
    );
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    expect(built.brief.packages[0]?.lead_count).toBe(100);
    const keys = walkKeys(built.brief).map((key) => key.toLowerCase());
    for (const forbidden of [
      'guarantee',
      'promised',
      'delivered_leads',
      'qualified',
      'conversion',
      'revenue',
    ]) {
      expect(
        keys.filter((key) => key.includes(forbidden) && key !== 'delivered'),
        forbidden,
      ).toStrictEqual([]);
    }
    // The plan this brief rests on still says so.
    expect(salesPlan().posture.guaranteeLeadVolume).toBe(false);
    expect(salesPlan().posture.guaranteeRevenue).toBe(false);
    expect(salesPlan().posture.guaranteeConversion).toBe(false);
  });

  it('does not rewrite the AVG-7 plan it rested on', () => {
    // The plan recorded that facts were MISSING when it was made. That stays true, and AVG-8 says
    // its own separate thing rather than editing somebody else's record.
    const plan = salesPlan();
    const built = prepareAarohiCommercialFactsBrief(briefInput({ salesPlan: plan }));
    expect(built.ok).toBe(true);
    expect(plan.brief.futureModelDraftEligible).toBe(false);
    expect(plan.brief.requiresCoreCommercialContext).toBe(true);
    if (!built.ok) return;
    expect(built.brief.posture.commercialFactsReadyForFutureGovernedDraft).toBe(true);
    expect(built.brief.posture.requiresCoreCommercialRevalidationBeforeFutureOutboundUse).toBe(
      true,
    );
  });
});

// ===========================================================================
// The public parser certifies what the builder produced, and AVG-8 stops here.
// ===========================================================================

describe('the brief parser is strict, and nothing downstream consumes it', () => {
  it('accepts an evaluator-produced brief and rebuilds it', () => {
    const built = prepareAarohiCommercialFactsBrief(briefInput());
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    const reparsed = parseAarohiCommercialFactsBrief(built.brief);
    expect(reparsed).toBeDefined();
    expect(reparsed?.packages.map((one) => one.id)).toStrictEqual(
      built.brief.packages.map((one) => one.id),
    );
  });

  it('refuses a hand-built brief that contradicts its own scope or order', () => {
    const built = prepareAarohiCommercialFactsBrief(
      briefInput({
        commercialCatalog: catalog([packageOption({ id: PKG_A }), packageOption({ id: PKG_C })]),
      }),
    );
    expect(built.ok).toBe(true);
    if (!built.ok) return;

    for (const [label, forged] of [
      ['exact scope carrying two packages', { ...built.brief, scope: 'EXACT_PACKAGE' }],
      ['unsorted packages', { ...built.brief, packages: [...built.brief.packages].reverse() }],
      [
        'duplicate package',
        { ...built.brief, packages: [built.brief.packages[0], built.brief.packages[0]] },
      ],
      ['no packages at all', { ...built.brief, packages: [] }],
      ['a brief before its catalog', { ...built.brief, preparedAt: '2026-08-27T09:14:59Z' }],
      ['a smuggled brief ref', { ...built.brief, briefRef: '9_1_9_8_1_2_3_4_5_6_7_8' }],
      ['a smuggled snapshot ref', { ...built.brief, catalogSnapshotRef: '919812345678' }],
      ['an invented outcome', { ...built.brief, outcome: 'PRICE_READY' }],
    ] as const) {
      expect(aarohiCommercialFactsBriefSchema.safeParse(forged).success, label).toBe(false);
      expect(parseAarohiCommercialFactsBrief(forged), label).toBeUndefined();
    }
  });

  it('refuses a brief carrying content or a commercial value', () => {
    const built = prepareAarohiCommercialFactsBrief(briefInput());
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    for (const extra of [
      { explanation: 'This is our best value package' },
      { summary: 'anything' },
      { reply: 'anything' },
      { body: 'anything' },
      { pitch: 'anything' },
      { recommendationReason: 'anything' },
      { currency: 'INR' },
      { discount: 10 },
      { savings: 2000 },
      { pricePerLead: 199 },
    ]) {
      expect(
        aarohiCommercialFactsBriefSchema.safeParse({ ...built.brief, ...extra }).success,
        JSON.stringify(extra),
      ).toBe(false);
    }
  });

  it('produces a brief and nothing else', () => {
    const built = prepareAarohiCommercialFactsBrief(briefInput());
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    expect(Object.keys(built).sort()).toStrictEqual(['brief', 'ok']);

    // Every reference a brief carries, listed exactly. An order, a payment or a communication
    // request would have to arrive as one of these.
    const references = walkKeys(built.brief).filter((key) => key.endsWith('Ref'));
    expect(references.sort()).toStrictEqual([
      'briefRef',
      'catalogSnapshotRef',
      'interpretationRef',
      'prospectRef',
      'salesPlanRef',
    ]);
    for (const forbidden of [
      'orderRef',
      'paymentRef',
      'creditRef',
      'vendorRef',
      'communicationRequestRef',
      'approvalRef',
      'authorizationRef',
      'executionIntentRef',
      'promptRef',
      'modelRef',
    ]) {
      expect(references, forbidden).not.toContain(forbidden);
    }
  });
});

// ===========================================================================
// The canonical roadmap must not contradict itself.
// ===========================================================================

describe('the roadmap overlay stays true on both sides of a merge', () => {
  const overlay = readFileSync(
    fileURLToPath(
      new URL(
        '../../../../docs/architecture/aarohi-vendor-growth-roadmap-overlay.md',
        import.meta.url,
      ),
    ),
    'utf8',
  );

  it('records the certified range and AVG-8 as a defined proof', () => {
    const certified = /AVG-0 through AVG-(\d+) — implemented as certified offline domains/u.exec(
      overlay,
    );
    expect(certified).not.toBeNull();
    expect(Number(certified?.[1] ?? '0')).toBeGreaterThanOrEqual(7);
    expect(overlay).toContain('ADR-0125');
    expect(overlay).toContain('PLANNED / DISABLED');
  });

  it('encodes no branch state, and claims no runtime activation', () => {
    const lowered = overlay.toLowerCase();
    for (const forbidden of [
      'not merged',
      'proposed in this branch',
      'current branch',
      'after merge',
      'this pr',
      'runtime activated',
      'runtime is active',
    ]) {
      expect(lowered, forbidden).not.toContain(forbidden);
    }
  });
});
