/**
 * MVP-P2A.2 HF1 — the runtime semantic approval digest, cross-proved against the generator.
 *
 * The generator (`scripts/…`) and the runtime helper (`src/config-digest.ts`) compute the same number
 * by two independent implementations in two languages' worth of style. They have to agree forever, so
 * the agreement is asserted rather than assumed — and the numbers that made HF1 necessary are pinned
 * here too, so nobody has to rediscover them by watching a live run fail.
 *
 * Nothing here reads a credential, touches the network, or reads the owner's external configuration.
 */
import { createHash } from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { compareByCodePoint } from '../config-digest.js';
import {
  canonicalSmokeApprovalJson,
  computeSmokeApprovalDigest,
  parseSmokeConfig,
  smokeApprovalDigestPayload,
  type SmokeConfig,
} from '../index.js';

const REPO_ROOT = fileURLToPath(new URL('../../../../', import.meta.url));
const GENERATOR_PATH = join(REPO_ROOT, 'scripts', 'generate-groq-staging-smoke-config.mjs');

/** The owner-approved SEMANTIC digest. Drift here is a contradiction, not a refresh. */
const APPROVED_DIGEST = '4f97ef1e9e46905db253912bd56dab8aea4f38e4d606dfe93b16fc024f0c2be1';
/** The RAW SHA-256 of the generator's emitted 888-byte file. Pinned to prove it is NOT the approval. */
const RAW_FILE_SHA = '60bd0fa496088cfe158312500ce88e315d22d2583052b42e1f49ae2fa7af1363';
const CANONICAL_PAYLOAD_BYTES = 709;
const SERIALIZED_FILE_BYTES = 888;

const generator = (await import(pathToFileURL(GENERATOR_PATH).href)) as {
  APPROVED_DIGEST_PAYLOAD: Record<string, unknown>;
  canonicalJson: (payload: unknown) => string;
  computeConfigDigest: (payload?: unknown) => string;
  buildSmokeConfig: (payload?: unknown) => Record<string, unknown>;
  serialiseConfig: (config: unknown) => string;
};

/** The generator's own output, parsed by the real closed parser. No hand-written fixture. */
function approvedConfig(): SmokeConfig {
  const parsed = parseSmokeConfig(generator.buildSmokeConfig());
  if (!parsed.ok) {
    throw new Error('The generator produced a configuration the real parser refuses.');
  }
  return parsed.config;
}

/**
 * Reparse a modified copy of the approved config through the REAL parser.
 *
 * Split in two deliberately. A mutation meant to survive parsing must be proven to have survived, and
 * a mutation meant to be refused must be proven refused — collapsing both into one nullable return
 * invites a spec that silently proves nothing when the parser changes its mind.
 */
function reparsed(mutate: (draft: Record<string, unknown>) => void): SmokeConfig {
  const draft = generator.buildSmokeConfig();
  mutate(draft);
  const parsed = parseSmokeConfig(draft);
  if (!parsed.ok) {
    throw new Error('This fixture must still parse, or the assertion below proves nothing.');
  }
  return parsed.config;
}

/** True iff the closed parser refuses the mutated draft outright. */
function reparseRefused(mutate: (draft: Record<string, unknown>) => void): boolean {
  const draft = generator.buildSmokeConfig();
  mutate(draft);
  return !parseSmokeConfig(draft).ok;
}

describe('the generator and the runtime agree on the approved digest', () => {
  it('the generator’s approved digest is still exactly the governed value', () => {
    expect(generator.computeConfigDigest()).toBe(APPROVED_DIGEST);
  });

  it('THE RUNTIME HELPER RECOMPUTES THE SAME DIGEST FROM THE PARSED CONFIG', () => {
    // The cross-proof. Two implementations, one number. If this ever fails, one of them drifted and
    // the live operator would refuse a configuration the owner correctly generated.
    expect(computeSmokeApprovalDigest(approvedConfig())).toBe(APPROVED_DIGEST);
  });

  it('both canonicalisations produce byte-identical input, at 709 bytes', () => {
    const fromGenerator = generator.canonicalJson(generator.APPROVED_DIGEST_PAYLOAD);
    const fromRuntime = canonicalSmokeApprovalJson(approvedConfig());
    expect(fromRuntime).toBe(fromGenerator);
    expect(Buffer.byteLength(fromRuntime, 'utf8')).toBe(CANONICAL_PAYLOAD_BYTES);
  });

  it('orders keys by code point, not by UTF-16 code unit', () => {
    // Astral characters are where the two orderings disagree. No approved key is astral today; the
    // rule is still the rule.
    const astral = String.fromCodePoint(0x1f600);
    const bmp = String.fromCodePoint(0xfffd);
    expect(compareByCodePoint('a', 'b')).toBeLessThan(0);
    expect(compareByCodePoint('ab', 'ab')).toBe(0);
    // By CODE POINT the astral character sorts last. By UTF-16 code unit it sorts first, because its
    // lead surrogate U+D83D is below U+FFFD. The two orderings genuinely disagree here, which is the
    // only way to prove the implementation picked the right one.
    expect(compareByCodePoint(astral, bmp)).toBeGreaterThan(0);
    expect(astral < bmp).toBe(true);
  });
});

describe('THE RAW FILE HASH IS NOT THE APPROVAL DIGEST — the HF1 regression', () => {
  it('the emitted approved configuration is 888 bytes and hashes to the raw value', () => {
    const bytes = Buffer.from(generator.serialiseConfig(generator.buildSmokeConfig()), 'utf8');
    expect(bytes.length).toBe(SERIALIZED_FILE_BYTES);
    expect(createHash('sha256').update(bytes).digest('hex')).toBe(RAW_FILE_SHA);
  });

  it('THE TWO NUMBERS DIFFER, WHICH IS WHY COMPARING THEM COULD NEVER SUCCEED', () => {
    // This is the entire live failure in two lines. Preflight hashed the 888-byte file and compared
    // it to the 709-byte payload's digest. Not a near miss and not environment-dependent: the file
    // is larger BECAUSE it carries the payload's digest inside itself.
    expect(RAW_FILE_SHA).not.toBe(APPROVED_DIGEST);
    expect(SERIALIZED_FILE_BYTES).toBeGreaterThan(CANONICAL_PAYLOAD_BYTES);
  });
});

describe('the digest payload excludes the digest, and only the digest', () => {
  it('carries every approved field and NOT release.configDigest', () => {
    const payload = smokeApprovalDigestPayload(approvedConfig());
    expect(Object.keys(payload).sort()).toStrictEqual([
      'capabilityProfileRef',
      'credentialReference',
      'dataClass',
      'dataControlsAttestationRef',
      'dataControlsAttested',
      'evaluationRef',
      'maxCompletionTokens',
      'maxInputTokens',
      'promptFamily',
      'promptVersion',
      'release',
      'schemaRevision',
      'supportsStrictJsonSchema',
      'timeoutMs',
    ]);
    expect(Object.keys(payload['release'] as Record<string, unknown>).sort()).toStrictEqual([
      'executionClass',
      'modelId',
      'modelVersion',
      'providerId',
      'releaseId',
    ]);
    expect(canonicalSmokeApprovalJson(approvedConfig())).not.toContain('configDigest');
  });

  it('CHANGING ONLY THE EMBEDDED DIGEST DOES NOT CHANGE THE RECOMPUTED ONE', () => {
    // Expected, and the reason preflight must ALSO compare the embedded value directly. A self-
    // excluding digest is structurally blind to the field it excludes.
    const tampered = reparsed((draft) => {
      (draft['release'] as Record<string, unknown>)['configDigest'] =
        '0000000000000000000000000000000000000000000000000000000000000000';
    });
    expect(computeSmokeApprovalDigest(tampered)).toBe(APPROVED_DIGEST);
    expect(tampered.release.configDigest).not.toBe(APPROVED_DIGEST);
  });

  it('FORMATTING AND KEY ORDER DO NOT CHANGE THE APPROVED IDENTITY', () => {
    // Same configuration, written differently. An approval is about values, so this must hold.
    const config = generator.buildSmokeConfig();
    // Deep reversal. An array replacer would drop the nested `release` keys and quietly test nothing.
    const reverseKeysDeep = (value: unknown): unknown => {
      if (value === null || typeof value !== 'object' || Array.isArray(value)) {
        return value;
      }
      const out: Record<string, unknown> = {};
      for (const key of Object.keys(value).sort().reverse()) {
        out[key] = reverseKeysDeep((value as Record<string, unknown>)[key]);
      }
      return out;
    };
    const reordered = reverseKeysDeep(config) as Record<string, unknown>;
    expect(Object.keys(reordered)).not.toStrictEqual(Object.keys(config));
    // The exact bytes an indentation-free writer would emit, round-tripped.
    const minified = JSON.parse(JSON.stringify(config)) as Record<string, unknown>;
    for (const variant of [reordered, minified]) {
      const parsed = parseSmokeConfig(variant);
      expect(parsed.ok).toBe(true);
      if (parsed.ok) {
        expect(computeSmokeApprovalDigest(parsed.config)).toBe(APPROVED_DIGEST);
      }
    }
  });
});

describe('EVERY APPROVED VALUE IS COMMITTED TO BY THE DIGEST', () => {
  // Each mutation keeps the embedded `release.configDigest` at the approved value, so the only thing
  // that can detect it is recomputation. That is exactly the case M2 breaks.
  const MUTATIONS: readonly {
    readonly field: string;
    readonly mutate: (draft: Record<string, unknown>) => void;
  }[] = [
    { field: 'credentialReference', mutate: (d) => (d['credentialReference'] = 'groq.other.v1') },
    {
      field: 'release.releaseId',
      mutate: (d) => ((d['release'] as Record<string, unknown>)['releaseId'] = 'rel.other.v1'),
    },
    {
      field: 'release.providerId',
      mutate: (d) => ((d['release'] as Record<string, unknown>)['providerId'] = 'other-provider'),
    },
    {
      field: 'release.modelId',
      mutate: (d) => ((d['release'] as Record<string, unknown>)['modelId'] = 'openai/gpt-oss-120b'),
    },
    {
      field: 'release.modelVersion',
      mutate: (d) =>
        ((d['release'] as Record<string, unknown>)['modelVersion'] =
          'groq-catalog-snapshot-2026-08-12'),
    },
    { field: 'maxInputTokens', mutate: (d) => (d['maxInputTokens'] = 513) },
    { field: 'maxCompletionTokens', mutate: (d) => (d['maxCompletionTokens'] = 257) },
    {
      field: 'capabilityProfileRef',
      mutate: (d) => (d['capabilityProfileRef'] = 'cap.groq.other.2026-07-28'),
    },
    { field: 'evaluationRef', mutate: (d) => (d['evaluationRef'] = 'eval.qfj.other.v1') },
    {
      field: 'dataControlsAttestationRef',
      mutate: (d) => (d['dataControlsAttestationRef'] = 'att.groq.other.2026-07-28'),
    },
    { field: 'timeoutMs', mutate: (d) => (d['timeoutMs'] = 30_001) },
  ];

  it.each(MUTATIONS.map((one) => [one.field, one.mutate] as const))(
    'a changed %s changes the recomputed digest',
    (field, mutate) => {
      const drifted = reparsed(mutate);
      expect(drifted.release.configDigest, field).toBe(APPROVED_DIGEST);
      expect(computeSmokeApprovalDigest(drifted), field).not.toBe(APPROVED_DIGEST);
    },
  );

  it('THE PARSER REFUSES THE LITERAL-TYPED FIELDS OUTRIGHT, WHICH IS STRONGER', () => {
    // `dataClass`, `supportsStrictJsonSchema`, `dataControlsAttested`, `promptFamily`,
    // `promptVersion`, `schemaRevision` and `release.executionClass` are `z.literal(...)`. A config
    // that changed one cannot parse at all, so it never reaches the digest. Recorded rather than
    // forced through an unsafe cast: refusal at the parser is a better guarantee than refusal at the
    // digest, and pretending otherwise would test a state the system cannot be in.
    expect(reparseRefused((d) => (d['dataClass'] = 'LOCAL_ONLY'))).toBe(true);
    expect(reparseRefused((d) => (d['supportsStrictJsonSchema'] = false))).toBe(true);
    expect(reparseRefused((d) => (d['dataControlsAttested'] = false))).toBe(true);
    expect(reparseRefused((d) => (d['promptFamily'] = 'qfj.other.family'))).toBe(true);
    expect(reparseRefused((d) => (d['promptVersion'] = 2))).toBe(true);
    expect(reparseRefused((d) => (d['schemaRevision'] = 'qfj.other.schema.v1'))).toBe(true);
    expect(
      reparseRefused(
        (d) => ((d['release'] as Record<string, unknown>)['executionClass'] = 'LOCAL'),
      ),
    ).toBe(true);
  });

  it('an unapproved extra field never reaches the digest at all', () => {
    // Closed parsing fails first. The digest never has to defend against a field the schema forbids.
    expect(reparseRefused((d) => (d['unapprovedField'] = 'anything'))).toBe(true);
    expect(
      reparseRefused((d) => ((d['release'] as Record<string, unknown>)['apiKey'] = 'anything')),
    ).toBe(true);
  });
});
