/**
 * The OWNER-supplied Nara candidate shortlist: shape rules, discovery re-authorisation, and the lines
 * a person reads before typing the phrase (JF-5B-R3).
 *
 * ### Why this exists at all
 *
 * A real authenticated run returned 51 aliases, 50 eligible, and stated no context length. The
 * metadata rule refused — correctly — and the operator stopped "for an owner decision" that the CLI
 * had no way to accept. These specs pin the channel that carries it, and pin just as hard the things
 * it must NOT become: a ranking, a winner, a way to name a model the account was not offered.
 *
 * Everything here is pure. No terminal, no network, no clock.
 */
import { describe, expect, it } from 'vitest';

import { NARA_CANDIDATE_FLAG, parseCertifyArgv, renderPreflightSummary } from '../cli/preflight.js';
import { EXECUTE_LIVE_FLAG } from '../contracts/live-execution-gate.js';
import { MAX_SHORTLIST, buildNaraShortlist } from '../discovery/nara-model-discovery.js';
import type { DiscoveredNaraModel } from '../discovery/nara-model-discovery.js';
import {
  checkOwnerCandidates,
  resolveOwnerCandidateShortlist,
} from '../discovery/owner-candidate-shortlist.js';

/** The exact five the owner selected from the authenticated eligible list. */
const OWNER_SET: readonly string[] = Object.freeze([
  'gpt-5.6-luna',
  'qwen3.8-flash',
  'deepseek-v4.1-flash',
  'glm-5.3-flash',
  'mimo-v2.5',
]);

/**
 * An eligible model as DISCOVERY returned it.
 *
 * `contextLength` is `undefined` by default, which is exactly what the live endpoint gave: the whole
 * reason the automatic rule refused and the owner channel is needed.
 */
const discovered = (
  modelId: string,
  over: Partial<DiscoveredNaraModel> = {},
): DiscoveredNaraModel =>
  Object.freeze({
    modelId,
    reasoning: undefined,
    contextLength: undefined,
    modality: 'chat',
    capabilities: Object.freeze(['chat']),
    ...over,
  });

/** The eligible list this run would have seen: the owner's five, plus others they did not choose. */
const ELIGIBLE: readonly DiscoveredNaraModel[] = Object.freeze([
  discovered('vendor-x/something-else'),
  ...OWNER_SET.map((alias) => discovered(alias)),
  discovered('another/alias'),
]);

// ---------------------------------------------------------------------------
// Argv.
// ---------------------------------------------------------------------------

describe('JF-5B-R3 the argv surface carries a decision, never a secret or a winner', () => {
  it('accepts the repeated switch in both spellings, and preserves owner order', () => {
    const parsed = parseCertifyArgv([
      EXECUTE_LIVE_FLAG,
      NARA_CANDIDATE_FLAG,
      'gpt-5.6-luna',
      `${NARA_CANDIDATE_FLAG}=qwen3.8-flash`,
      NARA_CANDIDATE_FLAG,
      'mimo-v2.5',
    ]);
    expect(parsed.naraCandidates).toEqual(['gpt-5.6-luna', 'qwen3.8-flash', 'mimo-v2.5']);
    expect(parsed.unknown).toEqual([]);
  });

  it('never splits on a comma: a delimiter here would be a syntax the endpoint does not use', () => {
    const parsed = parseCertifyArgv([NARA_CANDIDATE_FLAG, 'a,b,c']);
    expect(parsed.naraCandidates).toEqual(['a,b,c']);
    // And that single value is then refused as malformed, rather than silently becoming three.
    expect(checkOwnerCandidates(parsed.naraCandidates)).toEqual({
      ok: false,
      refusal: 'owner-candidate-malformed',
      modelId: 'a,b,c',
    });
  });

  it('adds no second selection route', () => {
    for (const forbidden of ['--nara-model', '--nara-winner', '--provider', '--api-key']) {
      const parsed = parseCertifyArgv([EXECUTE_LIVE_FLAG, forbidden, 'anything']);
      // Unrecognised, carried as unknown, never interpreted.
      expect([forbidden, parsed.unknown]).toEqual([forbidden, [forbidden, 'anything']]);
      expect([forbidden, parsed.naraCandidates]).toEqual([forbidden, []]);
    }
  });

  it('zero candidates is legal, and is what every existing run does', () => {
    const parsed = parseCertifyArgv([EXECUTE_LIVE_FLAG, '--output-dir', 'D:/out']);
    expect(parsed.naraCandidates).toEqual([]);
    expect(checkOwnerCandidates(parsed.naraCandidates)).toEqual({ ok: true });
  });
});

// ---------------------------------------------------------------------------
// Shape.
// ---------------------------------------------------------------------------

describe('JF-5B-R3 the candidate SHAPE is checked before any credential or network', () => {
  it('accepts one, and accepts the ceiling of five', () => {
    expect(checkOwnerCandidates([OWNER_SET[0] ?? ''])).toEqual({ ok: true });
    expect(checkOwnerCandidates(OWNER_SET)).toEqual({ ok: true });
    expect(OWNER_SET).toHaveLength(MAX_SHORTLIST);
  });

  it('refuses a sixth: naming the models does not buy a bigger budget', () => {
    expect(checkOwnerCandidates([...OWNER_SET, 'one-too-many'])).toEqual({
      ok: false,
      refusal: 'owner-candidate-too-many',
      modelId: '6',
    });
  });

  it('refuses an empty value rather than shortening the set', () => {
    expect(checkOwnerCandidates(['gpt-5.6-luna', '   '])).toEqual({
      ok: false,
      refusal: 'owner-candidate-empty',
      modelId: '',
    });
  });

  it('refuses a malformed alias, under the SAME grammar discovery applies', () => {
    for (const bad of ['has space', '-leading-dash', 'a,b', '!bang']) {
      expect([bad, checkOwnerCandidates([bad]).ok]).toEqual([bad, false]);
    }
  });

  it('refuses a router alias through the provider guard, not a second list', () => {
    for (const alias of ['auto', 'bynara/auto', 'vendor/latest', 'router']) {
      expect([alias, checkOwnerCandidates([alias])]).toEqual([
        alias,
        { ok: false, refusal: 'owner-candidate-router-alias', modelId: alias },
      ]);
    }
  });

  it('refuses an exact duplicate, and a case-only duplicate', () => {
    expect(checkOwnerCandidates(['gpt-5.6-luna', 'gpt-5.6-luna'])).toEqual({
      ok: false,
      refusal: 'owner-candidate-duplicate',
      modelId: 'gpt-5.6-luna',
    });
    // Case-insensitively: the same model twice would buy it two probes' worth of evidence.
    expect(checkOwnerCandidates(['gpt-5.6-luna', 'GPT-5.6-Luna'])).toEqual({
      ok: false,
      refusal: 'owner-candidate-duplicate',
      modelId: 'GPT-5.6-Luna',
    });
  });
});

// ---------------------------------------------------------------------------
// Discovery re-authorisation.
// ---------------------------------------------------------------------------

describe('JF-5B-R3 authenticated discovery re-authorises every candidate, every run', () => {
  it('resolves the owner set to the EXACT objects discovery returned', () => {
    const result = resolveOwnerCandidateShortlist(OWNER_SET, ELIGIBLE);
    expect(result.ok).toBe(true);
    const shortlist = result.ok ? result.shortlist : [];
    expect(shortlist.map((one) => one.modelId)).toEqual([...OWNER_SET]);
    // IDENTITY, not equality: a synthesised `{ modelId }` would carry no capability fields and would
    // quietly claim the endpoint said nothing about the model.
    for (const model of shortlist) {
      expect(ELIGIBLE.includes(model)).toBe(true);
    }
  });

  it('refuses a candidate the account was not offered', () => {
    expect(resolveOwnerCandidateShortlist(['not/offered'], ELIGIBLE)).toEqual({
      ok: false,
      refusal: 'owner-candidate-not-currently-eligible',
      modelId: 'not/offered',
    });
  });

  it('refuses an alias discovery REJECTED, because it never reaches the eligible list', () => {
    // `auto` is rejected by the parser as a router alias, so it is absent here by construction.
    expect(resolveOwnerCandidateShortlist(['mimo-v2.5'], []).ok).toBe(false);
  });

  it('refuses a case-only mismatch rather than repairing the spelling', () => {
    // The endpoint is the authority on how an alias is spelled. Correcting it would mean the receipt
    // named a model the owner never typed.
    expect(resolveOwnerCandidateShortlist(['GPT-5.6-LUNA'], ELIGIBLE)).toEqual({
      ok: false,
      refusal: 'owner-candidate-not-currently-eligible',
      modelId: 'GPT-5.6-LUNA',
    });
  });

  it('does NOT require context metadata for an explicit owner candidate', () => {
    // The live endpoint published none. Demanding it here would make the continuation channel useless
    // in exactly the case it was built for.
    expect(ELIGIBLE.every((one) => one.contextLength === undefined)).toBe(true);
    expect(resolveOwnerCandidateShortlist(OWNER_SET, ELIGIBLE).ok).toBe(true);
    // And the AUTOMATIC rule still refuses the same list, unchanged.
    expect(buildNaraShortlist(ELIGIBLE)).toEqual({
      ok: false,
      refusal: 'metadata-insufficient-for-truthful-shortlist',
    });
  });

  it('performs no ranking: the order out is the order the owner typed', () => {
    const reversed = [...OWNER_SET].reverse();
    const result = resolveOwnerCandidateShortlist(reversed, ELIGIBLE);
    expect(result.ok && result.shortlist.map((one) => one.modelId)).toEqual(reversed);
    // A longer-context model does not jump the queue, because nothing here reads the field.
    const withContext = ELIGIBLE.map((one) =>
      one.modelId === 'mimo-v2.5' ? discovered('mimo-v2.5', { contextLength: 1_000_000 }) : one,
    );
    const ordered = resolveOwnerCandidateShortlist(OWNER_SET, withContext);
    expect(ordered.ok && ordered.shortlist.map((one) => one.modelId)).toEqual([...OWNER_SET]);
  });
});

// ---------------------------------------------------------------------------
// Preflight.
// ---------------------------------------------------------------------------

describe('JF-5B-R3 the owner sees the exact candidate set before typing the phrase', () => {
  const summary = (naraCandidates: readonly string[]): string =>
    renderPreflightSummary({
      headSha: 'b'.repeat(40),
      worktreeClean: true,
      ciRunId: '34606043399',
      ciConclusion: 'success',
      outputDirectory: 'D:/jarvis-certification/JF-5B/run-5',
      runId: 'run.jf5b.001',
      groqCertificationModelId: 'openai/gpt-oss-120b',
      naraCandidates,
    }).join('\n');

  it('renders the source and every alias, numbered, above the confirmation line', () => {
    const text = summary(OWNER_SET);
    expect(text).toContain('nara candidate source  OWNER_EXPLICIT');
    for (const [position, alias] of OWNER_SET.entries()) {
      expect(text).toContain(`nara candidate ${String(position + 1)}       ${alias}`);
    }
    // ABOVE the phrase: a decision shown after the confirmation is a decision nobody consented to.
    expect(text.indexOf('nara candidate 1')).toBeLessThan(text.indexOf('To proceed, type exactly'));
  });

  it('says DISCOVERY_METADATA when the owner supplied none', () => {
    const text = summary([]);
    expect(text).toContain('nara candidate source  DISCOVERY_METADATA');
    expect(text).not.toContain('OWNER_EXPLICIT');
    expect(text).not.toContain('nara candidate 1');
  });

  it('still states every fact it always did, and no secret', () => {
    const text = summary(OWNER_SET);
    for (const fact of [
      'repository head',
      'nara discovery',
      'max estimated spend',
      'riya prompt',
    ]) {
      expect(text).toContain(fact);
    }
    expect(text.toLowerCase()).not.toContain(['api', 'key'].join('-'));
  });
});

// ---------------------------------------------------------------------------
// Nothing became a constant.
// ---------------------------------------------------------------------------

describe('JF-5B-R3 no owner alias becomes a production constant', () => {
  it('names no candidate alias in any production source file', async () => {
    const fs = await import('node:fs');
    const path = await import('node:path');
    const url = await import('node:url');
    const roots = [
      url.fileURLToPath(new URL('../../../../packages', import.meta.url)),
      url.fileURLToPath(new URL('../../../../apps', import.meta.url)),
    ];
    const walk = (dir: string): string[] =>
      [...fs.readdirSync(dir)].flatMap((entry) => {
        if (['node_modules', 'dist', '.turbo', 'coverage', '.git'].includes(entry)) {
          return [];
        }
        const full = path.join(dir, entry);
        return fs.statSync(full).isDirectory()
          ? walk(full)
          : full.endsWith('.ts') && !full.replace(/\\/gu, '/').includes('/src/tests/')
            ? [full]
            : [];
      });
    for (const root of roots) {
      for (const file of walk(root)) {
        const text = fs.readFileSync(file, 'utf8');
        for (const alias of OWNER_SET) {
          expect({
            file: file.split(/[\\/]/u).pop(),
            alias,
            present: text.includes(alias),
          }).toEqual({
            file: file.split(/[\\/]/u).pop(),
            alias,
            present: false,
          });
        }
      }
    }
  });
});
