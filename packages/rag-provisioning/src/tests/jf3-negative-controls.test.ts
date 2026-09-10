/**
 * JF-3 negative and mutation controls (ADR-0148 §9).
 *
 * A passing spec is not evidence that the thing it names is load-bearing; it is evidence that the code
 * and the spec agree. These close that gap by building the MUTANT — the plausible weaker
 * implementation somebody would actually write, or the adversarial input somebody would actually send
 * — and proving the real implementation and the mutant are distinguishable.
 *
 * Each control names the mutation, the production failure it would cause, and the assertion that
 * separates them. None of them relaxes an existing specification, and none is committed as a change to
 * production source: the mutants live here, as doubles and as strings.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  GovernedKnowledgeError,
  createGovernedKnowledgeRegistry,
} from '@qf-jarvis/governed-knowledge';
import type { RetrievedKnowledge } from '@qf-jarvis/governed-knowledge';
import { describe, expect, it } from 'vitest';

import type { RagRetrievalBackend } from '../contracts/retrieval-backend.js';
import { createGovernedExactBackend } from '../service/governed-exact-backend.js';
import { createRagProvisioner } from '../service/create-rag-provisioner.js';
import { invokeRagRetrieval } from '../service/invoke-rag-retrieval.js';
import {
  MISSING_PRODUCTION_KNOWLEDGE,
  PRODUCTION_KNOWLEDGE_PACK_MANIFEST,
  PRODUCTION_KNOWLEDGE_RECORDS,
} from '../knowledge-pack/production-knowledge-pack.js';
import { activeProfileInput } from '../testing/fixtures.js';
import {
  activeProvisioner,
  digest,
  testBackend,
  testPack,
  testRecordInput,
  testRequest,
} from './knowledge-fixtures.js';

const PKG_DIR = new URL('../../', import.meta.url);
const RECORD = testRecordInput();

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      out.push(...walk(full));
    } else if (entry.endsWith('.ts')) {
      out.push(full);
    }
  }
  return out;
}
const productionFiles = (): string[] =>
  walk(fileURLToPath(new URL('src', PKG_DIR))).filter(
    (f) => !f.replace(/\\/g, '/').includes('/tests/'),
  );

describe('JF-3 negative and mutation controls', () => {
  it('MUTANT: absent config becomes ACTIVE', () => {
    // IN PRODUCTION: a deployment that forgot to configure RAG starts grounding on whatever registry
    // happens to be in the process. Absence of configuration would become consent.
    for (const config of [undefined, null, {}, { mode: 'ACTIVE' }]) {
      const provisioner = createRagProvisioner(config, { backend: testBackend() });
      expect(provisioner.state).not.toBe('active');
      expect(provisioner.backend).toBeUndefined();
    }
    // The control is meaningful only if the SAME call with a real profile does activate.
    const backend = testBackend();
    expect(
      createRagProvisioner(activeProfileInput({ knowledgeRevision: backend.knowledgeRevision }), {
        backend,
      }).state,
    ).toBe('active');
  });

  it('MUTANT: a vector backend is treated as runtime-eligible', () => {
    // IN PRODUCTION: a future vector adapter serves under an approval written for deterministic exact
    // retrieval -- semantic search arriving through a door labelled "exact lookup".
    const backend = testBackend();
    for (const backendKind of ['FUTURE_LOCAL_VECTOR', 'FUTURE_MANAGED_VECTOR', 'NONE'] as const) {
      const byProfile = createRagProvisioner(
        activeProfileInput({ backendKind, knowledgeRevision: backend.knowledgeRevision }),
        { backend },
      );
      expect(byProfile.refusal).toBe('rag-backend-not-runtime-eligible');
    }
    // And from the other side: a backend that DECLARES a vector kind cannot serve an exact profile.
    const vectorish: RagRetrievalBackend = Object.freeze({
      ...backend,
      backendKind: 'FUTURE_LOCAL_VECTOR' as const,
    });
    expect(
      createRagProvisioner(activeProfileInput({ knowledgeRevision: backend.knowledgeRevision }), {
        backend: vectorish,
      }).refusal,
    ).toBe('rag-backend-kind-mismatch');
  });

  it('MUTANT: the same revision is claimed for different records (the owner-review bug)', () => {
    // IN PRODUCTION, on the head this corrects: an ACTIVE profile approving revision A bound to a
    // registry holding entirely different records, because the revision was a caller-chosen LABEL
    // and the gate only compared two labels. Measured on head 7bbe1ab, unapproved text activated
    // cleanly under an approved revision and served, and the citation still carried the approved
    // record's stale contentDigest.
    //
    // The correction makes the mutation unconstructible rather than detected: a revision is DERIVED
    // from the records, so two different bodies of knowledge cannot share one.
    const approvedPack = testPack([RECORD]);
    const substitutedPack = testPack([
      testRecordInput({
        content: 'SYNTHETIC UNAPPROVED REPLACEMENT. Invented for a spec; not business truth.',
        contentDigest: digest('8'),
      }),
    ]);
    // Same identity, same digest field, same everything a label comparison would see.
    expect(approvedPack.recordCount).toBe(substitutedPack.recordCount);
    expect(approvedPack.topics).toEqual(substitutedPack.topics);
    // Different content, therefore different revision. This is the whole correction in one line.
    expect(approvedPack.knowledgeRevision).not.toBe(substitutedPack.knowledgeRevision);

    const profile = activeProfileInput({ knowledgeRevision: approvedPack.knowledgeRevision });
    expect(
      createRagProvisioner(profile, {
        backend: createGovernedExactBackend({ pack: approvedPack }),
      }).state,
    ).toBe('active');
    const caught = createRagProvisioner(profile, {
      backend: createGovernedExactBackend({ pack: substitutedPack }),
    });
    expect(caught.state).toBe('invalid');
    expect(caught.refusal).toBe('rag-knowledge-revision-mismatch');

    // There is no public production constructor that pairs a registry with a chosen revision. The
    // backend takes a pack and reads the revision off it; a hand-built object is not a pack.
    expect(createGovernedExactBackend({ pack: substitutedPack }).knowledgeRevision).toBe(
      substitutedPack.knowledgeRevision,
    );
    expect(() =>
      createGovernedExactBackend({
        pack: {
          knowledgeRevision: approvedPack.knowledgeRevision,
          registry: undefined,
        } as unknown as typeof approvedPack,
      }),
    ).toThrow(Error);

    // And the `latest` variant, which is the version of this mutation that looks like convenience.
    expect(
      createRagProvisioner(activeProfileInput({ knowledgeRevision: 'latest' }), {
        backend: testBackend(),
      }).refusal,
    ).toBe('rag-knowledge-revision-not-exact');
  });

  it('MUTANT: governed retrieval is bypassed and raw registry records are returned', () => {
    // IN PRODUCTION: every lifecycle, freshness, permission, classification and privacy rule is
    // skipped in one step, and the result still LOOKS correct -- records come back, with content.
    // This is the single most dangerous shortcut available in the whole lane.
    const pack = testPack([
      testRecordInput({ classification: 'HUMAN_ONLY' }),
      testRecordInput({
        knowledgeId: 'kb.synthetic.retired',
        topic: 'synthetic-retired',
        lifecycleState: 'RETIRED',
        contentDigest: digest('3'),
      }),
    ]);
    const registry = pack.registry;
    const bypassing: RagRetrievalBackend = Object.freeze({
      backendKind: 'GOVERNED_EXACT' as const,
      knowledgeRevision: pack.knowledgeRevision,
      // The mutant: read the registry directly, skip `retrieveGovernedKnowledge` entirely.
      retrieve: (): { ok: true; records: readonly RetrievedKnowledge[] } => ({
        ok: true,
        records: registry.snapshot().map(
          (summary: { knowledgeId: string }) =>
            ({
              record: { ...summary, content: 'RAW REGISTRY CONTENT' },
              citation: { knowledgeId: summary.knowledgeId },
            }) as unknown as RetrievedKnowledge,
        ),
      }),
    });

    // The REAL backend over the same registry refuses both records -- HUMAN_ONLY and retired.
    const real = invokeRagRetrieval(
      activeProvisioner(testBackend([testRecordInput({ classification: 'HUMAN_ONLY' })])),
      testRequest({ selectors: { ids: [{ knowledgeId: RECORD.knowledgeId, version: 1 }] } }),
    );
    expect(real.ok).toBe(false);
    expect((real as { knowledgeReason?: string }).knowledgeReason).toBe(
      'knowledge-data-class-denied',
    );

    // The mutant returns content the authority would have withheld. The two are plainly different,
    // which is what makes the governance specs above load-bearing rather than incidental.
    const mutated = invokeRagRetrieval(activeProvisioner(bypassing), testRequest());
    expect(mutated.ok).toBe(true);
    expect(JSON.stringify(mutated)).toContain('RAW REGISTRY CONTENT');

    // And the structural control: no production file in this package reads the registry directly.
    for (const file of productionFiles()) {
      const text = readFileSync(file, 'utf8');
      expect(text).not.toMatch(/\.(resolveExact|listByTopic|identityKeys|snapshot)\s*\(/);
    }
  });

  it('MUTANT: the privacy gate is dropped', () => {
    // IN PRODUCTION: an erased subject's record reaches a model. The gate is absent exactly when
    // nobody decided who may see the subject, so a permissive default answers a privacy question this
    // package has no standing to answer.
    const outcome = invokeRagRetrieval(
      activeProvisioner(
        testBackend([
          testRecordInput({ subjectRef: 'subject.test.1', classification: 'LOCAL_ONLY' }),
        ]),
      ),
      testRequest({
        dataClass: 'LOCAL_ONLY',
        selectors: { ids: [{ knowledgeId: RECORD.knowledgeId, version: 1 }] },
      }),
    );
    expect(outcome.ok).toBe(false);
    expect((outcome as { knowledgeReason?: string }).knowledgeReason).toBe(
      'knowledge-privacy-gate-missing',
    );
    // No production file manufactures a gate, and none defaults one.
    for (const file of productionFiles()) {
      const text = readFileSync(file, 'utf8');
      expect(text).not.toMatch(/privacyGate\s*[:=]\s*(\{|createDeterministic|ALLOW|PERMISSIVE)/);
      expect(text).not.toMatch(/subjectStatus\s*[:(]/);
    }
  });

  it('MUTANT: a superseded record is admitted', () => {
    // IN PRODUCTION: the business withdrew a statement, a newer version replaced it, and the old text
    // still answers -- with a citation that makes it look current.
    const outcome = invokeRagRetrieval(
      activeProvisioner(
        testBackend([
          testRecordInput({
            supersededBy: { knowledgeId: RECORD.knowledgeId, version: 2 },
            lifecycleState: 'RETIRED',
            content: 'SYNTHETIC WITHDRAWN TEXT. Invented for a spec; not business truth.',
            contentDigest: digest('4'),
          }),
          // The successor has to exist: a supersession edge that points at nothing is itself refused.
          testRecordInput({
            version: 2,
            content: 'SYNTHETIC REPLACEMENT TEXT. Invented for a spec; not business truth.',
            contentDigest: digest('5'),
          }),
        ]),
      ),
      testRequest({ selectors: { ids: [{ knowledgeId: RECORD.knowledgeId, version: 1 }] } }),
    );
    expect(outcome.ok).toBe(false);
    expect((outcome as { knowledgeReason?: string }).knowledgeReason).toBe('knowledge-superseded');
    expect(JSON.stringify(outcome)).not.toContain('WITHDRAWN TEXT');
  });

  it('MUTANT: a citation is fabricated', () => {
    // IN PRODUCTION: an answer cites a source that does not say what the answer claims -- the failure
    // mode that makes grounding worse than no grounding, because the citation buys trust.
    //
    // The control is structural: there is no citation constructor anywhere in this package, and the
    // retrieval path never assembles a record/citation pair. It passes through what it was given.
    for (const file of productionFiles()) {
      const text = readFileSync(file, 'utf8');
      expect(text).not.toMatch(/citation\s*:\s*\{/);
      expect(text).not.toMatch(/buildCitation|createCitation|makeCitation/);
    }
    const outcome = invokeRagRetrieval(activeProvisioner(), testRequest());
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) {
      return;
    }
    // Every citation still matches its own record exactly, digest included.
    for (const entry of outcome.records) {
      expect(entry.citation.contentDigest).toBe(entry.record.contentDigest);
      expect(entry.citation.knowledgeId).toBe(entry.record.knowledgeId);
    }
  });

  it('MUTANT: an over-budget record is truncated instead of refused', () => {
    // IN PRODUCTION: the caller set a budget to bound what reaches a model, and a silently shortened
    // record answers a different question than the one asked -- while the citation still attests to
    // the full document.
    const outcome = invokeRagRetrieval(activeProvisioner(), testRequest({ maxContentChars: 4 }));
    expect(outcome.ok).toBe(false);
    expect((outcome as { knowledgeReason?: string }).knowledgeReason).toBe(
      'knowledge-limit-exceeded',
    );
    expect(outcome).not.toHaveProperty('records');
    // And no production file shortens, slices, elides or ellipsises content anywhere.
    for (const file of productionFiles()) {
      const text = readFileSync(file, 'utf8');
      expect(text).not.toMatch(/content\s*\.\s*(slice|substring|substr)\s*\(/);
      expect(text).not.toMatch(/truncate|ellipsis|\.\.\.'/);
    }
  });

  it('MUTANT: a production network call is added', () => {
    // IN PRODUCTION: retrieval reaches outside the process -- an endpoint, a key, a timeout, an
    // outage, and customer content on somebody else's wire.
    //
    // This control checks the CHECK. A scan that never matches anything is indistinguishable from a
    // scan with a broken pattern, so the pattern is first run against a synthetic mutant to prove it
    // fires, and only then against the real source to prove it does not.
    const NETWORK =
      /\bfetch\s*\(|from ['"](axios|undici|node-fetch)['"]|from ['"]node:(http|https|net)['"]/;
    const mutant = "const res = await fetch('https://example.invalid/retrieve');";
    expect(NETWORK.test(mutant)).toBe(true);
    for (const file of productionFiles()) {
      expect(NETWORK.test(readFileSync(file, 'utf8'))).toBe(false);
    }
  });

  it('MUTANT: a retrieved record carries an execution or action field into the result', () => {
    // IN PRODUCTION: a document becomes a command. Whoever can write a knowledge record can then make
    // the system act, which is the escalation that turns a content-authoring permission into an
    // execution permission.
    const hostile: RagRetrievalBackend = Object.freeze({
      backendKind: 'GOVERNED_EXACT' as const,
      knowledgeRevision: testPack().knowledgeRevision,
      retrieve: (): { ok: true; records: readonly RetrievedKnowledge[] } => ({
        ok: true,
        records: [
          {
            record: {
              ...testRecordInput(),
              action: 'APPROVE_ORDER',
              tool: 'refund',
              execute: true,
            },
            citation: { knowledgeId: RECORD.knowledgeId },
          } as unknown as RetrievedKnowledge,
        ],
      }),
    });
    const outcome = invokeRagRetrieval(
      activeProvisioner(hostile),
      testRequest(),
    ) as unknown as Record<string, unknown>;
    // Even handed a record carrying action fields, the OUTCOME exposes nothing that acts: the fields
    // stay inert data inside `records`, and nothing in this package reads or dispatches on them.
    for (const field of ['action', 'tool', 'execute', 'approve', 'command', 'dispatch']) {
      expect(outcome[field]).toBeUndefined();
    }
    for (const file of productionFiles()) {
      const text = readFileSync(file, 'utf8');
      expect(text).not.toMatch(/record\s*\.\s*(action|tool|execute|command)/);
      expect(text).not.toMatch(/\b(dispatch|invokeTool|runAction|approveOrder)\s*\(/i);
    }
  });

  it('MUTANT: a synthetic or training record is auto-ingested into the production pack', () => {
    // IN PRODUCTION: invented content becomes business truth by accident -- a corpus written to
    // exercise a model becomes what a customer is told, with a citation pointing at a test fixture.
    expect(PRODUCTION_KNOWLEDGE_RECORDS).toHaveLength(0);
    expect(PRODUCTION_KNOWLEDGE_PACK_MANIFEST.hasApprovedContent).toBe(false);
    const packText = JSON.stringify([
      PRODUCTION_KNOWLEDGE_PACK_MANIFEST,
      MISSING_PRODUCTION_KNOWLEDGE,
    ]).toUpperCase();
    for (const marker of ['SYNTHETIC', 'GOLDEN', 'CORPUS', 'FIXTURE', 'TRAINING', 'TEST://']) {
      expect(packText).not.toContain(marker);
    }
    // There is no ingestion path at all: no reader, no loader, no importer, no directory scan.
    for (const file of productionFiles()) {
      const text = readFileSync(file, 'utf8');
      expect(text).not.toMatch(
        /\b(ingest|loadCorpus|importRecords|readRecords|scanDirectory)\s*\(/i,
      );
      expect(text).not.toMatch(/from ['"]\.\.?\/.*tests?\//);
    }
    // And the pack's records array is the only way in, guarded by the governed record contract.
    expect(() =>
      createGovernedKnowledgeRegistry([testRecordInput({ knowledgeId: 'latest' })]),
    ).toThrow(GovernedKnowledgeError);
  });
});
