/**
 * The prompt content firewall, and the parity `prepareCase` proves before warmup.
 *
 * ### The pull this resists
 *
 * Performance under REAL prompts is what an owner actually wants, and the most realistic Riya prompts
 * in the repository are the Human Gold corpus and the protected P10 exam. A benchmark that could read
 * either would be a second, ungoverned copy of both, sitting outside every firewall built for them and
 * committed as "just fixtures". So the registry is closed and generated, and these specs are what keeps
 * it that way when somebody later asks for "more realistic" numbers.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { RiyaLocalBenchmarkError } from '../contracts/errors.js';
import {
  isRiyaSyntheticPromptProfileId,
  materializeRiyaSyntheticPromptProfile,
  riyaSyntheticPromptProfileDigest,
  RIYA_SYNTHETIC_PROMPT_PROFILE_IDS,
} from '../prompts/synthetic-profiles.js';
import { createRiyaLocalBenchmarkTarget } from '../service/local-engine-target.js';
import { FakeEngineTransport, FakeTokenizer, fakeHealthyStream } from '../testing/fakes.js';
import {
  FIXTURE_MODEL_ID,
  fixtureConfig,
  fixtureConfigInput,
  fixtureWorkload,
} from './fixtures.js';

const SRC = fileURLToPath(new URL('../', import.meta.url));

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === 'dist') continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      out.push(...walk(full));
    } else if (entry.endsWith('.ts')) {
      out.push(full);
    }
  }
  return out;
}

describe('the registry is closed, generated and deterministic', () => {
  it('offers exactly three profiles and refuses anything else', () => {
    expect([...RIYA_SYNTHETIC_PROMPT_PROFILE_IDS]).toStrictEqual([
      'synthetic.short.chat.v1',
      'synthetic.medium.chat.v1',
      'synthetic.long.chat.v1',
    ]);
    expect(isRiyaSyntheticPromptProfileId('synthetic.custom.v1')).toBe(false);
    expect(() => materializeRiyaSyntheticPromptProfile('gold.trajectory.v1')).toThrow(
      RiyaLocalBenchmarkError,
    );
  });

  it('produces identical bytes on every call, so a digest authored last week still matches', () => {
    for (const id of RIYA_SYNTHETIC_PROMPT_PROFILE_IDS) {
      expect(materializeRiyaSyntheticPromptProfile(id)).toStrictEqual(
        materializeRiyaSyntheticPromptProfile(id),
      );
      expect(riyaSyntheticPromptProfileDigest(id)).toBe(riyaSyntheticPromptProfileDigest(id));
      expect(riyaSyntheticPromptProfileDigest(id)).toMatch(/^[0-9a-f]{64}$/u);
    }
  });

  it('gives every profile its own digest, and grows in the direction its name claims', () => {
    const digests = RIYA_SYNTHETIC_PROMPT_PROFILE_IDS.map((id) =>
      riyaSyntheticPromptProfileDigest(id),
    );
    expect(new Set(digests).size).toBe(3);
    const sizes = RIYA_SYNTHETIC_PROMPT_PROFILE_IDS.map((id) =>
      materializeRiyaSyntheticPromptProfile(id).reduce(
        (total, message) => total + message.content.length,
        0,
      ),
    );
    expect(sizes[0]).toBeLessThan(sizes[1] ?? 0);
    expect(sizes[1]).toBeLessThan(sizes[2] ?? 0);
  });

  it('never repeats a line, so a prefix cache cannot answer a later turn for free', () => {
    // A repeated turn would turn a latency measurement into a cache-hit measurement, and the number
    // would look like a very fast model.
    const messages = materializeRiyaSyntheticPromptProfile('synthetic.long.chat.v1');
    const bodies = messages.slice(1).map((one) => one.content);
    expect(new Set(bodies).size).toBe(bodies.length);
  });

  it('carries no business, personal or protected content in any profile', () => {
    for (const id of RIYA_SYNTHETIC_PROMPT_PROFILE_IDS) {
      const text = materializeRiyaSyntheticPromptProfile(id)
        .map((one) => one.content)
        .join(' ')
        .toLowerCase();
      for (const sentinel of [
        'quickfurno',
        'onedecore',
        'riya',
        'aarohi',
        'anisha',
        'p10',
        'gold',
        'customer',
        'invoice',
        'price',
        'whatsapp',
        'discount',
        'warranty',
        'delivery',
        '@',
        'http',
        '+91',
      ]) {
        expect(text, `${id} must not contain ${sentinel}`).not.toContain(sentinel);
      }
      // Filler and punctuation only. No digits at all, so nothing here can be read as a figure.
      for (const message of materializeRiyaSyntheticPromptProfile(id).slice(1)) {
        expect(message.content).toMatch(/^[a-z .]+$/u);
      }
    }
  });
});

describe('no protected corpus can reach a benchmark prompt', () => {
  it('names no dataset, corpus or protected-fixture package anywhere in production source', () => {
    // RAW source, deliberately: a false negative at a content firewall is the expensive direction.
    for (const file of walk(SRC)) {
      if (file.includes(join('src', 'tests'))) continue;
      const source = readFileSync(file, 'utf8');
      for (const forbidden of [
        'riya-intelligence-dataset',
        'riya-quality-evaluation',
        'riya-ai-synthetic',
        'prompt-registry',
        'governed-knowledge',
        'HUMAN_AUTHORED',
        'GOLDEN_FIXTURES',
        'gold-v1',
        'wave-1',
        'RWC-P10',
      ]) {
        expect(source, `${file} must not name ${forbidden}`).not.toContain(forbidden);
      }
    }
  });

  it('reads no file and no environment outside the CLI and the artifact writer', () => {
    // The engine tokenizer, the transport, the target and the registry are all pure of I/O beyond the
    // one socket. Only the CLI reads a plan, and only the writer writes an artifact.
    const allowed = new Set([
      join(SRC, 'cli', 'local-benchmark.ts'),
      join(SRC, 'cli', 'bin.ts'),
      join(SRC, 'service', 'artifact-writer.ts'),
    ]);
    for (const file of walk(SRC)) {
      if (file.includes(join('src', 'tests')) || allowed.has(file)) continue;
      for (const forbidden of ['node:fs', 'readFile', 'writeFile', 'process.env']) {
        expect(readFileSync(file, 'utf8'), `${file} must not name ${forbidden}`).not.toContain(
          forbidden,
        );
      }
    }
  });
});

describe('prepareCase proves the prompt before any measured work', () => {
  const healthyTransport = (): FakeEngineTransport =>
    new FakeEngineTransport({
      script: [{ chunks: fakeHealthyStream({ model: FIXTURE_MODEL_ID }) }],
    });

  it('returns the digest it MATERIALIZED, the count the ENGINE gave, and the configured sampling', async () => {
    const config = fixtureConfig();
    const target = createRiyaLocalBenchmarkTarget({
      config,
      transport: healthyTransport(),
      tokenizer: new FakeTokenizer({ promptTokens: 11 }),
    });
    const workload = fixtureWorkload();
    const prepared = await target.prepareCase(workload);
    expect(prepared).toStrictEqual({
      workloadCaseId: workload.workloadCaseId,
      promptProfileDigest: riyaSyntheticPromptProfileDigest('synthetic.short.chat.v1'),
      inputTokenCount: 11,
      maximumOutputTokens: 32,
      samplingConfigDigest: config.samplingConfigDigest,
      streaming: true,
    });
  });

  it('refuses a plan whose declared prompt digest it cannot reproduce', async () => {
    const target = createRiyaLocalBenchmarkTarget({
      config: fixtureConfig(),
      transport: healthyTransport(),
      tokenizer: new FakeTokenizer({ promptTokens: 11 }),
    });
    await expect(
      target.prepareCase(fixtureWorkload({ promptProfileDigest: 'b'.repeat(64) })),
    ).rejects.toMatchObject({ code: 'PROMPT_PROFILE_DIGEST_MISMATCH' });
  });

  it('refuses a case the configuration has no prompt binding for', async () => {
    const target = createRiyaLocalBenchmarkTarget({
      config: fixtureConfig(),
      transport: healthyTransport(),
      tokenizer: new FakeTokenizer({ promptTokens: 11 }),
    });
    await expect(
      target.prepareCase(fixtureWorkload({ workloadCaseId: 'case.unbound' })),
    ).rejects.toMatchObject({ code: 'PROMPT_PROFILE_UNKNOWN' });
  });

  it('refuses a configuration binding a case to a profile outside the registry', () => {
    expect(() =>
      fixtureConfig({ casePromptProfiles: { 'case.short.c1': 'gold.trajectory.v1' } }),
    ).toThrow(RiyaLocalBenchmarkError);
  });

  it('refuses a plan authored under different sampling', async () => {
    const target = createRiyaLocalBenchmarkTarget({
      config: fixtureConfig(),
      transport: healthyTransport(),
      tokenizer: new FakeTokenizer({ promptTokens: 11 }),
    });
    await expect(
      target.prepareCase(fixtureWorkload({ samplingConfigDigest: 'c'.repeat(64) })),
    ).rejects.toMatchObject({ code: 'SAMPLING_CONFIG_MISMATCH' });
  });

  it('refuses a non-streamed case, which has no first token to observe', async () => {
    const target = createRiyaLocalBenchmarkTarget({
      config: fixtureConfig(),
      transport: healthyTransport(),
      tokenizer: new FakeTokenizer({ promptTokens: 11 }),
    });
    await expect(target.prepareCase(fixtureWorkload({ streaming: false }))).rejects.toMatchObject({
      code: 'STREAMING_REQUIRED',
    });
  });

  it('refuses a deadline it could not honour EXACTLY', async () => {
    // A JavaScript timer resolves in milliseconds. Rounding 5_000_500 microseconds down would mean two
    // plans that differ compare as equal while having abandoned slow requests at the same moment.
    const target = createRiyaLocalBenchmarkTarget({
      config: fixtureConfig(),
      transport: healthyTransport(),
      tokenizer: new FakeTokenizer({ promptTokens: 11 }),
    });
    await expect(
      target.prepareCase(fixtureWorkload({ requestTimeoutMicros: 5_000_500 })),
    ).rejects.toMatchObject({ code: 'REQUEST_TIMEOUT_NOT_MILLISECOND_EXACT' });
  });

  it('refuses a tokenizer that throws, or that answers with something impossible', async () => {
    const config = fixtureConfig();
    for (const tokenizer of [
      new FakeTokenizer({ throwOnPrompt: true }),
      new FakeTokenizer({ rawPromptTokens: 0 }),
      new FakeTokenizer({ rawPromptTokens: 11.5 }),
      new FakeTokenizer({ rawPromptTokens: '11' }),
    ]) {
      const target = createRiyaLocalBenchmarkTarget({
        config,
        transport: healthyTransport(),
        tokenizer,
      });
      await expect(target.prepareCase(fixtureWorkload())).rejects.toMatchObject({
        code: 'TOKENIZER_INVALID',
      });
    }
  });

  it('NEGATIVE CONTROL: a configuration that echoed the plan would pass a check that means nothing', async () => {
    // The vacuous version of the parity check is an adapter that returns the workload's own values.
    // This proves the adapter does NOT do that: it reports the count the tokenizer gave, and RMB-B is
    // then able to see the disagreement. If `prepareCase` echoed `workload.inputTokenCount`, this
    // expectation would fail with 11.
    const target = createRiyaLocalBenchmarkTarget({
      config: fixtureConfig(),
      transport: healthyTransport(),
      tokenizer: new FakeTokenizer({ promptTokens: 480 }),
    });
    const prepared = await target.prepareCase(fixtureWorkload({ inputTokenCount: 11 }));
    expect(prepared.inputTokenCount).toBe(480);
  });
});

describe('the configuration itself carries no prompt text', () => {
  it('binds profiles by id only', () => {
    expect(fixtureConfig().casePromptProfiles).toStrictEqual({
      'case.short.c1': 'synthetic.short.chat.v1',
    });
    expect(JSON.stringify(fixtureConfigInput())).not.toContain('You are');
  });
});
