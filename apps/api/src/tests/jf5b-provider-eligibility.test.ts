/**
 * The two production blockers JF-5B found by running the governed cases for real.
 *
 * ### Why these are pinned HERE, as their own specs
 *
 * The certification engine reports both as `INCONCLUSIVE` results, which is the honest thing for a
 * receipt to say and a poor thing for a diagnosis to say. A reader looking at a manifest full of
 * "could not tell" deserves to know exactly WHAT could not tell, and to have it asserted against the
 * real production contracts rather than described in prose that can drift.
 *
 * Both specs are written so they FAIL when the blocker is lifted. That is deliberate: whoever raises
 * `NARA_SUPPORTS_STRICT_JSON_SCHEMA`, or makes the generic reply schema strict-projectable, should be
 * told by the build that JF-5B's five blocked pairs are now runnable — rather than having a stale
 * "known blocked" comment quietly outlive the thing it described.
 *
 * ### Neither is repaired here, and that is the lane boundary
 *
 * JF-5B-R1's mandate is to close the missing EXECUTABLE WIRING and nothing else. Both repairs change
 * production behaviour for every deployment and every agent — one edits a core structured-output
 * contract in `@qf-jarvis/agent-runtime`, the other flips a provider capability whose own
 * documentation says live evidence must come first. Each is an owner decision with its own lane.
 */
import {
  createFetchNaraTransport,
  createNaraApiKey,
  createNaraProviderConfig,
  capabilitiesSatisfy,
  projectGroqStrictJsonSchema,
  renderStructuredJsonSchema,
} from '@qf-jarvis/model-gateway';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';
import { z } from 'zod';

/**
 * The generic structured reply schema, RESTATED from the shape the model reply adapter renders.
 *
 * Restated rather than imported because `@qf-jarvis/agent-runtime` does not export it, and the point
 * being pinned is a property of the rendered DOCUMENT — four properties, two of them optional. The
 * assertion below fails if that document ever becomes strict-projectable, which is exactly when
 * somebody should come and read this file.
 */
const genericReplyShape = z
  .object({
    kind: z.enum(['REPLY', 'ESCALATE_TO_HUMAN', 'REQUEST_CLARIFICATION', 'NO_ACTION']),
    // OPTIONAL. This is the whole finding.
    replyBody: z.string().min(1).max(8192).optional(),
    reasonCode: z
      .string()
      .min(1)
      .max(64)
      .regex(/^[A-Za-z0-9._:-]+$/u)
      .optional(),
    citations: z.array(z.object({ knowledgeId: z.string(), version: z.int() }).strict()).max(64),
  })
  .strict();

describe('JF-5B finding 1: the generic reply schema is not projectable to Groq strict mode', () => {
  it('renders with two of its four properties absent from `required`', () => {
    const rendered = renderStructuredJsonSchema(genericReplyShape) as {
      properties: Record<string, unknown>;
      required: readonly string[];
    };
    expect(Object.keys(rendered.properties).sort()).toEqual([
      'citations',
      'kind',
      'reasonCode',
      'replyBody',
    ]);
    // Groq strict mode has no concept of an absent property: every key of every object must appear in
    // `required`. Two of these four do not.
    expect([...rendered.required].sort()).toEqual(['citations', 'kind']);
  });

  it('is REFUSED by the projection, before any transport call, as `malformed-object`', () => {
    const projected = projectGroqStrictJsonSchema(renderStructuredJsonSchema(genericReplyShape));
    expect(projected).toEqual({ ok: false, reason: 'malformed-object' });
  });

  it('the REQUIRED-and-nullable form Riya already uses projects cleanly', () => {
    // Not a workaround: it is what the Riya schema was corrected to during the earlier live lane, and
    // it is the shape the generic contract would need. `.nullable()` renders to `anyOf: [T, null]`
    // with the property required, which is the supported way to say "no value this turn".
    const strictShape = z
      .object({
        kind: z.enum(['REPLY', 'ESCALATE_TO_HUMAN', 'REQUEST_CLARIFICATION', 'NO_ACTION']),
        replyBody: z.string().nullable(),
        reasonCode: z.string().nullable(),
        citations: z.array(z.object({ knowledgeId: z.string(), version: z.int() }).strict()),
      })
      .strict();
    expect(projectGroqStrictJsonSchema(renderStructuredJsonSchema(strictShape)).ok).toBe(true);
  });
});

describe('JF-5B finding 2: no Nara provider is eligible for an agent-reply request', () => {
  const naraCapabilities = () =>
    createNaraProviderConfig({
      providerId: 'nara',
      modelId: 'vendor-a/model-one',
      modelVersion: 'certification-snapshot-2026-09-11',
      executionClass: 'HOSTED',
      maxInputTokens: 16_384,
      maxCompletionTokens: 4_096,
      apiKey: createNaraApiKey('nara-synthetic-certification-key-0000'),
      transport: createFetchNaraTransport(),
      dataControlsAttested: true,
    }).capabilities;

  it('Nara declares no strict JSON-Schema support, and it is not a caller choice', () => {
    expect(naraCapabilities().supportsStrictJsonSchema).toBe(false);
    // Structured output itself is supported — the gap is specifically strict schema.
    expect(naraCapabilities().supportsStructuredOutput).toBe(true);
  });

  it('every agent-reply request demands strict JSON schema, so capability matching refuses', () => {
    // Exactly what `build-gateway-request.ts` puts on every request it builds: `strictJsonSchema` is
    // hardcoded `true` there, for every agent, every task class and every deployment.
    const required = {
      structuredOutput: true,
      strictJsonSchema: true,
      cancellation: false,
      minContextTokens: 1,
    };
    expect(capabilitiesSatisfy(naraCapabilities(), required)).toBe(false);
    // And it is the strict flag alone that refuses: drop it and the same provider satisfies.
    expect(capabilitiesSatisfy(naraCapabilities(), { ...required, strictJsonSchema: false })).toBe(
      true,
    );
  });
});

describe('JF-5B the evaluation gateway crosses providers only under AUTO', () => {
  /**
   * A SOURCE lock, and a mutation control is why.
   *
   * Changing `allowFallback: posture === 'AUTO'` to `allowFallback: true` broke no behavioural spec,
   * because a single-provider gateway has no second provider to fall back TO — the flag would sit
   * there, harmless today, and become a silent cross-provider call the moment a second provider was
   * registered for a posture that is supposed to have one. The rule is about the CONSTRUCTION, so the
   * construction is what is asserted.
   */
  const runner = readFileSync(
    fileURLToPath(new URL('../composition/jf5b-certification-runner-impl.ts', import.meta.url)),
    'utf8',
  );

  it('binds the fallback flag to the posture, and never to a constant', () => {
    expect(runner.match(/allowFallback:/gu)).toHaveLength(1);
    expect(runner).toContain("allowFallback: posture === 'AUTO'");
    expect(runner).not.toMatch(/allowFallback:\s*true/u);
  });

  it('leaves the retry budget alone, because the adapter already pins it to zero', () => {
    // A retry budget here would be a second opinion about retries, and the first one is the contract.
    expect(runner).not.toMatch(/retryBudget\s*:\s*[1-9]/u);
    expect(runner).not.toMatch(/maxAttempts\s*:\s*[2-9]/u);
  });
});
