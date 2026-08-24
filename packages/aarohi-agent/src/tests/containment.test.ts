/**
 * What this package cannot become.
 *
 * Aarohi's runtime status is PLANNED / DISABLED, and AVG-1 does not change that. The overlay's words
 * are "no Aarohi runtime, no outreach, no channel, no credential, and no Instagram, WhatsApp, n8n or
 * Meta integration in this repository". This slice adds a DOMAIN, and these specs are how that stays
 * true as the package grows.
 *
 * Scans read source with comments stripped, because this package documents at length the things it
 * refuses to be and scanning the prose would report every prohibition as a violation.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const SRC = fileURLToPath(new URL('../', import.meta.url));
const PKG = fileURLToPath(new URL('../../', import.meta.url));
const REPO_ROOT = fileURLToPath(new URL('../../../../', import.meta.url));

function walk(dir: string, skipTests: boolean): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (skipTests && entry === 'tests') continue;
      out.push(...walk(full, skipTests));
    } else if (entry.endsWith('.ts')) {
      out.push(full);
    }
  }
  return out;
}

const codeOnly = (text: string): string =>
  text
    .replace(/\/\*[\s\S]*?\*\//gu, '')
    .split('\n')
    .filter((line) => !/^\s*\/\//u.test(line))
    .join('\n');

const productionFiles = (): readonly { readonly file: string; readonly code: string }[] =>
  walk(SRC, true).map((file) => ({ file, code: codeOnly(readFileSync(file, 'utf8')) }));

describe('AVG-1 adds a DOMAIN, not a runtime', () => {
  it('reaches no channel, provider, execution path or credential', () => {
    // Every name the overlay rules out, asserted as absent rather than merely not written.
    for (const { file, code } of productionFiles()) {
      for (const forbidden of [
        'instagram',
        'whatsapp',
        'graph.facebook',
        'n8n',
        'meta',
        'linkedin',
        'twilio',
        'credential',
        'apikey',
        'api_key',
        'authorization',
        'bearer',
      ]) {
        expect(code.toLowerCase(), `${file} must not name ${forbidden}`).not.toContain(forbidden);
      }
    }
  });

  it('opens no network, reads no environment, touches no filesystem or database', () => {
    for (const { file, code } of productionFiles()) {
      for (const forbidden of [
        'node:fs',
        'node:http',
        'node:https',
        'node:net',
        'process.env',
        'process.argv',
        'postgres',
        'supabase',
        'axios',
        'undici',
      ]) {
        expect(code.toLowerCase(), `${file} must not name ${forbidden}`).not.toContain(forbidden);
      }
      expect(code, `${file} must not call fetch`).not.toMatch(/[^a-zA-Z]fetch\(/u);
    }
  });

  it('names no send, execute, mutate or payment verb', () => {
    // A domain package that named one of these would be one edit away from performing it, and
    // approved execution goes Core/human -> n8n -> provider, never from here.
    for (const { file, code } of productionFiles()) {
      for (const forbidden of [
        'sendMessage',
        'dispatch(',
        'executeAction',
        'processPayment',
        'createVendor',
        'updateVendor',
        'registerVendor',
        'activateVendor',
        'purchasePackage',
      ]) {
        expect(code, `${file} must not name ${forbidden}`).not.toContain(forbidden);
      }
    }
  });

  it('persists nothing — there is no store, repository or migration', () => {
    // Durable acquisition-case storage is not governed at implementation level yet, so contracts
    // only and storage stays out.
    for (const { file, code } of productionFiles()) {
      for (const forbidden of [
        'Repository',
        'createStore',
        'migration',
        'INSERT INTO',
        'UPDATE ',
      ]) {
        expect(code, `${file} must not name ${forbidden}`).not.toContain(forbidden);
      }
    }
  });
});

describe('it duplicates no shared Jarvis infrastructure', () => {
  it('composes no gateway, backbone, memory, runtime or provider abstraction', () => {
    // Deliberately asserted by CONSTRUCTOR name rather than by listing workspace specifiers.
    //
    // Spelling `@qf-jarvis/<package>` literally here would make this file look like an importer to
    // the sibling containment specs that scan the whole repository for their own specifier — which
    // is a false positive I would then have to weaken THEIR lock to accommodate. The total
    // `@qf-jarvis/` ban below is strictly stronger than any enumeration anyway.
    for (const { file, code } of productionFiles()) {
      for (const forbidden of [
        'createModelGateway',
        'createModelReplyAdapter',
        'createEventBackbone',
        'createJarvisRuntime',
        'retrieveGovernedKnowledge',
      ]) {
        expect(code, `${file} must not name ${forbidden}`).not.toContain(forbidden);
      }
    }
  });

  it('depends on zod alone, and the dependency graph stays acyclic by having no edges', () => {
    const manifest = JSON.parse(readFileSync(join(PKG, 'package.json'), 'utf8')) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
      exports?: Record<string, unknown>;
    };
    // No workspace dependency at all: AVG-1 is a pure domain. The absence IS the containment.
    expect(Object.keys(manifest.dependencies ?? {})).toStrictEqual(['zod']);
    expect(manifest.devDependencies).toBeUndefined();
    expect(Object.keys(manifest.exports ?? {})).toStrictEqual(['.']);
  });

  it('imports no @qf-jarvis package whatsoever', () => {
    for (const { file, code } of productionFiles()) {
      expect(code, `${file} must not import a workspace package`).not.toContain(
        ['@qf-jarvis', ''].join('/'),
      );
    }
  });

  it('does not touch the Anisha or Riya packages', () => {
    // Aarohi and Anisha are separate and always will be (ADR-0085). The arrow points nowhere.
    // The specifier is assembled rather than written, for the false-positive reason above.
    const scope = ['@qf-jarvis', ''].join('/');
    for (const { file, code } of productionFiles()) {
      for (const forbidden of ['anisha', 'riya']) {
        expect(code.toLowerCase(), `${file} must not import ${forbidden}`).not.toContain(
          `${scope}${forbidden}`,
        );
      }
    }
  });
});

describe('the public API is locked and nothing composes this leaf yet', () => {
  it('exports exactly the reviewed surface', async () => {
    const barrel = (await import('../index.js')) as unknown as Record<string, unknown>;
    // An exact set match, so a symbol cannot join the public surface without a decision.
    // AVG-2 (ADR-0111) adds the enrichment claim, profile and review-boundary surface. Every
    // addition is a contract, a closed vocabulary, a bound or a pure function -- there is no new
    // verb, and nothing here sends, authorizes, scores or mutates anything.
    expect(Object.keys(barrel).sort()).toStrictEqual([
      'AAROHI_AGENT_ID',
      'AAROHI_ENRICHMENT_CONTRACT_VERSION',
      'AAROHI_PROSPECT_CONTRACT_VERSION',
      'ACQUISITION_CASE_STATES',
      'ACQUISITION_CASE_TRANSITIONS',
      'ACQUISITION_REFUSAL_REASONS',
      'ACTIVATION_AUTHORITIES',
      'BLOCKED_CORE_STATUSES',
      'CASE_TRANSITION_REFUSALS',
      'CORE_PARTY_STATUSES',
      'CORE_STATUS_ROLE',
      'CORE_STATUS_ROLES',
      'ELIGIBLE_CORE_STATUSES',
      'ENRICHMENT_ATTRIBUTES',
      'ENRICHMENT_ATTRIBUTE_VALUE_KIND',
      'ENRICHMENT_CLAIM_REFUSALS',
      'ENRICHMENT_CONSISTENCY_VERDICTS',
      'ENRICHMENT_EVIDENCE_QUALITIES',
      'ENRICHMENT_PROFILE_REFUSALS',
      'ENRICHMENT_REVIEW_OUTCOME',
      'ENRICHMENT_REVIEW_REFUSALS',
      'ENRICHMENT_SOURCE_KINDS',
      'ENRICHMENT_VALUE_KINDS',
      'HANDOFF_REFUSAL_REASONS',
      'HANDOFF_REJECTED_AUTHORITIES',
      'HANDOFF_TRUSTED_AUTHORITY',
      'MAX_ENRICHMENT_LABEL_LENGTH',
      'MAX_ENRICHMENT_PROFILE_CLAIMS',
      'PRESENCE_SIGNALS',
      'PROSPECT_DISCOVERY_SOURCES',
      'TERMINAL_ACQUISITION_CASE_STATES',
      'acquisitionCaseSchema',
      'activationAttestationSchema',
      'canTransition',
      'completeCoreActiveHandoff',
      'coreEligibilityObservationSchema',
      'createEnrichmentClaim',
      'createEnrichmentProfile',
      'createProspectIdentity',
      'enrichmentClaimIdentity',
      'enrichmentClaimSchema',
      'enrichmentSourceSchema',
      'evaluateAcquisitionEligibility',
      'evaluateEnrichmentReviewReadiness',
      'isTerminalAcquisitionCaseState',
      'openAcquisitionCase',
      'prospectIdentitySchema',
      'summariseEnrichmentConsistency',
      'transitionAcquisitionCase',
    ]);
  });

  it('NO package or app imports it', () => {
    // Aarohi has no runtime. Asserted so the first consumer is a deliberate decision.
    const importers: string[] = [];
    for (const root of [join(REPO_ROOT, 'packages'), join(REPO_ROOT, 'apps')]) {
      for (const entry of readdirSync(root)) {
        if (entry === 'aarohi-agent') continue;
        let files: string[];
        try {
          files = walk(join(root, entry, 'src'), false);
        } catch {
          continue;
        }
        for (const file of files) {
          if (readFileSync(file, 'utf8').includes('@qf-jarvis/aarohi-agent')) {
            importers.push(file);
          }
        }
      }
    }
    expect(importers).toStrictEqual([]);
  });
});
